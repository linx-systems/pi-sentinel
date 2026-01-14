import browser from 'webextension-polyfill';
import { isSameSite } from '~/utils/utils';
import type { ExtensionState, TabDomainData } from '~/utils/types';

/**
 * Central state store for the extension.
 *
 * Manages:
 * - Connection and blocking status
 * - Cached statistics
 * - Per-tab domain tracking
 * - State change notifications
 */

type StateListener = (state: ExtensionState) => void;

class StateStore {
  private state: ExtensionState;
  private tabDomains: Map<number, TabDomainData> = new Map();
  private listeners: Set<StateListener> = new Set();

  constructor() {
    this.state = this.getInitialState();
  }

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

  /**
   * Get current state (immutable copy).
   */
  getState(): ExtensionState {
    return { ...this.state };
  }

  /**
   * Update state with partial values.
   */
  setState(partial: Partial<ExtensionState>): void {
    this.state = { ...this.state, ...partial };
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

  /**
   * Subscribe to state changes.
   * Returns unsubscribe function.
   */
  subscribe(listener: StateListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notifyListeners(): void {
    const state = this.getState();
    this.listeners.forEach((listener) => {
      try {
        listener(state);
      } catch (error) {
        console.error('State listener error:', error);
      }
    });
  }

  /**
   * Broadcast state update to popup/sidebar/options.
   */
  private async broadcastStateUpdate(): Promise<void> {
    try {
      await browser.runtime.sendMessage({
        type: 'STATE_UPDATED',
        payload: this.getState(),
      });
    } catch {
      // No listeners, ignore
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
          type: 'TAB_DOMAINS_UPDATED',
          payload: data,
        });
      }
    } catch {
      // No listeners, ignore
    }
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
  initTabDomains(tabId: number, pageUrl: string, firstPartyDomain: string): void {
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
    if (domain !== data.firstPartyDomain && !isSameSite(domain, data.firstPartyDomain)) {
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

  // ===== Serialization for Popup/Sidebar =====

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
}

// Singleton instance
export const store = new StateStore();
