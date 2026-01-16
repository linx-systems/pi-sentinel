// API Endpoints
export const ENDPOINTS = {
  AUTH: "/api/auth",
  STATS_SUMMARY: "/api/stats/summary",
  DNS_BLOCKING: "/api/dns/blocking",
  QUERIES: "/api/queries",
  DOMAINS_ALLOW_EXACT: "/api/domains/allow/exact",
  DOMAINS_DENY_EXACT: "/api/domains/deny/exact",
  DOMAINS_ALLOW_REGEX: "/api/domains/allow/regex",
  DOMAINS_DENY_REGEX: "/api/domains/deny/regex",
  SEARCH: "/api/search",
  CONFIG: "/api/config",
} as const;

// Storage Keys
export const STORAGE_KEYS = {
  CONFIG: "pisentinel_config",
  SESSION: "pisentinel_session",
} as const;

// Alarm Names
export const ALARMS = {
  SESSION_KEEPALIVE: "pisentinel_session_keepalive",
  STATS_REFRESH: "pisentinel_stats_refresh",
} as const;

// Default Values
export const DEFAULTS = {
  REFRESH_INTERVAL: 30, // seconds
  SESSION_KEEPALIVE_INTERVAL: 4, // minutes (Pi-hole default session is 300s = 5min)
  SESSION_RENEWAL_THRESHOLD: 60, // seconds before expiry to trigger renewal
  API_TIMEOUT: 10000, // ms
  PBKDF2_ITERATIONS: 100000,
  SALT_LENGTH: 16,
  IV_LENGTH: 12,
} as const;

// Extension-specific entropy for encrypting the master key when "Remember Password" is enabled
// This provides a layer of obfuscation for the stored master key
export const EXTENSION_ENTROPY = "PiSentinel-v1-MasterKey-Encryption" as const;

// Disable Timer Options (in seconds)
export const DISABLE_TIMERS = [
  { label: "30 seconds", value: 30 },
  { label: "1 minute", value: 60 },
  { label: "5 minutes", value: 300 },
  { label: "30 minutes", value: 1800 },
  { label: "1 hour", value: 3600 },
  { label: "Indefinitely", value: 0 },
] as const;

// Timeouts (in milliseconds)
export const TIMEOUTS = {
  MESSAGE: 10000, // sendMessage timeout
  API_REQUEST: 10000, // API request timeout
  HEALTH_CHECK: 5000, // Health check timeout
  TOAST_DURATION: 3000, // Toast notification duration
  DEBOUNCE_SEARCH: 300, // Search input debounce
  RETRY_DELAY_BASE: 1000, // Base delay for exponential backoff
  RETRY_DELAY_MAX: 10000, // Maximum retry delay
} as const;

// Error Messages
export const ERROR_MESSAGES = {
  AUTH_FAILED: "Authentication failed. Please check your password.",
  CONNECTION_ERROR: "Could not connect to Pi-hole server.",
  NETWORK_ERROR: "Network error. Please check your connection.",
  INVALID_URL: "Please enter a valid HTTP or HTTPS URL.",
  INVALID_DOMAIN: "Please enter a valid domain name.",
  INVALID_TOTP: "TOTP code must be 6 digits.",
  SESSION_EXPIRED: "Your session has expired. Please log in again.",
  TIMEOUT: "Request timed out. Please try again.",
  RATE_LIMITED: "Too many requests. Please wait a moment.",
  SERVER_ERROR: "Pi-hole server error. Please try again later.",
  UNKNOWN_ERROR: "An unexpected error occurred.",
  VALIDATION_ERROR: "Invalid input. Please check your entries.",
  STORAGE_ERROR: "Failed to save settings. Please try again.",
  CRYPTO_ERROR: "Encryption error. Please try logging in again.",
} as const;

// Validation Rules
export const VALIDATION_RULES = {
  DOMAIN_REGEX:
    /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9][a-z0-9-]{0,61}[a-z0-9]$/i,
  TOTP_REGEX: /^\d{6}$/,
  MAX_TIMER_SECONDS: 86400, // 24 hours
  MIN_TIMER_SECONDS: 0,
  MAX_DOMAIN_LENGTH: 253,
  MAX_LABEL_LENGTH: 63,
  MIN_PASSWORD_LENGTH: 1,
} as const;

// Retry Configuration
export const RETRY_CONFIG = {
  MAX_RETRIES: 3,
  RETRYABLE_STATUS_CODES: [408, 429, 500, 502, 503, 504],
  BACKOFF_MULTIPLIER: 2,
} as const;
