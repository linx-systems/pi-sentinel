import browser from "webextension-polyfill";
import { defineBackground } from "#imports";
import { apiClient, apiClientManager } from "~/background/api/client";
import { authManager } from "~/background/api/auth";
import { instanceManager } from "~/background/api/instance-manager";
import { encryption } from "~/background/crypto/encryption";
import { store } from "~/background/state/store";
import { badgeService } from "~/background/services/badge";
import { notificationService } from "~/background/services/notifications";
import { domainTracker } from "~/background/services/domain-tracker";
import {
  ALARMS,
  DEFAULTS,
  ERROR_MESSAGES,
  STORAGE_KEYS,
} from "~/utils/constants";
import { logger } from "~/utils/logger";
import { ErrorHandler, ErrorType } from "~/utils/error-handler";
import type { Message, MessageResponse } from "~/utils/messaging";
import type {
  EncryptedSessionData,
  ExtensionState,
  QueryEntry,
  SessionData,
} from "~/utils/types";

export default defineBackground(() => {
  /**
   * PiSentinel Background Script
   *
   * This is the main entry point for the extension's background logic.
   * It runs as a Firefox event page and handles:
   * - Message routing from popup/sidebar/options
   * - Session management and keepalive
   * - Stats polling
   * - Domain tracking coordination
   */

  // ===== Global Error Handlers =====
  // Prevent silent crashes that cause "background script not reachable" errors

  self.addEventListener("unhandledrejection", (event) => {
    logger.error(
      "[PiSentinel] Unhandled promise rejection:",
      event.reason instanceof Error
        ? { message: event.reason.message, stack: event.reason.stack }
        : event.reason,
    );
  });

  self.addEventListener("error", (event) => {
    logger.error("[PiSentinel] Uncaught error:", {
      message: event.message,
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno,
      error: event.error,
    });
  });

  /**
   * Ephemeral key for encrypting instance session tokens.
   * Generated on initialization, stored only in memory.
   */
  let instanceSessionEncryptionKey: string | null = null;

  /**
   * Flag to prevent duplicate initialization.
   * On extension reload, both onInstalled and immediate init can fire.
   */
  let initializationPromise: Promise<void> | null = null;

  /**
   * Flag to prevent stats refresh during instance switch.
   * Set of instance IDs currently being transitioned.
   */
  const instancesInTransition: Set<string> = new Set();

  // ===== Circuit Breaker for Auth Retries =====
  // Prevents infinite retry loops when Pi-hole sessions are externally invalidated

  /**
   * Consecutive auth failure counter for legacy single-instance mode.
   * Circuit breaker opens when this reaches MAX_CONSECUTIVE_AUTH_FAILURES.
   */
  let consecutiveAuthFailures = 0;

  /**
   * Per-instance auth failure counters for multi-instance mode.
   * Maps instance ID to failure count.
   */
  const instanceAuthFailures = new Map<string, number>();

  /**
   * Get consecutive auth failures for an instance.
   */
  function getInstanceAuthFailures(instanceId: string): number {
    return instanceAuthFailures.get(instanceId) ?? 0;
  }

  /**
   * Increment auth failures for an instance.
   */
  function incrementInstanceAuthFailures(instanceId: string): void {
    const current = getInstanceAuthFailures(instanceId);
    instanceAuthFailures.set(instanceId, current + 1);
    logger.warn(
      `[PiSentinel] Auth failed for instance ${instanceId} (${current + 1}/${DEFAULTS.MAX_CONSECUTIVE_AUTH_FAILURES})`,
    );
  }

  /**
   * Reset auth failures for an instance (on successful auth or manual connect).
   */
  function resetInstanceAuthFailures(instanceId: string): void {
    if (instanceAuthFailures.has(instanceId)) {
      instanceAuthFailures.delete(instanceId);
      logger.debug(
        `[PiSentinel] Auth failure counter reset for instance ${instanceId}`,
      );
    }
  }

  /**
   * Check if circuit breaker is open for an instance.
   */
  function isInstanceCircuitBreakerOpen(instanceId: string): boolean {
    return (
      getInstanceAuthFailures(instanceId) >=
      DEFAULTS.MAX_CONSECUTIVE_AUTH_FAILURES
    );
  }

  /**
   * Reset legacy auth failure counter.
   */
  function resetLegacyAuthFailures(): void {
    if (consecutiveAuthFailures > 0) {
      consecutiveAuthFailures = 0;
      logger.debug("[PiSentinel] Legacy auth failure counter reset");
    }
  }

  /**
   * Check if legacy circuit breaker is open.
   */
  function isLegacyCircuitBreakerOpen(): boolean {
    return consecutiveAuthFailures >= DEFAULTS.MAX_CONSECUTIVE_AUTH_FAILURES;
  }

  type ConnectionErrorInfo = {
    key?: string;
    message?: string;
    status?: number;
    hint?: string;
  };

  const formatConnectionError = (
    error?: ConnectionErrorInfo,
    fallback = "Couldn't connect. Try again?",
  ): string => {
    if (!error) return fallback;

    const message = error.message || "";
    const lower = message.toLowerCase();

    if (
      error.key === "auth_failed" ||
      error.status === 401 ||
      error.status === 403 ||
      lower.includes("authentication") ||
      lower.includes("password")
    ) {
      return "Login failed — check the password (or leave it blank if this Pi-hole has no password).";
    }

    if (error.key === "totp_required") {
      return "This one needs a 2FA code.";
    }

    if (error.key === "timeout" || lower.includes("timed out")) {
      return "Timed out talking to the host. Is it online?";
    }

    if (
      error.key === "cert_error" ||
      lower.includes("certificate") ||
      lower.includes("ssl")
    ) {
      return "SSL cert issue. Open the Pi-hole URL in your browser, accept the cert, then try again.";
    }

    if (
      error.key === "network_error" ||
      lower.includes("failed to fetch") ||
      lower.includes("network")
    ) {
      return "Can't reach the host. Check the URL and that the Pi-hole is online.";
    }

    if (error.key === "not_configured") {
      return "Missing host URL. Add it and try again.";
    }

    if (error.key === "connection_failed") {
      return "The host answered, but the connection didn't work. Check the URL and try again.";
    }

    if (error.status && error.status >= 500) {
      return "The Pi-hole is responding, but it looks unhappy (server error). Try again in a bit.";
    }

    if (error.status && error.status >= 400) {
      return "The host rejected the request. Double-check the URL and settings.";
    }

    if (message) {
      return `Something else went wrong: ${message}`;
    }

    return fallback;
  };

  const formatAuthError = (message?: string | null): string => {
    if (!message) {
      return "Login failed. Try again?";
    }
    const lower = message.toLowerCase();

    if (
      lower.includes("authentication") ||
      lower.includes("password") ||
      lower.includes("unauthorized") ||
      lower.includes("401") ||
      lower.includes("403")
    ) {
      return "Login failed — check the password (or leave it blank if this Pi-hole has no password).";
    }

    if (lower.includes("certificate") || lower.includes("ssl")) {
      return "SSL cert issue. Open the Pi-hole URL in your browser, accept the cert, then try again.";
    }

    if (
      lower.includes("timed out") ||
      lower.includes("timeout") ||
      lower.includes("failed to fetch") ||
      lower.includes("network")
    ) {
      return "Can't reach the host. Check the URL and that the Pi-hole is online.";
    }

    return `Something else went wrong: ${message}`;
  };

  // ===== Initialization =====

  async function initialize(): Promise<void> {
    // Prevent duplicate initialization (e.g., onInstalled + immediate init on reload)
    if (initializationPromise) {
      logger.debug(
        "[PiSentinel] Initialization already in progress, waiting...",
      );
      return initializationPromise;
    }

    initializationPromise = doInitialize();
    return initializationPromise;
  }

  async function doInitialize(): Promise<void> {
    try {
      logger.info("[PiSentinel] Starting background script initialization");

      // Generate ephemeral session encryption key (memory-only)
      instanceSessionEncryptionKey = encryption.generateMasterPassword();
      logger.debug("[PiSentinel] Instance session encryption key generated");

      // Initialize services
      logger.info("[PiSentinel] Initializing notification service");
      await notificationService.initialize();

      logger.info("[PiSentinel] Initializing domain tracker");
      domainTracker.initialize();

      // Initialize instance manager (handles migration from single-instance)
      logger.info("[PiSentinel] Initializing instance manager");
      await instanceManager.initialize();

      // Set up auth re-authentication handler for legacy API client
      logger.info("[PiSentinel] Setting up auth handler");
      apiClient.setAuthRequiredHandler(async () => {
        // Circuit breaker: stop auto-retry if too many consecutive failures
        if (isLegacyCircuitBreakerOpen()) {
          logger.warn(
            `[PiSentinel] Legacy auth circuit breaker open (${consecutiveAuthFailures} failures) - skipping auto-retry`,
          );
          return false;
        }

        const password = await authManager.getDecryptedPassword();
        if (password !== null) {
          // authManager.authenticate already handles logout-before-auth
          const result = await authManager.authenticate(password);
          if (result.success) {
            resetLegacyAuthFailures();
            return true;
          }
          consecutiveAuthFailures++;
          logger.warn(
            `[PiSentinel] Legacy auth failed (${consecutiveAuthFailures}/${DEFAULTS.MAX_CONSECUTIVE_AUTH_FAILURES})`,
          );
        }
        return false;
      });

      // Try to restore sessions for all instances
      logger.info("[PiSentinel] Attempting to restore sessions");
      await initializeInstances();

      // Subscribe to state changes for badge updates
      // This subscription is intentionally long-lived (extension lifetime)
      logger.info("[PiSentinel] Setting up state subscription");
      store.subscribe((state) => {
        badgeService.update(state);
      });

      // Initial badge update
      await badgeService.update(store.getState());

      logger.info("[PiSentinel] Background script initialized successfully");
    } catch (error) {
      logger.error(
        "[PiSentinel] Initialization error (message listener will still work):",
        error,
      );
      // Don't re-throw - allow message listener to still function
    }
  }

  /**
   * Initialize all configured instances.
   * Restores sessions and sets up API clients.
   */
  async function initializeInstances(): Promise<void> {
    const config = await instanceManager.getInstances();

    if (config.instances.length === 0) {
      // No instances configured - try legacy single-instance auth
      const hasSession = await authManager.initialize();
      if (hasSession) {
        logger.info("[PiSentinel] Legacy session restored successfully");
        store.setState({ isConnected: true });
        await refreshStats();
      }
      return;
    }

    // Set active instance in store
    store.setActiveInstanceId(config.activeInstanceId);

    // Initialize each instance
    for (const instance of config.instances) {
      try {
        // Configure API client for this instance
        const client = apiClientManager.configureClient(
          instance.id,
          instance.piholeUrl,
        );

        // Set up re-auth handler for this instance
        apiClientManager.setAuthHandler(instance.id, async () => {
          // Circuit breaker: stop auto-retry if too many consecutive failures
          if (isInstanceCircuitBreakerOpen(instance.id)) {
            logger.warn(
              `[PiSentinel] Auth circuit breaker open for instance ${instance.id} - skipping auto-retry`,
            );
            return false;
          }

          const password = await instanceManager.getDecryptedPassword(
            instance.id,
          );
          if (password !== null) {
            // Logout first to prevent ghost sessions
            if (client.hasSession()) {
              try {
                await client.logout();
              } catch {
                // Continue with re-auth
              }
            }
            const result = await client.authenticate(password);
            if (result.success) {
              resetInstanceAuthFailures(instance.id);
              return true;
            }
            incrementInstanceAuthFailures(instance.id);
          }
          return false;
        });

        // Try to restore session from encrypted storage
        const session = await getInstanceSession(instance.id);

        if (session && session.expiresAt > Date.now()) {
          client.setSession(session.sid, session.csrf);
          store.updateInstanceState(instance.id, { isConnected: true });

          // Fetch initial stats
          await refreshInstanceStats(instance.id);
        } else if (instance.rememberPassword && instance.encryptedMasterKey) {
          // Try auto-reauthentication
          const password = await instanceManager.getDecryptedPassword(
            instance.id,
          );
          if (password !== null) {
            // Note: client.hasSession() is false here (fresh start), but Pi-hole
            // might have old sessions from previous browser sessions that we can't
            // invalidate since we don't have the session ID. Those will expire naturally.
            const result = await client.authenticate(password);
            if (result.success && result.data?.session) {
              // Store session
              await storeInstanceSession(
                instance.id,
                result.data.session.sid,
                result.data.session.csrf,
                result.data.session.validity,
              );
              store.updateInstanceState(instance.id, { isConnected: true });
              await refreshInstanceStats(instance.id);
            }
          }
        }
      } catch (error) {
        logger.error(
          `[PiSentinel] Failed to initialize instance ${instance.id}:`,
          error,
        );
        store.updateInstanceState(instance.id, {
          isConnected: false,
          connectionError: "Initialization failed",
        });
      }
    }

    // Start keepalive alarm
    await browser.alarms.create(ALARMS.SESSION_KEEPALIVE, {
      periodInMinutes: DEFAULTS.SESSION_KEEPALIVE_INTERVAL,
    });

    // Start stats refresh alarm
    await browser.alarms.create(ALARMS.STATS_REFRESH, {
      periodInMinutes: config.globalSettings.refreshInterval / 60,
    });
  }

  /**
   * Store session for a specific instance.
   * Session tokens are encrypted with an ephemeral key.
   */
  async function storeInstanceSession(
    instanceId: string,
    sid: string,
    csrf: string,
    validity: number,
  ): Promise<void> {
    const expiresAt = Date.now() + validity * 1000;
    const session: SessionData = { sid, csrf, expiresAt };
    const sessionKey = `${STORAGE_KEYS.INSTANCE_SESSION_PREFIX}${instanceId}`;

    // Encrypt session tokens before storing
    if (instanceSessionEncryptionKey) {
      try {
        const encryptedSession = await encryption.encrypt(
          JSON.stringify(session),
          instanceSessionEncryptionKey,
        );
        const storedData: EncryptedSessionData = {
          encrypted: encryptedSession,
          expiresAt, // Store expiry in clear for quick validity checks
        };
        await browser.storage.session.set({ [sessionKey]: storedData });
        return;
      } catch (error) {
        logger.warn(
          "[PiSentinel] Failed to encrypt instance session, storing unencrypted:",
          error,
        );
      }
    }

    // Fallback to unencrypted (should not happen in normal operation)
    await browser.storage.session.set({ [sessionKey]: session });
  }

  /**
   * Get session for a specific instance.
   * Decrypts session tokens if they were stored encrypted.
   */
  async function getInstanceSession(
    instanceId: string,
  ): Promise<SessionData | null> {
    const sessionKey = `${STORAGE_KEYS.INSTANCE_SESSION_PREFIX}${instanceId}`;
    const result = await browser.storage.session.get(sessionKey);
    const storedData = result[sessionKey];

    if (!storedData) {
      return null;
    }

    // Check if data is encrypted (has 'encrypted' field)
    if (
      instanceSessionEncryptionKey &&
      storedData.encrypted &&
      storedData.expiresAt
    ) {
      try {
        // Quick expiry check before decryption
        if (storedData.expiresAt < Date.now()) {
          return null;
        }

        const decrypted = await encryption.decrypt(
          storedData.encrypted,
          instanceSessionEncryptionKey,
        );
        return JSON.parse(decrypted) as SessionData;
      } catch (error) {
        // Decryption failed - session key may have changed (browser restart)
        logger.debug("[PiSentinel] Failed to decrypt instance session:", error);
        return null;
      }
    }

    // Legacy unencrypted format (for backward compatibility during transition)
    if (storedData.sid && storedData.csrf && storedData.expiresAt) {
      return storedData as SessionData;
    }

    return null;
  }

  /**
   * Refresh stats for a specific instance.
   */
  async function refreshInstanceStats(instanceId: string): Promise<void> {
    const client = apiClientManager.getClient(instanceId);

    const statsResult = await client.getStats();
    if (statsResult.success && statsResult.data) {
      store.updateInstanceState(instanceId, {
        stats: statsResult.data,
        statsLastUpdated: Date.now(),
      });
    }

    const blockingResult = await client.getBlockingStatus();
    if (blockingResult.success && blockingResult.data) {
      store.updateInstanceState(instanceId, {
        blockingEnabled: blockingResult.data.blocking === "enabled",
        blockingTimer: blockingResult.data.timer,
      });
    }
  }

  // ===== Message Handling =====

  // Message handler type definition
  type MessageHandler<T = any> = (
    payload?: any,
    sender?: browser.Runtime.MessageSender,
  ) => Promise<MessageResponse<T>> | MessageResponse<T>;

  // Message handler map for cleaner routing
  const messageHandlers: Record<string, MessageHandler> = {
    AUTHENTICATE: (payload) => handleAuthenticate(payload),
    LOGOUT: () => handleLogout(),
    GET_STATE: () => ({ success: true, data: store.getState() }),
    GET_STATS: () => handleGetStats(),
    GET_BLOCKING_STATUS: () => handleGetBlockingStatus(),
    SET_BLOCKING: (payload) => handleSetBlocking(payload),
    GET_TAB_DOMAINS: (payload) => handleGetTabDomains(payload.tabId),
    ADD_TO_ALLOWLIST: (payload) =>
      handleAddDomain(payload.domain, "allow", payload.comment),
    ADD_TO_DENYLIST: (payload) =>
      handleAddDomain(payload.domain, "deny", payload.comment),
    REMOVE_FROM_ALLOWLIST: (payload) =>
      handleRemoveDomain(payload.domain, "allow"),
    REMOVE_FROM_DENYLIST: (payload) =>
      handleRemoveDomain(payload.domain, "deny"),
    SEARCH_DOMAIN: (payload) => handleSearchDomain(payload.domain),
    GET_QUERIES: (payload) => handleGetQueries(payload),
    SAVE_CONFIG: (payload) => handleSaveConfig(payload),
    TEST_CONNECTION: (payload) => handleTestConnection(payload.url),
    HEALTH_CHECK: () => ({
      success: true,
      data: {
        ready: true,
        timestamp: Date.now(),
        version: "0.0.1",
      },
    }),
    INSTANCES_UPDATED: () => ({ success: true }),
    // Multi-instance handlers
    GET_INSTANCES: () => handleGetInstances(),
    ADD_INSTANCE: (payload) => handleAddInstance(payload),
    UPDATE_INSTANCE: (payload) => handleUpdateInstance(payload),
    DELETE_INSTANCE: (payload) => handleDeleteInstance(payload.instanceId),
    SET_ACTIVE_INSTANCE: (payload) =>
      handleSetActiveInstance(payload.instanceId),
    CONNECT_INSTANCE: (payload) => handleConnectInstance(payload),
    DISCONNECT_INSTANCE: (payload) =>
      handleDisconnectInstance(payload.instanceId),
    GET_INSTANCE_STATE: (payload) => handleGetInstanceState(payload.instanceId),
    GET_AGGREGATED_STATE: () => handleGetAggregatedState(),
    CHECK_PASSWORD_AVAILABLE: (payload) =>
      handleCheckPasswordAvailable(payload),
  };

  async function handleMessage(
    message: Message,
    sender: browser.Runtime.MessageSender,
  ): Promise<MessageResponse<unknown>> {
    // Validate message origin to prevent spoofed messages from other extensions
    if (sender.id !== browser.runtime.id) {
      logger.warn(
        "[Background] Rejected message from unauthorized sender:",
        sender.id,
      );
      return { success: false, error: "Unauthorized" };
    }

    logger.debug("[Background] handleMessage called with type:", message.type);

    const handler = messageHandlers[message.type];
    if (!handler) {
      logger.error("[Background] Unknown message type:", message.type);
      return { success: false, error: ERROR_MESSAGES.UNKNOWN_ERROR };
    }

    try {
      // Type assertion: handlers are responsible for payload type safety
      const result = await handler((message as any).payload, sender);
      logger.info(
        "[Background] handleMessage completed for type:",
        message.type,
      );
      return result;
    } catch (error) {
      const appError = ErrorHandler.handle(
        error,
        `Message handler: ${message.type}`,
        ErrorType.INTERNAL,
      );
      logger.error("[Background] Message handler error:", error);
      return { success: false, error: appError.message };
    }
  }

  // ===== Message Handlers =====

  async function handleAuthenticate(payload: {
    password: string;
    totp?: string;
  }): Promise<MessageResponse<{ totpRequired?: boolean }>> {
    // Reset circuit breaker on manual connect attempt - user is explicitly trying
    resetLegacyAuthFailures();

    const result = await authManager.authenticate(
      payload.password,
      payload.totp,
    );

    if (result.success) {
      store.setState({
        isConnected: true,
        connectionError: null,
        totpRequired: false,
      });
      await refreshStats();
      await startStatsPolling();
      return { success: true };
    }

    if (result.totpRequired) {
      store.setState({ totpRequired: true });
      return {
        success: false,
        data: { totpRequired: true },
        error: "TOTP required",
      };
    }

    store.setState({
      isConnected: false,
      connectionError: formatAuthError(result.error),
    });
    return { success: false, error: formatAuthError(result.error) };
  }

  async function handleLogout(): Promise<MessageResponse<void>> {
    await authManager.logout();
    await stopStatsPolling();
    store.reset();
    await badgeService.clear();

    // Clean up storage-based communication artifacts (best effort)
    try {
      await browser.storage.local.remove([
        "authResponse",
        "configResponse",
        "logoutResponse",
        "testConnectionResponse",
        "addInstanceResponse",
        "updateInstanceResponse",
        "pendingAuth",
        "pendingConfig",
        "pendingLogout",
        "pendingTestConnection",
        "pendingAddInstance",
        "pendingUpdateInstance",
      ]);
    } catch (error) {
      logger.warn("[PiSentinel] Failed to clean up storage artifacts:", error);
      // Continue with logout - cleanup failure is non-critical
    }

    return { success: true };
  }

  /**
   * Get the API client for the active instance, or fall back to legacy client.
   */
  function getActiveClient() {
    const activeId = store.getActiveInstanceId();
    return activeId ? apiClientManager.getClient(activeId) : apiClient;
  }

  async function handleGetStats(): Promise<
    MessageResponse<ExtensionState["stats"]>
  > {
    const client = getActiveClient();
    const result = await client.getStats();
    if (result.success && result.data) {
      store.setState({
        stats: result.data,
        statsLastUpdated: Date.now(),
      });
      return { success: true, data: result.data };
    }
    return { success: false, error: result.error?.message };
  }

  async function handleGetBlockingStatus(): Promise<
    MessageResponse<{ blocking: boolean; timer: number | null }>
  > {
    const client = getActiveClient();
    const result = await client.getBlockingStatus();
    if (result.success && result.data) {
      const enabled = result.data.blocking === "enabled";
      store.setState({
        blockingEnabled: enabled,
        blockingTimer: result.data.timer,
      });
      return {
        success: true,
        data: { blocking: enabled, timer: result.data.timer },
      };
    }
    return { success: false, error: result.error?.message };
  }

  async function handleSetBlocking(payload: {
    enabled: boolean;
    timer?: number;
  }): Promise<MessageResponse<{ blocking: boolean; timer: number | null }>> {
    const client = getActiveClient();
    const result = await client.setBlocking(payload.enabled, payload.timer);

    if (result.success && result.data) {
      const enabled = result.data.blocking === "enabled";
      store.setState({
        blockingEnabled: enabled,
        blockingTimer: result.data.timer,
      });

      // Show notification
      if (enabled) {
        await notificationService.showBlockingEnabled();
      } else {
        await notificationService.showBlockingDisabled(payload.timer);
      }

      return {
        success: true,
        data: { blocking: enabled, timer: result.data.timer },
      };
    }

    return { success: false, error: result.error?.message };
  }

  function handleGetTabDomains(
    tabId: number,
  ): MessageResponse<ReturnType<typeof store.getSerializableTabDomains>> {
    const data = store.getSerializableTabDomains(tabId);
    return { success: true, data };
  }

  async function handleAddDomain(
    domain: string,
    listType: "allow" | "deny",
    comment?: string,
  ): Promise<MessageResponse<void>> {
    const client = getActiveClient();
    const result = await client.addDomain(domain, listType, "exact", comment);

    if (result.success) {
      await notificationService.showDomainAdded(domain, listType);
      return { success: true };
    }

    return { success: false, error: result.error?.message };
  }

  async function handleRemoveDomain(
    domain: string,
    listType: "allow" | "deny",
  ): Promise<MessageResponse<void>> {
    const client = getActiveClient();
    const result = await client.removeDomain(domain, listType, "exact");
    return result.success
      ? { success: true }
      : { success: false, error: result.error?.message };
  }

  async function handleSearchDomain(domain: string): Promise<
    MessageResponse<{
      gravity: boolean;
      allowlist: boolean;
      denylist: boolean;
      instances?: Array<{
        instanceId: string;
        instanceName?: string;
        gravity: boolean;
        allowlist: boolean;
        denylist: boolean;
      }>;
    }>
  > {
    const activeId = store.getActiveInstanceId();

    const parseResult = (raw: unknown) => {
      const data = raw as Record<string, unknown>;
      const searchData = (data.search as Record<string, unknown>) || data;
      const gravity = searchData.gravity;
      const domains = searchData.domains as unknown[];

      const gravityCount = Array.isArray(gravity) ? gravity.length : 0;
      const allowlist = Array.isArray(domains)
        ? domains.filter((d: any) => d.type === "allow")
        : [];
      const denylist = Array.isArray(domains)
        ? domains.filter((d: any) => d.type === "deny")
        : [];

      return {
        gravity: gravityCount > 0,
        allowlist: allowlist.length > 0,
        denylist: denylist.length > 0,
      };
    };

    // Single-instance mode
    if (activeId) {
      const client = apiClientManager.getClient(activeId);
      const result = await client.searchDomain(domain);

      if (result.success && result.data) {
        const parsed = parseResult(result.data);
        const instance = await instanceManager.getInstance(activeId);
        return {
          success: true,
          data: {
            ...parsed,
            instances: [
              {
                instanceId: activeId,
                instanceName: instance
                  ? instanceManager.getDisplayName(instance)
                  : undefined,
                ...parsed,
              },
            ],
          },
        };
      }

      return { success: false, error: result.error?.message };
    }

    // "All" mode - query all connected instances
    const config = await instanceManager.getInstances();
    const connectedInstances = config.instances.filter((instance) => {
      const state = store.getInstanceState(instance.id);
      return state?.isConnected;
    });

    const results: Array<{
      instanceId: string;
      instanceName?: string;
      gravity: boolean;
      allowlist: boolean;
      denylist: boolean;
    }> = [];

    for (const instance of connectedInstances) {
      try {
        const client = apiClientManager.getClient(instance.id);
        const result = await client.searchDomain(domain);

        if (result.success && result.data) {
          const parsed = parseResult(result.data);
          results.push({
            instanceId: instance.id,
            instanceName: instanceManager.getDisplayName(instance),
            ...parsed,
          });
        } else {
          logger.warn(
            `[Background] Search failed for instance ${instance.id}:`,
            result.error?.message,
          );
        }
      } catch (error) {
        logger.warn(
          `[Background] Error searching domain for instance ${instance.id}:`,
          error,
        );
      }
    }

    const aggregated = {
      gravity: results.some((r) => r.gravity),
      allowlist: results.some((r) => r.allowlist),
      denylist: results.some((r) => r.denylist),
      instances: results,
    };

    return { success: true, data: aggregated };
  }

  async function handleGetQueries(payload?: {
    length?: number;
    from?: number;
  }): Promise<MessageResponse<QueryEntry[]>> {
    const activeId = store.getActiveInstanceId();

    const normalizeQueries = (data: unknown): QueryEntry[] => {
      const raw = Array.isArray(data) ? data : (data as any)?.queries || [];
      return raw.map((q: any) => {
        const timestamp =
          typeof q.timestamp === "number"
            ? q.timestamp
            : typeof q.time === "number"
              ? q.time
              : Number(q.timestamp ?? q.time ?? 0) || 0;
        return {
          ...q,
          timestamp,
          id: q.id ?? `${q.domain ?? "unknown"}-${timestamp}`,
        };
      });
    };

    const attachInstanceMeta = (
      queries: QueryEntry[],
      instanceId: string | null,
      instanceName?: string,
    ) =>
      queries.map((q) => ({
        ...q,
        id: q.id ?? `${instanceId || "all"}-${q.timestamp}-${q.domain}`,
        instanceId: instanceId || undefined,
        instanceName,
      }));

    // Single instance mode
    if (activeId) {
      const client = apiClientManager.getClient(activeId);
      const result = await client.getQueries(payload);

      if (result.success && result.data) {
        const instance = await instanceManager.getInstance(activeId);
        const instanceName = instance
          ? instanceManager.getDisplayName(instance)
          : undefined;
        const data = attachInstanceMeta(
          normalizeQueries(result.data),
          activeId,
          instanceName,
        );
        return { success: true, data };
      }

      return { success: false, error: result.error?.message };
    }

    // "All" mode - aggregate across connected instances
    const config = await instanceManager.getInstances();
    const connectedInstances = config.instances.filter((instance) => {
      const state = store.getInstanceState(instance.id);
      return state?.isConnected;
    });

    const aggregated: QueryEntry[] = [];

    for (const instance of connectedInstances) {
      try {
        const client = apiClientManager.getClient(instance.id);
        const result = await client.getQueries(payload);

        if (result.success && result.data) {
          const queries = attachInstanceMeta(
            normalizeQueries(result.data),
            instance.id,
            instanceManager.getDisplayName(instance),
          );
          aggregated.push(...queries);
        } else {
          logger.warn(
            `[Background] Failed to load queries for instance ${instance.id}:`,
            result.error?.message,
          );
        }
      } catch (error) {
        logger.warn(
          `[Background] Error loading queries for instance ${instance.id}:`,
          error,
        );
      }
    }

    aggregated.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    return { success: true, data: aggregated };
  }

  async function handleSaveConfig(payload: {
    piholeUrl: string;
    password: string;
    notificationsEnabled?: boolean;
    refreshInterval?: number;
    rememberPassword?: boolean;
  }): Promise<MessageResponse<void>> {
    try {
      await authManager.saveConfig(payload.piholeUrl, payload.password, {
        notificationsEnabled: payload.notificationsEnabled,
        refreshInterval: payload.refreshInterval,
        rememberPassword: payload.rememberPassword,
      });

      notificationService.setEnabled(payload.notificationsEnabled ?? true);
      return { success: true };
    } catch (error) {
      logger.error("[Background] Error in handleSaveConfig:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to save config",
      };
    }
  }

  async function handleTestConnection(
    url: string,
  ): Promise<MessageResponse<void>> {
    const result = await apiClient.testConnection(url);
    return result.success
      ? { success: true }
      : { success: false, error: formatConnectionError(result.error) };
  }

  // ===== Multi-Instance Handlers =====

  async function handleGetInstances(): Promise<MessageResponse<unknown>> {
    try {
      const instances = await instanceManager.getInstances();
      return { success: true, data: instances };
    } catch (error) {
      logger.error("[Background] Error getting instances:", error);
      return {
        success: false,
        error:
          error instanceof Error ? error.message : "Failed to get instances",
      };
    }
  }

  async function broadcastInstancesUpdated(): Promise<void> {
    try {
      await browser.runtime.sendMessage({ type: "INSTANCES_UPDATED" });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      if (!errorMessage.includes("Could not establish connection")) {
        logger.debug("Failed to broadcast instances update:", error);
      }
    }
  }

  async function handleAddInstance(payload: {
    name: string | null;
    piholeUrl: string;
    password: string;
    rememberPassword: boolean;
  }): Promise<MessageResponse<unknown>> {
    try {
      const instance = await instanceManager.addInstance(
        payload.name,
        payload.piholeUrl,
        payload.password,
        payload.rememberPassword,
      );

      // Configure API client for this instance
      const client = apiClientManager.configureClient(
        instance.id,
        instance.piholeUrl,
      );

      // Set up re-auth handler
      apiClientManager.setAuthHandler(instance.id, async () => {
        // Circuit breaker: stop auto-retry if too many consecutive failures
        if (isInstanceCircuitBreakerOpen(instance.id)) {
          logger.warn(
            `[PiSentinel] Auth circuit breaker open for instance ${instance.id} - skipping auto-retry`,
          );
          return false;
        }

        const password = await instanceManager.getDecryptedPassword(
          instance.id,
        );
        if (password !== null) {
          // Logout first to prevent ghost sessions
          if (client.hasSession()) {
            try {
              await client.logout();
            } catch {
              // Continue with re-auth
            }
          }
          const result = await client.authenticate(password);
          if (result.success) {
            resetInstanceAuthFailures(instance.id);
            return true;
          }
          incrementInstanceAuthFailures(instance.id);
        }
        return false;
      });

      const config = await instanceManager.getInstances();
      store.setActiveInstanceId(config.activeInstanceId);
      await broadcastInstancesUpdated();
      return { success: true, data: instance };
    } catch (error) {
      logger.error("[Background] Error adding instance:", error);
      return {
        success: false,
        error:
          error instanceof Error ? error.message : "Failed to add instance",
      };
    }
  }

  async function handleUpdateInstance(payload: {
    instanceId: string;
    name?: string | null;
    piholeUrl?: string;
    password?: string;
    rememberPassword?: boolean;
  }): Promise<MessageResponse<unknown>> {
    try {
      const instance = await instanceManager.updateInstance(
        payload.instanceId,
        {
          name: payload.name,
          piholeUrl: payload.piholeUrl,
          password: payload.password,
          rememberPassword: payload.rememberPassword,
        },
      );

      if (!instance) {
        return { success: false, error: "Instance not found" };
      }

      // Update API client URL if changed
      if (payload.piholeUrl) {
        apiClientManager.configureClient(instance.id, instance.piholeUrl);
      }

      if (store.getActiveInstanceId() === instance.id) {
        await refreshInstanceStats(instance.id);
      }

      await broadcastInstancesUpdated();
      return { success: true, data: instance };
    } catch (error) {
      logger.error("[Background] Error updating instance:", error);
      return {
        success: false,
        error:
          error instanceof Error ? error.message : "Failed to update instance",
      };
    }
  }

  async function handleDeleteInstance(
    instanceId: string,
  ): Promise<MessageResponse<void>> {
    logger.debug(`[Background] handleDeleteInstance called for: ${instanceId}`);
    try {
      const deleted = await instanceManager.deleteInstance(instanceId);
      logger.debug(
        `[Background] instanceManager.deleteInstance returned: ${deleted}`,
      );

      if (!deleted) {
        logger.warn(`[Background] Instance not found: ${instanceId}`);
        return { success: false, error: "Instance not found" };
      }

      // Clean up API client and state
      apiClientManager.removeClient(instanceId);
      store.removeInstanceState(instanceId);

      const config = await instanceManager.getInstances();
      store.setActiveInstanceId(config.activeInstanceId);
      logger.debug(`[Background] About to broadcast instances updated`);
      await broadcastInstancesUpdated();
      logger.debug(`[Background] Broadcast complete, returning success`);
      return { success: true };
    } catch (error) {
      logger.error("[Background] Error deleting instance:", error);
      return {
        success: false,
        error:
          error instanceof Error ? error.message : "Failed to delete instance",
      };
    }
  }

  async function handleSetActiveInstance(
    instanceId: string | null,
  ): Promise<MessageResponse<void>> {
    // BUG-4: Mark instances as transitioning to prevent concurrent refresh
    const transitionIds: string[] = [];
    try {
      if (instanceId === null) {
        const config = await instanceManager.getInstances();
        config.instances.forEach((i) => {
          instancesInTransition.add(i.id);
          transitionIds.push(i.id);
        });
      } else {
        instancesInTransition.add(instanceId);
        transitionIds.push(instanceId);
      }

      await instanceManager.setActiveInstance(instanceId);
      store.setActiveInstanceId(instanceId);

      if (instanceId === null) {
        const config = await instanceManager.getInstances();
        for (const instance of config.instances) {
          await tryAutoConnect(instance.id);
        }
      } else {
        await tryAutoConnect(instanceId);

        // If switching to a specific instance, refresh its stats if cache expired
        if (
          store.getInstanceState(instanceId)?.isConnected &&
          !store.isCacheValid(instanceId)
        ) {
          await refreshInstanceStats(instanceId);
        }
      }

      await broadcastInstancesUpdated();
      return { success: true };
    } catch (error) {
      logger.error("[Background] Error setting active instance:", error);
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to set active instance",
      };
    } finally {
      // BUG-4: Clear transition flags
      transitionIds.forEach((id) => instancesInTransition.delete(id));
    }
  }

  async function tryAutoConnect(instanceId: string): Promise<void> {
    try {
      const currentState = store.getInstanceState(instanceId);
      if (currentState?.isConnected) {
        return;
      }

      const password = await instanceManager.getDecryptedPassword(instanceId);
      if (password === null) {
        return;
      }

      const response = await handleConnectInstance({ instanceId, password });
      if (!response.success) {
        logger.debug("[Background] Auto-connect failed:", response.error);
      }
    } catch (error) {
      logger.debug("[Background] Auto-connect error:", error);
    }
  }

  async function handleConnectInstance(payload: {
    instanceId: string;
    password?: string;
    totp?: string;
  }): Promise<MessageResponse<{ totpRequired?: boolean }>> {
    try {
      const instance = await instanceManager.getInstance(payload.instanceId);
      if (!instance) {
        return { success: false, error: "Instance not found" };
      }

      // Reset circuit breaker on manual connect attempt - user is explicitly trying
      resetInstanceAuthFailures(instance.id);

      // Skip if already connected and no new credentials provided
      // This prevents duplicate sessions from race conditions (e.g., init + UI connect)
      const currentState = store.getInstanceState(instance.id);
      const session = await getInstanceSession(instance.id);
      if (
        currentState?.isConnected &&
        session &&
        session.expiresAt > Date.now() &&
        payload.password === undefined &&
        payload.totp === undefined
      ) {
        logger.debug(
          `[PiSentinel] Instance ${instance.id} already connected, skipping re-auth`,
        );
        return { success: true };
      }

      // Get or create API client for this instance
      const client = apiClientManager.configureClient(
        instance.id,
        instance.piholeUrl,
      );

      const password =
        payload.password !== undefined
          ? payload.password
          : await instanceManager.getDecryptedPassword(instance.id);

      if (password === null) {
        const errorMessage =
          "No saved password for this one. Edit it to add one (or leave it blank if it doesn't need one).";
        store.updateInstanceState(instance.id, {
          isConnected: false,
          connectionError: errorMessage,
          totpRequired: false,
        });
        return { success: false, error: errorMessage };
      }

      // Invalidate old session before creating new one to prevent ghost sessions
      if (client.hasSession()) {
        try {
          await client.logout();
        } catch {
          logger.debug(
            `[PiSentinel] Failed to logout before connect for ${instance.id}`,
          );
        }
      }

      // Authenticate
      const result = await client.authenticate(password, payload.totp);

      if (!result.success) {
        // Check if TOTP is required
        // Pi-hole returns: error.key="bad_request", message="No 2FA token found in JSON payload", status=400
        // NOT "totp_required" - that key doesn't exist in Pi-hole's API
        const isTotpRequired =
          result.error?.key === "bad_request" &&
          result.error?.message?.toLowerCase().includes("2fa");
        if (isTotpRequired) {
          store.updateInstanceState(instance.id, { totpRequired: true });
          return {
            success: false,
            data: { totpRequired: true },
            error: "TOTP required",
          };
        }
        const errorMessage = formatConnectionError(result.error);
        store.updateInstanceState(instance.id, {
          isConnected: false,
          connectionError: errorMessage,
        });
        return { success: false, error: errorMessage };
      }

      if (result.data?.session) {
        // Note: session.totp indicates 2FA is ENABLED on the account, not that it's required
        // App passwords bypass 2FA, so we should NOT check session.totp here
        // TOTP requirement is ONLY determined by error responses (error.key === "totp_required")

        // Store session
        await storeInstanceSession(
          instance.id,
          result.data.session.sid,
          result.data.session.csrf,
          result.data.session.validity,
        );

        // Update state
        store.updateInstanceState(instance.id, {
          isConnected: true,
          connectionError: null,
          totpRequired: false,
        });

        // Fetch stats
        await refreshInstanceStats(instance.id);

        return { success: true };
      }

      return { success: false, error: "Invalid response from Pi-hole" };
    } catch (error) {
      logger.error("[Background] Error connecting instance:", error);
      return {
        success: false,
        error:
          error instanceof Error ? error.message : "Failed to connect instance",
      };
    }
  }

  async function handleDisconnectInstance(
    instanceId: string,
  ): Promise<MessageResponse<void>> {
    const MAX_RETRIES = 3;
    let lastError: Error | null = null;
    let logoutSucceeded = false;

    const client = apiClientManager.getClient(instanceId);

    // Retry logout with exponential backoff
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const result = await client.logout();
        if (result.success) {
          logoutSucceeded = true;
          break;
        }
        // Retry on failure
        if (attempt < MAX_RETRIES - 1) {
          await new Promise((r) => setTimeout(r, 100 * (attempt + 1)));
        }
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        if (attempt < MAX_RETRIES - 1) {
          await new Promise((r) => setTimeout(r, 100 * (attempt + 1)));
        }
      }
    }

    // Always clear local state - user wants to disconnect
    try {
      const sessionKey = `${STORAGE_KEYS.INSTANCE_SESSION_PREFIX}${instanceId}`;
      await browser.storage.session.remove(sessionKey);
      store.resetInstanceState(instanceId);

      // CRITICAL: Broadcast state change to update UI (was missing - caused stale "Connected" status)
      await broadcastInstancesUpdated();
    } catch (error) {
      logger.error("[Background] Error clearing disconnect state:", error);
      // Still return success - the API logout may have worked
    }

    if (!logoutSucceeded) {
      logger.warn(
        `[Background] Logout may have failed after ${MAX_RETRIES} attempts for ${instanceId}`,
        lastError,
      );
      // Still return success since local state is cleared
      // The server-side session will expire naturally
    }

    return { success: true };
  }

  function handleGetInstanceState(
    instanceId: string,
  ): MessageResponse<unknown> {
    const state = store.getInstanceState(instanceId);
    if (!state) {
      return { success: false, error: "Instance state not found" };
    }
    return { success: true, data: state };
  }

  async function handleGetAggregatedState(): Promise<MessageResponse<unknown>> {
    try {
      const config = await instanceManager.getInstances();

      // Build instance names map
      const instanceNames = new Map<string, string>();
      for (const instance of config.instances) {
        instanceNames.set(
          instance.id,
          instanceManager.getDisplayName(instance),
        );
      }

      const aggregatedState = store.getAggregatedState(instanceNames);
      return { success: true, data: aggregatedState };
    } catch (error) {
      logger.error("[Background] Error getting aggregated state:", error);
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to get aggregated state",
      };
    }
  }

  /**
   * Check if a password is available for an instance.
   * Returns true if the password is stored in session or can be decrypted from storage.
   */
  async function handleCheckPasswordAvailable(payload: {
    instanceId: string;
  }): Promise<MessageResponse<{ available: boolean }>> {
    try {
      const password = await instanceManager.getDecryptedPassword(
        payload.instanceId,
      );
      const available = password !== null;
      logger.info(
        `[Background] CHECK_PASSWORD_AVAILABLE for ${payload.instanceId}: available=${available}`,
      );
      return { success: true, data: { available } };
    } catch (error) {
      logger.error("[Background] Error checking password availability:", error);
      return { success: true, data: { available: false } };
    }
  }

  // ===== Stats Polling =====

  async function refreshStats(): Promise<void> {
    const client = getActiveClient();
    const result = await client.getStats();
    if (result.success && result.data) {
      store.setState({
        stats: result.data,
        statsLastUpdated: Date.now(),
      });
    }

    // Also refresh blocking status
    const blockingResult = await client.getBlockingStatus();
    if (blockingResult.success && blockingResult.data) {
      store.setState({
        blockingEnabled: blockingResult.data.blocking === "enabled",
        blockingTimer: blockingResult.data.timer,
      });
    }
  }

  async function startStatsPolling(): Promise<void> {
    const config = await authManager.getConfig();
    const interval = config?.refreshInterval || DEFAULTS.REFRESH_INTERVAL;

    await browser.alarms.create(ALARMS.STATS_REFRESH, {
      periodInMinutes: interval / 60, // Convert seconds to minutes
    });
  }

  async function stopStatsPolling(): Promise<void> {
    await browser.alarms.clear(ALARMS.STATS_REFRESH);
  }

  // ===== Alarm Handling =====

  async function handleAlarm(alarm: browser.Alarms.Alarm): Promise<void> {
    switch (alarm.name) {
      case ALARMS.SESSION_KEEPALIVE:
        await handleSessionKeepalive();
        break;

      case ALARMS.STATS_REFRESH:
        await handleStatsRefresh();
        break;
    }
  }

  /**
   * Handle session keepalive for all instances.
   */
  async function handleSessionKeepalive(): Promise<void> {
    const config = await instanceManager.getInstances();

    // If no instances, fall back to legacy auth manager
    if (config.instances.length === 0) {
      // Circuit breaker check for legacy mode
      if (isLegacyCircuitBreakerOpen()) {
        logger.debug(
          "[PiSentinel] Skipping legacy keepalive - auth circuit breaker open",
        );
        return;
      }

      const renewalSuccess = await authManager.renewSessionBeforeExpiry();
      if (renewalSuccess) {
        resetLegacyAuthFailures();
        return;
      }

      const sessionValid = await authManager.handleKeepalive();
      if (!sessionValid) {
        const password = await authManager.getDecryptedPassword();
        if (password !== null) {
          const result = await authManager.authenticate(password);
          if (result.success) {
            resetLegacyAuthFailures();
            store.setState({ isConnected: true });
            return;
          }
          consecutiveAuthFailures++;
          logger.warn(
            `[PiSentinel] Legacy keepalive auth failed (${consecutiveAuthFailures}/${DEFAULTS.MAX_CONSECUTIVE_AUTH_FAILURES})`,
          );
        }
        store.setState({ isConnected: false });
        await notificationService.showConnectionError("Session expired");
      }
      return;
    }

    // Iterate through all instances
    for (const instance of config.instances) {
      try {
        // Circuit breaker check for this instance
        if (isInstanceCircuitBreakerOpen(instance.id)) {
          logger.debug(
            `[PiSentinel] Skipping keepalive for instance ${instance.id} - auth circuit breaker open`,
          );
          continue;
        }

        // SEC-3: Use encrypted session retrieval
        const session = await getInstanceSession(instance.id);

        if (!session) continue;

        const client = apiClientManager.getClient(instance.id);

        // BUG-3: Check if session is about to expire (within threshold)
        // Use a longer threshold to account for slow network conditions
        const timeUntilExpiry = session.expiresAt - Date.now();
        const SAFE_THRESHOLD_MS = DEFAULTS.SESSION_RENEWAL_THRESHOLD * 1000;
        const AGGRESSIVE_THRESHOLD_MS = SAFE_THRESHOLD_MS * 2; // 2x threshold for safety margin

        if (timeUntilExpiry > AGGRESSIVE_THRESHOLD_MS) {
          // Session still valid with good margin, just ping to extend
          const result = await client.getStats();
          if (result.success) {
            // Update session expiry - also reset failures since session is working
            resetInstanceAuthFailures(instance.id);
            await storeInstanceSession(
              instance.id,
              session.sid,
              session.csrf,
              300,
            );
            continue;
          }

          // BUG-3: If ping failed (possibly expired during call), try to re-authenticate
          if (result.error?.status === 401 || result.error?.status === 403) {
            logger.debug(
              `[PiSentinel] Session ping failed for ${instance.id}, attempting re-auth`,
            );
            // Fall through to re-authentication below
          } else {
            // Network error or other issue - keep trying
            continue;
          }
        }

        // Session about to expire or ping failed - proactively re-authenticate
        const password = await instanceManager.getDecryptedPassword(
          instance.id,
        );
        if (password !== null) {
          // Invalidate old session before creating new one to prevent ghost sessions
          try {
            await client.logout();
          } catch {
            // Continue with re-auth even if logout fails
            logger.debug(
              `[PiSentinel] Failed to logout before session renewal for ${instance.id}`,
            );
          }

          const result = await client.authenticate(password);
          if (result.success && result.data?.session) {
            resetInstanceAuthFailures(instance.id);
            await storeInstanceSession(
              instance.id,
              result.data.session.sid,
              result.data.session.csrf,
              result.data.session.validity,
            );
            store.updateInstanceState(instance.id, { isConnected: true });
            continue;
          }
          // Auth failed - increment failure counter
          incrementInstanceAuthFailures(instance.id);
        }

        // Session expired and couldn't be renewed
        store.updateInstanceState(instance.id, {
          isConnected: false,
          connectionError: "Session expired",
        });
      } catch (error) {
        logger.error(
          `[PiSentinel] Keepalive failed for instance ${instance.id}:`,
          error,
        );
      }
    }
  }

  /**
   * Handle stats refresh for all instances.
   */
  async function handleStatsRefresh(): Promise<void> {
    const config = await instanceManager.getInstances();

    // If no instances, fall back to legacy refresh
    if (config.instances.length === 0) {
      if (await authManager.hasValidSession()) {
        await refreshStats();
      }
      return;
    }

    // PERF-1: Refresh stats for all connected instances in parallel
    const refreshPromises = config.instances
      .filter((instance) => {
        // BUG-4: Skip instances that are currently being transitioned
        if (instancesInTransition.has(instance.id)) {
          logger.debug(
            `[PiSentinel] Skipping refresh for ${instance.id} - in transition`,
          );
          return false;
        }

        const state = store.getInstanceState(instance.id);
        return state?.isConnected;
      })
      .map((instance) =>
        refreshInstanceStats(instance.id).catch((error) => {
          // Log but don't fail other refreshes
          logger.error(
            `[PiSentinel] Stats refresh failed for ${instance.id}:`,
            error,
          );
        }),
      );

    await Promise.all(refreshPromises);
  }

  // ===== Event Listeners =====

  // Register message listener at top level (required for event pages)
  logger.debug("[Background] Registering message listener");

  // Use Promise-based pattern (recommended for webextension-polyfill in Firefox MV3)
  // Returning a Promise directly is more reliable than sendResponse callback
  browser.runtime.onMessage.addListener(
    (message: unknown, sender: browser.Runtime.MessageSender) => {
      logger.info(
        "[Background] Listener received message:",
        (message as Message)?.type,
        "from:",
        sender.url?.substring(0, 50),
      );

      // Return Promise directly - webextension-polyfill handles this correctly
      return handleMessage(message as Message, sender)
        .then((response) => {
          logger.info(
            "[Background] Returning response for",
            (message as Message)?.type,
            ":",
            JSON.stringify(response)?.substring(0, 100),
          );
          return response;
        })
        .catch((error) => {
          logger.error("[Background] Error handling message:", error);
          return { success: false, error: error.message };
        });
    },
  );
  logger.debug("[Background] Message listener registered");

  // Register alarm listener at top level with error isolation
  // Wrap to prevent alarm errors from crashing the background script
  browser.alarms.onAlarm.addListener(async (alarm) => {
    try {
      await handleAlarm(alarm);
    } catch (error) {
      logger.error(
        `[PiSentinel] Error in alarm handler (${alarm.name}):`,
        error instanceof Error
          ? { message: error.message, stack: error.stack }
          : error,
      );
      // Don't rethrow - let the background script continue running
    }
  });

  // WORKAROUND: Listen for storage changes for config saves and auth (browser.runtime.sendMessage is broken)
  // Configuration for storage-based request handlers
  type StorageRequestConfig = {
    responseKey: string;
    handler: (payload: any) => Promise<MessageResponse<any>>;
  };

  const storageRequests: Record<string, StorageRequestConfig> = {
    pendingConfig: {
      responseKey: "configResponse",
      handler: (payload) =>
        handleSaveConfig({
          piholeUrl: payload.url,
          password: payload.password,
          rememberPassword: payload.rememberPassword,
        }),
    },
    pendingAuth: {
      responseKey: "authResponse",
      handler: (payload) =>
        handleAuthenticate({
          password: payload.password,
          totp: payload.totp,
        }),
    },
    pendingTestConnection: {
      responseKey: "testConnectionResponse",
      handler: (payload) => handleTestConnection(payload.url),
    },
    pendingLogout: {
      responseKey: "logoutResponse",
      handler: () => handleLogout(),
    },
    pendingAddInstance: {
      responseKey: "addInstanceResponse",
      handler: (payload) => handleAddInstance(payload),
    },
    pendingUpdateInstance: {
      responseKey: "updateInstanceResponse",
      handler: (payload) => handleUpdateInstance(payload),
    },
    pendingGetInstances: {
      responseKey: "getInstancesResponse",
      handler: () => handleGetInstances(),
    },
    pendingDeleteInstance: {
      responseKey: "deleteInstanceResponse",
      handler: (payload) => handleDeleteInstance(payload.instanceId),
    },
    pendingConnectInstance: {
      responseKey: "connectInstanceResponse",
      handler: (payload) => handleConnectInstance(payload),
    },
    pendingDisconnectInstance: {
      responseKey: "disconnectInstanceResponse",
      handler: (payload) => handleDisconnectInstance(payload.instanceId),
    },
    pendingSetActiveInstance: {
      responseKey: "setActiveInstanceResponse",
      handler: (payload) => handleSetActiveInstance(payload.instanceId),
    },
    pendingGetInstanceState: {
      responseKey: "getInstanceStateResponse",
      handler: (payload) => handleGetInstanceState(payload.instanceId),
    },
    pendingCheckPasswordAvailable: {
      responseKey: "checkPasswordAvailableResponse",
      handler: (payload) => handleCheckPasswordAvailable(payload),
    },
  };

  // Generic storage request handler
  browser.storage.onChanged.addListener(async (changes, areaName) => {
    logger.debug(
      `[Background] Storage changed: area=${areaName}, keys=${Object.keys(changes).join(", ")}`,
    );
    if (areaName !== "local") return;

    for (const [requestKey, config] of Object.entries(storageRequests)) {
      if (changes[requestKey]?.newValue) {
        const payload = changes[requestKey].newValue;
        logger.info(`[Background] Processing storage request: ${requestKey}`);

        try {
          const response = await config.handler(payload);
          await browser.storage.local.set({ [config.responseKey]: response });
          logger.debug(`[Background] ${requestKey} processed successfully`);
        } catch (error) {
          logger.error(`[Background] Error processing ${requestKey}:`, error);
          await browser.storage.local.set({
            [config.responseKey]: {
              success: false,
              error:
                error instanceof Error
                  ? error.message
                  : ERROR_MESSAGES.UNKNOWN_ERROR,
            },
          });
        } finally {
          // Always remove the pending request key to prevent stuck requests
          await browser.storage.local.remove(requestKey);
        }
      }
    }
  });

  // Initialize on startup
  browser.runtime.onStartup.addListener(initialize);

  // Initialize on install
  browser.runtime.onInstalled.addListener(async (details) => {
    logger.info("PiSentinel: Extension installed/updated", details.reason);
    await initialize();
  });

  // Also initialize immediately for development reloads
  initialize().catch(logger.error);
});
