import browser from "webextension-polyfill";
import { isSameSite } from "~/utils/validation";
import { logger } from "~/utils/logger";
import { ErrorHandler, ErrorType } from "~/utils/error-handler";
import { DEFAULTS } from "~/utils/constants";
import type {
  BlockingStatus,
  AggregatedState,
  CachedData,
  ExtensionState,
  InstanceState,
  StatsSummary,
  TabDomainData,
} from "~/utils/types";

/**
 * Central state store for the extension.
 *
 * Manages:
 * - Per-instance connection and blocking status
 * - Cached statistics with TTL
 * - Per-tab domain tracking
 * - State change notifications
 * - Aggregated state for "All" mode
 */

type StateListener = (state: ExtensionState) => void;

class StateStore {
  // Multi-instance state
  private instanceStates: Map<string, InstanceState> = new Map();
  private instanceCaches: Map<string, CachedData<StatsSummary>> = new Map();

  // Active instance tracking
  private activeInstanceId: string | null = null;

  // Tab domain tracking
  private tabDomains: Map<number, TabDomainData> = new Map();

  // State change listeners
  private listeners: Set<StateListener> = new Set();

  // Mutex prevents race conditions during concurrent state updates
  private updateLock: Promise<void> = Promise.resolve();

  // State transitions serialize mutation and publication together.

  /**
   * Acquire lock for state updates via promise chaining.
   * Ensures serialized access to state modifications.
   *
   * Uses a chained-promise pattern instead of a traditional mutex:
   * 1. New operations chain onto `this.updateLock`
   * 2. Each operation awaits the previous one before executing
   * 3. Release happens in finally block, unblocking next operation
   *
   * @param fn - Function to execute while holding the lock
   * @returns Result of the function
   */
  private async withLock<T>(fn: () => T | Promise<T>): Promise<T> {
    // Chain onto existing lock
    const currentLock = this.updateLock;
    let releaseLock: () => void;
    this.updateLock = new Promise((resolve) => {
      releaseLock = resolve;
    });

    try {
      // Wait for previous operation to complete
      await currentLock;
      // Execute the function
      return await fn();
    } finally {
      // Release lock for next operation
      releaseLock!();
    }
  }

  // ===== External state projection =====

  /**
   * Get current state (immutable copy).
   * Returns state for active instance, or aggregated state if in "All" mode.
   */
  getState(): ExtensionState {
    const initialState = this.getInitialState();
    if (this.activeInstanceId) {
      const instanceState = this.instanceStates.get(this.activeInstanceId);
      if (instanceState) {
        return this.instanceStateToExtensionState(instanceState);
      }
    }

    if (this.instanceStates.size === 0) {
      return initialState;
    }

    const connectedStates = Array.from(this.instanceStates.values()).filter(
      (state) => state.isConnected,
    );
    if (connectedStates.length === 0) {
      return {
        ...initialState,
        connectionError: "All instances disconnected",
      };
    }

    const statsStates = connectedStates.filter((state) => state.stats !== null);
    return {
      ...initialState,
      isConnected: true,
      blockingEnabled: connectedStates.every((state) => state.blockingEnabled),
      stats:
        statsStates.length > 0
          ? this.aggregateStats(statsStates.map((state) => state.stats!))
          : null,
    };
  }

  // ===== Instance lifecycle transitions =====

  /**
   * Projects a successfully authenticated instance.
   */
  async connectionSucceeded(instanceId: string): Promise<void> {
    await this.withLock(async () => {
      const state =
        this.instanceStates.get(instanceId) ??
        this.getInitialInstanceState(instanceId);
      this.instanceStates.set(instanceId, {
        ...state,
        isConnected: true,
        connectionError: null,
        totpRequired: false,
      });
      await this.publishStateChange();
    });
  }

  /**
   * Projects an authentication challenge without treating it as a connection.
   */
  async requireTotp(instanceId: string): Promise<void> {
    await this.withLock(async () => {
      this.instanceStates.set(instanceId, {
        ...this.getInitialInstanceState(instanceId),
        totpRequired: true,
      });
      this.instanceCaches.delete(instanceId);
      await this.publishStateChange();
    });
  }

  /**
   * Projects an unsuccessful connection attempt.
   */
  async connectionFailed(instanceId: string, error: string): Promise<void> {
    await this.withLock(async () => {
      this.instanceStates.set(instanceId, {
        ...this.getInitialInstanceState(instanceId),
        connectionError: error,
      });
      this.instanceCaches.delete(instanceId);
      await this.publishStateChange();
    });
  }

