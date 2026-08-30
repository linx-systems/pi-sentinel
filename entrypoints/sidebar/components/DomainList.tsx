import { useEffect, useState } from "preact/hooks";
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
import type { TemporaryAllowEntry } from "~/utils/types";
import {
  createDomainInspection,
  type DomainInspectionResult,
} from "~/utils/domain-inspection";

interface DomainListProps {
  domains: string[];
  firstPartyDomain: string;
  onAddToList: (domain: string, listType: "allow" | "deny") => Promise<boolean>;
  temporaryAllows: readonly TemporaryAllowEntry[];
  onCreateTemporaryAllow: (
    domain: string,
    durationSeconds: number | null,
  ) => Promise<boolean>;
  onRemoveTemporaryAllows: (entryIds: string[]) => Promise<boolean>;
}

export function DomainList({
  domains,
  firstPartyDomain,
  onAddToList,
  temporaryAllows,
  onCreateTemporaryAllow,
  onRemoveTemporaryAllows,
}: DomainListProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const [isSearchingAll, setIsSearchingAll] = useState(false);
  const [isAutoSearching, setIsAutoSearching] = useState(false);
  const [autoSearchEnabled, setAutoSearchEnabled] = useState(false);
  const [dismissedDomains, setDismissedDomains] = useState<Set<string>>(
    () => new Set(),
  );
  const [inspection] = useState(() => createDomainInspection());
  const [, renderInspection] = useState(0);

  useEffect(() => {
    const unsubscribe = inspection.subscribe(() =>
      renderInspection((revision) => revision + 1),
    );
    return () => {
      unsubscribe();
      inspection.destroy();
    };
  }, [inspection]);

  useEffect(() => {
    if (!temporaryAllows.some((entry) => entry.expiresAt !== null)) return;
    const interval = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(interval);
  }, [temporaryAllows]);

  useEffect(() => {
    browser.storage.local
      .get("pisentinel_autoSearch")
      .then((result) => {
        setAutoSearchEnabled(result.pisentinel_autoSearch === true);
      })
      .catch((error) => {
        logger.error(
          "[DomainList] Failed to load auto-search preference:",
          error,
        );
      });
  }, []);

  useEffect(() => {
    setDismissedDomains(new Set());
  }, [firstPartyDomain]);

  const toggleAutoSearch = async (enabled: boolean) => {
    setAutoSearchEnabled(enabled);
    try {
      await browser.storage.local.set({ pisentinel_autoSearch: enabled });
    } catch (error) {
      logger.error(
        "[DomainList] Failed to save auto-search preference:",
        error,
      );
    }
  };

  useEffect(() => {
    if (!autoSearchEnabled) return;
    let cancelled = false;
    setIsAutoSearching(true);
    void inspection
      .lookupMany(domains)
      .catch((error) => logger.error("[DomainList] Auto-search failed:", error))
      .finally(() => {
        if (!cancelled) setIsAutoSearching(false);
      });
    return () => {
      cancelled = true;
    };
  }, [autoSearchEnabled, domains, inspection]);

  const lookupDomain = (domain: string) => {
    setDismissedDomains((current) => {
      if (!current.has(domain)) return current;
      const next = new Set(current);

      next.delete(domain);
      return next;
    });
    void inspection.lookup(domain);
  };

  const afterListMutation = async (operation: () => Promise<boolean>) => {
    const changed = await operation();
    if (changed) inspection.clear();
    return changed;
  };

  const addDomainToList = async (
    domain: string,
    listType: "allow" | "deny",
  ) => {
    if (await afterListMutation(() => onAddToList(domain, listType))) {
      void inspection.lookup(domain);
    }
  };

  const createTemporaryAllow = async (
    domain: string,
    durationSeconds: number | null,
  ): Promise<void> => {
    await afterListMutation(() =>
      onCreateTemporaryAllow(domain, durationSeconds),
    );
  };

  const removeTemporaryAllows = async (entryIds: string[]): Promise<void> => {
    await afterListMutation(() => onRemoveTemporaryAllows(entryIds));
  };

  const handleSearchAll = async () => {
    setIsSearchingAll(true);
    try {
      await inspection.lookupMany(domains);
    } finally {
      setIsSearchingAll(false);
    }
  };

  const clearAllResults = () => {
    inspection.clear();
    setDismissedDomains(new Set());
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
        {isAutoSearching && (
          <span class="auto-search-status">Searching...</span>
        )}
        <button
          class="search-all-btn"
          onClick={handleSearchAll}
          disabled={isSearchingAll || isAutoSearching}
          title="Search all domains in Pi-hole"
        >
          {isSearchingAll ? <SpinnerIcon /> : <SearchAllIcon />}
        </button>
        {domains.some(
          (domain) =>
            !dismissedDomains.has(domain) &&
            inspection.resultFor(domain) !== undefined,
        ) && (
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
                temporaryAllows={temporaryAllows.filter(
                  (entry) => entry.domain === domain,
                )}
                onCreateTemporaryAllow={createTemporaryAllow}
                onRemoveTemporaryAllows={removeTemporaryAllows}
                now={now}
                domain={domain}
                isFirstParty
                onAddToList={addDomainToList}
                searchResult={
                  dismissedDomains.has(domain)
                    ? null
                    : (inspection.resultFor(domain) ?? null)
                }
                onSearch={() => lookupDomain(domain)}
                onDismiss={() =>
                  setDismissedDomains((current) => new Set(current).add(domain))
                }
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
                temporaryAllows={temporaryAllows.filter(
                  (entry) => entry.domain === domain,
                )}
                onCreateTemporaryAllow={createTemporaryAllow}
                onRemoveTemporaryAllows={removeTemporaryAllows}
                now={now}
                domain={domain}
                isFirstParty={false}
                onAddToList={addDomainToList}
                searchResult={
                  dismissedDomains.has(domain)
                    ? null
                    : (inspection.resultFor(domain) ?? null)
                }
                onSearch={() => lookupDomain(domain)}
                onDismiss={() =>
                  setDismissedDomains((current) => new Set(current).add(domain))
                }
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
  temporaryAllows: readonly TemporaryAllowEntry[];
  now: number;
  onCreateTemporaryAllow: (
    domain: string,
    durationSeconds: number | null,
  ) => Promise<void>;
  onRemoveTemporaryAllows: (entryIds: string[]) => Promise<void>;
  searchResult: DomainInspectionResult | null;
  onSearch(): void;
  onDismiss(): void;
}

function DomainItem({
  domain,
  isFirstParty,
  onAddToList,
  temporaryAllows,
  now,
  onCreateTemporaryAllow,
  onRemoveTemporaryAllows,
  searchResult,
  onSearch,
  onDismiss,
}: DomainItemProps) {
  const [temporaryDuration, setTemporaryDuration] = useState<string>("300");

  const createTemporaryAllow = () => {
    const durationSeconds =
      temporaryDuration === "session" ? null : Number(temporaryDuration);
    return onCreateTemporaryAllow(domain, durationSeconds);
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
            onClick={onSearch}
            title="Search in Pi-hole"
          >
            <SearchIcon />
          </button>
          <div class="temporary-allow-controls">
            <select
              class="temporary-allow-select"
              value={temporaryDuration}
              onChange={(event) =>
                setTemporaryDuration((event.target as HTMLSelectElement).value)
              }
              aria-label={`Temporary allow duration for ${domain}`}
            >
              <option value="300">5 min</option>
              <option value="3600">1 hour</option>
              <option value="session">Session</option>
            </select>
            <button
              class="action-btn allow"
              onClick={createTemporaryAllow}
              title={`Temporarily allow ${domain}`}
              aria-label={`Temporarily allow ${domain}`}
            >
              Temp
            </button>
          </div>
        </div>
      </div>
      {temporaryAllows.map((entry) => (
        <div class="temporary-allow-badge" key={entry.id}>
          <span>
            Temporary: {entry.instanceName} ·{" "}
            {entry.cleanupPending
              ? "cleanup retry pending"
              : formatTemporaryRemaining(entry, now)}
          </span>
          <button
            class="temporary-allow-cancel"
            onClick={() => onRemoveTemporaryAllows([entry.id])}
            aria-label={`Cancel temporary allow for ${domain} on ${entry.instanceName}`}
          >
            Cancel
          </button>
        </div>
      ))}
      {searchResult && (
        <div class="search-result domain-search-result">
          <div class="instance-search-results">
            {searchResult.entries.length > 0 &&
              searchResult.entries.map((result) => {
                const label = result.instanceName || result.instanceId;
                return (
                  <div class="instance-search-row" key={result.instanceId}>
                    <span class="instance-badge">{label}</span>
                    <span class="search-status">
                      {result.denylist ? (
                        <span class="status-denylist">● Denylisted</span>
                      ) : result.allowlist ? (
                        <span class="status-allowlist">● Allowlisted</span>
                      ) : result.gravity ? (
                        <span class="status-blocked">● Blocked (gravity)</span>
                      ) : (
                        <span class="status-allowed">○ Not in blocklist</span>
                      )}
                    </span>
                  </div>
                );
              })}
            {!searchResult.complete && (
              <div class="instance-search-row search-incomplete">
                {searchResult.failures.length > 0
                  ? `Search incomplete: ${searchResult.failures.map((failure) => `${failure.instanceName} unavailable (${failure.message})`).join("; ")}.`
                  : "Search incomplete: no connected instances."}
              </div>
            )}
          </div>
          <button
            class="dismiss-btn two-row"
            onClick={onDismiss}
            title="Dismiss"
          >
            ×
          </button>
        </div>
      )}
    </li>
  );
}

function formatTemporaryRemaining(
  entry: TemporaryAllowEntry,
  now: number,
): string {
  if (entry.expiresAt === null) return "browser session";

  const remainingMs = Math.max(0, entry.expiresAt - now);
  const remainingMinutes = Math.ceil(remainingMs / 60_000);
  if (remainingMinutes < 60) {
    return `${remainingMinutes} min remaining`;
  }

  const hours = Math.floor(remainingMinutes / 60);
  const minutes = remainingMinutes % 60;
  return minutes > 0
    ? `${hours}h ${minutes}m remaining`
    : `${hours}h remaining`;
}
