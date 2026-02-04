/**
 * Error codes for Pi-hole API errors.
 */
export enum PiholeErrorCode {
  // Authentication errors
  Unauthorized = "unauthorized",
  TotpRequired = "totp_required",
  InvalidTotp = "invalid_totp",
  SessionExpired = "session_expired",

  // Network errors
  NetworkError = "network_error",
  Timeout = "timeout",
  ConnectionRefused = "connection_refused",
  CertificateError = "certificate_error",

  // Client errors
  BadRequest = "bad_request",
  NotFound = "not_found",
  Conflict = "conflict",
  ValidationError = "validation_error",

  // Server errors
  ServerError = "server_error",
  ServiceUnavailable = "service_unavailable",

  // Other
  ParseError = "parse_error",
  Unknown = "unknown",
}

/**
 * Pi-hole API error.
 */
export interface PiholeError {
  /** Error code for programmatic handling */
  code: PiholeErrorCode;
  /** Human-readable error message */
  message: string;
  /** Optional hint from the API */
  hint?: string;
  /** HTTP status code (0 for network errors) */
  status: number;
  /** Original error key from Pi-hole API */
  apiKey?: string;
}

/**
 * Create a PiholeError from HTTP response.
 */
export function createError(
  code: PiholeErrorCode,
  message: string,
  status: number,
  options?: { hint?: string; apiKey?: string },
): PiholeError {
  return {
    code,
    message,
    status,
    hint: options?.hint,
    apiKey: options?.apiKey,
  };
}

/**
 * Map HTTP status to error code.
 */
export function statusToErrorCode(status: number): PiholeErrorCode {
  switch (status) {
    case 400:
      return PiholeErrorCode.BadRequest;
    case 401:
      return PiholeErrorCode.Unauthorized;
    case 403:
      return PiholeErrorCode.Unauthorized;
    case 404:
      return PiholeErrorCode.NotFound;
    case 409:
      return PiholeErrorCode.Conflict;
    case 422:
      return PiholeErrorCode.ValidationError;
    case 500:
      return PiholeErrorCode.ServerError;
    case 502:
    case 503:
    case 504:
      return PiholeErrorCode.ServiceUnavailable;
    default:
      return status >= 400 && status < 500
        ? PiholeErrorCode.BadRequest
        : PiholeErrorCode.ServerError;
  }
}

/**
 * Map Pi-hole API error key to error code.
 */
export function apiKeyToErrorCode(key: string): PiholeErrorCode {
  switch (key) {
    case "unauthorized":
    case "auth_failed":
      return PiholeErrorCode.Unauthorized;
    case "totp_required":
      return PiholeErrorCode.TotpRequired;
    case "bad_totp":
      return PiholeErrorCode.InvalidTotp;
    case "session_expired":
      return PiholeErrorCode.SessionExpired;
    case "not_found":
      return PiholeErrorCode.NotFound;
    case "conflict":
      return PiholeErrorCode.Conflict;
    case "bad_request":
      return PiholeErrorCode.BadRequest;
    default:
      return PiholeErrorCode.Unknown;
  }
}

/**
 * Check if error code is retryable.
 */
export function isRetryable(code: PiholeErrorCode): boolean {
  return (
    code === PiholeErrorCode.NetworkError ||
    code === PiholeErrorCode.Timeout ||
    code === PiholeErrorCode.ServiceUnavailable ||
    code === PiholeErrorCode.ServerError
  );
}

/**
 * Check if error indicates auth is required.
 */
export function isAuthError(code: PiholeErrorCode): boolean {
  return (
    code === PiholeErrorCode.Unauthorized ||
    code === PiholeErrorCode.SessionExpired ||
    code === PiholeErrorCode.TotpRequired
  );
}
