import browser from "webextension-polyfill";
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

class DomainTrackerService {
  private isInitialized = false;

  /**
   * Initialize the domain tracker.
   * Sets up webRequest and tab listeners.
   */
  initialize(): void {
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
      store.initTabDomains(tabId, url, domain);
      return;
    }

    // Add domain to existing tab tracking
    store.addTabDomain(tabId, domain);
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
