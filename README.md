# PiSentinel

A Firefox Manifest V3 extension for Pi-hole v6 integration. Monitor DNS blocking statistics, control blocking status, and manage domains directly from your browser.

## Features

- **Real-time Statistics** - View blocked queries, block rate, and active clients
- **Blocking Control** - Toggle DNS blocking with optional timer (30s to indefinite)
- **Domain Tracking** - See all domains loaded by each tab, categorized as first-party or third-party
- **Quick Actions** - Add domains to allowlist/denylist with one click
- **Query Log** - Browse recent DNS queries with blocked/allowed filtering
- **2FA Support** - Full TOTP authentication support for secured Pi-hole instances
- **Secure Storage** - Credentials encrypted with PBKDF2 + AES-256-GCM

## Requirements

- Firefox 115 or later
- Pi-hole v6 with the new REST API

## Prerequisites

Before installing, ensure you have:

- **Node.js** 18.x or later (LTS recommended)
- **npm** 9.x or later (comes with Node.js)
- **Bun** 0.7.x or later (optional, for faster build times)

Verify your installation:
```bash
node --version  # Should output v18.x.x or higher
npm --version   # Should output 9.x.x or higher
bun --version   # Should output 0.7.x or higher (if installed)
```

## Installation

### From Source

1. **Clone the repository**
   ```bash
   git clone https://github.com/nicokosi/pisentinel.git
   cd pisentinel
   ```

2. **Install dependencies**
   ```bash
   npm install
   # or
   bun install
   ```

3. **Build the extension**
   ```bash
   npm run build
   # or
   bun run build
   ```

4. **Load in Firefox**
   - Open Firefox and navigate to `about:debugging`
   - Click "This Firefox" in the sidebar
   - Click "Load Temporary Add-on..."
   - Select the `dist/manifest.json` file

## Development

### Quick Start

```bash
# Install dependencies
npm install

# Start development mode with file watching
npm run dev

# In another terminal, or after changes, reload the extension in Firefox
```

### Development Workflow

1. **Start watch mode**
   ```bash
   npm run dev
   ```
   This watches for file changes and automatically rebuilds. Output is unminified with inline sourcemaps for debugging.

2. **Load the extension in Firefox**
   - Navigate to `about:debugging#/runtime/this-firefox`
   - Click "Load Temporary Add-on..."
   - Select `dist/manifest.json`

3. **Reload after changes**
   - After esbuild rebuilds (watch the terminal for "Build complete"), click the "Reload" button next to PiSentinel in `about:debugging`
   - For popup/sidebar changes, close and reopen the popup/sidebar
   - For background script changes, always reload the extension

### Debugging

#### Background Script
1. Go to `about:debugging#/runtime/this-firefox`
2. Find PiSentinel and click "Inspect"
3. This opens DevTools for the background script where you can:
   - View console logs
   - Set breakpoints
   - Inspect network requests to Pi-hole API

#### Popup / Sidebar / Options
1. Right-click inside the popup/sidebar/options page
2. Select "Inspect" to open DevTools for that specific UI

#### Logging

The extension uses `console.log/warn/error` for logging. In development mode, useful logs include:

- **API calls**: Check the Network tab in background script DevTools
- **State changes**: Add `console.log` statements in `src/background/state/`
- **Message passing**: Log in `src/background/index.ts` message handlers

To add temporary debug logging:
```typescript
// In any source file
console.log('[PiSentinel]', 'Debug message', { data });
```

### Available Scripts

| Command | Description |
|---------|-------------|
| `npm run build` | Production build to `dist/` (minified, no sourcemaps) |
| `npm run dev` | Watch mode for development (unminified, inline sourcemaps) |
| `npm run lint` | Run ESLint on TypeScript files |
| `npm run package` | Build and create `pisentinel.xpi` for distribution |

### Project Structure

