/**
 * HTTP layer with retry logic and timeout handling.
 */

import {
  type PiholeError,
  PiholeErrorCode,
  apiKeyToErrorCode,
  createError,
  isRetryable,
  statusToErrorCode,
} from "./errors.js";
import { type Result, err, ok } from "./result.js";

/** HTTP request options */
export interface HttpRequestOptions {
  /** Request method */
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** URL path (will be appended to baseUrl) */
  path: string;
  /** Request body (will be JSON stringified) */
  body?: unknown;
  /** Additional headers */
  headers?: Record<string, string>;
  /** Request timeout in ms */
  timeout?: number;
  /** Skip retry logic */
  noRetry?: boolean;
}

/** HTTP client configuration */
export interface HttpConfig {
  /** Base URL for requests */
  baseUrl: string;
  /** Default timeout in ms */
  timeout: number;
  /** Maximum retry attempts */
  maxRetries: number;
  /** Base delay for exponential backoff (ms) */
  retryDelayBase: number;
  /** Maximum retry delay (ms) */
  retryDelayMax: number;
  /** Backoff multiplier */
  backoffMultiplier: number;
}

/** Default configuration */
export const DEFAULT_HTTP_CONFIG: HttpConfig = {
  baseUrl: "",
  timeout: 10000,
  maxRetries: 3,
  retryDelayBase: 1000,
  retryDelayMax: 10000,
  backoffMultiplier: 2,
};

/**
 * HTTP client for making requests to Pi-hole API.
 */
export class HttpClient {
  private config: HttpConfig;

  constructor(config: Partial<HttpConfig> = {}) {
    this.config = { ...DEFAULT_HTTP_CONFIG, ...config };
  }

  /** Update configuration */
  configure(config: Partial<HttpConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /** Get current base URL */
  getBaseUrl(): string {
    return this.config.baseUrl;
  }

  /** Set base URL */
  setBaseUrl(url: string): void {
    // Normalize: remove trailing slash
    this.config.baseUrl = url.replace(/\/+$/, "");
  }

  /**
   * Make an HTTP request with retry logic.
   */
  async request<T>(
    options: HttpRequestOptions,
    authHeaders?: Record<string, string>,
  ): Promise<Result<T, PiholeError>> {
    if (!this.config.baseUrl) {
      return err(
        createError(PiholeErrorCode.BadRequest, "Base URL not configured", 0),
      );
    }

    const timeout = options.timeout ?? this.config.timeout;
    const maxAttempts = options.noRetry ? 1 : this.config.maxRetries + 1;

    let lastError: PiholeError | null = null;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const result = await this.executeRequest<T>(
        options,
        authHeaders,
        timeout,
      );

      if (result.ok) {
        return result;
      }

      lastError = result.error;

      // Don't retry non-retryable errors
      if (!isRetryable(result.error.code)) {
        return result;
      }

      // Don't wait after last attempt
      if (attempt < maxAttempts - 1) {
        const delay = this.calculateDelay(attempt);
        await this.sleep(delay);
      }
    }

    return err(
      lastError ?? createError(PiholeErrorCode.Unknown, "Request failed", 0),
    );
  }

  /**
   * Execute a single request attempt.
   */
  private async executeRequest<T>(
    options: HttpRequestOptions,
    authHeaders?: Record<string, string>,
    timeout: number = this.config.timeout,
  ): Promise<Result<T, PiholeError>> {
    const url = `${this.config.baseUrl}${options.path}`;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...authHeaders,
      ...options.headers,
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(url, {
        method: options.method,
        headers,
        body: options.body ? JSON.stringify(options.body) : undefined,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      return this.handleResponse<T>(response);
    } catch (error) {
      clearTimeout(timeoutId);
      return err(this.handleFetchError(error));
    }
  }

  /**
   * Handle fetch response.
   */
  private async handleResponse<T>(
    response: Response,
  ): Promise<Result<T, PiholeError>> {
    // Handle error responses
    if (!response.ok) {
      return err(await this.parseErrorResponse(response));
    }

    // Handle 204 No Content
    if (response.status === 204) {
      return ok(undefined as T);
    }

    // Parse JSON response
    try {
      const data = await response.json();
      return ok(data as T);
    } catch {
      return err(
        createError(
          PiholeErrorCode.ParseError,
          "Failed to parse response",
          response.status,
        ),
      );
    }
  }

  /**
   * Parse error response from Pi-hole API.
   */
  private async parseErrorResponse(response: Response): Promise<PiholeError> {
    let errorData: {
      error?: { key?: string; message?: string; hint?: string };
    } = {};

    try {
      const json = await response.json();
      if (typeof json === "object" && json !== null) {
        errorData = json as typeof errorData;
      }
    } catch {
      // Response may not be JSON
    }

    const apiKey = errorData.error?.key;
    const code = apiKey
      ? apiKeyToErrorCode(apiKey)
      : statusToErrorCode(response.status);

    return createError(
      code,
      errorData.error?.message ?? `HTTP ${response.status}`,
      response.status,
      {
        hint: errorData.error?.hint,
        apiKey,
      },
    );
  }

  /**
   * Handle fetch errors (network, timeout, etc).
   */
  private handleFetchError(error: unknown): PiholeError {
    if (error instanceof Error) {
      // Timeout
      if (error.name === "AbortError") {
        return createError(PiholeErrorCode.Timeout, "Request timed out", 0);
      }

      // SSL/Certificate errors
      const msg = error.message.toLowerCase();
      if (
        msg.includes("ssl") ||
        msg.includes("certificate") ||
        msg.includes("cert_") ||
        msg.includes("sec_error")
      ) {
        return createError(
          PiholeErrorCode.CertificateError,
          "SSL certificate error",
          0,
          { hint: "Accept the certificate in your browser first" },
        );
      }

      // Connection refused
      if (msg.includes("econnrefused") || msg.includes("connection refused")) {
        return createError(
          PiholeErrorCode.ConnectionRefused,
          "Connection refused",
          0,
        );
      }

      // Generic network error
      return createError(PiholeErrorCode.NetworkError, error.message, 0);
    }

    return createError(PiholeErrorCode.Unknown, "Unknown error occurred", 0);
  }

  /**
   * Calculate retry delay with exponential backoff.
   */
  private calculateDelay(attempt: number): number {
    const delay =
      this.config.retryDelayBase *
      Math.pow(this.config.backoffMultiplier, attempt);
    return Math.min(delay, this.config.retryDelayMax);
  }

  /**
   * Sleep for specified milliseconds.
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
