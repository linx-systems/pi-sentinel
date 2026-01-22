# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

PiSentinel is a Firefox Manifest V3 extension for Pi-hole v6 integration. It monitors DNS blocking statistics, controls
blocking status, and manages domains directly from the browser.

**Key Technologies:**

- TypeScript (strict mode)
- Preact (lightweight React alternative)
- esbuild (bundler)
- webextension-polyfill (cross-browser API compatibility)
- Firefox MV3 (Manifest V3)

## Build Commands

```bash
# Install dependencies
npm install
# or
bun install

# Development build with watch mode (unminified + inline sourcemaps)
npm run dev
# or
bun run dev

# Production build (minified, no sourcemaps)
npm run build
# or
bun run build

# Linting
npm run lint           # ESLint on TypeScript files
npm run lint:ext       # web-ext lint for extension validation

# Packaging
npm run package        # Build and create unsigned .xpi
npm run sign           # Build and sign with Mozilla (requires AMO credentials)
npm run sign:channel   # Build and sign as unlisted
```

## Development Workflow

1. **Start watch mode**: `npm run dev`
2. **Load in Firefox**:
   - Navigate to `about:debugging#/runtime/this-firefox`
   - Click "Load Temporary Add-on..."
   - Select `dist/manifest.json`
3. **After changes**: Click "Reload" button in about:debugging
4. **Debugging**:
   - Background script: Inspect via about:debugging
   - Popup/Sidebar/Options: Right-click → Inspect within the UI

## Architecture

### Message-Based Communication

The extension uses a centralized message-passing architecture where **all cross-context communication flows through the
background script**:

- **Popup/Sidebar/Options → Background**: Send messages via `sendMessage()` from `utils/messaging.ts`
- **Background → API**: Background script handles all Pi-hole API calls
- **Background → State**: Background script updates central state store
- **State Changes**: Background script notifies listeners (badge, notifications)

**Key Message Types** (defined in `utils/messaging.ts`):

- `GET_STATE`: Retrieve current extension state
- `CONNECT`: Authenticate with Pi-hole
- `DISCONNECT`: Log out from Pi-hole
- `TOGGLE_BLOCKING`: Enable/disable DNS blocking
- `GET_TAB_DOMAINS`: Get domains loaded by a specific tab
- `ADD_TO_LIST`: Add domain to allowlist/denylist
- `GET_QUERIES`: Fetch query log

### Multi-Instance Notes (Recent Findings)

- Instance config lives in `browser.storage.local` under `STORAGE_KEYS.INSTANCES`.
- Background broadcasts `INSTANCES_UPDATED` after add/update/delete/active changes.
- `InstanceSelector` listens to both `STATE_UPDATED` and `INSTANCES_UPDATED`.
- Popup derives the Admin link from the active instance (or the only instance).
- Avoid stat refresh loops: only refresh when stats are stale (cache TTL).
- Options pages use storage-based messaging (`utils/storage-message.ts`) because
  `runtime.sendMessage` responses can be unreliable in Firefox options pages.

### State Management

**Central State Store** (`src/background/state/store.ts`):

- Single source of truth for extension state
- Manages connection status, statistics, blocking state, per-tab domain data
- Notifies listeners on state changes (used by badge service, popup listeners)

**State Flow**:

1. UI sends message to background
2. Background calls Pi-hole API via `apiClient`
3. Background updates `store` with new data
4. Store notifies listeners
5. Background sends response back to UI

### Background Script Structure

**Entry Point**: `src/background/index.ts`

**Services** (in `src/background/services/`):

- `badge.ts`: Updates toolbar badge (blocked count, color based on status)
- `notifications.ts`: Shows browser notifications for blocking state changes
- `domain-tracker.ts`: Tracks domains loaded per tab via webRequest API

**API Layer** (in `src/background/api/`):

- `client.ts`: Pi-hole v6 REST API client with session management
- `auth.ts`: Authentication manager with credential storage and auto-refresh
- `types.ts`: TypeScript types for Pi-hole API responses

**Crypto** (`src/background/crypto/encryption.ts`):

- PBKDF2 (100,000 iterations) + AES-256-GCM encryption for stored credentials
- Session tokens stored in `browser.storage.session` (cleared on browser close)

### Frontend Structure

All UI components are built with **Preact** and share styles/patterns:

