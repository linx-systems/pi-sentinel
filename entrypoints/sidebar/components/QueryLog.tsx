import { useState, useEffect } from 'preact/hooks';
import browser from 'webextension-polyfill';
import { ErrorIcon, CheckIcon, RefreshIcon, BlockIcon, SearchIcon } from '~/utils/icons';
import { isQueryBlocked } from '~/utils/utils';
import type { QueryEntry } from '~/utils/types';
import type { MessageResponse } from '~/utils/messaging';

type SearchResult = {
  gravity: boolean;
  allowlist: boolean;
  denylist: boolean;
};

interface QueryLogProps {
  onAddToList: (domain: string, listType: 'allow' | 'deny') => Promise<void>;
}

export function QueryLog({ onAddToList }: QueryLogProps) {
  const [queries, setQueries] = useState<QueryEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'blocked' | 'allowed'>('all');
  const [searchResults, setSearchResults] = useState<Map<string, SearchResult>>(new Map());

  useEffect(() => {
    loadQueries();
  }, []);

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
    setIsLoading(true);
    try {
      const response = (await browser.runtime.sendMessage({
        type: 'GET_QUERIES',
        payload: { length: 100 },
      })) as MessageResponse<QueryEntry[]> | undefined;

      if (response?.success && response.data) {
        // Ensure we have an array
        const queryData = Array.isArray(response.data) ? response.data : [];
        setQueries(queryData);
      }
    } catch (err) {
      console.error('Failed to load queries:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const filteredQueries = queries.filter((q) => {
    if (!q) return false;
    if (filter === 'all') return true;
    const blocked = isQueryBlocked(q.status);
    if (filter === 'blocked') return blocked;
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
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ padding: '8px', display: 'flex', gap: '8px', flexShrink: 0 }}>
        <FilterButton
          label="All"
          active={filter === 'all'}
          onClick={() => setFilter('all')}
        />
        <FilterButton
          label="Blocked"
          active={filter === 'blocked'}
          onClick={() => setFilter('blocked')}
        />
        <FilterButton
          label="Allowed"
          active={filter === 'allowed'}
          onClick={() => setFilter('allowed')}
        />
        <button
          onClick={loadQueries}
          style={{
            marginLeft: 'auto',
            background: 'none',
            border: 'none',
            color: '#888',
            cursor: 'pointer',
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
        <div style={{ padding: '0 8px 8px', overflow: 'auto', flex: 1 }}>
          {filteredQueries.map((query, index) =>
            query ? (
              <QueryItem
                key={query.id || index}
                query={query}
                onAddToList={onAddToList}
                searchResult={searchResults.get(query.domain) || null}
                onSearchResult={(result) => setSearchResult(query.domain, result)}
              />
            ) : null
          )}
        </div>
      )}
    </div>
  );
}

interface QueryItemProps {
  query: QueryEntry;
  onAddToList: (domain: string, listType: 'allow' | 'deny') => Promise<void>;
  searchResult: SearchResult | null;
  onSearchResult: (result: SearchResult | null) => void;
}

function QueryItem({ query, onAddToList, searchResult, onSearchResult }: QueryItemProps) {
  const blocked = isQueryBlocked(query.status);

  // Handle timestamp - Pi-hole v6 uses 'time' as Unix timestamp (seconds with decimals)
  const rawTime = (query as any).time || query.timestamp;
  let timeStr = 'Unknown';
  if (rawTime) {
    const ts = rawTime * 1000; // Convert seconds to milliseconds
    const date = new Date(ts);
    if (!isNaN(date.getTime())) {
      timeStr = date.toLocaleTimeString();
    }
  }

  // Handle client - Pi-hole v6 returns {ip, name} object
  const clientInfo = typeof query.client === 'object' && query.client
    ? ((query.client as any).name || (query.client as any).ip || '?')
    : (query.client || '?');

  const handleSearch = async () => {
    try {
      const response = (await browser.runtime.sendMessage({
        type: 'SEARCH_DOMAIN',
        payload: { domain: query.domain },
      })) as MessageResponse<SearchResult> | undefined;

      if (response?.success && response.data) {
        onSearchResult(response.data);
      }
    } catch (err) {
      console.error('Search failed:', err);
    }
  };

  const handleRemove = async (listType: 'allow' | 'deny') => {
    try {
      const messageType = listType === 'allow' ? 'REMOVE_FROM_ALLOWLIST' : 'REMOVE_FROM_DENYLIST';
      await browser.runtime.sendMessage({
        type: messageType,
        payload: { domain: query.domain },
      });
      // Clear search result after removal
      onSearchResult(null);
    } catch (err) {
      console.error('Remove failed:', err);
    }
  };

  const hasValidDomain = query.domain && query.domain !== 'unknown';

  return (
    <div class="query-item">
      <span class={`status-icon ${blocked ? 'blocked' : 'allowed'}`}>
        {blocked ? <ErrorIcon size={14} /> : <CheckIcon size={14} />}
      </span>
      <div class="details">
        <div class="domain-row">
          <div class="domain" title={query.domain}>
            {query.domain || 'unknown'}
          </div>
          {hasValidDomain && (
            <div class="domain-actions">
              <button
                class="action-btn allow"
                onClick={() => onAddToList(query.domain, 'allow')}
                title="Add to allowlist"
              >
                <CheckIcon size={14} />
              </button>
              <button
                class="action-btn block"
                onClick={() => onAddToList(query.domain, 'deny')}
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
            <span
              class={searchResult.gravity ? 'status-blocked' : 'status-allowed'}
              data-bullet={searchResult.gravity ? '●' : '○'}
            >
              {searchResult.gravity ? 'Blocked (gravity)' : 'Not in blocklist'}
            </span>
            {searchResult.allowlist && (
              <span class="status-allowlist" data-bullet="●">
                Allowlisted
              </span>
            )}
            {searchResult.denylist && (
              <span class="status-denylist" data-bullet="●">
                Denylisted
              </span>
            )}
            {(searchResult.allowlist || searchResult.denylist) && (
              <button
                class="remove-btn"
                onClick={() => handleRemove(searchResult.allowlist ? 'allow' : 'deny')}
                title="Remove from list"
              >
                Remove
              </button>
            )}
            <button class="dismiss-btn" onClick={() => onSearchResult(null)} title="Dismiss">
              ×
            </button>
          </div>
        )}

        <div class="meta">
          {query.type || '?'} • {clientInfo} • {timeStr}
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
        background: active ? '#3b82f6' : '#2d2d44',
        border: 'none',
        color: active ? '#fff' : '#888',
        padding: '6px 12px',
        borderRadius: '6px',
        fontSize: '12px',
        cursor: 'pointer',
      }}
    >
      {label}
    </button>
  );
}
