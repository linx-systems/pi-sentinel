/**
 * Client Adapter for pihole-api-client library.
 *
 * This adapter wraps the library's PiholeClient to provide:
 * 1. Compatibility with extension's existing IPiholeClient interface
 * 2. Session persistence hooks for browser.storage integration
 * 3. Multi-instance management via LibraryClientManager
 */

import {
  PiholeClient,
  type PiholeClientConfig,
  type PiholeError,
  type Result,
  isOk,
  type DomainType,
  type DomainKind,
} from "@linx-systems/pihole-api-client";
import type {
  ApiResult,
  AuthResponse,
  BlockingStatus,
  DomainEntry,
  DomainListType,
  DomainMatchType,
  IPiholeClient,
  IClientManager,
  QueryEntry,
  QueryParams,
  SearchResult,
  StatsSummary,
} from "./types";
import { toApiResult } from "./type-compat";

/**
 * Configuration for the adapter.
 */
export interface AdapterConfig {
  baseUrl: string;
  password?: string;
  timeout?: number;
  /** Pre-existing session ID for session restoration */
  sid?: string;
  /** Pre-existing CSRF token for session restoration */
  csrf?: string;
  /** Callback when session credentials change (for external storage) */
  onSessionChanged?: (sid: string, csrf: string, validity: number) => void;
  /** Callback when authentication is required (for UI-driven reauth) */
  onAuthRequired?: () => Promise<{ password: string; totp?: string } | null>;
}

/**
 * Adapter that wraps PiholeClient for extension compatibility.
 *
 * Implements IPiholeClient interface to be interchangeable with PiholeApiClient.
 */
export class PiholeClientAdapter implements IPiholeClient {
  private client: PiholeClient;
  private config: AdapterConfig;
  private authHandler: (() => Promise<boolean>) | null = null;
  private currentPassword: string | null = null;

  constructor(config: AdapterConfig) {
    this.config = config;
    this.currentPassword = config.password ?? null;
    this.client = this.createClient(config);
  }

  /**
   * Create a new PiholeClient with the given configuration.
   */
  private createClient(config: AdapterConfig): PiholeClient {
    const sessionConfig: Partial<SessionConfig> = {
      password: config.password,
      sid: config.sid,
      csrf: config.csrf,
      autoRefresh: true,
      refreshThreshold: 60,
    };

    // Wire up session change hook if provided
    if (config.onSessionChanged) {
      sessionConfig.onSessionChanged = config.onSessionChanged;
    }

    // Wire up auth required hook
    if (config.onAuthRequired) {
      sessionConfig.onAuthRequired = config.onAuthRequired;
    }

    const clientConfig: PiholeClientConfig = {
      baseUrl: config.baseUrl.replace(/\/+$/, ""),
      password: config.password,
      sid: config.sid,
      csrf: config.csrf,
      timeout: config.timeout ?? 10000,
      autoRefresh: true,
      refreshThreshold: 60,
    };

    return new PiholeClient(clientConfig);
  }

  /**
   * Set the Pi-hole server URL.
   */
  setBaseUrl(url: string): void {
    const normalizedUrl = url.replace(/\/+$/, "");
    this.config.baseUrl = normalizedUrl;

    // Recreate client with new URL
    this.client = this.createClient({
      ...this.config,
      baseUrl: normalizedUrl,
      password: this.currentPassword ?? undefined,
    });
  }

  /**
   * Set session credentials (for restoring from storage).
   */
  setSession(sid: string, csrf: string): void {
    // Recreate client with pre-existing session
    this.client = this.createClient({
      ...this.config,
      sid,
      csrf,
      password: this.currentPassword ?? undefined,
    });
  }

  /**
   * Clear session credentials.
   */
  clearSession(): void {
    // Recreate client without session
    this.client = this.createClient({
      ...this.config,
      sid: undefined,
      csrf: undefined,
      password: this.currentPassword ?? undefined,
    });
  }

  /**
   * Check if we have a session.
   */
  hasSession(): boolean {
    return this.client.isConnected();
  }

  /**
   * Set callback for handling auth required (401) responses.
   * This wraps the callback to match the library's expected signature.
   */
  setAuthRequiredHandler(handler: () => Promise<boolean>): void {
    this.authHandler = handler;

    // Recreate client with the auth handler
    // The library's onAuthRequired returns credentials, but the extension's
    // handler returns a boolean (success/failure after handling internally)
    this.config.onAuthRequired = async () => {
      const success = await handler();
      if (success && this.currentPassword) {
        return { password: this.currentPassword };
      }
      return null;
    };

    this.client = this.createClient({
      ...this.config,
      password: this.currentPassword ?? undefined,
    });
  }

