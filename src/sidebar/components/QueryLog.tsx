import { useState, useEffect } from 'preact/hooks';
import browser from 'webextension-polyfill';
import type { QueryEntry } from '../../shared/types';
import type { MessageResponse } from '../../shared/messaging';

export function QueryLog() {
  const [queries, setQueries] = useState<QueryEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'blocked' | 'allowed'>('all');

  useEffect(() => {
    loadQueries();
  }, []);

  const loadQueries = async () => {
    setIsLoading(true);
    try {
      const response = (await browser.runtime.sendMessage({
        type: 'GET_QUERIES',
        payload: { length: 100 },
      })) as MessageResponse<QueryEntry[]>;

      if (response.success && response.data) {
        // Ensure we have an array
        const queryData = Array.isArray(response.data) ? response.data : [];
        // Debug: log first query to see the actual format
        if (queryData.length > 0) {
          console.log('Query sample:', JSON.stringify(queryData[0], null, 2));
        }
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
    const blocked = isBlocked(q.status);
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
            query ? <QueryItem key={query.id || index} query={query} /> : null
          )}
        </div>
      )}
    </div>
  );
}

interface QueryItemProps {
  query: QueryEntry;
}

function QueryItem({ query }: QueryItemProps) {
  const blocked = isBlocked(query.status);

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

  return (
    <div class="query-item">
      <span class={`status-icon ${blocked ? 'blocked' : 'allowed'}`}>
        {blocked ? <BlockedIcon /> : <AllowedIcon />}
      </span>
      <div class="details">
        <div class="domain" title={query.domain}>
          {query.domain || 'unknown'}
        </div>
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

function isBlocked(status: string | number | undefined | null): boolean {
  if (status === undefined || status === null) return false;

  if (typeof status === 'string') {
    // Pi-hole v6 status strings
    // Blocked: GRAVITY, BLACKLIST, REGEX, EXTERNAL_BLOCKED_*, DENYLIST, etc.
    // Allowed: FORWARDED, CACHE, UPSTREAM_*, RETRIED, etc.
    const blockedStatuses = [
      'GRAVITY',
      'BLACKLIST',
      'DENYLIST',
      'REGEX',
      'EXTERNAL_BLOCKED_IP',
      'EXTERNAL_BLOCKED_NULL',
      'EXTERNAL_BLOCKED_NXRA',
      'BLOCKED',
      'SPECIAL_DOMAIN',
      'DATABASE_BUSY'
    ];
    return blockedStatuses.includes(status.toUpperCase());
  }

  // Numeric status fallback: 2-11 are blocked
  return status >= 2 && status <= 11;
}

function BlockedIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <circle cx="12" cy="12" r="10" />
      <line x1="15" y1="9" x2="9" y2="15" />
      <line x1="9" y1="9" x2="15" y2="15" />
    </svg>
  );
}

function AllowedIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function RefreshIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <polyline points="23 4 23 10 17 10" />
      <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
    </svg>
  );
}
