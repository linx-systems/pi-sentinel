import { useState } from 'preact/hooks';
import browser from 'webextension-polyfill';
import type { MessageResponse } from '../../shared/messaging';

interface DomainListProps {
  domains: string[];
  thirdPartyDomains: string[];
  firstPartyDomain: string;
  onAddToList: (domain: string, listType: 'allow' | 'deny') => Promise<void>;
}

export function DomainList({
  domains,
  thirdPartyDomains,
  firstPartyDomain,
  onAddToList,
}: DomainListProps) {
  const [searchQuery, setSearchQuery] = useState('');

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
}

function DomainItem({ domain, isFirstParty, onAddToList }: DomainItemProps) {
  const [searchResult, setSearchResult] = useState<{
    gravity: boolean;
    allowlist: boolean;
    denylist: boolean;
  } | null>(null);

  const handleSearch = async () => {
    try {
      const response = (await browser.runtime.sendMessage({
        type: 'SEARCH_DOMAIN',
        payload: { domain },
      })) as MessageResponse<typeof searchResult>;

      if (response.success && response.data) {
        setSearchResult(response.data);
      }
    } catch (err) {
      console.error('Search failed:', err);
    }
  };

  return (
    <li class="domain-item">
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
