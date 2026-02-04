/**
 * Statistics types.
 */

export interface StatsSummary {
  queries: {
    total: number;
    blocked: number;
    percent_blocked: number;
    unique_domains: number;
    forwarded: number;
    cached: number;
    types?: Record<string, number>;
  };
  clients: {
    active: number;
    total: number;
  };
  gravity: {
    domains_being_blocked: number;
    last_update: number;
  };
  took?: number;
}

export interface UpstreamStats {
  upstreams: Array<{
    name: string;
    ip: string;
    port: number;
    count: number;
    percentage: number;
  }>;
  forwarded: number;
  total: number;
  took?: number;
}

export interface TopDomainsStats {
  domains: Array<{
    domain: string;
    count: number;
  }>;
  total_queries: number;
  blocked_queries?: number;
  took?: number;
}

export interface TopClientsStats {
  clients: Array<{
    client: string;
    name?: string;
    count: number;
  }>;
  total_queries: number;
  took?: number;
}

export interface QueryTypesStats {
  types: Record<string, number>;
  total: number;
  took?: number;
}

export interface RecentBlockedResponse {
  blocked: string[];
  took?: number;
}

export interface DatabaseSummary extends StatsSummary {
  database: {
    size: number;
    queries: number;
  };
}

export interface StatsOptions {
  /** Number of results to return */
  count?: number;
  /** Only show blocked queries */
  blocked?: boolean;
}

export interface DatabaseStatsOptions extends StatsOptions {
  /** Start timestamp */
  from?: number;
  /** End timestamp */
  until?: number;
}
