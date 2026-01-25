/**
 * Shared utility functions used across popup, sidebar, and options pages.
 */

import { ERROR_MESSAGES } from "./constants";

// Re-export validation utilities for convenience
export {
  isSameSite,
  getRegistrableDomain,
  Validators,
  type ValidationResult,
} from "./validation";

/**
 * Format a number with K/M suffixes for large values.
 */
export function formatNumber(num: number): string {
  if (num >= 1000000) {
    return `${(num / 1000000).toFixed(1)}M`;
  }
  if (num >= 1000) {
    return `${(num / 1000).toFixed(1)}K`;
  }
  return num.toString();
}

/**
 * Format duration in seconds to human-readable string.
 * @param seconds - Duration in seconds
 * @param includeRemaining - Whether to append "remaining" suffix
 */
export function formatDuration(
  seconds: number,
  includeRemaining = false,
): string {
  const suffix = includeRemaining ? " remaining" : "";

  if (seconds < 60) {
    return `${Math.round(seconds)}s${suffix}`;
  }
  if (seconds < 3600) {
    return `${Math.round(seconds / 60)}m${suffix}`;
  }
  return `${Math.round(seconds / 3600)}h${suffix}`;
}

/**
 * Extract domain from URL.
 * @param url - Full URL string
 * @returns Domain name or null if invalid URL
 */
export function extractDomain(url: string): string | null {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Format Unix timestamp to localized date/time string.
 * @param timestamp - Unix timestamp in seconds
 */
export function formatTimestamp(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleString();
}

/**
 * Debounce function calls.
 * @param fn - Function to debounce
 * @param delayMs - Delay in milliseconds
 */
export function debounce<T extends (...args: any[]) => void>(
  fn: T,
  delayMs: number,
): T {
  let timeoutId: ReturnType<typeof setTimeout>;
  return ((...args: Parameters<T>) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn(...args), delayMs);
  }) as T;
}

/**
 * Parse API error to user-friendly message.
 * @param error - Error object with key or message property
 * @returns User-friendly error message
 */
export function parseApiError(
  error: string | { key?: string; message?: string } | undefined | null,
): string {
  if (!error) {
    return ERROR_MESSAGES.UNKNOWN_ERROR;
  }

  // Handle string errors
  if (typeof error === "string") {
    return ERROR_MESSAGES[error as keyof typeof ERROR_MESSAGES] || error;
  }

  // Handle error objects with key
  if (error.key) {
    const message = ERROR_MESSAGES[error.key as keyof typeof ERROR_MESSAGES];
    if (message) return message;
  }

  // Fall back to error.message or generic error
  return error.message || ERROR_MESSAGES.UNKNOWN_ERROR;
}

/**
 * Determine if a query status indicates the query was blocked.
 *
 * Pi-hole v6 uses string statuses:
 * - Blocked: GRAVITY, DENYLIST, REGEX, EXTERNAL_BLOCKED_*, SPECIAL_DOMAIN
 * - Allowed: FORWARDED, CACHE, UPSTREAM_*, RETRIED
 *
 * Legacy Pi-hole (v5 and earlier) used numeric statuses:
 * - Blocked: 2-11
 * - Allowed: 0, 1, 12+
 *
 * @param status - Query status from Pi-hole API (string or number)
 * @returns True if the query was blocked
 */
export function isQueryBlocked(
  status: string | number | undefined | null,
): boolean {
  if (status === undefined || status === null) return false;

  if (typeof status === "string") {
    // Pi-hole v6 status strings
    // Blocked: GRAVITY, BLACKLIST, REGEX, EXTERNAL_BLOCKED_*, DENYLIST, etc.
    // Allowed: FORWARDED, CACHE, UPSTREAM_*, RETRIED, etc.
    const blockedStatuses = [
      "GRAVITY",
      "BLACKLIST",
      "DENYLIST",
      "REGEX",
      "EXTERNAL_BLOCKED_IP",
      "EXTERNAL_BLOCKED_NULL",
      "EXTERNAL_BLOCKED_NXRA",
      "BLOCKED",
      "SPECIAL_DOMAIN",
      "DATABASE_BUSY",
    ];
    return blockedStatuses.includes(status.toUpperCase());
  }

  // Numeric status fallback: 2-11 are blocked
  return status >= 2 && status <= 11;
}
