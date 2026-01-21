import browser from "webextension-polyfill";
import { defineBackground } from "#imports";
import { apiClient, apiClientManager } from "~/background/api/client";
import { authManager } from "~/background/api/auth";
import { instanceManager } from "~/background/api/instance-manager";
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
import type { ExtensionState, QueryEntry, SessionData } from "~/utils/types";

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

  // ===== Initialization =====

  async function initialize(): Promise<void> {
    try {
      logger.info("[PiSentinel] Starting background script initialization");

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
        const password = await authManager.getDecryptedPassword();
        if (password) {
          const result = await authManager.authenticate(password);
          return result.success;
        }
        return false;
      });

      // Try to restore sessions for all instances
      logger.info("[PiSentinel] Attempting to restore sessions");
      await initializeInstances();

      // Subscribe to state changes for badge updates
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
          const password = await instanceManager.getDecryptedPassword(
            instance.id,
          );
          if (password) {
            const result = await client.authenticate(password);
            return result.success;
          }
          return false;
        });

        // Try to restore session from storage
        const sessionKey = `${STORAGE_KEYS.INSTANCE_SESSION_PREFIX}${instance.id}`;
        const sessionResult = await browser.storage.session.get(sessionKey);
        const session = sessionResult[sessionKey] as SessionData | undefined;

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
          if (password) {
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
    await browser.storage.session.set({ [sessionKey]: session });
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
  };

  async function handleMessage(
    message: Message,
    sender: browser.Runtime.MessageSender,
  ): Promise<MessageResponse<unknown>> {
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
      connectionError: result.error || null,
    });
    return { success: false, error: result.error };
  }

  async function handleLogout(): Promise<MessageResponse<void>> {
    await authManager.logout();
    await stopStatsPolling();
    store.reset();
    await badgeService.clear();

    // Clean up storage-based communication artifacts
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

  async function handleSearchDomain(
    domain: string,
  ): Promise<
    MessageResponse<{ gravity: boolean; allowlist: boolean; denylist: boolean }>
  > {
    const client = getActiveClient();
    const result = await client.searchDomain(domain);

    if (result.success && result.data) {
      const data = result.data as unknown as Record<string, unknown>;
      logger.info("Search API response:", JSON.stringify(data, null, 2));

      // Handle Pi-hole v6 API response structure
      // API returns: { search: { domains: [...], gravity: [...] } }
      const searchData = (data.search as Record<string, unknown>) || data;
      const gravity = searchData.gravity;
      const domains = searchData.domains as unknown[];

      // gravity is an array of matching blocklist entries
      const gravityCount = Array.isArray(gravity) ? gravity.length : 0;

      // domains is an array - check for allow/deny entries
      const allowlist = Array.isArray(domains)
        ? domains.filter((d: any) => d.type === "allow")
        : [];
      const denylist = Array.isArray(domains)
        ? domains.filter((d: any) => d.type === "deny")
        : [];

      return {
        success: true,
        data: {
          gravity: gravityCount > 0,
          allowlist: allowlist.length > 0,
          denylist: denylist.length > 0,
        },
      };
    }

    return { success: false, error: result.error?.message };
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
      : { success: false, error: result.error?.message };
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
        const password = await instanceManager.getDecryptedPassword(
          instance.id,
        );
        if (password) {
          const result = await client.authenticate(password);
          return result.success;
        }
        return false;
      });

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
    try {
      const deleted = await instanceManager.deleteInstance(instanceId);

      if (!deleted) {
        return { success: false, error: "Instance not found" };
      }

      // Clean up API client and state
      apiClientManager.removeClient(instanceId);
      store.removeInstanceState(instanceId);

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
    try {
      await instanceManager.setActiveInstance(instanceId);
      store.setActiveInstanceId(instanceId);

      // If switching to a specific instance, refresh its stats if cache expired
      if (instanceId && !store.isCacheValid(instanceId)) {
        await refreshInstanceStats(instanceId);
      }

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
    }
  }

  async function handleConnectInstance(payload: {
    instanceId: string;
    password: string;
    totp?: string;
  }): Promise<MessageResponse<{ totpRequired?: boolean }>> {
    try {
      const instance = await instanceManager.getInstance(payload.instanceId);
      if (!instance) {
        return { success: false, error: "Instance not found" };
      }

      // Get or create API client for this instance
      const client = apiClientManager.configureClient(
        instance.id,
        instance.piholeUrl,
      );

      // Authenticate
      const result = await client.authenticate(payload.password, payload.totp);

      if (!result.success) {
        // Check if TOTP is required
        if (
          result.error?.key === "totp_required" ||
          result.error?.status === 401
        ) {
          store.updateInstanceState(instance.id, { totpRequired: true });
          return {
            success: false,
            data: { totpRequired: true },
            error: "TOTP required",
          };
        }
        store.updateInstanceState(instance.id, {
          isConnected: false,
          connectionError: result.error?.message || "Authentication failed",
        });
        return { success: false, error: result.error?.message };
      }

      if (result.data?.session) {
        // Check if TOTP is required but not provided
        if (result.data.session.totp && !payload.totp) {
          store.updateInstanceState(instance.id, { totpRequired: true });
          return {
            success: false,
            data: { totpRequired: true },
            error: "TOTP required",
          };
        }

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
    try {
      const client = apiClientManager.getClient(instanceId);

      // Logout from Pi-hole
      await client.logout();

      // Clear session storage
      const sessionKey = `${STORAGE_KEYS.INSTANCE_SESSION_PREFIX}${instanceId}`;
      await browser.storage.session.remove(sessionKey);

      // Reset instance state
      store.resetInstanceState(instanceId);

      return { success: true };
    } catch (error) {
      logger.error("[Background] Error disconnecting instance:", error);
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to disconnect instance",
      };
    }
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
      const renewalSuccess = await authManager.renewSessionBeforeExpiry();
      if (renewalSuccess) return;

      const sessionValid = await authManager.handleKeepalive();
      if (!sessionValid) {
        const password = await authManager.getDecryptedPassword();
        if (password) {
          const result = await authManager.authenticate(password);
          if (result.success) {
            store.setState({ isConnected: true });
            return;
          }
        }
        store.setState({ isConnected: false });
        await notificationService.showConnectionError("Session expired");
      }
      return;
    }

    // Iterate through all instances
    for (const instance of config.instances) {
      try {
        const sessionKey = `${STORAGE_KEYS.INSTANCE_SESSION_PREFIX}${instance.id}`;
        const sessionResult = await browser.storage.session.get(sessionKey);
        const session = sessionResult[sessionKey] as SessionData | undefined;

        if (!session) continue;

        // Check if session is about to expire (within 60 seconds)
        const timeUntilExpiry = session.expiresAt - Date.now();
        if (timeUntilExpiry > DEFAULTS.SESSION_RENEWAL_THRESHOLD * 1000) {
          // Session still valid, just ping to extend
          const client = apiClientManager.getClient(instance.id);
          const result = await client.getStats();
          if (result.success) {
            // Update session expiry
            await storeInstanceSession(
              instance.id,
              session.sid,
              session.csrf,
              300,
            );
          }
          continue;
        }

        // Session about to expire, try to re-authenticate
        const password = await instanceManager.getDecryptedPassword(
          instance.id,
        );
        if (password) {
          const client = apiClientManager.getClient(instance.id);
          const result = await client.authenticate(password);
          if (result.success && result.data?.session) {
            await storeInstanceSession(
              instance.id,
              result.data.session.sid,
              result.data.session.csrf,
              result.data.session.validity,
            );
            store.updateInstanceState(instance.id, { isConnected: true });
            continue;
          }
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

    // Refresh stats for all connected instances
    for (const instance of config.instances) {
      const state = store.getInstanceState(instance.id);
      if (state?.isConnected) {
        await refreshInstanceStats(instance.id);
      }
    }
  }

  // ===== Event Listeners =====

  // Register message listener at top level (required for event pages)
  logger.debug("[Background] Registering message listener");

  // Use Chrome/Firefox compatible sendResponse pattern
  browser.runtime.onMessage.addListener(
    (
      message: unknown,
      sender: browser.Runtime.MessageSender,
      sendResponse: (response: any) => void,
    ) => {
      logger.debug("[Background] Listener received message:", message);

      // Handle async with sendResponse callback
      handleMessage(message as Message, sender)
        .then((response) => {
          logger.debug("[Background] Calling sendResponse with:", response);
          sendResponse(response);
        })
        .catch((error) => {
          logger.error("[Background] Error handling message:", error);
          sendResponse({ success: false, error: error.message });
        });

      // CRITICAL: Return true to indicate we will call sendResponse asynchronously
      return true;
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
  };

  // Generic storage request handler
  browser.storage.onChanged.addListener(async (changes, areaName) => {
    if (areaName !== "local") return;

    for (const [requestKey, config] of Object.entries(storageRequests)) {
      if (changes[requestKey]?.newValue) {
        const payload = changes[requestKey].newValue;
        logger.debug(`[Background] Processing storage request: ${requestKey}`);

        try {
          const response = await config.handler(payload);
          await browser.storage.local.set({ [config.responseKey]: response });
          await browser.storage.local.remove(requestKey);
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
