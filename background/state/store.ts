import browser from "webextension-polyfill";
import { isSameSite } from "~/utils/validation";
import { logger } from "~/utils/logger";
import { ErrorHandler, ErrorType } from "~/utils/error-handler";
import { DEFAULTS } from "~/utils/constants";
import type {
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
  // Legacy single-instance state (for backwards compatibility)
  private state: ExtensionState;

  // Multi-instance state
  private instanceStates: Map<string, InstanceState> = new Map();
  private instanceCaches: Map<string, CachedData<StatsSummary>> = new Map();

  // Active instance tracking
  private activeInstanceId: string | null = null;

  // Tab domain tracking
  private tabDomains: Map<number, TabDomainData> = new Map();

  // State change listeners
  private listeners: Set<StateListener> = new Set();

  constructor() {
    this.state = this.getInitialState();
  }

  // ===== Legacy API (backwards compatibility) =====

  /**
   * Get current state (immutable copy).
   * Returns state for active instance, or aggregated state if in "All" mode.
   */
  getState(): ExtensionState {
    // If we have an active instance, return its state
    if (this.activeInstanceId) {
      const instanceState = this.instanceStates.get(this.activeInstanceId);
      if (instanceState) {
        return this.instanceStateToExtensionState(instanceState);
      }
    }

    // If in "All" mode with multiple instances, return aggregated state
    if (this.instanceStates.size > 0) {
      const connectedStates = Array.from(this.instanceStates.values()).filter(
        (s) => s.isConnected,
      );

      if (connectedStates.length > 0) {
        // Aggregate stats from all connected instances
        let aggregatedStats: StatsSummary | null = null;
        const statsStates = connectedStates.filter((s) => s.stats !== null);
        if (statsStates.length > 0) {
          aggregatedStats = this.aggregateStats(
            statsStates.map((s) => s.stats!),
          );
        }

        // Determine blocking state - only enabled if ALL instances have blocking enabled
        const allEnabled = connectedStates.every((s) => s.blockingEnabled);

        return {
          ...this.state,
          isConnected: true,
          connectionError: null,
          blockingEnabled: allEnabled, // Only true if all enabled
          blockingTimer: null, // Timer doesn't make sense in aggregate mode
          stats: aggregatedStats,
          totpRequired: false,
        };
      }
    }

    // Fallback to legacy state
    return { ...this.state };
  }

  /**
   * Update state with partial values.
   * Updates the active instance state if set.
   */
  setState(partial: Partial<ExtensionState>): void {
    // Update legacy state
    this.state = { ...this.state, ...partial };

    // Also update active instance state if set
    if (this.activeInstanceId) {
      this.updateInstanceState(this.activeInstanceId, {
        isConnected: partial.isConnected,
        connectionError: partial.connectionError,
        blockingEnabled: partial.blockingEnabled,
        blockingTimer: partial.blockingTimer,
        stats: partial.stats,
        statsLastUpdated: partial.statsLastUpdated,
        totpRequired: partial.totpRequired,
      });
    }

    this.notifyListeners();
    this.broadcastStateUpdate();
  }

  /**
   * Reset state to initial values.
   */
  reset(): void {
    this.state = this.getInitialState();
    this.tabDomains.clear();
    this.notifyListeners();
    this.broadcastStateUpdate();
  }

  // ===== Multi-Instance State API =====

  /**
   * Set the active instance ID.
   */
  setActiveInstanceId(instanceId: string | null): void {
    this.activeInstanceId = instanceId;

    // If switching to a specific instance, sync legacy state
    if (instanceId) {
      const instanceState = this.instanceStates.get(instanceId);
      if (instanceState) {
        this.state = this.instanceStateToExtensionState(instanceState);
      }
    }

    this.notifyListeners();
    this.broadcastStateUpdate();
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
   * Update state for a specific instance.
   */
  updateInstanceState(
    instanceId: string,
    partial: Partial<Omit<InstanceState, "instanceId">>,
  ): void {
    let state = this.instanceStates.get(instanceId);

    if (!state) {
      state = this.getInitialInstanceState(instanceId);
    }

    // Apply partial updates, filtering out undefined values
    const updates: Partial<InstanceState> = {};
    if (partial.isConnected !== undefined)
      updates.isConnected = partial.isConnected;
    if (partial.connectionError !== undefined)
      updates.connectionError = partial.connectionError;
    if (partial.blockingEnabled !== undefined)
      updates.blockingEnabled = partial.blockingEnabled;
    if (partial.blockingTimer !== undefined)
      updates.blockingTimer = partial.blockingTimer;
    if (partial.stats !== undefined) updates.stats = partial.stats;
    if (partial.statsLastUpdated !== undefined)
      updates.statsLastUpdated = partial.statsLastUpdated;
    if (partial.totpRequired !== undefined)
      updates.totpRequired = partial.totpRequired;

    this.instanceStates.set(instanceId, { ...state, ...updates });

    // Update cache if stats were updated
    if (partial.stats !== undefined && partial.stats !== null) {
      this.instanceCaches.set(instanceId, {
        data: partial.stats,
        cachedAt: Date.now(),
        ttl: DEFAULTS.CACHE_TTL,
      });
    }

    // If this is the active instance, also update legacy state
    if (instanceId === this.activeInstanceId) {
      this.state = this.instanceStateToExtensionState(
        this.instanceStates.get(instanceId)!,
      );
      this.notifyListeners();
      this.broadcastStateUpdate();
    }
  }

  /**
   * Reset state for a specific instance.
   */
  resetInstanceState(instanceId: string): void {
    this.instanceStates.set(
      instanceId,
      this.getInitialInstanceState(instanceId),
    );
    this.instanceCaches.delete(instanceId);

    if (instanceId === this.activeInstanceId) {
      this.state = this.getInitialState();
      this.notifyListeners();
      this.broadcastStateUpdate();
    }
  }

  /**
   * Remove state for a specific instance.
   */
  removeInstanceState(instanceId: string): void {
    this.instanceStates.delete(instanceId);
    this.instanceCaches.delete(instanceId);

    if (instanceId === this.activeInstanceId) {
      this.activeInstanceId = null;
      this.state = this.getInitialState();
      this.notifyListeners();
      this.broadcastStateUpdate();
    }
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
   * Add a domain to tab tracking.
   */
  addTabDomain(tabId: number, domain: string): void {
    const data = this.tabDomains.get(tabId);
    if (!data) return;

    // Check if domain is already tracked
    const wasNew = !data.domains.has(domain);
    data.domains.add(domain);

    // Check if third-party
    if (
      domain !== data.firstPartyDomain &&
      !isSameSite(domain, data.firstPartyDomain)
    ) {
      data.thirdPartyDomains.add(domain);
    }

    // Broadcast update if this was a new domain
    if (wasNew) {
      this.broadcastTabDomainsUpdate(tabId);
    }
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
   * Broadcast state update to popup/sidebar/options.
   */
  private async broadcastStateUpdate(): Promise<void> {
    try {
      await browser.runtime.sendMessage({
        type: "STATE_UPDATED",
        payload: this.getState(),
      });
    } catch (error) {
      // No listeners is normal (popup/sidebar may not be open)
      // Only log if it's a real error, not "Could not establish connection"
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      if (!errorMessage.includes("Could not establish connection")) {
        logger.debug("Failed to broadcast state update:", error);
      }
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