  /**
   * Records a complete statistics response as one observable transition.
   */
  async recordStatsSnapshot(
    instanceId: string,
    stats: StatsSummary,
  ): Promise<void> {
    await this.withLock(async () => {
      const state =
        this.instanceStates.get(instanceId) ??
        this.getInitialInstanceState(instanceId);
      const statsLastUpdated = Date.now();
      this.instanceStates.set(instanceId, {
        ...state,
        isConnected: true,
        connectionError: null,
        totpRequired: false,
        stats,
        statsLastUpdated,
      });
      this.instanceCaches.set(instanceId, {
        data: stats,
        cachedAt: statsLastUpdated,
        ttl: DEFAULTS.CACHE_TTL,
      });
      await this.publishStateChange();
    });
  }

  /**
   * Records a complete blocking response only for an existing connected
   * session. Lifecycle operations own connectivity, authentication, and
   * membership; a late blocking response may update neither.
   */
  async recordBlockingSnapshot(
    instanceId: string,
    status: BlockingStatus,
  ): Promise<boolean> {
    return this.withLock(async () => {
      const state = this.instanceStates.get(instanceId);
      if (!state?.isConnected || state.totpRequired) return false;

      this.instanceStates.set(instanceId, {
        ...state,
        blockingEnabled: status.blocking === "enabled",
        blockingTimer: status.timer,
      });
      await this.publishStateChange();
      return true;
    });
  }

  /**
   * Changes the projection from one instance to another, or to "All".
   */
  async selectInstance(instanceId: string | null): Promise<void> {
    await this.withLock(async () => {
      this.activeInstanceId = instanceId;
      await this.publishStateChange();
    });
  }

  /**
   * Clears all session-derived values while retaining the disconnected instance.
   */
  async disconnectInstance(instanceId: string): Promise<void> {
    await this.withLock(async () => {
      this.instanceStates.set(
        instanceId,
        this.getInitialInstanceState(instanceId),
      );
      this.instanceCaches.delete(instanceId);
      await this.publishStateChange();
    });
  }

  /**
   * Removes an instance projection and atomically projects the persisted
   * selection that remains after removal.
   */
  async removeInstance(
    instanceId: string,
    activeInstanceId: string | null = null,
  ): Promise<void> {
    await this.withLock(async () => {
      this.instanceStates.delete(instanceId);
      this.instanceCaches.delete(instanceId);
      this.activeInstanceId = activeInstanceId;
      await this.publishStateChange();
    });
  }

  /**
   * Get the active instance ID.
   */
  getActiveInstanceId(): string | null {
    return this.activeInstanceId;
  }

  /**
   * Get state for a specific instance.
   */
  getInstanceState(instanceId: string): InstanceState | null {
    return this.instanceStates.get(instanceId) || null;
  }

  /**
   * Get all instance IDs with state.
   */
  getInstanceIds(): string[] {
    return Array.from(this.instanceStates.keys());
  }

  // ===== Caching API =====

  /**
   * Get cached stats for an instance.
   * Returns null if cache is expired or doesn't exist.
   */
  getCachedStats(instanceId: string): StatsSummary | null {
    const cache = this.instanceCaches.get(instanceId);
    if (!cache) return null;

    const isExpired = Date.now() - cache.cachedAt > cache.ttl;
    if (isExpired) {
      return null;
    }

    return cache.data;
  }

  /**
   * Check if cache is valid for an instance.
   */
  isCacheValid(instanceId: string): boolean {
    return this.getCachedStats(instanceId) !== null;
  }

  /**
   * Invalidate cache for an instance.
   */
  invalidateCache(instanceId: string): void {
    this.instanceCaches.delete(instanceId);
  }

  /**
   * Invalidate all caches.
   */
  invalidateAllCaches(): void {
    this.instanceCaches.clear();
  }

  // ===== Aggregation API =====

