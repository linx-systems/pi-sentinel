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

## Installation

### From Source

1. **Clone the repository**
   ```bash
   git clone https://github.com/yourusername/pisentinel.git
   cd pisentinel
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Build the extension**
   ```bash
   npm run build
   ```

4. **Load in Firefox**
   - Open Firefox and navigate to `about:debugging`
   - Click "This Firefox" in the sidebar
   - Click "Load Temporary Add-on..."
   - Select the `dist/manifest.json` file

### For Development

Use watch mode for automatic rebuilds:
```bash
npm run dev
```

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

## Development

### Project Structure
```
src/
├── background/           # Background script (event page)
│   ├── api/              # Pi-hole API client
│   ├── crypto/           # Credential encryption
│   ├── services/         # Badge, notifications, domain tracking
│   └── state/            # State management
├── popup/                # Popup UI (Preact)
├── sidebar/              # Sidebar UI (Preact)
├── options/              # Options page (Preact)
├── shared/               # Shared types, constants, messaging
└── icons/                # Extension icons
```

### Scripts
| Command | Description |
|---------|-------------|
| `npm run build` | Production build to `dist/` |
| `npm run dev` | Watch mode for development |
| `npm run lint` | Run ESLint |
| `npm run package` | Create `.xpi` file for distribution |

### Tech Stack
- **TypeScript** - Type-safe JavaScript
- **Preact** - Lightweight React alternative (~3KB)
- **esbuild** - Fast bundler
- **webextension-polyfill** - Cross-browser WebExtensions API

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

### macOS users
- Recent macOS versions may require granting Firefox "Local Network" permission in System Preferences → Privacy & Security

## License

MIT

## Contributing

Contributions are welcome! Please open an issue or submit a pull request.
