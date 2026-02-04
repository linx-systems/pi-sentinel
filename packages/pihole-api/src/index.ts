/**
 * @pisentinel/pihole-api
 *
 * Type-safe TypeScript client for the Pi-hole v6 REST API.
 *
 * @example
 * ```typescript
 * import { PiholeClient, isOk } from '@pisentinel/pihole-api';
 *
 * const client = new PiholeClient({
 *   baseUrl: 'http://pi.hole',
 *   password: 'your-password',
 * });
 *
 * const result = await client.stats.getSummary();
 * if (isOk(result)) {
 *   console.log('Blocked:', result.data.queries.blocked);
 * }
 * ```
 *
 * @packageDocumentation
 */

// ===== Main Client =====
export { PiholeClient, createClient } from "./client.js";
export type { PiholeClientConfig } from "./client.js";

// ===== Result Type =====
export {
  type Result,
  type Ok,
  type Err,
  ok,
  err,
  isOk,
  isErr,
  unwrap,
  unwrapOr,
  map,
  mapErr,
  andThen,
} from "./result.js";

// ===== Errors =====
export {
  PiholeErrorCode,
  type PiholeError,
  createError,
  statusToErrorCode,
  apiKeyToErrorCode,
  isRetryable,
  isAuthError,
} from "./errors.js";

// ===== HTTP Layer =====
export { HttpClient } from "./http.js";
export type { HttpConfig, HttpRequestOptions } from "./http.js";

// ===== Session Manager =====
export { SessionManager } from "./session.js";
export type { SessionState, SessionConfig } from "./session.js";

// ===== Types =====
export * from "./types/index.js";

// ===== Endpoint Classes (for advanced usage) =====
export { AuthEndpoints } from "./endpoints/auth.js";
export { DnsEndpoints } from "./endpoints/dns.js";
export { StatsEndpoints, DatabaseStatsEndpoints } from "./endpoints/stats.js";
export { QueriesEndpoints } from "./endpoints/queries.js";
export {
  HistoryEndpoints,
  DatabaseHistoryEndpoints,
} from "./endpoints/history.js";
export { DomainsEndpoints } from "./endpoints/domains.js";
export { GroupsEndpoints } from "./endpoints/groups.js";
export { ClientsEndpoints } from "./endpoints/clients.js";
export { ListsEndpoints } from "./endpoints/lists.js";
export { DhcpEndpoints } from "./endpoints/dhcp.js";
export { ConfigEndpoints } from "./endpoints/config.js";
export { InfoEndpoints } from "./endpoints/info.js";
export { NetworkEndpoints } from "./endpoints/network.js";
export { ActionsEndpoints } from "./endpoints/actions.js";
export { LogsEndpoints } from "./endpoints/logs.js";
export { TeleporterEndpoints } from "./endpoints/teleporter.js";
