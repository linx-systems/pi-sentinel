import browser from "webextension-polyfill";
import { logger } from "./logger";

/**
 * Error types for classification
 */
export enum ErrorType {
  NETWORK = "NETWORK",
  API = "API",
  AUTHENTICATION = "AUTHENTICATION",
  VALIDATION = "VALIDATION",
  STORAGE = "STORAGE",
  CRYPTO = "CRYPTO",
  INTERNAL = "INTERNAL",
  UI = "UI",
}

/**
 * Standardized error structure
 */
export interface AppError {
  type: ErrorType;
  message: string;
  originalError?: Error;
  context?: Record<string, any>;
  timestamp: number;
}

/**
 * User-facing error messages mapped from technical errors
 */
const USER_ERROR_MESSAGES: Record<ErrorType, string> = {
  [ErrorType.NETWORK]:
    "Network error. Please check your connection and try again.",
  [ErrorType.API]:
    "Failed to communicate with Pi-hole server. Please verify your server configuration.",
  [ErrorType.AUTHENTICATION]:
    "Authentication failed. Please check your password and try again.",
  [ErrorType.VALIDATION]:
    "Invalid input. Please check your entries and try again.",
  [ErrorType.STORAGE]: "Failed to save settings. Please try again.",
  [ErrorType.CRYPTO]: "Encryption error. Please try logging in again.",
  [ErrorType.INTERNAL]:
    "An unexpected error occurred. Please try reloading the extension.",
  [ErrorType.UI]: "Interface error. Please refresh the page.",
};

/**
 * Centralized error handler for the extension
 */
export class ErrorHandler {
  private static errors: AppError[] = [];
  private static readonly MAX_ERRORS = 50;

  /**
   * Handle an error with context and logging
   */
  static handle(
    error: Error | unknown,
    context: string,
    type: ErrorType = ErrorType.INTERNAL,
  ): AppError {
    const appError: AppError = {
      type,
      message: error instanceof Error ? error.message : String(error),
      originalError: error instanceof Error ? error : undefined,
      context: { source: context },
      timestamp: Date.now(),
    };

    // Log the error
    logger.error(`[${type}] ${context}:`, appError.originalError || error);

    // Store error for debugging (with limit)
    this.errors.push(appError);
    if (this.errors.length > this.MAX_ERRORS) {
      this.errors.shift();
    }

    return appError;
  }

  /**
   * Handle an error and show a user notification
   */
  static async handleWithNotification(
    error: Error | unknown,
    context: string,
    type: ErrorType = ErrorType.INTERNAL,
    customMessage?: string,
  ): Promise<AppError> {
    const appError = this.handle(error, context, type);

    // Show notification to user
    try {
      await browser.notifications.create({
        type: "basic",
        iconUrl: browser.runtime.getURL("icons/icon-48.png"),
        title: "PiSentinel Error",
        message: customMessage || USER_ERROR_MESSAGES[type],
      });
    } catch (notificationError) {
      // Fallback if notifications fail - just log
      logger.warn("Failed to show error notification:", notificationError);
    }

    return appError;
  }

  /**
   * Get user-friendly message for an error type
   */
  static getUserMessage(type: ErrorType, customMessage?: string): string {
    return customMessage || USER_ERROR_MESSAGES[type];
  }

  /**
   * Get recent errors for debugging
   */
  static getRecentErrors(limit = 10): AppError[] {
    return this.errors.slice(-limit);
  }

  /**
   * Clear error history
   */
  static clearErrors(): void {
    this.errors = [];
  }

  /**
   * Check if error is a network error
   */
  static isNetworkError(error: Error | unknown): boolean {
    if (!(error instanceof Error)) return false;

    return (
      error.message.includes("fetch") ||
      error.message.includes("network") ||
      error.message.includes("Failed to fetch") ||
      error.name === "NetworkError"
    );
  }

  /**
   * Check if error is an authentication error
   */
  static isAuthError(error: Error | unknown): boolean {
    if (!(error instanceof Error)) return false;

    return (
      error.message.includes("401") ||
      error.message.includes("403") ||
      error.message.includes("Unauthorized") ||
      error.message.includes("authentication")
    );
  }

  /**
   * Classify error type automatically
   */
  static classifyError(error: Error | unknown): ErrorType {
    if (this.isNetworkError(error)) return ErrorType.NETWORK;
    if (this.isAuthError(error)) return ErrorType.AUTHENTICATION;

    if (error instanceof Error) {
      if (error.message.includes("validation")) return ErrorType.VALIDATION;
      if (error.message.includes("storage")) return ErrorType.STORAGE;
      if (
        error.message.includes("crypto") ||
        error.message.includes("encryption")
      ) {
        return ErrorType.CRYPTO;
      }
    }

    return ErrorType.INTERNAL;
  }

  /**
   * Handle error with automatic classification
   */
  static handleAuto(error: Error | unknown, context: string): AppError {
    const type = this.classifyError(error);
    return this.handle(error, context, type);
  }
}

/**
 * Async wrapper that catches and handles errors
 */
export async function withErrorHandling<T>(
  fn: () => Promise<T>,
  context: string,
  errorType: ErrorType = ErrorType.INTERNAL,
): Promise<{ success: true; data: T } | { success: false; error: AppError }> {
  try {
    const data = await fn();
    return { success: true, data };
  } catch (error) {
    const appError = ErrorHandler.handle(error, context, errorType);
    return { success: false, error: appError };
  }
}

/**
 * Sync wrapper that catches and handles errors
 */
export function withErrorHandlingSync<T>(
  fn: () => T,
  context: string,
  errorType: ErrorType = ErrorType.INTERNAL,
): { success: true; data: T } | { success: false; error: AppError } {
  try {
    const data = fn();
    return { success: true, data };
  } catch (error) {
    const appError = ErrorHandler.handle(error, context, errorType);
    return { success: false, error: appError };
  }
}
