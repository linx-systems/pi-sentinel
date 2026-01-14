# Implementation Plan: Sidebar Auto-Search Toggle

Generated: 2026-01-13

## Goal

Add a toggle in the sidebar that, when enabled, automatically searches all domains as they are detected (via Pi-hole API) to check their whitelist/blacklist/gravity status. This eliminates the need for manual per-domain searches or bulk "Search All" operations.

## Research Summary

**Existing Functionality:**
- Domain search is fully implemented via `SEARCH_DOMAIN` message type
- `handleSearchDomain()` in background script calls `apiClient.searchDomain(domain)` and returns `{ gravity, allowlist, denylist }`
- `DomainList.tsx` already has search result display UI with proper status indicators
- Individual domain search via search button, and bulk "Search All" button both work
- Real-time domain updates broadcast via `TAB_DOMAINS_UPDATED` message when new domains are detected

**Domain Detection Flow:**
1. `domain-tracker.ts` listens to `webRequest.onCompleted` and `onErrorOccurred`
2. New domains are added via `store.addTabDomain(tabId, domain)`
3. Store broadcasts `TAB_DOMAINS_UPDATED` to sidebar
4. Sidebar receives update and refreshes `tabDomains` state

**Storage Pattern:**
- Extension uses `browser.storage.local` for persistent settings (see `PersistedConfig` in types.ts)
- Session-only data uses `browser.storage.session`
- For a sidebar preference, `browser.storage.local` is appropriate for persistence across sessions

## Existing Codebase Analysis

### Critical Files

| File | Role |
|------|------|
| `src/sidebar/components/DomainList.tsx` | Main domain list UI, has existing search logic |
| `src/sidebar/components/App.tsx` | Parent component, receives domain updates |
| `src/sidebar/sidebar.css` | Styling for sidebar components |
| `src/background/index.ts` | Message handler for SEARCH_DOMAIN |
| `src/background/state/store.ts` | Broadcasts TAB_DOMAINS_UPDATED when domains added |
| `src/shared/types.ts` | Type definitions (may need update) |

### Existing Search Pattern in DomainList.tsx

```typescript
// State for search results
const [searchResults, setSearchResults] = useState<Map<string, SearchResult>>(new Map());

// Individual domain search
const handleSearch = async () => {
  const response = await browser.runtime.sendMessage({
    type: 'SEARCH_DOMAIN',
    payload: { domain },
  });
  if (response?.success && response.data) {
    onSearchResult(response.data);
  }
};

// Bulk search all
const handleSearchAll = async () => {
  for (const domain of allDomains) {
    // ... search each domain
  }
};
```

### Real-time Update Pattern in App.tsx

```typescript
// Listen for domain updates
const handleMessage = async (message: unknown) => {
  if (msg.type === 'TAB_DOMAINS_UPDATED' && msg.payload) {
    const [currentTab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (currentTab?.id === msg.payload.tabId) {
      setTabDomains(msg.payload);  // <-- This is where we can trigger auto-search
    }
  }
};
```

## Architecture Overview

```
                                    +------------------+
                                    |   storage.local  |
                                    | autoSearchEnabled|
                                    +--------+---------+
                                             |
                                             v
+----------------+    TAB_DOMAINS_UPDATED   +----------------+    SEARCH_DOMAIN    +----------------+
| domain-tracker | -----------------------> |   App.tsx      | -----------------> | background.ts  |
| (detects new   |                          |                |                    |                |
|  domains)      |                          | autoSearch=on? | <----------------- | searchDomain() |
+----------------+                          |     |          |    SearchResult    +----------------+
                                            |     v          |
                                            | DomainList.tsx |
                                            | (displays      |
                                            |  results)      |
                                            +----------------+
```

**Flow when auto-search is enabled:**
1. User enables toggle -> setting saved to `storage.local`
2. New domain detected -> `TAB_DOMAINS_UPDATED` broadcast
3. App.tsx receives update, compares with previous domains
4. For each NEW domain, sends `SEARCH_DOMAIN` message
5. Result stored in `searchResults` Map and displayed

## Implementation Phases

### Phase 1: Add Toggle UI and State

**Files to modify:**
- `src/sidebar/components/DomainList.tsx` - Add toggle checkbox to search box area

**Steps:**

1. Add state for auto-search toggle:
```typescript
const [autoSearchEnabled, setAutoSearchEnabled] = useState(false);
```

2. Load/save setting from storage on mount:
```typescript
useEffect(() => {
  browser.storage.local.get('pisentinel_autoSearch').then(result => {
    setAutoSearchEnabled(result.pisentinel_autoSearch === true);
  });
}, []);

const toggleAutoSearch = async (enabled: boolean) => {
  setAutoSearchEnabled(enabled);
  await browser.storage.local.set({ pisentinel_autoSearch: enabled });
};
```