  /**
   * Authenticate with Pi-hole.
   */
  async authenticate(
    password: string,
    totp?: string,
  ): Promise<ApiResult<AuthResponse>> {
    // Store password for re-auth
    this.currentPassword = password;
    this.client.setPassword(password);

    const result = await this.client.connect(totp);

    if (isOk(result)) {
      // Construct a compatible response
      // Note: The library manages session internally
      return {
        success: true,
        data: {
          session: {
            valid: true,
            sid: "", // Library manages this internally
            csrf: "", // Library manages this internally
            validity: 1800,
            totp: false,
          },
        },
      };
    }

    // Handle TOTP requirement
    if (this.client.isTotpRequired()) {
      return {
        success: false,
        error: {
          key: "totp_required",
          message: "Two-factor authentication code required",
          status: 401,
        },
      };
    }

    return toApiResult(result as Result<AuthResponse, PiholeError>);
  }

  /**
   * Logout and invalidate session.
   */
  async logout(): Promise<ApiResult<void>> {
    const result = await this.client.disconnect();
    // Always clear local state regardless of server response
    this.clearSession();
    return toApiResult(result);
  }

  /**
   * Get summary statistics.
   */
  async getStats(): Promise<ApiResult<StatsSummary>> {
    const result = await this.client.stats.getSummary();
    return toApiResult(result as Result<StatsSummary, PiholeError>);
  }

  /**
   * Get current blocking status.
   */
  async getBlockingStatus(): Promise<ApiResult<BlockingStatus>> {
    const result = await this.client.dns.getStatus();
    return toApiResult(result as Result<BlockingStatus, PiholeError>);
  }

  /**
   * Enable or disable blocking.
   */
  async setBlocking(
    enabled: boolean,
    timer?: number,
  ): Promise<ApiResult<BlockingStatus>> {
    const result = await this.client.dns.setBlocking(enabled, { timer });
    return toApiResult(result as Result<BlockingStatus, PiholeError>);
  }

  /**
   * Get recent queries.
   */
  async getQueries(params?: QueryParams): Promise<ApiResult<QueryEntry[]>> {
    const result = await this.client.queries.list({
      length: params?.length,
      from: params?.from,
      until: params?.until,
      client: params?.client,
      domain: params?.domain,
      type: params?.type,
      status: params?.status,
    });

    if (isOk(result)) {
      // Map library QueryEntry to extension QueryEntry
      const queries = result.data.map((q) => ({
        id: q.id,
        timestamp: q.timestamp,
        type: q.type,
        domain: q.domain,
        client: q.client,
        status: q.status,
        reply_type: q.reply_type,
        reply_time: q.reply_time,
      }));
      return { success: true, data: queries };
    }

    return toApiResult(result as Result<QueryEntry[], PiholeError>);
  }

  /**
   * Get domains from a list.
   */
  async getDomains(
    listType: DomainListType,
    matchType: DomainMatchType = "exact",
  ): Promise<ApiResult<DomainEntry[]>> {
    const domainType: DomainType = listType;
    const domainKind: DomainKind = matchType;

    const result = await this.client.domains.list(domainType, domainKind);

    if (isOk(result)) {
      // Map library DomainEntry to extension DomainEntry
      const domains = result.data.map((d) => ({
        id: d.id,
        domain: d.domain,
        type: d.type,
        enabled: d.enabled,
        comment: d.comment ?? null,
        date_added: d.date_added,
        date_modified: d.date_modified,
      }));
      return { success: true, data: domains };
    }

    return toApiResult(result as Result<DomainEntry[], PiholeError>);
  }

  /**
   * Add a domain to a list.
   */
  async addDomain(
    domain: string,
    listType: DomainListType,
    matchType: DomainMatchType = "exact",
    comment?: string,
  ): Promise<ApiResult<DomainEntry>> {
    const domainType: DomainType = listType;
    const domainKind: DomainKind = matchType;

    const result = await this.client.domains.add(
      domainType,
      domainKind,
      domain,
      {
        comment,
      },
    );

    if (isOk(result)) {
      const d = result.data;
      return {
        success: true,
        data: {
          id: d.id,
          domain: d.domain,
          type: d.type,
          enabled: d.enabled,
          comment: d.comment ?? null,
          date_added: d.date_added,
          date_modified: d.date_modified,
        },
      };
    }

    return toApiResult(result as Result<DomainEntry, PiholeError>);
  }

