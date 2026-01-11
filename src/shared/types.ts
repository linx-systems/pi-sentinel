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
  blocking: 'enabled' | 'disabled';
  timer: number | null;
}

export interface QueryEntry {
  id: number;
  timestamp: number;
  type: string;
  domain: string;
  client: string;
  status: string;
  reply_type: string;
  reply_time: number;
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