3. Add checkbox UI in the search-box area (next to Search All button):
```tsx
<label class="auto-search-toggle">
  <input
    type="checkbox"
    checked={autoSearchEnabled}
    onChange={(e) => toggleAutoSearch((e.target as HTMLInputElement).checked)}
  />
  <span>Auto-search</span>
</label>
```

**Acceptance criteria:**
- [ ] Toggle checkbox visible in sidebar search area
- [ ] Toggle state persists across page reloads
- [ ] Toggle state persists across browser restarts

### Phase 2: Track Previously Searched Domains

**Files to modify:**
- `src/sidebar/components/DomainList.tsx`

**Steps:**

1. Add ref to track which domains have been auto-searched (to avoid re-searching):
```typescript
const autoSearchedDomains = useRef<Set<string>>(new Set());
```

2. Clear the set when tab changes or domains are cleared:
```typescript
// In the useEffect that watches domains prop
useEffect(() => {
  // Reset auto-searched set when first-party domain changes (new page)
  autoSearchedDomains.current.clear();
}, [firstPartyDomain]);
```

**Acceptance criteria:**
- [ ] Previously searched domains are not re-searched
- [ ] Domain tracking resets when navigating to new page

### Phase 3: Implement Auto-Search Logic

**Files to modify:**
- `src/sidebar/components/DomainList.tsx`

**Steps:**

1. Add effect that triggers when domains list changes AND auto-search is enabled:
```typescript
useEffect(() => {
  if (!autoSearchEnabled) return;

  const newDomains = domains.filter(
    d => !searchResults.has(d) && !autoSearchedDomains.current.has(d)
  );

  if (newDomains.length === 0) return;

  // Search new domains with rate limiting
  const searchNewDomains = async () => {
    for (const domain of newDomains) {
      autoSearchedDomains.current.add(domain);
      try {
        const response = await browser.runtime.sendMessage({
          type: 'SEARCH_DOMAIN',
          payload: { domain },
        });
        if (response?.success && response.data) {
          setSearchResult(domain, response.data);
        }
      } catch (err) {
        console.error(`Auto-search failed for ${domain}:`, err);
      }
      // Small delay to avoid hammering the API
      await new Promise(r => setTimeout(r, 100));
    }
  };

  searchNewDomains();
}, [domains, autoSearchEnabled]);
```

**Acceptance criteria:**
- [ ] New domains are automatically searched when toggle is on
- [ ] Existing domains are not re-searched
- [ ] Search results display correctly
- [ ] No API hammering (rate limited)

### Phase 4: Add Styling

**Files to modify:**
- `src/sidebar/sidebar.css`

**Steps:**

1. Add styles for the auto-search toggle:
```css
.auto-search-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: #888;
  cursor: pointer;
  padding: 0 8px;
  white-space: nowrap;
}

.auto-search-toggle input[type="checkbox"] {
  accent-color: #3b82f6;
  cursor: pointer;
}

.auto-search-toggle:hover {
  color: #e0e0e0;
}
```

**Acceptance criteria:**
- [ ] Toggle has consistent styling with sidebar theme
- [ ] Hover states work correctly
- [ ] Checkbox uses accent color matching extension theme

### Phase 5: Performance Optimization (Optional)

**Files to modify:**
- `src/sidebar/components/DomainList.tsx`

**Steps:**

1. Add debouncing to prevent excessive searches during rapid page loads:
```typescript
const pendingSearches = useRef<string[]>([]);
const isSearching = useRef(false);

// Batch and debounce searches
```

2. Consider adding a max domains limit for auto-search:
```typescript
const MAX_AUTO_SEARCH_DOMAINS = 50;
if (newDomains.length > MAX_AUTO_SEARCH_DOMAINS) {
  console.warn('Too many domains for auto-search, limiting to first 50');
  newDomains = newDomains.slice(0, MAX_AUTO_SEARCH_DOMAINS);
}
```

**Acceptance criteria:**
- [ ] Large pages with many domains don't freeze UI
- [ ] User is informed if domains are skipped

## Testing Strategy

### Manual Testing

1. **Basic toggle functionality:**
   - Open sidebar, verify toggle appears
   - Toggle on/off, close sidebar, reopen - verify state persists
   - Close browser, reopen - verify state persists

2. **Auto-search behavior:**
   - Enable toggle
   - Navigate to a new website
   - Verify domains are automatically searched and results appear
   - Navigate to another page
   - Verify new domains are searched, old results cleared

3. **Performance testing:**
   - Visit a page with many domains (e.g., news site with ads)
   - Verify UI remains responsive
   - Check console for API errors or rate limiting

4. **Edge cases:**
   - Toggle off while searches are in progress
   - Rapid navigation between pages
   - Disconnect from Pi-hole while auto-search is running

### Browser Console Checks

```javascript
// Verify storage is set correctly
browser.storage.local.get('pisentinel_autoSearch').then(console.log)

// Should show: { pisentinel_autoSearch: true } or { pisentinel_autoSearch: false }
```

## Risks & Considerations

