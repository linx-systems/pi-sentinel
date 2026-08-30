import browser from "webextension-polyfill";
import { defineBackground } from "#imports";
import { createInitializationGate } from "~/background/readiness";
import { ApiClientManager, PiholeApiClient } from "~/background/api/client";
import { isTotpChallenge } from "~/background/api/auth";
import { encryption } from "~/background/crypto/encryption";
import { instanceManager } from "~/background/api/instance-manager";
import {
  createInstanceRuntime,
  type InstanceRuntime,
} from "~/background/runtime/instances";
import {
  createFleetQueries,
  type DomainSearchEntry,
  type FleetQueryEntry,
  type FleetResult,
} from "~/background/fleet/queries";
import {
  getInstanceSession,
  storeInstanceSession,
} from "~/background/session-storage";
import { loadSwState, saveSwState } from "~/background/sw-state";
import { store } from "~/background/state/store";
import { badgeService } from "~/background/services/badge";
import { notificationService } from "~/background/services/notifications";
import { domainTracker } from "~/background/services/domain-tracker";
import { TemporaryAllowService } from "~/background/services/temporary-allows";
import {
  ALARMS,
  DEFAULTS,
  ERROR_MESSAGES,
  STORAGE_KEYS,
} from "~/utils/constants";
import { classifyConnectInstanceFailure } from "~/utils/connection-failure";
import { logger } from "~/utils/logger";
import {
  createRuntimeStorageCommandSignalReceiver,
  isStorageCommandSignal,
  registerStorageCommandReceiver,
} from "~/utils/extension-commands";
import {
  createCommandDispatcher,
  type CommandHandlerRegistry,
} from "~/utils/commands/dispatcher";
import type {
  CommandMessage,
  CreateTemporaryAllowsPayload,
  CreateTemporaryAllowsResult,
  MessageResponse,
  RemoveTemporaryAllowsPayload,
  RemoveTemporaryAllowsResult,
} from "~/utils/messaging";
import type {
  SessionData,
  StatsSummary,
  TemporaryAllowEntry,
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
   * On Chrome, persisted to browser.storage.session to survive SW restarts.
   */
  let instanceSessionEncryptionKey: string | null = null;

  /**
   * Shares one initialization result with startup events and all dispatchers.
   * A rejected initialization remains rejected for the lifetime of this worker.
   */
  const initializationGate = createInitializationGate();

  // Renewal failure state is private to the multi-instance runtime and survives
  // Chrome service-worker restarts through the runtime lifecycle adapter.

  const instanceAuthFailures = new Map<string, number>();
  const clientRegistry = new ApiClientManager();

  const fleetQueries = createFleetQueries({
    store,
    instances: instanceManager,
    clients: clientRegistry,
  });
  const temporaryAllowService = new TemporaryAllowService({
    getInstances: () => instanceManager.getInstances(),
    getClient: (instanceId) => clientRegistry.getClient(instanceId),
  });

  // ===== Chrome Service Worker State Persistence =====
  const instanceRuntime = createRuntime();
  function createRuntime(): InstanceRuntime {
    return createInstanceRuntime({
      storage: {
        loadInstances: async () => {
          const config = await instanceManager.getInstances();
          return {
            instances: config.instances.map((instance) => ({
              ...instance,
              savedPassword: null,
            })),
            activeInstanceId: config.activeInstanceId,
          };
        },
        addInstance: async (input) => ({
          ...(await instanceManager.addInstance(
            input.name,
            input.piholeUrl,
            input.password,
            input.rememberPassword,
          )),
          savedPassword: null,
        }),
        updateInstance: async (input) => {
          const instance = await instanceManager.updateInstance(
            input.instanceId,
            {
              name: input.name,
              piholeUrl: input.piholeUrl,
              password: input.password,
              rememberPassword: input.rememberPassword,
            },
          );
          return instance ? { ...instance, savedPassword: null } : null;
        },
        removeInstanceConfiguration: (instanceId) =>
          instanceManager.removeInstanceConfiguration(instanceId),
        setActiveInstance: (instanceId) =>
          instanceManager.setActiveInstance(instanceId),
        loadSessions: async () => {
          const { instances } = await instanceManager.getInstances();
          const sessions = await Promise.all(
            instances.map(async (instance) => {
              const session = await getInstanceSession(
                instance.id,
                instanceSessionEncryptionKey,
              );
              return session ? ([instance.id, session] as const) : null;
            }),
          );
          return new Map(
            sessions.filter(
              (session): session is readonly [string, SessionData] =>
                session !== null,
            ),
          );
        },
        saveSession: async (instanceId, session) => {
          await storeInstanceSession(
            instanceId,
            session.sid,
            session.csrf,
            (session.expiresAt - Date.now()) / 1000,
            instanceSessionEncryptionKey,
          );
        },
        deleteSession: async (instanceId) => {
          await browser.storage.session.remove(
            `${STORAGE_KEYS.INSTANCE_SESSION_PREFIX}${instanceId}`,
          );
        },
        deleteInstanceCredentials: async (instanceId) => {
          await instanceManager.deleteInstanceSessionMaterial(instanceId);
        },
      },
      clients: {
        configure: (instance) => {
          const client = clientRegistry.configureClient(
            instance.id,
            instance.piholeUrl ?? "",
          );
          return {
            setSession: (sid, csrf) => client.setSession(sid, csrf),
            authenticate: async (password, totp) => {
              if (password === null) {
                return {
                  ok: false as const,
                  reason: "invalid" as const,
                  message: "No saved password for this instance",
                };
              }
              const result = await client.authenticate(password, totp);
              if (result.success && result.data?.session) {
                return {
                  ok: true as const,
                  session: {
                    sid: result.data.session.sid,
                    csrf: result.data.session.csrf,
                    expiresAt: Date.now() + result.data.session.validity * 1000,
                  },
                };
              }
              const message = formatConnectionError(result.error);
              return {
                ok: false as const,
                reason: isTotpChallenge(result.error, totp)
                  ? ("totp" as const)
                  : ("invalid" as const),
                message,
                error: classifyConnectInstanceFailure({
                  message,
                  status: result.error?.status,
                }),
              };
            },
            logout: () => client.logout(),
            getStats: async () => {
              const result = await client.getStats();
              return result.success && result.data
                ? { ok: true as const, stats: result.data }
                : {
                    ok: false as const,
                    unauthorized: result.error?.status === 401,
                    message: formatConnectionError(result.error),
                  };
            },
            getBlockingStatus: async () => {
              const result = await client.getBlockingStatus();
              return result.success && result.data
                ? { ok: true as const, status: result.data }
                : {
                    ok: false as const,
                    message: formatConnectionError(result.error),
                  };
            },
            setBlocking: async (enabled, timer) => {
              const result = await client.setBlocking(enabled, timer);
              return result.success && result.data
                ? { ok: true as const, status: result.data }
                : {
                    ok: false as const,
                    message: formatConnectionError(result.error),
                  };
            },
          };
        },
        remove: (instanceId) => clientRegistry.removeClient(instanceId),
      },
      state: {
        connectionSucceeded: async (instanceId) => {
          await store.connectionSucceeded(instanceId);
          await broadcastInstancesUpdated();
        },
        requireTotp: async (instanceId) => {
          await store.requireTotp(instanceId);
          await broadcastInstancesUpdated();
        },
        connectionFailed: async (instanceId, error) => {
          await store.connectionFailed(instanceId, error);
          await broadcastInstancesUpdated();
        },
        recordStatsSnapshot: async (instanceId, stats) => {
          await store.recordStatsSnapshot(instanceId, stats as StatsSummary);
          await broadcastInstancesUpdated();
        },
        recordBlockingSnapshot: async (instanceId, status) => {
          const recorded = await store.recordBlockingSnapshot(
            instanceId,
            status,
          );
          if (recorded) await broadcastInstancesUpdated();
          return recorded;
        },
        disconnectInstance: async (instanceId) => {
          await store.disconnectInstance(instanceId);
          await broadcastInstancesUpdated();
        },
        selectInstance: async (instanceId) => {
          await store.selectInstance(instanceId);
          await broadcastInstancesUpdated();
        },
        removeInstance: async (instanceId, activeInstanceId) => {
          await store.removeInstance(instanceId, activeInstanceId);
          await broadcastInstancesUpdated();
        },
      },
      temporaryAllows: {
        removeForInstance: (instanceId) =>
          temporaryAllowService.removeForInstance(instanceId),
      },
      now: () => Date.now(),
      maxConsecutiveRenewalFailures: DEFAULTS.MAX_CONSECUTIVE_AUTH_FAILURES,
      getSavedPassword: (instance) =>
        instanceManager.getDecryptedPassword(instance.id),
      lifecycle: {
        loadRenewalFailures: async () => new Map(instanceAuthFailures),
        saveRenewalFailures: async (failures) => {
          instanceAuthFailures.clear();
          for (const [instanceId, count] of failures) {
            instanceAuthFailures.set(instanceId, count);
          }
          await persistSwState();
        },
      },
    });
  }
  // Critical state must be persisted to browser.storage.session to survive restarts.

  /**
   * Persist critical in-memory state to browser.storage.session (Chrome only).
   * Storage failures reject initialization rather than silently rotating keys.
   */
  async function persistSwState(): Promise<void> {
    if (import.meta.env.FIREFOX) return;
    await saveSwState({
      instanceSessionEncryptionKey,
      instanceAuthFailures: Object.fromEntries(instanceAuthFailures),
    });
  }

  /**
   * Restore critical in-memory state from browser.storage.session (Chrome only).
   * Returns false only when no state was stored.
   */
  async function restoreSwState(): Promise<boolean> {
    if (import.meta.env.FIREFOX) return false;
    const saved = await loadSwState();
    if (!saved) {
      return false;
    }
    if (typeof saved.instanceSessionEncryptionKey !== "string") {
      throw new Error("Invalid persisted service-worker session key");
    }
    if (
      !saved.instanceAuthFailures ||
      typeof saved.instanceAuthFailures !== "object"
    ) {
      throw new Error("Invalid persisted service-worker failure state");
    }

    instanceSessionEncryptionKey = saved.instanceSessionEncryptionKey;
    for (const [id, count] of Object.entries(saved.instanceAuthFailures)) {
      instanceAuthFailures.set(id, count);
    }
    logger.debug("[PiSentinel] Restored SW state from storage.session");
    return true;
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

  async function initialize(): Promise<void> {
    return initializationGate.initialize(doInitialize);
  }

  async function doInitialize(): Promise<void> {
    try {
      logger.info("[PiSentinel] Starting background script initialization");

      // On Chrome, try to restore state from a previous SW lifecycle first.
      // This preserves the encryption key so existing encrypted sessions remain readable.
      const restored = await restoreSwState();
      if (!restored) {
        // Generate ephemeral session encryption key (memory-only on Firefox, persisted on Chrome)
        instanceSessionEncryptionKey = encryption.generateMasterPassword();
        logger.debug("[PiSentinel] Instance session encryption key generated");
        await persistSwState();
      }

      // Migrate legacy storage before any service observes runtime settings.
      logger.info("[PiSentinel] Initializing instance manager");
      await instanceManager.initialize();

      logger.info("[PiSentinel] Initializing notification service");
      await notificationService.initialize();

      logger.info("[PiSentinel] Initializing domain tracker");
      domainTracker.initialize();

      logger.info("[PiSentinel] Attempting to restore instance sessions");
      await instanceRuntime.initialize();
      await browser.alarms.create(ALARMS.SESSION_KEEPALIVE, {
        periodInMinutes: DEFAULTS.SESSION_KEEPALIVE_INTERVAL,
      });
      await startStatsPolling();
      await temporaryAllowService.initialize();

      // Notify any open options pages that initialization is complete
      // so they can refresh instance states (especially connection status)
      await broadcastInstancesUpdated();

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
      logger.error("[PiSentinel] Initialization error:", error);
      throw error;
    }
  }

  // ===== Message Handling =====

  const messageHandlers: CommandHandlerRegistry = {
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
    TEST_CONNECTION: (payload) => handleTestConnection(payload.url),
    HEALTH_CHECK: () => ({
      success: true,
      data: {
        ready: true,
        timestamp: Date.now(),
        version: "0.0.4",
      },
    }),
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
    CHECK_PASSWORD_AVAILABLE: (payload) =>
      handleCheckPasswordAvailable(payload),
    CREATE_TEMPORARY_ALLOWS: (payload) => handleCreateTemporaryAllows(payload),
    GET_TEMPORARY_ALLOWS: () => handleGetTemporaryAllows(),
    REMOVE_TEMPORARY_ALLOWS: (payload) => handleRemoveTemporaryAllows(payload),
  };

  const dispatchCommand = createCommandDispatcher(messageHandlers, () =>
    initializationGate.wait(),
  );

  const receiveRuntimeStorageCommandSignal =
    createRuntimeStorageCommandSignalReceiver({
      storage: browser.storage.local,
      dispatch: dispatchCommand,
      onError: (error) =>
        logger.error("[Background] Runtime storage command failed:", error),
    });

  async function handleMessage(
    message: CommandMessage,
    sender: browser.Runtime.MessageSender,
  ): Promise<MessageResponse<unknown>> {
    if (sender.id !== browser.runtime.id) {
      logger.warn(
        "[Background] Rejected message from unauthorized sender:",
        sender.id,
      );
      return { success: false, error: "Unauthorized" };
    }

    logger.debug("[Background] dispatching command:", message.type);
    return dispatchCommand(message);
  }
  function isCommandMessage(message: unknown): message is CommandMessage {
    return (
      message !== null &&
      typeof message === "object" &&
      "type" in message &&
      typeof message.type === "string" &&
      message.type in messageHandlers
    );
  }

  // ===== Message Handlers =====

  /**
   * Returns the selected multi-instance client. Mutating Pi-hole operations
   * intentionally require a selection instead of falling back to a singleton.
   */
  function getActiveClient(): PiholeApiClient | null {
    const activeId = store.getActiveInstanceId();
    return activeId ? clientRegistry.getClient(activeId) : null;
  }

  async function handleGetStats(): Promise<MessageResponse<StatsSummary>> {
    await instanceRuntime.refreshStats();
    const stats = store.getState().stats;
    return stats
      ? { success: true, data: stats }
      : { success: false, error: "No statistics available" };
  }

  async function handleGetBlockingStatus(): Promise<
    MessageResponse<{ blocking: boolean; timer: number | null }>
  > {
    const activeId = store.getActiveInstanceId();
    if (!activeId) {
      return { success: false, error: "Select an instance first" };
    }

    const result = await instanceRuntime.getBlockingStatus(activeId);
    if (result.ok) {
      return {
        success: true,
        data: {
          blocking: result.status.blocking === "enabled",
          timer: result.status.timer,
        },
      };
    }
    return { success: false, error: result.message };
  }

  async function handleSetBlocking(payload: {
    enabled: boolean;
    timer?: number;
  }): Promise<MessageResponse<{ blocking: boolean; timer: number | null }>> {
    const activeId = store.getActiveInstanceId();
    if (!activeId) {
      return { success: false, error: "Select an instance first" };
    }

    const result = await instanceRuntime.setBlocking(
      activeId,
      payload.enabled,
      payload.timer,
    );
    if (result.ok) {
      const enabled = result.status.blocking === "enabled";
      if (enabled) {
        await notificationService.showBlockingEnabled();
      } else {
        await notificationService.showBlockingDisabled(payload.timer);
      }

      return {
        success: true,
        data: { blocking: enabled, timer: result.status.timer },
      };
    }

    return { success: false, error: result.message };
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
    if (!client) {
      return { success: false, error: "Select an instance first" };
    }
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
    if (!client) {
      return { success: false, error: "Select an instance first" };
    }
    const result = await client.removeDomain(domain, listType, "exact");
    return result.success
      ? { success: true }
      : { success: false, error: result.error?.message };
  }

  async function handleSearchDomain(
    domain: string,
  ): Promise<MessageResponse<FleetResult<DomainSearchEntry>>> {
    return { success: true, data: await fleetQueries.searchDomain(domain) };
  }

  async function handleGetQueries(payload?: {
    length?: number;
    from?: number;
  }): Promise<MessageResponse<FleetResult<FleetQueryEntry>>> {
    return { success: true, data: await fleetQueries.recentQueries(payload) };
  }

  async function handleTestConnection(
    url: string,
  ): Promise<MessageResponse<void>> {
    const result = await new PiholeApiClient({ baseUrl: url }).testConnection();
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
      const instance = await instanceRuntime.add(payload);
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
      const instance = await instanceRuntime.update(payload);
      if (!instance) return { success: false, error: "Instance not found" };

      await instanceRuntime.refreshStats();
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
    try {
      if (!(await instanceRuntime.remove(instanceId))) {
        return { success: false, error: "Instance not found" };
      }
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
      await instanceRuntime.select(instanceId);
      void instanceRuntime
        .refreshStats()
        .catch((error) =>
          logger.error(
            "[Background] Post-selection stats refresh failed:",
            error,
          ),
        );
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

  async function tryAutoConnect(instanceId: string): Promise<void> {
    const result = await instanceRuntime.connect({ instanceId });
    if (!result.ok && !result.totpRequired) {
      logger.debug("[Background] Auto-connect failed:", result.message);
    }
  }

  async function handleConnectInstance(payload: {
    instanceId: string;
    password?: string;
    totp?: string;
  }): Promise<MessageResponse<{ kind: "connected" | "totp-required" }>> {
    const result = await instanceRuntime.connect(payload);
    if (result.ok) return { success: true, data: { kind: "connected" } };
    if (result.totpRequired) {
      return { success: true, data: { kind: "totp-required" } };
    }
    return {
      success: false,
      error:
        result.error ??
        classifyConnectInstanceFailure({ message: result.message }),
    };
  }

  async function handleDisconnectInstance(
    instanceId: string,
  ): Promise<MessageResponse<void>> {
    try {
      await instanceRuntime.disconnect(instanceId);
      return { success: true };
    } catch (error) {
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
  async function waitForInstanceClients(): Promise<void> {
    await initializationGate.wait();
  }

  async function handleCreateTemporaryAllows(
    payload: CreateTemporaryAllowsPayload,
  ): Promise<MessageResponse<CreateTemporaryAllowsResult>> {
    if (
      !Array.isArray(payload?.domains) ||
      (payload.durationSeconds !== null &&
        (!Number.isFinite(payload.durationSeconds) ||
          payload.durationSeconds <= 0)) ||
      (payload.instanceIds !== undefined && !Array.isArray(payload.instanceIds))
    ) {
      return { success: false, error: "Invalid temporary allow request" };
    }
    await waitForInstanceClients();
    return {
      success: true,
      data: await temporaryAllowService.create(
        payload.domains,
        payload.durationSeconds,
        payload.instanceIds,
      ),
    };
  }

  async function handleGetTemporaryAllows(): Promise<
    MessageResponse<TemporaryAllowEntry[]>
  > {
    await waitForInstanceClients();
    return { success: true, data: await temporaryAllowService.list() };
  }

  async function handleRemoveTemporaryAllows(
    payload: RemoveTemporaryAllowsPayload,
  ): Promise<MessageResponse<RemoveTemporaryAllowsResult>> {
    if (!Array.isArray(payload?.entryIds)) {
      return {
        success: false,
        error: "Invalid temporary allow removal request",
      };
    }
    await waitForInstanceClients();
    return {
      success: true,
      data: await temporaryAllowService.remove(payload.entryIds),
    };
  }
  // ===== Stats Polling =====

  async function startStatsPolling(): Promise<void> {
    const { globalSettings } = await instanceManager.getInstances();
    await browser.alarms.create(ALARMS.STATS_REFRESH, {
      periodInMinutes: globalSettings.refreshInterval / 60,
    });
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

      case ALARMS.TEMPORARY_ALLOW_CLEANUP:
        await temporaryAllowService.handleAlarm();
        break;
    }
  }

  async function handleSessionKeepalive(): Promise<void> {
    await instanceRuntime.keepAlive();
  }

  async function handleStatsRefresh(): Promise<void> {
    await instanceRuntime.refreshStats();
  }

  // ===== Event Listeners =====

  // Register message listener at top level (required for event pages)
  logger.debug("[Background] Registering message listener");

  // Use Promise-based pattern (recommended for webextension-polyfill in Firefox MV3)
  // Returning a Promise directly is more reliable than sendResponse callback
  browser.runtime.onMessage.addListener(
    (message: unknown, sender: browser.Runtime.MessageSender) => {
      if (isStorageCommandSignal(message, isCommandMessage)) {
        if (sender.id !== browser.runtime.id) {
          void browser.storage.local
            .set({
              [`pisentinel.command.response.${message.id}`]: {
                id: message.id,
                result: { success: false, error: "Unauthorized" },
              },
            })
            .catch((error) =>
              logger.error(
                "[Background] Unable to reject runtime storage command:",
                error,
              ),
            );
        } else {
          void receiveRuntimeStorageCommandSignal(message);
        }
        return Promise.resolve(undefined);
      }
      if (!isCommandMessage(message)) {
        return Promise.resolve({ success: false, error: "Unknown command" });
      }
      logger.info(
        "[Background] Listener received command:",
        message.type,
        "from:",
        sender.url?.substring(0, 50),
      );

      return handleMessage(message, sender).catch((error) => {
        logger.error("[Background] Error handling command:", error);
        return {
          success: false,
          error:
            error instanceof Error
              ? error.message
              : ERROR_MESSAGES.UNKNOWN_ERROR,
        };
      });
    },
  );
  logger.debug("[Background] Message listener registered");

  // Register alarm listener at top level with error isolation
  // Wrap to prevent alarm errors from crashing the background script
  browser.alarms.onAlarm.addListener(async (alarm) => {
    try {
      await initializationGate.wait();
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

  // Firefox options pages use this storage transport when runtime responses
  // are unavailable. The receiver claims and removes each request before
  // dispatching, so repeated Firefox storage notifications cannot replay it.
  registerStorageCommandReceiver({
    browser,
    dispatch: dispatchCommand,
    isCommand: isCommandMessage,
    onError: (error) =>
      logger.error("[Background] Storage command failed:", error),
  });
  // Initialize on install
  browser.runtime.onStartup.addListener(initialize);

  browser.runtime.onInstalled.addListener(async (details) => {
    logger.info("PiSentinel: Extension installed/updated", details.reason);
    await initialize();
  });

  // Also initialize immediately for development reloads
  initialize().catch(logger.error);
});
