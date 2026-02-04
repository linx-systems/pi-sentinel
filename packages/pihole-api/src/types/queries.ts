/**
 * Query log types.
 */

export interface QueryEntry {
  id: number | string;
  timestamp: number;
  type: string;
  domain: string;
  client: string;
  status: string;
  reply_type: string;
  reply_time: number;
  dnssec?: string;
  upstream?: string;
  cname_domain?: string;
}

export interface QueriesResponse {
  queries: QueryEntry[];
  cursor?: string;
  recordsTotal?: number;
  recordsFiltered?: number;
  took?: number;
}

export interface QueryParams {
  /** Maximum number of queries to return */
  length?: number;
  /** Start timestamp (Unix) */
  from?: number;
  /** End timestamp (Unix) */
  until?: number;
  /** Filter by client IP or name */
  client?: string;
  /** Filter by domain */
  domain?: string;
  /** Filter by query type (A, AAAA, etc.) */
  type?: string;
  /** Filter by status */
  status?: string;
  /** Cursor for pagination */
  cursor?: string;
  /** Filter by upstream */
  upstream?: string;
  /** Sort order */
  order?: "asc" | "desc";
}

export interface QuerySuggestions {
  domains: string[];
  clients: string[];
  upstreams: string[];
  types: string[];
  status: string[];
}
