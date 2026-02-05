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
