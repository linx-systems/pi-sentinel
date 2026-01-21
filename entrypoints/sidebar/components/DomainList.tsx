import { useEffect, useRef, useState } from "preact/hooks";
import browser from "webextension-polyfill";
import {
  BlockIcon,
  CheckIcon,
  ClearIcon,
  GlobeIcon,
  SearchAllIcon,
  SearchIcon,
  SpinnerIcon,
} from "~/utils/icons";
import { isSameSite } from "~/utils/utils";
import { logger } from "~/utils/logger";
import type { MessageResponse } from "~/utils/messaging";
import { useToast } from "./ToastContext";

interface DomainListProps {
  domains: string[];
  thirdPartyDomains: string[];
  firstPartyDomain: string;
  onAddToList: (domain: string, listType: "allow" | "deny") => Promise<void>;
}

type SearchResult = {
  gravity: boolean;
  allowlist: boolean;
  denylist: boolean;
  instances?: Array<{
    instanceId: string;
    instanceName?: string;
    gravity: boolean;
    allowlist: boolean;
    denylist: boolean;
  }>;
};

export function DomainList({
  domains,
  thirdPartyDomains,
  firstPartyDomain,
  onAddToList,
}: DomainListProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Map<string, SearchResult>>(
    new Map(),
  );
  const [isSearchingAll, setIsSearchingAll] = useState(false);
  const { showToast } = useToast();

  // Auto-search state (Phase 1)
  const [autoSearchEnabled, setAutoSearchEnabled] = useState(false);
  const [autoSearchProgress, setAutoSearchProgress] = useState<{
    current: number;
    total: number;
    retrying?: boolean;
  } | null>(null);

  // Track search state per domain (success/failed/pending)
  const domainSearchState = useRef<
    Map<string, "pending" | "searching" | "success" | "failed">
  >(new Map());

  // Track retry attempts per domain (max 2 retries = 3 total attempts)
  const retryAttempts = useRef<Map<string, number>>(new Map());
  const MAX_RETRIES = 2;

  // Track currently searching domains to prevent duplicate searches
  const currentlySearching = useRef<Set<string>>(new Set());

  // Circuit breaker to stop auto-search if API is failing
  const circuitBreaker = useRef<{ failures: number; lastFailure: number }>({
    failures: 0,
    lastFailure: 0,
  });

  // Load auto-search preference and cached results from storage on mount (Phase 1)
  // NOTE: Auto-search is OFF by default to prevent overwhelming Pi-hole
  useEffect(() => {
    browser.storage.local
      .get(["pisentinel_autoSearch", "pisentinel_searchCache"])
      .then((result) => {
        // Only enable if explicitly set to true
        setAutoSearchEnabled(result.pisentinel_autoSearch === true);

        // Load cached search results (with 24 hour expiry)
        if (result.pisentinel_searchCache) {
          const cache = result.pisentinel_searchCache as {
            data: Record<string, any>;
            timestamp: number;
          };
          const age = Date.now() - cache.timestamp;
          const MAX_AGE = 24 * 60 * 60 * 1000; // 24 hours

          if (age < MAX_AGE) {
            const cachedMap = new Map<string, SearchResult>(
              Object.entries(cache.data),
            );
            setSearchResults(cachedMap);
            logger.debug(
              `[DomainList] Loaded ${cachedMap.size} cached search results`,
            );
          } else {
            logger.debug("[DomainList] Search cache expired, clearing");
            browser.storage.local
              .remove("pisentinel_searchCache")
              .catch((err) =>
                logger.error("[DomainList] Failed to clear cache:", err),
              );
          }
        }
      });
  }, []);

  // Clear search state when page changes (Phase 2)
  useEffect(() => {
    domainSearchState.current.clear();
    retryAttempts.current.clear();
    currentlySearching.current.clear();
  }, [firstPartyDomain]);

  // Toggle auto-search and persist to storage (Phase 1)
  const toggleAutoSearch = async (enabled: boolean) => {
    setAutoSearchEnabled(enabled);
    await browser.storage.local.set({ pisentinel_autoSearch: enabled });
  };

  // Auto-search logic with retry support (Phase 3)
  useEffect(() => {
    if (!autoSearchEnabled) return;

    // Find domains that haven't succeeded and aren't currently being searched
    const newDomains = domains.filter(
      (d) =>
        !searchResults.has(d) &&
        domainSearchState.current.get(d) !== "success" &&
        !currentlySearching.current.has(d),
    );

    if (newDomains.length === 0) return;

    // Mark domains as currently being searched
    newDomains.forEach((d) => currentlySearching.current.add(d));

    let cancelled = false;

    const searchDomain = async (
      domain: string,
    ): Promise<{ success: boolean; shouldRetry: boolean }> => {
      try {
        if (cancelled) return { success: false, shouldRetry: false };

        const response = (await browser.runtime.sendMessage({
          type: "SEARCH_DOMAIN",
          payload: { domain },
        })) as MessageResponse<SearchResult> | undefined;

        if (!cancelled && response?.success && response.data) {
          setSearchResult(domain, response.data);
          domainSearchState.current.set(domain, "success");
          // Reset circuit breaker on success
          circuitBreaker.current.failures = 0;
          return { success: true, shouldRetry: false };
        }

        // Track failure - should retry transient errors
        circuitBreaker.current.failures++;
        circuitBreaker.current.lastFailure = Date.now();
        domainSearchState.current.set(domain, "failed");

        // Retry transient errors (no data, API errors) but not permanent errors
        return { success: false, shouldRetry: true };
      } catch (err) {
        logger.error(`Auto-search failed for ${domain}:`, err);
        // Track failure
        circuitBreaker.current.failures++;
        circuitBreaker.current.lastFailure = Date.now();
        domainSearchState.current.set(domain, "failed");

        // Retry on network/API errors
        return { success: false, shouldRetry: true };
      }
    };

    const searchNewDomains = async () => {
      const CONCURRENT_LIMIT = 2; // Reduced from 5 to 2 for Raspberry Pi
      const BASE_DELAY = 500; // Increased from 300ms to 500ms
      const MAX_FAILURES = 3; // Stop if 3 consecutive failures
      const RETRY_DELAYS = [1000, 2000, 4000]; // Exponential backoff for retries

      const queue = [...newDomains];
      let searchedCount = 0;
      let consecutiveFailures = 0;
      const failedDomains: Array<{ domain: string; shouldRetry: boolean }> = [];

      setAutoSearchProgress({ current: 0, total: newDomains.length });

      // Phase 1: Initial search
      while (queue.length > 0 && !cancelled) {
        // Circuit breaker: Stop if too many failures
        if (circuitBreaker.current.failures >= MAX_FAILURES) {
          const timeSinceLastFailure =
            Date.now() - circuitBreaker.current.lastFailure;
          if (timeSinceLastFailure < 30000) {
            // 30 second cooldown
            logger.warn(
              "[DomainList] Circuit breaker triggered - too many API failures.",
            );

            // Show toast notification
            showToast({
              type: "warning",
              message:
                "Auto-search stopped due to repeated Pi-hole errors. Check your connection.",
              duration: 8000,
            });

            setAutoSearchProgress(null);
            // Clear currently searching for remaining domains
            queue.forEach((d) => currentlySearching.current.delete(d));
            return;
          } else {
            // Reset after cooldown
            circuitBreaker.current.failures = 0;
          }
        }

        const batch = queue.splice(0, CONCURRENT_LIMIT);

        // Execute batch concurrently
        const results = await Promise.all(
          batch.map(async (domain) => {
            const result = await searchDomain(domain);
            return { domain, ...result };
          }),
        );

        // Count failures in this batch
        const batchFailures = results.filter((r) => !r.success).length;
        if (batchFailures === batch.length) {
          consecutiveFailures++;
        } else {
          consecutiveFailures = 0;
        }

        // Track failed domains for retry
        for (const result of results) {
          currentlySearching.current.delete(result.domain);

          if (!result.success && result.shouldRetry) {
            const attempts = retryAttempts.current.get(result.domain) || 0;
            if (attempts < MAX_RETRIES) {
              failedDomains.push({ domain: result.domain, shouldRetry: true });
            }
          }
        }

        searchedCount += batch.length;
        if (!cancelled) {
          setAutoSearchProgress({
            current: searchedCount,
            total: newDomains.length,
          });
        }

        // Rate limit between batches with exponential backoff on failures
        if (!cancelled && queue.length > 0) {
          const delay =
            BASE_DELAY * Math.pow(2, Math.min(consecutiveFailures, 3));
          await new Promise((r) => setTimeout(r, delay));
        }
      }

      // Phase 2: Retry failed domains
      if (failedDomains.length > 0 && !cancelled) {
        logger.debug(
          `[DomainList] Retrying ${failedDomains.length} failed domains`,
        );

        for (const { domain } of failedDomains) {
          if (cancelled) break;

          const currentAttempt = (retryAttempts.current.get(domain) || 0) + 1;
          retryAttempts.current.set(domain, currentAttempt);

          // Wait with exponential backoff before retry
          const retryDelay =
            RETRY_DELAYS[Math.min(currentAttempt - 1, RETRY_DELAYS.length - 1)];
          await new Promise((r) => setTimeout(r, retryDelay));

          setAutoSearchProgress({
            current: currentAttempt,
            total: failedDomains.length,
            retrying: true,
          });

          currentlySearching.current.add(domain);
          const result = await searchDomain(domain);
          currentlySearching.current.delete(domain);

          // If still failing and haven't hit max retries, add back to queue
          if (
            !result.success &&
            result.shouldRetry &&
            currentAttempt < MAX_RETRIES
          ) {
            failedDomains.push({ domain, shouldRetry: true });
          }
        }
      }

      if (!cancelled) {
        setAutoSearchProgress(null);
      }
    };

    // Handle the promise to avoid unhandled promise warning
    searchNewDomains().catch((err) => {
      logger.error("[DomainList] Auto-search error:", err);
      setAutoSearchProgress(null);
    });

    // Cleanup function to cancel on unmount
    return () => {
      cancelled = true;
      setAutoSearchProgress(null);
      // Remove cancelled domains from currently searching
      newDomains.forEach((d) => currentlySearching.current.delete(d));
    };
  }, [domains, autoSearchEnabled]);

  const setSearchResult = (domain: string, result: SearchResult | null) => {
    setSearchResults((prev) => {
      const next = new Map(prev);
      if (result) {
        next.set(domain, result);
      } else {
        next.delete(domain);
      }

      // Cache results to storage (debounced via async)
      setTimeout(() => {
        const cacheData = Object.fromEntries(next.entries());
        browser.storage.local
          .set({
            pisentinel_searchCache: {
              data: cacheData,
              timestamp: Date.now(),
            },
          })
          .catch((err) =>
            logger.error("[DomainList] Failed to cache results:", err),
          );
      }, 500);

      return next;
    });
  };

  const handleSearchAll = async () => {
    const allDomains = [...new Set(domains)];
    setIsSearchingAll(true);

    for (const domain of allDomains) {
      try {
        const response = (await browser.runtime.sendMessage({
          type: "SEARCH_DOMAIN",
          payload: { domain },
        })) as MessageResponse<SearchResult> | undefined;

        if (response?.success && response.data) {
          setSearchResult(domain, response.data);
        }
      } catch (err) {
        logger.error(`Search failed for ${domain}:`, err);
      }
    }

    setIsSearchingAll(false);
  };

  const clearAllResults = () => {
    setSearchResults(new Map());
  };

  // Separate first-party and third-party domains
  const firstPartyDomains = domains.filter(
    (d) => d === firstPartyDomain || isSameSite(d, firstPartyDomain),
  );
  const thirdParty = domains.filter(
    (d) => d !== firstPartyDomain && !isSameSite(d, firstPartyDomain),
  );

  // Filter by search
  const filterDomains = (list: string[]) =>
    searchQuery
      ? list.filter((d) => d.toLowerCase().includes(searchQuery.toLowerCase()))
      : list;

  const filteredFirstParty = filterDomains(firstPartyDomains);
  const filteredThirdParty = filterDomains(thirdParty);

  if (domains.length === 0) {
    return (
      <div class="empty-state">
        <div class="icon">
          <GlobeIcon />
        </div>
        <p>No domains detected on this page yet.</p>
        <p style={{ fontSize: "11px", marginTop: "8px" }}>
          Navigate to a website to see its domains.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div class="search-box">
        <input
          type="text"
          class="search-input"
          placeholder="Search domains..."
          value={searchQuery}
          onInput={(e) => setSearchQuery((e.target as HTMLInputElement).value)}
        />
        <label
          class="auto-search-toggle"
          title="⚠️ Warning: May impact Pi-hole performance on low-powered devices. Searches up to 2 domains at a time with protective delays."
        >
          <input
            type="checkbox"
            checked={autoSearchEnabled}
            onChange={(e) =>
              toggleAutoSearch((e.target as HTMLInputElement).checked)
            }
          />
          <span>Auto</span>
        </label>
        {autoSearchProgress && (
          <span class="auto-search-status">
            {autoSearchProgress.retrying ? "Retrying... " : ""}
            {autoSearchProgress.current}/{autoSearchProgress.total}
          </span>
        )}
        <button
          class="search-all-btn"
          onClick={handleSearchAll}
          disabled={isSearchingAll || autoSearchProgress !== null}
          title="Search all domains in Pi-hole"
        >
          {isSearchingAll ? <SpinnerIcon /> : <SearchAllIcon />}
        </button>
        {searchResults.size > 0 && (
          <button
            class="clear-results-btn"
            onClick={clearAllResults}
            title="Clear all search results"
          >
            <ClearIcon />
          </button>
        )}
      </div>

      {filteredFirstParty.length > 0 && (
        <div class="domain-section">
          <div class="section-header">
            <span>First-party</span>
            <span class="count">{filteredFirstParty.length}</span>
          </div>
          <ul class="domain-list">
            {filteredFirstParty.map((domain) => (
              <DomainItem
                key={domain}
                domain={domain}
                isFirstParty
                onAddToList={onAddToList}
                searchResult={searchResults.get(domain) || null}
                onSearchResult={(result) => setSearchResult(domain, result)}
              />
            ))}
          </ul>
        </div>
      )}

      {filteredThirdParty.length > 0 && (
        <div class="domain-section">
          <div class="section-header">
            <span>Third-party</span>
            <span class="count">{filteredThirdParty.length}</span>
          </div>
          <ul class="domain-list">
            {filteredThirdParty.map((domain) => (
              <DomainItem
                key={domain}
                domain={domain}
                isFirstParty={false}
                onAddToList={onAddToList}
                searchResult={searchResults.get(domain) || null}
                onSearchResult={(result) => setSearchResult(domain, result)}
              />
            ))}
          </ul>
        </div>
      )}

      {filteredFirstParty.length === 0 && filteredThirdParty.length === 0 && (
        <div class="empty-state">
          <p>No domains match "{searchQuery}"</p>
        </div>
      )}
    </div>
  );
}

interface DomainItemProps {
  domain: string;
  isFirstParty: boolean;
  onAddToList: (domain: string, listType: "allow" | "deny") => Promise<void>;
  searchResult: SearchResult | null;
  onSearchResult: (result: SearchResult | null) => void;
}

function DomainItem({
  domain,
  isFirstParty,
  onAddToList,
  searchResult,
  onSearchResult,
}: DomainItemProps) {
  const handleSearch = async () => {
    try {
      const response = (await browser.runtime.sendMessage({
        type: "SEARCH_DOMAIN",
        payload: { domain },
      })) as MessageResponse<SearchResult> | undefined;

      if (response?.success && response.data) {
        onSearchResult(response.data);
      }
    } catch (err) {
      logger.error("Search failed:", err);
    }
  };

  return (
    <li class="domain-item">
      <div class="domain-row">
        <span class={`domain ${isFirstParty ? "first-party" : "third-party"}`}>
          {domain}
        </span>
        <div class="domain-actions">
          <button
            class="action-btn allow"
            onClick={() => onAddToList(domain, "allow")}
            title="Add to allowlist"
          >
            <CheckIcon size={14} />
          </button>
          <button
            class="action-btn block"
            onClick={() => onAddToList(domain, "deny")}
            title="Add to denylist"
          >
            <BlockIcon />
          </button>
          <button
            class="action-btn search"
            onClick={handleSearch}
            title="Search in Pi-hole"
          >
            <SearchIcon />
          </button>
        </div>
      </div>
      {searchResult && (
        <div class="search-result domain-search-result">
          {searchResult.instances && searchResult.instances.length > 1 ? (
            <div class="instance-search-results">
              {searchResult.instances.map((res) => {
                const label = res.instanceName || res.instanceId;
                return (
                  <div class="instance-search-row" key={label}>
                    <span class="instance-badge">{label}</span>
                    <span class="search-status">
                      {res.denylist ? (
                        <span class="status-denylist">● Denylisted</span>
                      ) : res.allowlist ? (
                        <span class="status-allowlist">● Allowlisted</span>
                      ) : res.gravity ? (
                        <span class="status-blocked">● Blocked (gravity)</span>
                      ) : (
                        <span class="status-allowed">○ Not in blocklist</span>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
          ) : (
            <>
              {searchResult.denylist ? (
                <span class="status-denylist">● Denylisted</span>
              ) : searchResult.allowlist ? (
                <span class="status-allowlist">● Allowlisted</span>
              ) : searchResult.gravity ? (
                <span class="status-blocked">● Blocked (gravity)</span>
              ) : (
                <span class="status-allowed">○ Not in blocklist</span>
              )}
            </>
          )}
          <button
            class="dismiss-btn two-row"
            onClick={() => onSearchResult(null)}
            title="Dismiss"
          >
            ×
          </button>
        </div>
      )}
    </li>
  );
}
