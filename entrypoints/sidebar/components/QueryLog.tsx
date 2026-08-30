import type { TargetedEvent } from "preact";
import { useCallback, useEffect, useRef, useState } from "preact/hooks";
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
import { createRuntimeExtensionCommands } from "~/utils/extension-commands";
import {
  createDomainInspection,
  type DomainInspectionResult,
} from "~/utils/domain-inspection";

const commands = createRuntimeExtensionCommands();

interface QueryLogProps {
  onAddToList: (domain: string, listType: "allow" | "deny") => Promise<boolean>;
}

const REFRESH_INTERVAL = 5000; // 5 seconds

const getQueryKey = (query: QueryEntry) =>
  `${query.instanceId || "single"}-${query.id ?? `${query.timestamp}-${query.domain}`}`;

const sortQueries = (items: QueryEntry[]) =>
  [...items].sort((left, right) => right.timestamp - left.timestamp);

export function QueryLog({ onAddToList }: QueryLogProps) {
  const [queries, setQueries] = useState<QueryEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [queryNotice, setQueryNotice] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "blocked" | "allowed">("all");
  const [inspection] = useState(() => createDomainInspection());
  const [, renderInspection] = useState(0);
  const [dismissedDomains, setDismissedDomains] = useState<Set<string>>(
    () => new Set(),
  );

  useEffect(() => {
    const unsubscribe = inspection.subscribe(() =>
      renderInspection((revision) => revision + 1),
    );
    return () => {
      unsubscribe();
      inspection.destroy();
    };
  }, [inspection]);

  // Auto-refresh state
  const [autoRefreshEnabled, setAutoRefreshEnabled] = useState(true);
  const refreshIntervalRef = useRef<number | null>(null);

  // Scroll tracking state
  const [isScrolledDown, setIsScrolledDown] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [newQueryCount, setNewQueryCount] = useState(0);
  const isScrolledDownRef = useRef(false);

  // Track if initial load has happened (not relying on queries.length due to closure issues)
  const hasLoadedOnce = useRef(false);

  // Load auto-refresh preference on mount
  useEffect(() => {
    browser.storage.local.get("pisentinel_queryAutoRefresh").then((result) => {
      if (result.pisentinel_queryAutoRefresh === true) {
        setAutoRefreshEnabled(true);
      } else if (result.pisentinel_queryAutoRefresh === false) {
        setAutoRefreshEnabled(false);
      }
    });
  }, []);

  // Handle disconnection - stop auto-refresh
  useEffect(() => {
    const handleMessage = (message: unknown) => {
      if (
        typeof message === "object" &&
        message !== null &&
        "type" in message &&
        message.type === "STATE_UPDATED" &&
        "payload" in message &&
        typeof message.payload === "object" &&
        message.payload !== null &&
        "isConnected" in message.payload &&
        message.payload.isConnected === false
      ) {
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

  // Handle scroll with onScroll event
  const handleScroll = (event: TargetedEvent<HTMLDivElement, Event>) => {
    const container = event.currentTarget;
    const scrolledDown = container.scrollTop > 50; // More than 50px from top

    if (!scrolledDown && isScrolledDownRef.current) {
      // User scrolled back to top - reset count
      setNewQueryCount(0);
    }

    isScrolledDownRef.current = scrolledDown;
    setIsScrolledDown(scrolledDown);
  };

  // Reset scroll state when filter changes
  useEffect(() => {
    isScrolledDownRef.current = false;
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
    isScrolledDownRef.current = false;
    setNewQueryCount(0);
    setIsScrolledDown(false);
  };

  const lookupDomain = (domain: string) => {
    setDismissedDomains((current) => {
      if (!current.has(domain)) return current;
      const next = new Set(current);
      next.delete(domain);
      return next;
    });
    void inspection.lookup(domain);
  };

  const addDomainToList = async (
    domain: string,
    listType: "allow" | "deny",
  ): Promise<boolean> => {
    const added = await onAddToList(domain, listType);
    if (added) {
      inspection.clear();
      lookupDomain(domain);
    }
    return added;
  };

  const loadQueries = useCallback(async () => {
    const isInitialLoad = !hasLoadedOnce.current;

    // Show loading only on initial load
    if (isInitialLoad) {
      setIsLoading(true);
    }

    try {
      const response = await commands.getQueries({ length: 100 });

      if (response.success) {
        const { entries: queryData, failures, complete } = response.data;
        setQueryNotice(
          complete
            ? null
            : failures.length > 0
              ? `Query results incomplete: ${failures.map((failure) => `${failure.instanceName} unavailable (${failure.message})`).join("; ")}.`
              : "Query results incomplete: no connected instances.",
        );
        const normalized = sortQueries(queryData);

        if (isInitialLoad) {
          setQueries(normalized);
          hasLoadedOnce.current = true;
        } else {
          setQueries((previousQueries) => {
            const existingIds = new Set(previousQueries.map(getQueryKey));
            const newQueries = normalized.filter(
              (query) => !existingIds.has(getQueryKey(query)),
            );

            if (newQueries.length > 0 && isScrolledDownRef.current) {
              setNewQueryCount(
                (previousCount) => previousCount + newQueries.length,
              );
            }

            // Use the normalized/sorted list so we keep cross-instance order
            return normalized;
          });
        }
      } else {
        setQueryNotice(response.error);
      }
    } catch (error) {
      setQueryNotice(
        error instanceof Error
          ? error.message
          : "Unable to load query results.",
      );
      logger.error("Failed to load queries:", error);
    } finally {
      if (isInitialLoad) {
        setIsLoading(false);
      }
    }
  }, []);
  // Initial load
  useEffect(() => {
    void loadQueries();
  }, [loadQueries]);

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
  }, [autoRefreshEnabled, loadQueries]);

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

      {queryNotice && (
        <div class="query-results-notice" role="status">
          {queryNotice}
        </div>
      )}
      {filteredQueries.length === 0 ? (
        !queryNotice && (
          <div class="empty-state">
            <p>No queries to display.</p>
          </div>
        )
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
                onAddToList={addDomainToList}
                searchResult={
                  dismissedDomains.has(query.domain)
                    ? null
                    : (inspection.resultFor(query.domain) ?? null)
                }
                onSearch={() => lookupDomain(query.domain)}
                onDismiss={() =>
                  setDismissedDomains((current) =>
                    new Set(current).add(query.domain),
                  )
                }
                onClear={() => inspection.clear()}
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
  onAddToList: (domain: string, listType: "allow" | "deny") => Promise<boolean>;
  searchResult: DomainInspectionResult | null;
  onSearch(): void;
  onDismiss(): void;
  onClear(): void;
}

function QueryItem({
  query,
  onAddToList,
  searchResult,
  onSearch,
  onDismiss,
  onClear,
}: QueryItemProps) {
  const blocked = isQueryBlocked(query.status);
  const instanceLabel = query.instanceName || query.instanceId;
  // Query timestamps are normalized to Unix seconds at the fleet boundary.
  const rawTime = query.timestamp;
  let timeStr = "Unknown";
  if (rawTime) {
    const timestamp = rawTime * 1000; // Convert seconds to milliseconds
    const date = new Date(timestamp);
    if (!isNaN(date.getTime())) {
      timeStr = date.toLocaleTimeString();
    }
  }

  const clientInfo = query.client || "?";

  const handleRemove = async (listType: "allow" | "deny") => {
    try {
      const response = await (listType === "allow"
        ? commands.removeFromAllowlist(query.domain)
        : commands.removeFromDenylist(query.domain));
      if (!response?.success) {
        logger.error("Remove failed:", response?.error ?? "Unknown failure");
        return;
      }
      onDismiss();
      onClear();
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
                onClick={onSearch}
                title="Search domain status"
              >
                <SearchIcon size={14} />
              </button>
            </div>
          )}
        </div>

        {searchResult && (
          <div class="search-result">
            <div class="instance-search-results">
              {searchResult.entries.map((result) => (
                <div class="instance-search-row" key={result.instanceId}>
                  <span class="instance-badge">
                    {result.instanceName || result.instanceId}
                  </span>
                  {result.denylist ? (
                    <span class="status-denylist" data-bullet="●">
                      Denylisted
                    </span>
                  ) : result.allowlist ? (
                    <span class="status-allowlist" data-bullet="●">
                      Allowlisted
                    </span>
                  ) : result.gravity ? (
                    <span class="status-blocked" data-bullet="●">
                      Blocked (gravity)
                    </span>
                  ) : (
                    <span class="status-allowed" data-bullet="○">
                      Not in blocklist
                    </span>
                  )}
                  {searchResult.entries.length === 1 &&
                    (result.allowlist || result.denylist) && (
                      <button
                        class="remove-btn"
                        onClick={() =>
                          handleRemove(result.allowlist ? "allow" : "deny")
                        }
                        title="Remove from list"
                      >
                        Remove
                      </button>
                    )}
                </div>
              ))}
              {!searchResult.complete && (
                <div class="instance-search-row search-incomplete">
                  {searchResult.failures.length > 0
                    ? `Search incomplete: ${searchResult.failures.map((failure) => `${failure.instanceName} unavailable (${failure.message})`).join("; ")}.`
                    : "Search incomplete: no connected instances."}
                </div>
              )}
            </div>
            <button class="dismiss-btn" onClick={onDismiss} title="Dismiss">
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
