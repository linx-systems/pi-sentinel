import { useEffect, useRef, useState } from "preact/hooks";
import browser from "webextension-polyfill";
import {
  ArrowUpIcon,
  BlockIcon,
  CheckIcon,
  ErrorIcon,
  RefreshIcon,
  SearchIcon,
} from "~/utils/icons";
import { isQueryBlocked } from "~/utils/utils";
import { logger } from "~/utils/logger";
import type { QueryEntry } from "~/utils/types";
import type { MessageResponse } from "~/utils/messaging";

type InstanceSearchResult = {
  instanceId: string;
  instanceName?: string;
  gravity: boolean;
  allowlist: boolean;
  denylist: boolean;
};

type SearchResult = {
  gravity: boolean;
  allowlist: boolean;
  denylist: boolean;
  instances?: InstanceSearchResult[];
};

interface QueryLogProps {
  onAddToList: (domain: string, listType: "allow" | "deny") => Promise<void>;
}

const REFRESH_INTERVAL = 5000; // 5 seconds

export function QueryLog({ onAddToList }: QueryLogProps) {
  const [queries, setQueries] = useState<QueryEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "blocked" | "allowed">("all");
  const [searchResults, setSearchResults] = useState<Map<string, SearchResult>>(
    new Map(),
  );

  // Auto-refresh state
  const [autoRefreshEnabled, setAutoRefreshEnabled] = useState(true);
  const refreshIntervalRef = useRef<number | null>(null);

  // Scroll tracking state
  const [isScrolledDown, setIsScrolledDown] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [newQueryCount, setNewQueryCount] = useState(0);

  // Track if initial load has happened (not relying on queries.length due to closure issues)
  const hasLoadedOnce = useRef(false);

  const getQueryKey = (q: QueryEntry) =>
    `${q.instanceId || "single"}-${q.id ?? `${q.timestamp}-${q.domain}`}`;

  const sortQueries = (items: QueryEntry[]) =>
    [...items].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

  // Load auto-refresh preference on mount
  useEffect(() => {
    browser.storage.local.get("pisentinel_queryAutoRefresh").then((result) => {
      if (result.pisentinel_queryAutoRefresh !== undefined) {
        setAutoRefreshEnabled(result.pisentinel_queryAutoRefresh);
      }
    });
  }, []);

  // Handle disconnection - stop auto-refresh
  useEffect(() => {
    const handleMessage = (msg: any) => {
      if (msg.type === "STATE_UPDATED" && !msg.payload?.isConnected) {
        setAutoRefreshEnabled(false);
      }
    };

    browser.runtime.onMessage.addListener(handleMessage);
    return () => browser.runtime.onMessage.removeListener(handleMessage);
  }, []);

  // Save preference on change
  const toggleAutoRefresh = async (enabled: boolean) => {
    setAutoRefreshEnabled(enabled);
    await browser.storage.local.set({ pisentinel_queryAutoRefresh: enabled });
  };

  // Initial load
  useEffect(() => {
    loadQueries();
  }, []);

  // Auto-refresh interval
  useEffect(() => {
    if (!autoRefreshEnabled) {
      if (refreshIntervalRef.current) {
        clearInterval(refreshIntervalRef.current);
        refreshIntervalRef.current = null;
      }
      return;
    }

    refreshIntervalRef.current = window.setInterval(() => {
      loadQueries();
    }, REFRESH_INTERVAL);

    return () => {
      if (refreshIntervalRef.current) {
        clearInterval(refreshIntervalRef.current);
      }
    };
  }, [autoRefreshEnabled]);

  // Handle scroll with onScroll event
  const handleScroll = (e: Event) => {
    const container = e.target as HTMLDivElement;
    const scrolledDown = container.scrollTop > 50; // More than 50px from top

    if (!scrolledDown && isScrolledDown) {
      // User scrolled back to top - reset count
      setNewQueryCount(0);
    }

    setIsScrolledDown(scrolledDown);
  };

  // Reset scroll state when filter changes
  useEffect(() => {
    setIsScrolledDown(false);
    setNewQueryCount(0);
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = 0;
    }
  }, [filter]);

  // Back-to-top handler
  const scrollToTop = () => {
    scrollContainerRef.current?.scrollTo({
      top: 0,
      behavior: "smooth",
    });
    setNewQueryCount(0);
    setIsScrolledDown(false);
  };

  const setSearchResult = (domain: string, result: SearchResult | null) => {
    setSearchResults((prev) => {
      const next = new Map(prev);
      if (result) {
        next.set(domain, result);
      } else {
        next.delete(domain);
      }
      return next;
    });
  };

  const loadQueries = async () => {
    const isInitialLoad = !hasLoadedOnce.current;

    // Show loading only on initial load
    if (isInitialLoad) {
      setIsLoading(true);
    }

    try {
      const response = (await browser.runtime.sendMessage({
        type: "GET_QUERIES",
        payload: { length: 100 },
      })) as MessageResponse<QueryEntry[]> | undefined;

      if (response?.success && response.data) {
        const queryData = Array.isArray(response.data) ? response.data : [];
        const normalized = sortQueries(
          queryData.map((q) => ({
            ...q,
            // Some Pi-hole versions return "time" instead of timestamp
            timestamp:
              typeof q.timestamp === "number"
                ? q.timestamp
                : Number((q as any).time ?? 0) || 0,
          })),
        );

        if (isInitialLoad) {
          setQueries(normalized);
          hasLoadedOnce.current = true;
        } else {
          setQueries((prev) => {
            const existingIds = new Set(prev.map((q) => getQueryKey(q)));
            const newQueries = normalized.filter(
              (q) => !existingIds.has(getQueryKey(q)),
            );

            if (newQueries.length > 0 && isScrolledDown) {
              setNewQueryCount((prevCount) => prevCount + newQueries.length);
            }

            // Use the normalized/sorted list so we keep cross-instance order
            return normalized;
          });
        }
      }
    } catch (err) {
      logger.error("Failed to load queries:", err);
    } finally {
      if (isInitialLoad) {
        setIsLoading(false);
      }
    }
  };

  const filteredQueries = queries.filter((q) => {
    if (!q) return false;
    if (filter === "all") return true;
    const blocked = isQueryBlocked(q.status);
    if (filter === "blocked") return blocked;
    return !blocked;
  });

  if (isLoading) {
    return (
      <div class="loading">
        <div class="spinner" />
        <span>Loading queries...</span>
      </div>
    );
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        position: "relative",
      }}
    >
      <div
        style={{
          padding: "8px",
          display: "flex",
          gap: "8px",
          flexShrink: 0,
          alignItems: "center",
        }}
      >
        <FilterButton
          label="All"
          active={filter === "all"}
          onClick={() => setFilter("all")}
        />
        <FilterButton
          label="Blocked"
          active={filter === "blocked"}
          onClick={() => setFilter("blocked")}
        />
        <FilterButton
          label="Allowed"
          active={filter === "allowed"}
          onClick={() => setFilter("allowed")}
        />

        <label class="auto-refresh-toggle" style={{ marginLeft: "auto" }}>
          <input
            type="checkbox"
            checked={autoRefreshEnabled}
            onChange={(e) =>
              toggleAutoRefresh((e.target as HTMLInputElement).checked)
            }
          />
          <span>Auto</span>
        </label>

        <button
          onClick={() => loadQueries()}
          style={{
            background: "none",
            border: "none",
            color: "#888",
            cursor: "pointer",
          }}
          title="Refresh"
        >
          <RefreshIcon />
        </button>
      </div>

      {filteredQueries.length === 0 ? (
        <div class="empty-state">
          <p>No queries to display.</p>
        </div>
      ) : (
        <div
          ref={scrollContainerRef}
          onScroll={handleScroll}
          style={{ padding: "0 8px 8px", overflow: "auto", flex: 1 }}
        >
          {filteredQueries.map((query, index) =>
            query ? (
              <QueryItem
                key={getQueryKey(query) || index}
                query={query}
                onAddToList={onAddToList}
                searchResult={searchResults.get(query.domain) || null}
                onSearchResult={(result) =>
                  setSearchResult(query.domain, result)
                }
              />
            ) : null,
          )}
        </div>
      )}

      {isScrolledDown && autoRefreshEnabled && (
        <button
          class="back-to-top-btn"
          onClick={scrollToTop}
          title="Back to top and resume auto-scroll"
        >
          <ArrowUpIcon size={14} />
          <span>
            {newQueryCount > 0 ? `${newQueryCount} new` : "Back to top"}
          </span>
        </button>
      )}
    </div>
  );
}