| Risk | Mitigation |
|------|------------|
| API rate limiting by Pi-hole | Add 100ms delay between searches |
| Performance with many domains | Limit auto-search to first 50 domains, batch requests |
| Network errors | Use try/catch, don't break on single failure |
| Toggle state sync issues | Use storage.local, not in-memory only |
| Stale results after list changes | Track searched domains in ref, clear on navigation |

## Estimated Complexity

| Phase | Effort | Risk |
|-------|--------|------|
| Phase 1: Toggle UI | Low | Low |
| Phase 2: Domain tracking | Low | Low |
| Phase 3: Auto-search logic | Medium | Medium |
| Phase 4: Styling | Low | Low |
| Phase 5: Optimization | Medium | Low |

**Total estimated effort:** 2-3 hours

## File Change Summary

| File | Change Type |
|------|-------------|
| `src/sidebar/components/DomainList.tsx` | Major modification - add toggle, auto-search logic |
| `src/sidebar/sidebar.css` | Minor modification - add toggle styles |

No changes needed to:
- Background script (existing `SEARCH_DOMAIN` handler is sufficient)
- Types (no new types required)
- Messaging (existing message type works)

## Risk Mitigations (Pre-Mortem - 2026-01-13)

### Critical Tigers Addressed

#### 1. API Rate Limiting (HIGH)
**Risk:** No rate limiting at API client or background handler level. Rapid-fire requests (50 domains in 5 seconds) could trigger Pi-hole rate limits or overload the API.

**Mitigation:** Add request concurrency control in Phase 3
```typescript
// Instead of sequential with just setTimeout:
// Batch requests - max 5 concurrent at a time
const CONCURRENT_LIMIT = 5;
const queue = [...newDomains];
const inProgress = new Set<Promise<void>>();

while (queue.length > 0 || inProgress.size > 0) {
  while (inProgress.size < CONCURRENT_LIMIT && queue.length > 0) {
    const domain = queue.shift()!;
    const promise = (async () => {
      try {
        const response = await browser.runtime.sendMessage({
          type: 'SEARCH_DOMAIN',
          payload: { domain },
        });
        if (response?.success && response.data) {
          setSearchResult(domain, response.data);
        }
      } catch (err) {
        console.error(`Auto-search failed for ${domain}:`, err);
      }
      inProgress.delete(promise);
    })();
    inProgress.add(promise);
  }
  if (inProgress.size > 0) {
    await Promise.race(inProgress);
  }
  await new Promise(r => setTimeout(r, 100)); // Rate limit between batches
}
```

**Added to:** Phase 3 implementation

#### 2. useEffect Cleanup Missing (MEDIUM)
**Risk:** If component unmounts or dependencies change mid-search, async operations continue running and may call setState on unmounted component.

**Mitigation:** Add cleanup function to useEffect
```typescript
useEffect(() => {
  let cancelled = false;

  const searchNewDomains = async () => {
    // ... search logic from above, but add:
    if (cancelled) return; // Check before each domain search
    // ... rest of search logic
  };

  if (autoSearchEnabled && newDomains.length > 0) {
    searchNewDomains();
  }

  return () => {
    cancelled = true; // Cancel on unmount or dependency change
  };
}, [domains, autoSearchEnabled]);
```

**Added to:** Phase 3 implementation

### Elephants Addressed

#### 1. No User Feedback for Long Operations (MEDIUM)
**Risk:** User has no indication auto-search is working during bulk operations.

**Mitigation:** Add subtle status indicator
```typescript
const [autoSearchProgress, setAutoSearchProgress] = useState<{current: number; total: number} | null>(null);

// In search loop:
setAutoSearchProgress({ current: searchedCount, total: newDomains.length });

// When done:
setAutoSearchProgress(null);

// In JSX:
{autoSearchProgress && (
  <span class="auto-search-status">
    Searching {autoSearchProgress.current}/{autoSearchProgress.total}...
  </span>
)}
```

**Added to:** Phase 3 implementation, Phase 4 styling

#### 2. Pi-hole Disconnection During Search (MEDIUM)
**Risk:** Undefined behavior if user disconnects from Pi-hole mid-search.

**Mitigation Strategy:**
- Continue attempting searches (already have try/catch per domain)
- Failed searches log error but don't break loop
- When user reconnects, existing toggle state will handle new domains
- **Behavior:** Fail silently per-domain, don't show error toast (avoids spam)

**Added to:** Phase 3 - already present via try/catch, just needs documentation

### Accepted Risks

#### 1. Storage Key Naming (LOW)
- Using direct string `'pisentinel_autoSearch'` instead of STORAGE_KEYS constant
- **Accepted because:** Matches existing pattern in popup (line 21: `'pisentinel_config'`)

#### 2. Initial 100ms Delay (LOW)
- May need adjustment based on Pi-hole behavior
- **Accepted because:** Starting point that can be tuned during testing

### Updated Phases

**Phase 3 now includes:**
- Request concurrency control (max 5 concurrent)
- useEffect cleanup function
- Progress indicator state
- Documented disconnection behavior