  /**
   * Remove a domain from a list.
   */
  async removeDomain(
    domain: string,
    listType: DomainListType,
    matchType: DomainMatchType = "exact",
  ): Promise<ApiResult<void>> {
    const domainType: DomainType = listType;
    const domainKind: DomainKind = matchType;

    const result = await this.client.domains.remove(
      domainType,
      domainKind,
      domain,
    );
    return toApiResult(result);
  }

  /**
   * Search for a domain in gravity and lists.
   */
  async searchDomain(domain: string): Promise<ApiResult<SearchResult>> {
    const result = await this.client.domains.search(domain);
    return toApiResult(result as Result<SearchResult, PiholeError>);
  }

  /**
   * Test connection to Pi-hole (unauthenticated).
   */
  async testConnection(url?: string): Promise<ApiResult<void>> {
    const testUrl = url || this.config.baseUrl;
    if (!testUrl) {
      return {
        success: false,
        error: { key: "not_configured", message: "No URL provided", status: 0 },
      };
    }

    // Create a temporary client for testing
    const testClient = new PiholeClient({
      baseUrl: testUrl.replace(/\/+$/, ""),
      timeout: this.config.timeout ?? 10000,
    });

    const result = await testClient.testConnection();
    return toApiResult(result);
  }

  /**
   * Get the underlying PiholeClient for advanced operations.
   * Use this to access features not exposed by the IPiholeClient interface.
   */
  getClient(): PiholeClient {
    return this.client;
  }
}

/**
 * Manager for multiple PiholeClientAdapter instances.
 * Implements IClientManager interface to be interchangeable with ApiClientManager.
 */
export class LibraryClientManager implements IClientManager {
  private clients: Map<string, PiholeClientAdapter> = new Map();
  private configs: Map<string, AdapterConfig> = new Map();
  private authHandlers: Map<string, () => Promise<boolean>> = new Map();

  /**
   * Get an existing adapter for an instance.
   */
  getClient(instanceId: string): PiholeClientAdapter | undefined {
    return this.clients.get(instanceId);
  }

  /**
   * Check if a client exists for an instance.
   */
  hasClient(instanceId: string): boolean {
    return this.clients.has(instanceId);
  }

  /**
   * Configure and create a client for an instance.
   */
  configureClient(
    instanceId: string,
    config: AdapterConfig,
  ): PiholeClientAdapter {
    // Apply any registered auth handler
    const authHandler = this.authHandlers.get(instanceId);
    if (authHandler) {
      config.onAuthRequired = async () => {
        const success = await authHandler();
        // Note: The handler updates password internally, so we return null
        // and rely on the adapter's stored password
        return null;
      };
    }

    const adapter = new PiholeClientAdapter(config);

    // Set auth handler on the adapter if registered
    if (authHandler) {
      adapter.setAuthRequiredHandler(authHandler);
    }

    this.clients.set(instanceId, adapter);
    this.configs.set(instanceId, config);
    return adapter;
  }

  /**
   * Remove a client for an instance.
   */
  removeClient(instanceId: string): void {
    const client = this.clients.get(instanceId);
    if (client) {
      client.clearSession();
      this.clients.delete(instanceId);
    }
    this.configs.delete(instanceId);
    this.authHandlers.delete(instanceId);
  }

  /**
   * Update base URL for a client.
   */
  setBaseUrl(instanceId: string, url: string): void {
    const client = this.clients.get(instanceId);
    if (client) {
      client.setBaseUrl(url);
      const config = this.configs.get(instanceId);
      if (config) {
        config.baseUrl = url;
      }
    }
  }

  /**
   * Set auth required handler for an instance.
   */
  setAuthHandler(instanceId: string, handler: () => Promise<boolean>): void {
    this.authHandlers.set(instanceId, handler);
    const client = this.clients.get(instanceId);
    if (client) {
      client.setAuthRequiredHandler(handler);
    }
  }

  /**
   * Get all instance IDs with active clients.
   */
  getActiveInstanceIds(): string[] {
    return Array.from(this.clients.keys());
  }

  /**
   * Clear all clients.
   */
  clear(): void {
    for (const client of this.clients.values()) {
      client.clearSession();
    }
    this.clients.clear();
    this.configs.clear();
    this.authHandlers.clear();
  }
}

// Singleton manager instance
export const libraryClientManager = new LibraryClientManager();