interface QueryItemProps {
  query: QueryEntry;
  onAddToList: (domain: string, listType: "allow" | "deny") => Promise<void>;
  searchResult: SearchResult | null;
  onSearchResult: (result: SearchResult | null) => void;
}

function QueryItem({
  query,
  onAddToList,
  searchResult,
  onSearchResult,
}: QueryItemProps) {
  const blocked = isQueryBlocked(query.status);
  const instanceLabel = query.instanceName || query.instanceId;

  // Handle timestamp - Pi-hole v6 uses 'time' as Unix timestamp (seconds with decimals)
  const rawTime = (query as any).time || query.timestamp;
  let timeStr = "Unknown";
  if (rawTime) {
    const ts = rawTime * 1000; // Convert seconds to milliseconds
    const date = new Date(ts);
    if (!isNaN(date.getTime())) {
      timeStr = date.toLocaleTimeString();
    }
  }

  // Handle client - Pi-hole v6 returns {ip, name} object
  const clientInfo =
    typeof query.client === "object" && query.client
      ? (query.client as any).name || (query.client as any).ip || "?"
      : query.client || "?";

  const handleSearch = async () => {
    try {
      const response = (await browser.runtime.sendMessage({
        type: "SEARCH_DOMAIN",
        payload: { domain: query.domain },
      })) as MessageResponse<SearchResult> | undefined;

      if (response?.success && response.data) {
        onSearchResult(response.data);
      }
    } catch (err) {
      logger.error("Search failed:", err);
    }
  };

  const handleRemove = async (listType: "allow" | "deny") => {
    try {
      const messageType =
        listType === "allow" ? "REMOVE_FROM_ALLOWLIST" : "REMOVE_FROM_DENYLIST";
      await browser.runtime.sendMessage({
        type: messageType,
        payload: { domain: query.domain },
      });
      // Clear search result after removal
      onSearchResult(null);
    } catch (err) {
      logger.error("Remove failed:", err);
    }
  };

  const hasValidDomain = query.domain && query.domain !== "unknown";

  return (
    <div class="query-item">
      <span class={`status-icon ${blocked ? "blocked" : "allowed"}`}>
        {blocked ? <ErrorIcon size={14} /> : <CheckIcon size={14} />}
      </span>
      <div class="details">
        <div class="domain-row">
          <div class="domain" title={query.domain}>
            {query.domain || "unknown"}
          </div>
          {instanceLabel && (
            <span class="instance-badge" title={`From ${instanceLabel}`}>
              {instanceLabel}
            </span>
          )}
          {hasValidDomain && (
            <div class="domain-actions">
              <button
                class="action-btn allow"
                onClick={() => onAddToList(query.domain, "allow")}
                title="Add to allowlist"
              >
                <CheckIcon size={14} />
              </button>
              <button
                class="action-btn block"
                onClick={() => onAddToList(query.domain, "deny")}
                title="Add to denylist"
              >
                <BlockIcon size={14} />
              </button>
              <button
                class="action-btn search"
                onClick={handleSearch}
                title="Search domain status"
              >
                <SearchIcon size={14} />
              </button>
            </div>
          )}
        </div>

        {searchResult && (
          <div class="search-result">
            {searchResult.instances && searchResult.instances.length > 1 ? (
              <div class="instance-search-results">
                {searchResult.instances.map((res) => {
                  const label = res.instanceName || res.instanceId;
                  return (
                    <div class="instance-search-row" key={label}>
                      <span class="instance-badge">{label}</span>
                      {res.denylist ? (
                        <span class="status-denylist" data-bullet="●">
                          Denylisted
                        </span>
                      ) : res.allowlist ? (
                        <span class="status-allowlist" data-bullet="●">
                          Allowlisted
                        </span>
                      ) : res.gravity ? (
                        <span class="status-blocked" data-bullet="●">
                          Blocked (gravity)
                        </span>
                      ) : (
                        <span class="status-allowed" data-bullet="○">
                          Not in blocklist
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <>
                {searchResult.denylist ? (
                  <span class="status-denylist" data-bullet="●">
                    Denylisted
                  </span>
                ) : searchResult.allowlist ? (
                  <span class="status-allowlist" data-bullet="●">
                    Allowlisted
                  </span>
                ) : searchResult.gravity ? (
                  <span class="status-blocked" data-bullet="●">
                    Blocked (gravity)
                  </span>
                ) : (
                  <span class="status-allowed" data-bullet="○">
                    Not in blocklist
                  </span>
                )}
                {(searchResult.allowlist || searchResult.denylist) && (
                  <button
                    class="remove-btn"
                    onClick={() =>
                      handleRemove(searchResult.allowlist ? "allow" : "deny")
                    }
                    title="Remove from list"
                  >
                    Remove
                  </button>
                )}
              </>
            )}
            <button
              class="dismiss-btn"
              onClick={() => onSearchResult(null)}
              title="Dismiss"
            >
              x
            </button>
          </div>
        )}

        <div class="meta">
          {query.type || "?"} - {clientInfo} - {timeStr}
          {instanceLabel ? ` - ${instanceLabel}` : ""}
        </div>
      </div>
    </div>
  );
}

interface FilterButtonProps {
  label: string;
  active: boolean;
  onClick: () => void;
}

function FilterButton({ label, active, onClick }: FilterButtonProps) {
  return (
    <button
      onClick={onClick}
      style={{
        background: active ? "#3b82f6" : "#2d2d44",
        border: "none",
        color: active ? "#fff" : "#888",
        padding: "6px 12px",
        borderRadius: "6px",
        fontSize: "12px",
        cursor: "pointer",
      }}
    >
      {label}
    </button>
  );
}
