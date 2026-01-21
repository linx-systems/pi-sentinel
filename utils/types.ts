// Pi-hole API Types

export interface AuthResponse {
  session: {
    valid: boolean;
    sid: string;
    csrf: string;
    validity: number;
    totp: boolean;
  };
}

export interface StatsSummary {
  queries: {
    total: number;
    blocked: number;
    percent_blocked: number;
    unique_domains: number;
    forwarded: number;
    cached: number;
  };
  clients: {
    active: number;
    total: number;
  };
  gravity: {
    domains_being_blocked: number;
    last_update: number;
  };
}

export interface BlockingStatus {
  blocking: "enabled" | "disabled";
  timer: number | null;
}

export interface QueryEntry {
  id: number | string;
  timestamp: number;
  type: string;
  domain: string;
  client: string;
  status: string;
  reply_type: string;
  reply_time: number;
  /** Source Pi-hole instance (present in multi-instance mode) */
  instanceId?: string;
  /** Display name for source instance */
  instanceName?: string;
}

export interface DomainEntry {
  id: number;
  domain: string;
  type: number; // 0=allow exact, 1=deny exact, 2=allow regex, 3=deny regex
  enabled: boolean;
  comment: string | null;
  date_added: number;
  date_modified: number;
}

export interface ApiError {
  error: {
    key: string;
    message: string;
    hint?: string;
  };
}

// Extension State Types

export interface ExtensionState {
  isConnected: boolean;
  connectionError: string | null;
  blockingEnabled: boolean;
  blockingTimer: number | null;
  stats: StatsSummary | null;
  statsLastUpdated: number;
  totpRequired: boolean;
}

export interface TabDomainData {
  tabId: number;
  pageUrl: string;
  firstPartyDomain: string;
  domains: Set<string>;
  thirdPartyDomains: Set<string>;
}

export interface PersistedConfig {
  piholeUrl: string;
  encryptedPassword: EncryptedData | null;
  refreshInterval: number;
  notificationsEnabled: boolean;
  rememberPassword: boolean;
  /** Encrypted master key for persistent re-authentication (only when rememberPassword is true) */
  encryptedMasterKey: EncryptedData | null;
}

export interface EncryptedData {
  ciphertext: string;
  salt: string;
  iv: string;
}

export interface SessionData {
  sid: string;
  csrf: string;
  expiresAt: number;
}

// ===== Multi Pi-hole Instance Types =====

/**
 * A single Pi-hole instance configuration.
 * Each instance has its own encrypted credentials.
 */
export interface PiHoleInstance {
  /** Unique identifier (UUID) */
  id: string;
  /** Optional display name (null = use hostname from URL) */
  name: string | null;
  /** Pi-hole server URL (without /admin) */
  piholeUrl: string;
  /** Encrypted Pi-hole password */
  encryptedPassword: EncryptedData | null;
  /** Encrypted master key for persistent re-authentication */
  encryptedMasterKey: EncryptedData | null;
  /** Whether to persist credentials across browser restarts */
  rememberPassword: boolean;
  /** Timestamp when instance was created */
  createdAt: number;
}

/**
 * Persisted multi-instance configuration.
 * Stored in browser.storage.local.
 */
export interface PersistedInstances {
  /** All configured Pi-hole instances */
  instances: PiHoleInstance[];
  /** Currently active instance ID (null = "All" mode) */
  activeInstanceId: string | null;
  /** Global settings that apply to all instances */
  globalSettings: {
    notificationsEnabled: boolean;
    refreshInterval: number;
  };
}

/**
 * Runtime state for a single Pi-hole instance.
 * Stored in memory, not persisted.
 */
export interface InstanceState {
  /** Instance ID this state belongs to */
  instanceId: string;
  /** Whether connected to this Pi-hole */
  isConnected: boolean;
  /** Connection error message if any */
  connectionError: string | null;
  /** Whether blocking is enabled */
  blockingEnabled: boolean;
  /** Remaining time for disable timer (null = no timer) */
  blockingTimer: number | null;
  /** Cached statistics */
  stats: StatsSummary | null;
  /** When stats were last fetched */
  statsLastUpdated: number;
  /** Whether TOTP is required for authentication */
  totpRequired: boolean;
}

/**
 * Cached API response data with TTL.
 */
export interface CachedData<T> {
  /** The cached data */
  data: T;
  /** Timestamp when cache was populated */
  cachedAt: number;
  /** Cache TTL in milliseconds */
  ttl: number;
}

/**
 * Aggregated state when viewing "All" instances.
 */
export interface AggregatedState {
  /** Number of connected instances */
  connectedCount: number;
  /** Total number of instances */
  totalCount: number;
  /** Aggregated statistics (summed/averaged) */
  stats: StatsSummary | null;
  /** Mixed blocking state: 'enabled' | 'disabled' | 'mixed' */
  blockingState: "enabled" | "disabled" | "mixed";
  /** Per-instance connection status */
  instanceStatuses: Array<{
    instanceId: string;
    name: string;
    isConnected: boolean;
  }>;
}
