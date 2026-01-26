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
- Options pages now use regular `sendMessage()` from `utils/messaging.ts` (same as
  popup/sidebar). Storage-based messaging was removed because Firefox's
  `storage.onChanged` listener wasn't firing reliably, causing timeouts.
- `useExtensionState` retries `GET_STATE` on transient "background unreachable"
  errors and clears errors when a `STATE_UPDATED` message arrives.
- Popup `handleInstanceChange` should NOT call `refetch()` - it races with
  background's async operations. Trust `STATE_UPDATED` broadcast instead.
