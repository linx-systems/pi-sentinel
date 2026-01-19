import browser from "webextension-polyfill";
import { defineBackground } from "#imports";
import { apiClient } from "~/background/api/client";
import { authManager } from "~/background/api/auth";
import { store } from "~/background/state/store";
import { badgeService } from "~/background/services/badge";
import { notificationService } from "~/background/services/notifications";
import { domainTracker } from "~/background/services/domain-tracker";
import { ALARMS, DEFAULTS, ERROR_MESSAGES } from "~/utils/constants";
import { logger } from "~/utils/logger";
import { ErrorHandler, ErrorType } from "~/utils/error-handler";
import type { Message, MessageResponse } from "~/utils/messaging";
import type { ExtensionState } from "~/utils/types";

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

      // Set up auth re-authentication handler
      logger.info("[PiSentinel] Setting up auth handler");
      apiClient.setAuthRequiredHandler(async () => {
        const password = await authManager.getDecryptedPassword();
        if (password) {
          const result = await authManager.authenticate(password);
          return result.success;
        }
        return false;
      });

      // Try to restore session
      logger.info("[PiSentinel] Attempting to restore session");
      const hasSession = await authManager.initialize();
      if (hasSession) {
        logger.info("[PiSentinel] Session restored successfully");
        store.setState({ isConnected: true });
        await refreshStats();
      } else {
        logger.info("[PiSentinel] No session to restore");
      }

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
      "pendingAuth",
      "pendingConfig",
      "pendingLogout",
      "pendingTestConnection",
    ]);

    return { success: true };
  }

  async function handleGetStats(): Promise<
    MessageResponse<ExtensionState["stats"]>
  > {
    const result = await apiClient.getStats();
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
    const result = await apiClient.getBlockingStatus();
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
    const result = await apiClient.setBlocking(payload.enabled, payload.timer);

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
    const result = await apiClient.addDomain(
      domain,
      listType,
      "exact",
      comment,
    );

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
    const result = await apiClient.removeDomain(domain, listType, "exact");
    return result.success
      ? { success: true }
      : { success: false, error: result.error?.message };
  }

  async function handleSearchDomain(
    domain: string,
  ): Promise<
    MessageResponse<{ gravity: boolean; allowlist: boolean; denylist: boolean }>
  > {
    const result = await apiClient.searchDomain(domain);

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
  }): Promise<MessageResponse<unknown>> {
    const result = await apiClient.getQueries(payload);
    return result.success
      ? { success: true, data: result.data }
      : { success: false, error: result.error?.message };
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

  // ===== Stats Polling =====

  async function refreshStats(): Promise<void> {
    const result = await apiClient.getStats();
    if (result.success && result.data) {
      store.setState({
        stats: result.data,
        statsLastUpdated: Date.now(),
      });
    }

    // Also refresh blocking status
    const blockingResult = await apiClient.getBlockingStatus();
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
        // First, try proactive renewal if session is about to expire
        const renewalSuccess = await authManager.renewSessionBeforeExpiry();
        if (renewalSuccess) {
          // Session renewed or still valid
          break;
        }

        // Fall back to regular keepalive
        const sessionValid = await authManager.handleKeepalive();
        if (!sessionValid) {
          // Session expired and couldn't be renewed
          // Try auto-reauthentication if Remember Password is enabled
          const password = await authManager.getDecryptedPassword();
          if (password) {
            const result = await authManager.authenticate(password);
            if (result.success) {
              store.setState({ isConnected: true });
              break;
            }
          }

          store.setState({ isConnected: false });
          await notificationService.showConnectionError("Session expired");
        }
        break;

      case ALARMS.STATS_REFRESH:
        if (await authManager.hasValidSession()) {
          await refreshStats();
        }
        break;
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
