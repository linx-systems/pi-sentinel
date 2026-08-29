# AGENTS.md

Critical gotchas for agents working in this repo. Details in `.claude/rules/`.

## Must-Know Rules

1. **Options page MUST use `sendViaStorage()`** for `CHECK_PASSWORD_AVAILABLE`, `CONNECT_INSTANCE`, `DISCONNECT_INSTANCE`, `SET_ACTIVE_INSTANCE`. Firefox bug causes `runtime.sendMessage` to return `undefined` for async responses. See `.claude/rules/architecture.md`.

2. **Popup MUST NOT call `refetch()` in `handleInstanceChange`** — it races with background async ops. Rely on `STATE_UPDATED` broadcast instead.

3. **Avoid stat refresh loops** — only fetch stats/blocking status when cached data is stale (use `DEFAULTS.CACHE_TTL` as threshold).

4. **Instance selector "All"** shows when 2+ instances configured (not based on connected count). Auto-connects on selection if stored password exists.

5. **`useExtensionState`** retries `GET_STATE` on transient "background unreachable" errors and clears errors on `STATE_UPDATED`.

6. **Cross-browser builds** — WXT defaults to Chrome. Use `bun run build:firefox` for Firefox output (`dist/firefox-mv3/`), `bun run build` for Chrome (`dist/chrome-mv3/`). The `package`/`sign` scripts explicitly target Firefox; use `package:chrome` for Chrome zips.

7. **Sidebar vs Side Panel** — Firefox uses `sidebar/` (sidebar_action API), Chrome uses `sidepanel/` (sidePanel API). WXT auto-excludes the wrong one per browser. Popup code conditionally calls `browser.sidebarAction` or `browser.sidePanel` based on API availability.

8. **Background script type** — Firefox uses event page (`background.scripts`), Chrome uses service worker (`background.service_worker`). WXT handles this automatically. The background script persists state via `storage.session` to survive SW restarts on Chrome.

## Project Context

PiSentinel is a cross-browser Manifest V3 extension for Pi-hole v6 integration. It monitors DNS blocking statistics, controls blocking status, and manages domains directly from Firefox and Chromium-based browsers.

**Key technologies:** TypeScript (strict mode), Preact, WXT + Vite, webextension-polyfill, and Manifest V3.

## Repository Layout

- `background/api/` — Pi-hole v6 REST client, authentication, and types.
- `background/crypto/` — PBKDF2 and AES-256-GCM encryption.
- `background/services/` — badge, notifications, and domain tracking.
- `background/state/` — central state store.
- `components/` — shared UI components.
- `entrypoints/` — WXT entry points for background, popup, sidebar, side panel, and options.
- `public/` — static assets and icons.
- `tests/` — unit and end-to-end tests.
- `utils/` — shared messaging, types, constants, and validation.

## Quick Reference

```bash
bun install              # Install dependencies
bun run dev              # Watch mode — Chrome (default)
bun run dev:firefox      # Watch mode — Firefox
bun run build            # Production build — Chrome (default)
bun run build:firefox    # Production build — Firefox
bun run lint             # ESLint
bun run lint:ext         # Validate the Firefox extension
bun run lint:ext:chrome  # Validate the Chrome extension
bun run package          # Build Firefox and create an unsigned .xpi
bun run package:chrome   # Build Chrome and create a .zip
```

## Related Repositories

- `../pisentinel-mobile/` — React Native + Expo SDK 54 mobile app.
- `../pisentinel-shared/` — `@pisentinel/shared`, providing types, constants, validation, and utilities.

The mobile package links its nested shared submodule through `file:./pisentinel-shared`. Mobile makes direct API calls through TanStack Query rather than message passing and uses `expo-secure-store` rather than PBKDF2+AES encryption. Its plan and progress tracker is `.claude/plans/dapper-wishing-sundae.md`.

## Rule References

For detailed guidance, use `.claude/rules/`:

- `architecture.md` — message flow, state management, background structure, and session/domain tracking.
- `coding-patterns.md` — API integration, code examples, and Firefox MV3 specifics.
- `testing.md` — build commands, development workflow, and testing changes.
- `debugging.md` — common issues and troubleshooting checklists.
