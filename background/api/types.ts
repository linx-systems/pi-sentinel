// API-specific types that extend shared types

import type {
  ApiError,
  AuthResponse,
  BlockingStatus,
  DomainEntry,
  QueryEntry,
  StatsSummary,
} from "~/utils/types";

export interface ApiConfig {
  baseUrl: string;
  timeout: number;
}

export interface ApiResult<T> {
  success: boolean;
  data?: T;
  error?: {
    key: string;
    message: string;
    hint?: string;
    status: number;
  };
}

// Re-export for convenience
export type {
  AuthResponse,
  StatsSummary,
  BlockingStatus,
  QueryEntry,
  DomainEntry,
  ApiError,
};

// Domain list types
export type DomainListType = "allow" | "deny";
export type DomainMatchType = "exact" | "regex";

// Query params
export interface QueryParams {
  length?: number;
  from?: number;
  until?: number;
  client?: string;
  domain?: string;
  type?: string;
  status?: string;
}

// Search result
export interface SearchResult {
  gravity: {
    count: number;
    results: Array<{
      domain: string;
      group: string;
    }>;
  };
  domains: {
    allow: DomainEntry[];
    deny: DomainEntry[];
  };
}

/**
 * Unified Pi-hole API client interface.
 * Both the custom client and the library adapter implement this interface,
 * allowing seamless switching between implementations via feature flag.
 */
export interface IPiholeClient {
  /** Set the Pi-hole server URL */
  setBaseUrl(url: string): void;

  /** Set session credentials (for restoring from storage) */
  setSession(sid: string, csrf: string): void;

  /** Clear session credentials */
  clearSession(): void;

  /** Check if we have a session */
  hasSession(): boolean;

  /** Set callback for handling auth required (401) responses */
  setAuthRequiredHandler?(handler: () => Promise<boolean>): void;

  /** Authenticate with Pi-hole */
  authenticate(
    password: string,
    totp?: string,
  ): Promise<ApiResult<AuthResponse>>;

  /** Logout and invalidate session */
  logout(): Promise<ApiResult<void>>;

  /** Get summary statistics */
  getStats(): Promise<ApiResult<StatsSummary>>;

  /** Get current blocking status */
  getBlockingStatus(): Promise<ApiResult<BlockingStatus>>;

  /** Enable or disable blocking */
  setBlocking(enabled: boolean, timer?: number): Promise<ApiResult<BlockingStatus>>;

  /** Get recent queries */
  getQueries(params?: QueryParams): Promise<ApiResult<QueryEntry[]>>;

  /** Get domains from a list */
  getDomains(
    listType: DomainListType,
    matchType?: DomainMatchType,
  ): Promise<ApiResult<DomainEntry[]>>;

  /** Add a domain to a list */
  addDomain(
    domain: string,
    listType: DomainListType,
    matchType?: DomainMatchType,
    comment?: string,
  ): Promise<ApiResult<DomainEntry>>;

  /** Remove a domain from a list */
  removeDomain(
    domain: string,
    listType: DomainListType,
    matchType?: DomainMatchType,
  ): Promise<ApiResult<void>>;

  /** Search for a domain in gravity and lists */
  searchDomain(domain: string): Promise<ApiResult<SearchResult>>;

  /** Test connection to Pi-hole (unauthenticated) */
  testConnection(url?: string): Promise<ApiResult<void>>;
}

/**
 * Unified client manager interface.
 * Both ApiClientManager and LibraryClientManager implement this interface.
 */
export interface IClientManager {
  /** Get or create a client for an instance */
  getClient(instanceId: string): IPiholeClient | undefined;

  /** Check if a client exists for an instance */
  hasClient(instanceId: string): boolean;

  /** Remove a client for an instance */
  removeClient(instanceId: string): void;

  /** Get all instance IDs with active clients */
  getActiveInstanceIds(): string[];

  /** Clear all clients */
  clear(): void;
}
