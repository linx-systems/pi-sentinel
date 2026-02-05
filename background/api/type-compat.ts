/**
 * Type compatibility layer for converting between pihole-api-client library types
 * and extension's existing ApiResult types.
 */

import {
  type Result,
  type PiholeError,
  isOk,
  PiholeErrorCode,
} from "@linx-systems/pihole-api-client";
import type { ApiResult } from "./types";

/**
 * Convert library Result<T, PiholeError> to extension ApiResult<T>.
 */
export function toApiResult<T>(result: Result<T, PiholeError>): ApiResult<T> {
  if (isOk(result)) {
    return {
      success: true,
      data: result.data,
    };
  }

  return {
    success: false,
    error: {
      key: result.error.apiKey ?? result.error.code,
      message: result.error.message,
      hint: result.error.hint,
      status: result.error.status,
    },
  };
}

/**
 * Check if a library error indicates TOTP is required.
 */
export function isTotpRequired(error: PiholeError): boolean {
  return error.code === PiholeErrorCode.TotpRequired;
}

/**
 * Check if a library error is an auth error requiring re-login.
 */
export function isAuthError(error: PiholeError): boolean {
  return (
    error.code === PiholeErrorCode.Unauthorized ||
    error.code === PiholeErrorCode.SessionExpired
  );
}

/**
 * Check if a library error is a network/connection error.
 */
export function isNetworkError(error: PiholeError): boolean {
  return (
    error.code === PiholeErrorCode.NetworkError ||
    error.code === PiholeErrorCode.Timeout ||
    error.code === PiholeErrorCode.ConnectionRefused ||
    error.code === PiholeErrorCode.CertificateError
  );
}

/**
 * Check if a library error is retryable.
 */
export function isRetryableError(error: PiholeError): boolean {
  return (
    error.code === PiholeErrorCode.NetworkError ||
    error.code === PiholeErrorCode.Timeout ||
    error.code === PiholeErrorCode.ServiceUnavailable ||
    error.code === PiholeErrorCode.ServerError
  );
}

/**
 * Convert library error to user-friendly message.
 */
export function getErrorMessage(error: PiholeError): string {
  switch (error.code) {
    case PiholeErrorCode.Unauthorized:
      return "Authentication failed. Please check your password.";
    case PiholeErrorCode.TotpRequired:
      return "Two-factor authentication code required.";
    case PiholeErrorCode.InvalidTotp:
      return "Invalid two-factor authentication code.";
    case PiholeErrorCode.SessionExpired:
      return "Session expired. Please reconnect.";
    case PiholeErrorCode.NetworkError:
      return "Network error. Please check your connection.";
    case PiholeErrorCode.Timeout:
      return "Request timed out. Pi-hole may be slow or unreachable.";
    case PiholeErrorCode.ConnectionRefused:
      return "Connection refused. Is Pi-hole running?";
    case PiholeErrorCode.CertificateError:
      return "SSL certificate error. Check your Pi-hole HTTPS configuration.";
    case PiholeErrorCode.NotFound:
      return "Resource not found.";
    case PiholeErrorCode.ServerError:
      return "Pi-hole server error.";
    case PiholeErrorCode.ServiceUnavailable:
      return "Pi-hole is temporarily unavailable.";
    default:
      return error.message || "An unknown error occurred.";
  }
}