  /**
   * Get aggregated state across all connected instances.
   * Used for "All" mode display.
   */
  getAggregatedState(instanceNames: Map<string, string>): AggregatedState {
    const states = Array.from(this.instanceStates.values());
    const connectedStates = states.filter((s) => s.isConnected);

    // Determine blocking state
    let blockingState: "enabled" | "disabled" | "mixed" = "enabled";
    if (connectedStates.length > 0) {
      const allEnabled = connectedStates.every((s) => s.blockingEnabled);
      const allDisabled = connectedStates.every((s) => !s.blockingEnabled);
      if (allEnabled) {
        blockingState = "enabled";
      } else if (allDisabled) {
        blockingState = "disabled";
      } else {
        blockingState = "mixed";
      }
    }

    // Aggregate stats
    let aggregatedStats: StatsSummary | null = null;
    const statsStates = connectedStates.filter((s) => s.stats !== null);
    if (statsStates.length > 0) {
      aggregatedStats = this.aggregateStats(statsStates.map((s) => s.stats!));
    }

    return {
      connectedCount: connectedStates.length,
      totalCount: states.length,
      stats: aggregatedStats,
      blockingState,
      instanceStatuses: states.map((s) => ({
        instanceId: s.instanceId,
        name: instanceNames.get(s.instanceId) || s.instanceId,
        isConnected: s.isConnected,
      })),
    };
  }

  /**
   * Aggregate stats from multiple instances.
   */
  private aggregateStats(statsArray: StatsSummary[]): StatsSummary {
    if (statsArray.length === 0) {
      return {
        queries: {
          total: 0,
          blocked: 0,
          percent_blocked: 0,
          unique_domains: 0,
          forwarded: 0,
          cached: 0,
        },
        clients: { active: 0, total: 0 },
        gravity: { domains_being_blocked: 0, last_update: 0 },
      };
    }

    // Sum numeric fields
    const totalQueries = statsArray.reduce(
      (sum, s) => sum + s.queries.total,
      0,
    );
    const totalBlocked = statsArray.reduce(
      (sum, s) => sum + s.queries.blocked,
      0,
    );
    const totalUniqueDomains = statsArray.reduce(
      (sum, s) => sum + s.queries.unique_domains,
      0,
    );
    const totalForwarded = statsArray.reduce(
      (sum, s) => sum + s.queries.forwarded,
      0,
    );
    const totalCached = statsArray.reduce(
      (sum, s) => sum + s.queries.cached,
      0,
    );
    const totalActiveClients = statsArray.reduce(
      (sum, s) => sum + s.clients.active,
      0,
    );
    const totalClients = statsArray.reduce(
      (sum, s) => sum + s.clients.total,
      0,
    );
    const totalGravityDomains = statsArray.reduce(
      (sum, s) => sum + s.gravity.domains_being_blocked,
      0,
    );

    // Calculate percentage from aggregated totals
    const percentBlocked =
      totalQueries > 0 ? (totalBlocked / totalQueries) * 100 : 0;

    // Use most recent gravity update time
    const latestGravityUpdate = Math.max(
      ...statsArray.map((s) => s.gravity.last_update),
    );

    return {
      queries: {
        total: totalQueries,
        blocked: totalBlocked,
        percent_blocked: percentBlocked,
        unique_domains: totalUniqueDomains,
        forwarded: totalForwarded,
        cached: totalCached,
      },
      clients: {
        active: totalActiveClients,
        total: totalClients,
      },
      gravity: {
        domains_being_blocked: totalGravityDomains,
        last_update: latestGravityUpdate,
      },
    };
  }

  // ===== State Subscription =====

