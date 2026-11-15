import browser from "webextension-polyfill";
import type { FleetQueries } from "../fleet/queries";
import { notificationService } from "./notifications";
import { store } from "../state/store";
import { logger } from "~/utils/logger";
import { ErrorHandler, ErrorType } from "~/utils/error-handler";
import { extractDomain } from "~/utils/utils";

/**
 * Domain Tracker Service
 *
 * Uses webRequest API to track all domains loaded by each tab.
 * Categorizes domains as first-party or third-party.
 */

const BLOCKING_ERRORS = new Set([
  "net::ERR_NAME_NOT_RESOLVED",
  "net::ERR_NAME_RESOLUTION_FAILED",
  "NS_ERROR_UNKNOWN_HOST",
  "NS_ERROR_UNKNOWN_PROXY_HOST",
  "net::ERR_CONNECTION_REFUSED",
  "net::ERR_ADDRESS_UNREACHABLE",
  "NS_ERROR_CONNECTION_REFUSED",
]);

export class DomainTrackerService {
  private queries?: Pick<FleetQueries, "searchDomain">;
  private readonly navigations = new Map<number, object>();
  private isInitialized = false;

  /**
   * Initialize the domain tracker.
   * Sets up webRequest and tab listeners.
   */
  initialize(queries: Pick<FleetQueries, "searchDomain">): void {
    this.queries = queries;
    if (this.isInitialized) return;
    this.isInitialized = true;

    try {
      // Listen for completed requests
      browser.webRequest.onCompleted.addListener(
        (details) => {
          try {
            this.handleRequest(details);
          } catch (error) {
            ErrorHandler.handle(
              error,
              "Domain tracker: onCompleted",
              ErrorType.INTERNAL,
            );
          }
        },
        { urls: ["<all_urls>"] },
      );

      // Listen for failed requests (blocked by Pi-hole, DNS errors, etc.)
      browser.webRequest.onErrorOccurred.addListener(
        (details) => {
          try {
            this.handleRequest(details);
          } catch (error) {
            ErrorHandler.handle(
              error,
              "Domain tracker: onErrorOccurred",
              ErrorType.INTERNAL,
            );
          }
        },
        { urls: ["<all_urls>"] },
      );

      // Listen for tab updates (navigation)
      browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
        try {
          if (changeInfo.status === "loading" && tab.url) {
            this.handleNavigation(tabId, tab.url);
          }
        } catch (error) {
          ErrorHandler.handle(
            error,
            "Domain tracker: tab update",
            ErrorType.INTERNAL,
          );
        }
      });

      // Listen for tab removal
      browser.tabs.onRemoved.addListener((tabId) => {
        try {
          this.navigations.delete(tabId);
          store.clearTabDomains(tabId);
        } catch (error) {
          ErrorHandler.handle(
            error,
            "Domain tracker: tab removal",
            ErrorType.INTERNAL,
          );
        }
      });

      // Initialize existing tabs
      this.initExistingTabs();

      logger.info("Domain tracker initialized");
    } catch (error) {
      ErrorHandler.handle(
        error,
        "Domain tracker initialization",
        ErrorType.INTERNAL,
      );
    }
  }

  /**
   * Get current tab's domains for sidebar display.
   */
  async getCurrentTabDomains(): Promise<{
    tabId: number;
    pageUrl: string;
    firstPartyDomain: string;
    domains: string[];
    thirdPartyDomains: string[];
  } | null> {
    try {
      const [activeTab] = await browser.tabs.query({
        active: true,
        currentWindow: true,
      });

      if (!activeTab?.id) return null;

      return store.getSerializableTabDomains(activeTab.id);
    } catch (error) {
      ErrorHandler.handle(error, "Get current tab domains", ErrorType.INTERNAL);
      return null;
    }
  }

  /**
   * Initialize tracking for already-open tabs.
   */
  private async initExistingTabs(): Promise<void> {
    try {
      const tabs = await browser.tabs.query({});
      logger.debug(`Initializing domain tracking for ${tabs.length} tabs`);

      for (const tab of tabs) {
        if (tab.id && tab.url && this.isTrackableUrl(tab.url)) {
          const domain = extractDomain(tab.url);
          if (domain) {
            store.initTabDomains(tab.id, tab.url, domain);
          }
        }
      }

      logger.info(
        `Domain tracking initialized for ${store.getAllTrackedTabs().length} tabs`,
      );
    } catch (error) {
      ErrorHandler.handle(
        error,
        "Initialize existing tabs",
        ErrorType.INTERNAL,
      );
    }
  }

  /**
   * Handle navigation to a new page.
   */
  private handleNavigation(tabId: number, url: string): void {
    this.navigations.set(tabId, {});
    if (!this.isTrackableUrl(url)) {
      store.clearTabDomains(tabId);
      return;
    }

    const domain = extractDomain(url);
    if (domain) {
      store.initTabDomains(tabId, url, domain);
    }
  }

  /**
   * Handle a web request (completed or failed).
   */
  private handleRequest(
    details:
      | browser.WebRequest.OnCompletedDetailsType
      | browser.WebRequest.OnErrorOccurredDetailsType,
  ): void {
    const { tabId, url, type } = details;

    // Ignore requests not associated with a tab
    if (tabId === -1) return;

    // Ignore speculative requests
    if (type === "speculative") return;

    // Ignore non-trackable URLs
    if (!this.isTrackableUrl(url)) return;

    const domain = extractDomain(url);
    if (!domain) return;

    // Initialize tab tracking if this is a main frame
    if (type === "main_frame") {
      const navigation = {};
      this.navigations.set(tabId, navigation);
      store.initTabDomains(tabId, url, domain);
      if ("error" in details && BLOCKING_ERRORS.has(details.error)) {
        void this.checkPageBlocked(tabId, domain, navigation);
      }
      return;
    }

    // Add domain to existing tab tracking
    store.addTabDomain(tabId, domain);
  }

  private async checkPageBlocked(
    tabId: number,
    domain: string,
    navigation: object,
  ): Promise<void> {
    try {
      const result = await this.queries?.searchDomain(domain);
      if (this.navigations.get(tabId) !== navigation) return;
      const match = result?.entries.find(
        (entry) => !entry.allowlist && (entry.gravity || entry.denylist),
      );
      if (!match) return;
      store.setTabPageBlocked(tabId, {
        domain,
        instanceName: match.instanceName,
      });
      await notificationService.showPageBlocked(domain);
    } catch (error) {
      ErrorHandler.handle(error, "Check blocked page", ErrorType.INTERNAL);
    }
  }

  /**
   * Check if URL should be tracked.
   * Skip browser internal URLs and extensions.
   */
  private isTrackableUrl(url: string): boolean {
    if (!url) return false;

    const skipPrefixes = [
      "about:",
      "chrome:",
      "chrome-extension:",
      "moz-extension:",
      "edge:",
      "brave:",
      "data:",
      "blob:",
      "javascript:",
    ];

    return !skipPrefixes.some((prefix) => url.startsWith(prefix));
  }
}

// Singleton instance
export const domainTracker = new DomainTrackerService();
