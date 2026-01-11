// API Endpoints
export const ENDPOINTS = {
  AUTH: '/api/auth',
  STATS_SUMMARY: '/api/stats/summary',
  DNS_BLOCKING: '/api/dns/blocking',
  QUERIES: '/api/queries',
  DOMAINS_ALLOW_EXACT: '/api/domains/allow/exact',
  DOMAINS_DENY_EXACT: '/api/domains/deny/exact',
  DOMAINS_ALLOW_REGEX: '/api/domains/allow/regex',
  DOMAINS_DENY_REGEX: '/api/domains/deny/regex',
  SEARCH: '/api/search',
  CONFIG: '/api/config',
} as const;

// Storage Keys
export const STORAGE_KEYS = {
  CONFIG: 'pisentinel_config',
  SESSION: 'pisentinel_session',
} as const;

// Alarm Names
export const ALARMS = {
  SESSION_KEEPALIVE: 'pisentinel_session_keepalive',
  STATS_REFRESH: 'pisentinel_stats_refresh',
} as const;

// Default Values
export const DEFAULTS = {
  REFRESH_INTERVAL: 30, // seconds
  SESSION_KEEPALIVE_INTERVAL: 4, // minutes (Pi-hole default session is 300s = 5min)
  API_TIMEOUT: 10000, // ms
  PBKDF2_ITERATIONS: 100000,
  SALT_LENGTH: 16,
  IV_LENGTH: 12,
} as const;

// Disable Timer Options (in seconds)
export const DISABLE_TIMERS = [
  { label: '30 seconds', value: 30 },
  { label: '1 minute', value: 60 },
  { label: '5 minutes', value: 300 },
  { label: '30 minutes', value: 1800 },
  { label: '1 hour', value: 3600 },
  { label: 'Indefinitely', value: 0 },
] as const;