- **Popup** (`src/popup/`): Quick stats and blocking toggle
- **Sidebar** (`src/sidebar/`): Domain list per tab + query log
- **Options** (`src/options/`): Server configuration and 2FA setup

**Shared Resources** (`utils/`):

- `messaging.ts`: Message helpers for cross-context communication
- `types.ts`: Shared TypeScript types
- `constants.ts`: API endpoints, defaults, alarm names, error messages
- `validation.ts`: Input validation and domain comparison utilities
- `error-handler.ts`: Centralized error handling
- `logger.ts`: Structured logging with production mode support
- `utils.ts`: Utility functions (formatting, parsing, etc.)

### Session Management

**Auto-refresh pattern**:

- Sessions auto-refresh every 4 minutes via alarm (`SESSION_KEEPALIVE`)
- `authManager.authenticate()` handles re-authentication on session expiry
- API client automatically retries with fresh session on 401/403

**2FA/TOTP Support**:

- If Pi-hole requires TOTP, `totpRequired` flag is set in state
- UI prompts for TOTP code
- `authManager.authenticateWithTotp()` completes authentication

### Domain Tracking

**How it works** (see `src/background/services/domain-tracker.ts`):

1. `webRequest.onBeforeRequest` listener captures all HTTP(S) requests
2. Domains extracted and categorized as first-party vs third-party
3. Per-tab data stored in state store's `tabDomains` Map
4. Sidebar retrieves domain list via `GET_TAB_DOMAINS` message

**First-party vs Third-party**:

- First-party: Same eTLD+1 as current tab URL
- Third-party: Different eTLD+1 (tracked in `utils.ts:isSameSite()`)

## Pi-hole v6 API Integration

**Base URL format**: `http://pi.hole` or `http://192.168.1.100` (no `/admin` suffix)

**Key Endpoints Used**:

- `POST /api/auth` - Authenticate (with optional `totp` in body)
- `DELETE /api/auth` - Logout
- `GET /api/stats/summary` - Statistics
- `GET/POST /api/dns/blocking` - Check/toggle blocking
- `GET /api/queries` - Query log
- `POST /api/domains/{allow|deny}/exact` - Add to lists
- `GET /api/search/{domain}` - Search domain status

**Authentication Flow**:

1. User enters password in options page
2. Password encrypted with PBKDF2+AES and stored
3. Background script calls `POST /api/auth` with password
4. Pi-hole returns `sid` (session ID) and `csrf` token
5. Subsequent requests include both as headers
6. Session auto-refreshed every 4 minutes

## Important Patterns

### Making API Calls

Always use the `apiClient` singleton from background script:

```typescript
import { apiClient } from "./api/client";

const result = await apiClient.getStats();
if (result.success) {
  const stats = result.data;
}
```

### Sending Messages from UI

```typescript
import { sendMessage } from "~/utils/messaging";

const response = await sendMessage({
  type: "TOGGLE_BLOCKING",
  payload: { enabled: false, timer: 300 },
});
```

### Updating State

```typescript
import { store } from "./state/store";

store.setState({ isConnected: true, stats: newStats });
```

### Firefox MV3 Specifics

- **Background script**: Event page (not service worker like Chrome)
- **Session storage**: `browser.storage.session` for temporary data
- **Alarms**: Used for periodic tasks (stats polling, session keepalive)
- **webRequest**: Available in Firefox MV3 for domain tracking

## Testing Changes

After making changes:

1. **Ensure watch mode is running**: `npm run dev` should show successful rebuild
2. **Reload extension**: Click "Reload" in about:debugging
3. **For popup changes**: Close and reopen the popup
4. **For background changes**: Always reload the extension
5. **Check console**:
   - Background logs: Inspect via about:debugging
   - UI logs: Right-click → Inspect in popup/sidebar

## Common Issues

### Session Expiry

If seeing 401/403 errors, check:

- Password is correctly stored and decrypted
- `authManager.getDecryptedPassword()` returns valid password
- Auto-refresh alarm is running (check `browser.alarms.getAll()`)

### Domain Tracking Not Working

Check:

- `webRequest` permission in manifest.json
- `host_permissions: ["<all_urls>"]` in manifest.json
- `domainTracker.initialize()` called in background script

### Message Passing Failures

Verify:

- Message type exists in `MessageType` union (utils/messaging.ts)
- Background script has handler for message type
- Response format matches `MessageResponse` type