  /**
   * Subscribe to state changes.
   * Returns unsubscribe function.
   */
  subscribe(listener: StateListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // ===== Tab Domain Tracking =====

  /**
   * Get domains for a tab.
   */
  getTabDomains(tabId: number): TabDomainData | null {
    const data = this.tabDomains.get(tabId);
    if (!data) return null;

    // Return serializable copy
    return {
      ...data,
      domains: new Set(data.domains),
      thirdPartyDomains: new Set(data.thirdPartyDomains),
    };
  }

  /**
   * Initialize domain tracking for a tab.
   */
  initTabDomains(
    tabId: number,
    pageUrl: string,
    firstPartyDomain: string,
  ): void {
    this.tabDomains.set(tabId, {
      tabId,
      pageUrl,
      firstPartyDomain,
      domains: new Set([firstPartyDomain]),
      thirdPartyDomains: new Set(),
    });
  }

  /**
   * PERF-2: Maximum domains to track per tab.
   * Prevents unbounded memory growth in long sessions.
   */
  private static readonly MAX_DOMAINS_PER_TAB = 500;

  /**
   * Add a domain to tab tracking.
   */
  addTabDomain(tabId: number, domain: string): void {
    const data = this.tabDomains.get(tabId);
    if (!data) return;

    // Check if domain is already tracked
    if (data.domains.has(domain)) {
      return; // Already tracked, no update needed
    }

    // PERF-2: Check if we've hit the limit
    if (data.domains.size >= StateStore.MAX_DOMAINS_PER_TAB) {
      // At limit - evict oldest domain (first item in Set iteration order)
      const oldestDomain = data.domains.values().next().value;
      if (oldestDomain && oldestDomain !== data.firstPartyDomain) {
        data.domains.delete(oldestDomain);
        data.thirdPartyDomains.delete(oldestDomain);
      } else {
        // Can't evict, just skip adding
        return;
      }
    }

    data.domains.add(domain);

    // Check if third-party
    if (
      domain !== data.firstPartyDomain &&
      !isSameSite(domain, data.firstPartyDomain)
    ) {
      data.thirdPartyDomains.add(domain);
    }

    // Broadcast update
    this.broadcastTabDomainsUpdate(tabId);
  }

  /**
   * Clear domain tracking for a tab.
   */
  clearTabDomains(tabId: number): void {
    this.tabDomains.delete(tabId);
  }

  /**
   * Get all tracked tabs.
   */
  getAllTrackedTabs(): number[] {
    return Array.from(this.tabDomains.keys());
  }

  /**
   * Get serializable tab domains for messaging.
   */
  getSerializableTabDomains(tabId: number): {
    tabId: number;
    pageUrl: string;
    firstPartyDomain: string;
    domains: string[];
    thirdPartyDomains: string[];
  } | null {
    const data = this.tabDomains.get(tabId);
    if (!data) return null;

    return {
      tabId: data.tabId,
      pageUrl: data.pageUrl,
      firstPartyDomain: data.firstPartyDomain,
      domains: Array.from(data.domains),
      thirdPartyDomains: Array.from(data.thirdPartyDomains),
    };
  }

  // ===== Private Helpers =====

  private getInitialState(): ExtensionState {
    return {
      isConnected: false,
      connectionError: null,
      blockingEnabled: true,
      blockingTimer: null,
      stats: null,
      statsLastUpdated: 0,
      totpRequired: false,
    };
  }

  private getInitialInstanceState(instanceId: string): InstanceState {
    return {
      instanceId,
      isConnected: false,
      connectionError: null,
      blockingEnabled: true,
      blockingTimer: null,
      stats: null,
      statsLastUpdated: 0,
      totpRequired: false,
    };
  }

  private instanceStateToExtensionState(state: InstanceState): ExtensionState {
    return {
      isConnected: state.isConnected,
      connectionError: state.connectionError,
      blockingEnabled: state.blockingEnabled,
      blockingTimer: state.blockingTimer,
      stats: state.stats,
      statsLastUpdated: state.statsLastUpdated,
      totpRequired: state.totpRequired,
    };
  }

  private notifyListeners(): void {
    const state = this.getState();
    this.listeners.forEach((listener) => {
      try {
        listener(state);
      } catch (error) {
        // Log listener errors but don't throw - one bad listener shouldn't break all of them
        ErrorHandler.handle(
          error,
          "State listener callback",
          ErrorType.INTERNAL,
        );
      }
    });
  }

  /**
   * Publishes the new projection after a complete state transition.
   */
  private async publishStateChange(): Promise<void> {
    this.notifyListeners();
    await this.broadcastStateUpdate();
  }

  /**
   * Clean up resources held by subscriptions.
   */
  destroy(): void {
    this.listeners.clear();
  }

  /**
   * Broadcast state update to popup/sidebar/options.
   */
  private async broadcastStateUpdate(): Promise<void> {
    try {
      await browser.runtime.sendMessage({
        type: "STATE_UPDATED",
        payload: this.getState(),
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      if (errorMessage.includes("Could not establish connection")) return;

      logger.debug("Failed to broadcast state update:", error);
      throw error;
    }
  }

  /**
   * Broadcast tab domains update to sidebar.
   */
  private async broadcastTabDomainsUpdate(tabId: number): Promise<void> {
    try {
      const data = this.getSerializableTabDomains(tabId);
      if (data) {
        await browser.runtime.sendMessage({
          type: "TAB_DOMAINS_UPDATED",
          payload: data,
        });
      }
    } catch (error) {
      // No listeners is normal (sidebar may not be open)
      // Only log if it's a real error, not "Could not establish connection"
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      if (!errorMessage.includes("Could not establish connection")) {
        logger.debug("Failed to broadcast tab domains update:", error);
      }
    }
  }
}

// Export class for testing
export { StateStore };

// Singleton instance
export const store = new StateStore();
