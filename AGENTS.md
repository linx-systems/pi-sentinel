# AGENTS.md

Critical gotchas for agents working in this repo. Details in `.claude/rules/`.

## Must-Know Rules

1. **Options page MUST use `sendViaStorage()`** for `CHECK_PASSWORD_AVAILABLE`, `CONNECT_INSTANCE`, `DISCONNECT_INSTANCE`, `SET_ACTIVE_INSTANCE`. Firefox bug causes `runtime.sendMessage` to return `undefined` for async responses. See `.claude/rules/architecture.md`.

2. **Popup MUST NOT call `refetch()` in `handleInstanceChange`** — it races with background async ops. Rely on `STATE_UPDATED` broadcast instead.

3. **Avoid stat refresh loops** — only fetch stats/blocking status when cached data is stale (use `DEFAULTS.CACHE_TTL` as threshold).

4. **Instance selector "All"** shows when 2+ instances configured (not based on connected count). Auto-connects on selection if stored password exists.

5. **`useExtensionState`** retries `GET_STATE` on transient "background unreachable" errors and clears errors on `STATE_UPDATED`.
