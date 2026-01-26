# AGENTS.md

Notes for agents working in this repo (recent findings).

- Multi-instance config is stored under `STORAGE_KEYS.INSTANCES` and mirrored via
  `GET_INSTANCES` and `GET_INSTANCE_STATE`.
- Background now broadcasts `INSTANCES_UPDATED` after add/update/delete/active
  changes; UI listeners should refresh on this message.
- Popup Admin link must be derived from the active instance (or single instance),
  and hidden in "All" mode when multiple instances exist.
- Avoid refresh loops in the popup: only fetch stats/blocking status when cached
  data is stale (use `DEFAULTS.CACHE_TTL` as the threshold).
- Instance selector "All" option is now shown whenever 2+ instances are
  configured (not based on connected count) and auto-connects on selection if a
  stored password exists.
- `useExtensionState` retries `GET_STATE` on transient "background unreachable"
  errors and clears errors when a `STATE_UPDATED` message arrives.
- Popup `handleInstanceChange` should NOT call `refetch()` - it races with
  background's async operations. Trust `STATE_UPDATED` broadcast instead.

## Options Page Messaging (Firefox Bug)

**IMPORTANT:** Options pages MUST use `sendViaStorage()` for certain async operations
due to a Firefox bug where `runtime.sendMessage` returns `undefined` before the
background script can respond.

**Use `sendViaStorage()` for:**
- `CHECK_PASSWORD_AVAILABLE` → `pendingCheckPasswordAvailable` / `checkPasswordAvailableResponse`
- `CONNECT_INSTANCE` → `pendingConnectInstance` / `connectInstanceResponse`
- `DISCONNECT_INSTANCE` → `pendingDisconnectInstance` / `disconnectInstanceResponse`
- `SET_ACTIVE_INSTANCE` → `pendingSetActiveInstance` / `setActiveInstanceResponse`

**Use regular `sendMessage()` for:**
- `GET_INSTANCES`, `GET_INSTANCE_STATE` (these work correctly)
- All popup/sidebar messaging (not affected by this bug)

## Remember Password Feature

Password persistence uses a two-layer encryption scheme:
1. Password encrypted with instance-specific master key → `encryptedPassword`
2. Master key encrypted with extension entropy → `encryptedMasterKey` (only if `rememberPassword=true`)

After browser restart:
1. Session storage is cleared (master key lost from memory)
2. If `rememberPassword=true`, master key is recovered from `encryptedMasterKey`
3. Password is then decrypted from `encryptedPassword` using recovered master key

Key method: `instanceManager.getDecryptedPassword()` handles the full recovery chain.
