import browser from 'webextension-polyfill';
import {store} from '../state/store';

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

        // Listen for completed requests
        browser.webRequest.onCompleted.addListener(
            (details) => this.handleRequest(details),
            {urls: ['<all_urls>']}
        );

        // Listen for failed requests (blocked by Pi-hole, DNS errors, etc.)
        browser.webRequest.onErrorOccurred.addListener(
            (details) => this.handleRequest(details),
            {urls: ['<all_urls>']}
        );

        // Listen for tab updates (navigation)
        browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
            if (changeInfo.status === 'loading' && tab.url) {
                this.handleNavigation(tabId, tab.url);
            }
        });

        // Listen for tab removal
        browser.tabs.onRemoved.addListener((tabId) => {
            store.clearTabDomains(tabId);
        });

        // Initialize existing tabs
        this.initExistingTabs();
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
        } catch {
            return null;
        }
    }

    /**
     * Initialize tracking for already-open tabs.
     */
    private async initExistingTabs(): Promise<void> {
        try {
            const tabs = await browser.tabs.query({});
            for (const tab of tabs) {
                if (tab.id && tab.url && this.isTrackableUrl(tab.url)) {
                    const domain = this.extractDomain(tab.url);
                    if (domain) {
                        store.initTabDomains(tab.id, tab.url, domain);
                    }
                }
            }
        } catch (error) {
            console.error('Failed to init existing tabs:', error);
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

        const domain = this.extractDomain(url);
        if (domain) {
            store.initTabDomains(tabId, url, domain);
        }
    }

    /**
     * Handle a web request (completed or failed).
     */
    private handleRequest(
        details: browser.WebRequest.OnCompletedDetailsType | browser.WebRequest.OnErrorOccurredDetailsType
    ): void {
        const {tabId, url, type} = details;

        // Ignore requests not associated with a tab
        if (tabId === -1) return;

        // Ignore speculative requests
        if (type === 'speculative') return;

        // Ignore non-trackable URLs
        if (!this.isTrackableUrl(url)) return;

        const domain = this.extractDomain(url);
        if (!domain) return;

        // Initialize tab tracking if this is a main frame
        if (type === 'main_frame') {
            store.initTabDomains(tabId, url, domain);
            return;
        }

        // Add domain to existing tab tracking
        store.addTabDomain(tabId, domain);
    }

    /**
     * Extract domain from URL.
     */
    private extractDomain(url: string): string | null {
        try {
            const urlObj = new URL(url);
            return urlObj.hostname.toLowerCase();
        } catch {
            return null;
        }
    }

    /**
     * Check if URL should be tracked.
     * Skip browser internal URLs and extensions.
     */
    private isTrackableUrl(url: string): boolean {
        if (!url) return false;

        const skipPrefixes = [
            'about:',
            'chrome:',
            'chrome-extension:',
            'moz-extension:',
            'edge:',
            'brave:',
            'data:',
            'blob:',
            'javascript:',
        ];

        return !skipPrefixes.some((prefix) => url.startsWith(prefix));
    }
}

// Singleton instance
export const domainTracker = new DomainTrackerService();
