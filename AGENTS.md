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
- Options pages use storage-based messaging (`utils/storage-message.ts`) due to
  unreliable `runtime.sendMessage` responses in Firefox options pages.
- `useExtensionState` retries `GET_STATE` on transient "background unreachable"
  errors and clears errors when a `STATE_UPDATED` message arrives.