```
src/
├── background/           # Background script (service worker)
│   ├── api/              # Pi-hole API client
│   ├── crypto/           # Credential encryption (PBKDF2 + AES-256-GCM)
│   ├── services/         # Badge, notifications, domain tracking
│   └── state/            # State management
├── popup/                # Popup UI (Preact)
├── sidebar/              # Sidebar UI (Preact)
├── options/              # Options page (Preact)
├── shared/               # Shared types, constants, messaging utilities
├── icons/                # Extension icons (SVG source, PNG exports)
└── manifest.json         # Extension manifest (MV3)

scripts/
├── build.js              # esbuild configuration and build script
└── convert-icons.js      # SVG to PNG icon conversion
```

### Tech Stack

- **TypeScript** - Type-safe JavaScript with strict mode
- **Preact** - Lightweight React alternative (~3KB gzipped)
- **esbuild** - Fast bundler (~10ms rebuilds)
- **webextension-polyfill** - Cross-browser WebExtensions API compatibility

## Configuration

1. Click the PiSentinel icon in your toolbar
2. If not configured, click "Configure Pi-hole"
3. Enter your Pi-hole server URL (e.g., `http://pi.hole` or `http://192.168.1.100`)
4. Enter your Pi-hole web interface password
5. Click "Test Connection" to verify, then "Save & Connect"
6. If 2FA is enabled, enter your TOTP code when prompted

## Usage

### Popup
Click the toolbar icon to view:
- Connection status
- Total queries and blocked count
- Block rate percentage
- Active clients
- Toggle blocking on/off with optional timer

### Sidebar
Open the sidebar (View → Sidebar → PiSentinel Domains) to see:
- **Domains tab**: All domains loaded by the current page
  - First-party domains (green)
  - Third-party domains (orange)
  - Quick actions to allow/block each domain
- **Query Log tab**: Recent DNS queries with filtering

### Badge
The toolbar badge shows:
- **Number**: Blocked query count
- **Green background**: Blocking active
- **Red background**: Blocking disabled
- **Gray background**: Not connected

## Security

- Credentials are encrypted using PBKDF2 (100,000 iterations) + AES-256-GCM
- Session tokens stored in `browser.storage.session` (cleared on browser close)
- All API calls routed through background script (CORS bypass)
- No credentials or tokens exposed to content scripts

## Pi-hole v6 API Endpoints Used

| Endpoint | Purpose |
|----------|---------|
| `POST /api/auth` | Authenticate and get session |
| `DELETE /api/auth` | Logout |
| `GET /api/stats/summary` | Fetch statistics |
| `GET/POST /api/dns/blocking` | Check/toggle blocking |
| `GET /api/queries` | Query log |
| `POST /api/domains/allow/exact` | Add to allowlist |
| `POST /api/domains/deny/exact` | Add to denylist |
| `GET /api/search/{domain}` | Search domain status |

## Troubleshooting

### "Connection failed" error
- Verify Pi-hole URL is correct (no `/admin` suffix needed)
- Ensure Pi-hole v6 is running
- Check if Pi-hole is accessible from your browser

### Session expires frequently
- The extension automatically refreshes sessions every 4 minutes
- If issues persist, check Pi-hole's session timeout settings

### Extension not updating after code changes
- Ensure `npm run dev` is running and shows successful rebuilds
- Click "Reload" in `about:debugging` after each change
- For popup changes, close and reopen the popup

### Console errors not visible
- Background script logs: Inspect via `about:debugging`
- Popup/sidebar logs: Right-click → Inspect within the UI

### macOS users
- Recent macOS versions may require granting Firefox "Local Network" permission in System Preferences → Privacy & Security

## Contributing

Contributions are welcome! Here's how to get started:

1. **Fork the repository** and clone your fork
2. **Create a feature branch**: `git checkout -b feature/your-feature-name`
3. **Make your changes** following the existing code style
4. **Run linting**: `npm run lint` and fix any issues
5. **Test manually** in Firefox using the development workflow above
6. **Commit your changes** with a descriptive message
7. **Push to your fork** and open a Pull Request

### Code Style

- Use TypeScript strict mode
- Follow existing patterns in the codebase
- Keep components small and focused
- Use meaningful variable and function names

## License

MIT
