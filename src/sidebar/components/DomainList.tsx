import { useState } from 'preact/hooks';
import browser from 'webextension-polyfill';
import type { MessageResponse } from '../../shared/messaging';

interface DomainListProps {
  domains: string[];
  thirdPartyDomains: string[];
  firstPartyDomain: string;
  onAddToList: (domain: string, listType: 'allow' | 'deny') => Promise<void>;
}

type SearchResult = {
  gravity: boolean;
  allowlist: boolean;
  denylist: boolean;
};

export function DomainList({
  domains,
  thirdPartyDomains,
  firstPartyDomain,
  onAddToList,
}: DomainListProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Map<string, SearchResult>>(new Map());
  const [isSearchingAll, setIsSearchingAll] = useState(false);

  const setSearchResult = (domain: string, result: SearchResult | null) => {
    setSearchResults(prev => {
      const next = new Map(prev);
      if (result) {
        next.set(domain, result);
      } else {
        next.delete(domain);
      }
      return next;
    });
  };

  const handleSearchAll = async () => {
    const allDomains = [...new Set(domains)];
    setIsSearchingAll(true);

    for (const domain of allDomains) {
      try {
        const response = (await browser.runtime.sendMessage({
          type: 'SEARCH_DOMAIN',
          payload: { domain },
        })) as MessageResponse<SearchResult>;

        if (response.success && response.data) {
          setSearchResult(domain, response.data);
        }
      } catch (err) {
        console.error(`Search failed for ${domain}:`, err);
      }
    }

    setIsSearchingAll(false);
  };

  const clearAllResults = () => {
    setSearchResults(new Map());
  };

  // Separate first-party and third-party domains
  const firstPartyDomains = domains.filter(
    (d) => d === firstPartyDomain || isSameSite(d, firstPartyDomain)
  );
  const thirdParty = domains.filter(
    (d) => d !== firstPartyDomain && !isSameSite(d, firstPartyDomain)
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
        <p style={{ fontSize: '11px', marginTop: '8px' }}>
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
        <button
          class="search-all-btn"
          onClick={handleSearchAll}
          disabled={isSearchingAll}
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
  onAddToList: (domain: string, listType: 'allow' | 'deny') => Promise<void>;
  searchResult: SearchResult | null;
  onSearchResult: (result: SearchResult | null) => void;
}

function DomainItem({ domain, isFirstParty, onAddToList, searchResult, onSearchResult }: DomainItemProps) {
  const handleSearch = async () => {
    try {
      const response = (await browser.runtime.sendMessage({
        type: 'SEARCH_DOMAIN',
        payload: { domain },
      })) as MessageResponse<SearchResult>;

      if (response.success && response.data) {
        onSearchResult(response.data);
      }
    } catch (err) {
      console.error('Search failed:', err);
    }
  };

  return (
    <li class="domain-item">
      <div class="domain-row">
        <span class={`domain ${isFirstParty ? 'first-party' : 'third-party'}`}>
          {domain}
        </span>
        <div class="domain-actions">
          <button
            class="action-btn allow"
            onClick={() => onAddToList(domain, 'allow')}
            title="Add to allowlist"
          >
            <AllowIcon />
          </button>
          <button
            class="action-btn block"
            onClick={() => onAddToList(domain, 'deny')}
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
        <div class="search-result">
          <span class={searchResult.gravity ? 'status-blocked' : 'status-allowed'}>
            {searchResult.gravity ? '● Blocked (gravity)' : '○ Not in blocklist'}
          </span>
          {searchResult.allowlist && <span class="status-allowlist">● Allowlisted</span>}
          {searchResult.denylist && <span class="status-denylist">● Denylisted</span>}
          <button class="dismiss-btn" onClick={() => onSearchResult(null)} title="Dismiss">×</button>
        </div>
      )}
    </li>
  );
}

function isSameSite(domain1: string, domain2: string): boolean {
  const getParts = (d: string) => d.split('.').slice(-2).join('.');
  return getParts(domain1) === getParts(domain2);
}

function GlobeIcon() {
  return (
    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
      <circle cx="12" cy="12" r="10" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  );
}

function AllowIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function BlockIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <circle cx="12" cy="12" r="10" />
      <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

function SearchAllIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <circle cx="10" cy="10" r="6" />
      <line x1="21" y1="21" x2="14.5" y2="14.5" />
      <line x1="10" y1="7" x2="10" y2="13" />
      <line x1="7" y1="10" x2="13" y2="10" />
    </svg>
  );
}

function SpinnerIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="spinner-icon">
      <circle cx="12" cy="12" r="10" opacity="0.25" />
      <path d="M12 2a10 10 0 0 1 10 10" />
    </svg>
  );
}

function ClearIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}
