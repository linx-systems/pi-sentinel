import browser from "webextension-polyfill";
import { TIMEOUTS } from "~/utils/constants";
import { commandFailure } from "~/utils/commands/dispatcher";
import {
  hasValidCommandData,
  isRecord,
} from "~/utils/commands/response-validation";
import type {
  DomainSearchEntry,
  FleetQueryEntry,
  FleetResult,
} from "~/background/fleet/queries";
import type {
  AddInstancePayload,
  CheckPasswordAvailablePayload,
  CommandMessage,
  ConnectInstancePayload,
  CreateTemporaryAllowsPayload,
  CreateTemporaryAllowsResult,
  DisconnectInstancePayload,
  RemoveTemporaryAllowsResult,
  DomainPayload,
  GetInstanceStatePayload,
  GetQueriesPayload,
  MessageResponse,
  SerializableTabDomains,
  SetActiveInstancePayload,
  SetBlockingPayload,
  UpdateInstancePayload,
} from "~/utils/messaging";
import {
  classifyConnectInstanceFailure,
  isConnectInstanceFailure,
  type ConnectInstanceFailure,
} from "~/utils/connection-failure";
import type {
  ExtensionState,
  InstanceState,
  PersistedInstances,
  PiHoleInstance,
  StatsSummary,
  TemporaryAllowEntry,
} from "~/utils/types";

export type CommandSuccess<T> = { success: true; data: T };
export type CommandFailure<Failure = string> = {
  success: false;
  error: Failure;
};
export type CommandResult<T, Failure = string> =
  CommandSuccess<T> | CommandFailure<Failure>;

export type ConnectInstanceInput = ConnectInstancePayload;
export type ConnectInstanceData =
  { kind: "connected" } | { kind: "totp-required" };
export type AddInstanceInput = AddInstancePayload;
export type UpdateInstanceInput = UpdateInstancePayload;
export type CreateTemporaryAllowsInput = CreateTemporaryAllowsPayload;

export type SearchDomainData = FleetResult<DomainSearchEntry>;

export type RecentQueriesData = FleetResult<FleetQueryEntry>;

export interface CommandBlockingStatus {
  blocking: boolean;
  timer: number | null;
}

export interface ExtensionCommands {
  getState(): Promise<CommandResult<ExtensionState>>;
  getStats(): Promise<CommandResult<StatsSummary>>;
  getBlockingStatus(): Promise<CommandResult<CommandBlockingStatus>>;
  setBlocking(
    input: SetBlockingPayload,
  ): Promise<CommandResult<CommandBlockingStatus>>;
  getTabDomains(
    tabId: number,
  ): Promise<CommandResult<SerializableTabDomains | null>>;
  addToAllowlist(
    domain: string,
    comment?: string,
  ): Promise<CommandResult<void>>;
  addToDenylist(domain: string, comment?: string): Promise<CommandResult<void>>;
  removeFromAllowlist(domain: string): Promise<CommandResult<void>>;
  removeFromDenylist(domain: string): Promise<CommandResult<void>>;
  searchDomain(domain: string): Promise<CommandResult<SearchDomainData>>;
  getQueries(
    input?: GetQueriesPayload,
  ): Promise<CommandResult<RecentQueriesData>>;
  testConnection(url: string): Promise<CommandResult<void>>;
  getInstances(): Promise<CommandResult<PersistedInstances>>;
  addInstance(input: AddInstanceInput): Promise<CommandResult<PiHoleInstance>>;
  updateInstance(
    input: UpdateInstanceInput,
  ): Promise<CommandResult<PiHoleInstance>>;
  deleteInstance(instanceId: string): Promise<CommandResult<void>>;
  setActiveInstance(instanceId: string | null): Promise<CommandResult<void>>;
  connectInstance(
    input: ConnectInstanceInput,
  ): Promise<CommandResult<ConnectInstanceData, ConnectInstanceFailure>>;
  disconnectInstance(instanceId: string): Promise<CommandResult<void>>;
  getInstanceState(instanceId: string): Promise<CommandResult<InstanceState>>;
  checkPasswordAvailable(
    instanceId: string,
  ): Promise<CommandResult<{ available: boolean }>>;
  createTemporaryAllows(
    input: CreateTemporaryAllowsInput,
  ): Promise<CommandResult<CreateTemporaryAllowsResult>>;
  getTemporaryAllows(): Promise<CommandResult<TemporaryAllowEntry[]>>;
  removeTemporaryAllows(
    entryIds: string[],
  ): Promise<CommandResult<RemoveTemporaryAllowsResult>>;
}

export interface CommandTransport {
  send(message: CommandMessage): Promise<MessageResponse<unknown>>;
}

const INVALID_RESPONSE_ERROR = "Invalid command response. Please try again.";

function connectionFailure(
  error: unknown,
  fallback = INVALID_RESPONSE_ERROR,
): CommandFailure<ConnectInstanceFailure> {
  return {
    success: false,
    error: classifyConnectInstanceFailure({
      message: commandFailure(error, fallback).error,
    }),
  };
}

function normalize<T, Failure = string>(
  command: CommandMessage,
  response: unknown,
): CommandResult<T, Failure> {
  if (isRecord(response) && "success" in response) {
    if (response.success === true) {
      if (hasValidCommandData(command, response.data)) {
        return { success: true, data: response.data as T };
      }
    } else if (response.success === false) {
      if (command.type === "CONNECT_INSTANCE") {
        if (isConnectInstanceFailure(response.error)) {
          return { success: false, error: response.error as Failure };
        }
        if (typeof response.error === "string") {
          return connectionFailure(response.error) as CommandResult<T, Failure>;
        }
      } else {
        return commandFailure(response.error) as CommandResult<T, Failure>;
      }
    }
  }

  if (command.type === "CONNECT_INSTANCE") {
    return connectionFailure(undefined) as CommandResult<T, Failure>;
  }
  return commandFailure(undefined, INVALID_RESPONSE_ERROR) as CommandResult<
    T,
    Failure
  >;
}

function message<Output, Failure = string>(
  transport: CommandTransport,
  command: CommandMessage,
): Promise<CommandResult<Output, Failure>> {
  return transport
    .send(command)
    .then((response) => normalize<Output, Failure>(command, response))
    .catch((error) => {
      if (command.type === "CONNECT_INSTANCE") {
        return connectionFailure(
          undefined,
          "Unable to contact PiSentinel. Please try again.",
        ) as CommandResult<Output, Failure>;
      }
      return commandFailure(
        error,
        "Unable to contact PiSentinel. Please try again.",
      ) as CommandResult<Output, Failure>;
    });
}

export function createExtensionCommands(
  transport: CommandTransport,
): ExtensionCommands {
  const domain = (
    type: "ADD_TO_ALLOWLIST" | "ADD_TO_DENYLIST",
    value: string,
    comment?: string,
  ) =>
    message<void>(transport, {
      type,
      payload: {
        domain: value,
        ...(comment === undefined ? {} : { comment }),
      } satisfies DomainPayload,
    });
  const removeDomain = (
    type: "REMOVE_FROM_ALLOWLIST" | "REMOVE_FROM_DENYLIST",
    domain: string,
  ) => message<void>(transport, { type, payload: { domain } });

  return {
    getState: () => message(transport, { type: "GET_STATE" }),
    getStats: () => message(transport, { type: "GET_STATS" }),
    getBlockingStatus: () =>
      message(transport, { type: "GET_BLOCKING_STATUS" }),
    setBlocking: (payload) =>
      message(transport, { type: "SET_BLOCKING", payload }),
    getTabDomains: (tabId) =>
      message(transport, { type: "GET_TAB_DOMAINS", payload: { tabId } }),
    addToAllowlist: (domainName, comment) =>
      domain("ADD_TO_ALLOWLIST", domainName, comment),
    addToDenylist: (domainName, comment) =>
      domain("ADD_TO_DENYLIST", domainName, comment),
    removeFromAllowlist: (domainName) =>
      removeDomain("REMOVE_FROM_ALLOWLIST", domainName),
    removeFromDenylist: (domainName) =>
      removeDomain("REMOVE_FROM_DENYLIST", domainName),
    searchDomain: (domainName) =>
      message(transport, {
        type: "SEARCH_DOMAIN",
        payload: { domain: domainName },
      }),
    getQueries: (payload) =>
      message(
        transport,
        payload ? { type: "GET_QUERIES", payload } : { type: "GET_QUERIES" },
      ),
    testConnection: (url) =>
      message(transport, { type: "TEST_CONNECTION", payload: { url } }),
    getInstances: () => message(transport, { type: "GET_INSTANCES" }),
    addInstance: (payload) =>
      message(transport, { type: "ADD_INSTANCE", payload }),
    updateInstance: (payload) =>
      message(transport, { type: "UPDATE_INSTANCE", payload }),
    deleteInstance: (instanceId) =>
      message(transport, { type: "DELETE_INSTANCE", payload: { instanceId } }),
    setActiveInstance: (instanceId) =>
      message<void>(transport, {
        type: "SET_ACTIVE_INSTANCE",
        payload: { instanceId } satisfies SetActiveInstancePayload,
      }),
    connectInstance: (payload) =>
      message<ConnectInstanceData, ConnectInstanceFailure>(transport, {
        type: "CONNECT_INSTANCE",
        payload,
      }),
    disconnectInstance: (instanceId) =>
      message<void>(transport, {
        type: "DISCONNECT_INSTANCE",
        payload: { instanceId } satisfies DisconnectInstancePayload,
      }),
    getInstanceState: (instanceId) =>
      message(transport, {
        type: "GET_INSTANCE_STATE",
        payload: { instanceId } satisfies GetInstanceStatePayload,
      }),
    checkPasswordAvailable: (instanceId) =>
      message(transport, {
        type: "CHECK_PASSWORD_AVAILABLE",
        payload: { instanceId } satisfies CheckPasswordAvailablePayload,
      }),
    createTemporaryAllows: (payload) =>
      message(transport, { type: "CREATE_TEMPORARY_ALLOWS", payload }),
    getTemporaryAllows: () =>
      message(transport, { type: "GET_TEMPORARY_ALLOWS" }),
    removeTemporaryAllows: (entryIds) =>
      message(transport, {
        type: "REMOVE_TEMPORARY_ALLOWS",
        payload: { entryIds },
      }),
  };
}

export interface RuntimeCommandBrowser {
  runtime: Pick<typeof browser.runtime, "sendMessage">;
}

export function createRuntimeExtensionCommands(
  runtimeBrowser: RuntimeCommandBrowser = browser,
): ExtensionCommands {
  return createExtensionCommands({
    send: (command) =>
      runtimeBrowser.runtime.sendMessage(command) as Promise<
        MessageResponse<unknown>
      >,
  });
}

export const STORAGE_COMMAND_REQUEST_PREFIX = "pisentinel.command.request.";
export const STORAGE_COMMAND_RESPONSE_PREFIX = "pisentinel.command.response.";
export const STORAGE_COMMAND_SIGNAL_TYPE = "PISENTINEL_STORAGE_COMMAND_SIGNAL";

export interface StorageCommandSignal {
  type: typeof STORAGE_COMMAND_SIGNAL_TYPE;
  id: string;
  command: CommandMessage;
}

export interface StorageArea {
  set(values: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
}

export interface StorageCommandBrowser {
  runtime?: Pick<typeof browser.runtime, "sendMessage">;
  storage: {
    local: StorageArea;
    session?: StorageArea;
    onChanged: {
      addListener(listener: StorageChangeListener): void;
      removeListener(listener: StorageChangeListener): void;
    };
  };
}

export type StorageChangeListener = (
  changes: Record<string, { newValue?: unknown }>,
  areaName: string,
) => void;

export interface StorageCommandOptions {
  browser?: StorageCommandBrowser;
  timeoutMs?: number;
  connectTimeoutMs?: number;
  onError?(error: unknown): void;
}

export function isStorageCommandSignal(
  value: unknown,
  isCommand: (command: unknown) => command is CommandMessage,
): value is StorageCommandSignal {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  const signal = value as { type?: unknown; id?: unknown; command?: unknown };
  return (
    signal.type === STORAGE_COMMAND_SIGNAL_TYPE &&
    typeof signal.id === "string" &&
    isCommand(signal.command)
  );
}

export interface RuntimeStorageCommandSignalReceiverOptions {
  storage: StorageArea;
  dispatch(
    command: CommandMessage,
  ): Promise<MessageResponse<unknown>> | MessageResponse<unknown>;
  onError?(error: unknown): void;
}

export function createRuntimeStorageCommandSignalReceiver({
  storage,
  dispatch,
  onError = () => {},
}: RuntimeStorageCommandSignalReceiverOptions): (
  signal: StorageCommandSignal,
) => Promise<void> {
  const received = new Map<string, Promise<void>>();
  return (signal) => {
    const existing = received.get(signal.id);
    if (existing) return existing;

    const process = (async () => {
      let result: MessageResponse<unknown>;
      try {
        result = await dispatch(signal.command);
      } catch (error) {
        result = commandFailure(
          error,
          "Unable to process command. Please try again.",
        );
      }

      try {
        await storage.set({
          [`${STORAGE_COMMAND_RESPONSE_PREFIX}${signal.id}`]: {
            id: signal.id,
            result,
          },
        });
      } catch (error) {
        try {
          onError(error);
        } catch {
          // Reporting must not create an unhandled rejection in the background.
        }
      }
    })();
    received.set(signal.id, process);
    return process;
  };
}

export interface StorageCommandReceiverOptions {
  browser: StorageCommandBrowser;
  dispatch(
    command: CommandMessage,
  ): Promise<MessageResponse<unknown>> | MessageResponse<unknown>;
  isCommand(value: unknown): value is CommandMessage;
  onError?(error: unknown): void;
}

export function registerStorageCommandReceiver({
  browser: storageBrowser,
  dispatch,
  isCommand,
  onError = () => {},
}: StorageCommandReceiverOptions): () => void {
  const claimedIds = new Set<string>();
  let queue = Promise.resolve();
  const listener: StorageChangeListener = (changes, areaName) => {
    if (areaName !== "session") return;
    const storage = storageBrowser.storage.session;
    if (!storage) return;

    for (const [requestKey, change] of Object.entries(changes)) {
      const request = change.newValue as
        { id?: unknown; message?: unknown } | undefined;
      if (
        !requestKey.startsWith(STORAGE_COMMAND_REQUEST_PREFIX) ||
        typeof request?.id !== "string" ||
        requestKey !== `${STORAGE_COMMAND_REQUEST_PREFIX}${request.id}` ||
        !isCommand(request.message) ||
        claimedIds.has(request.id)
      ) {
        continue;
      }

      const { id, message } = request as {
        id: string;
        message: CommandMessage;
      };
      claimedIds.add(id);
      const responseKey = `${STORAGE_COMMAND_RESPONSE_PREFIX}${id}`;
      const removeRequest = storage.remove(requestKey).then(
        () => ({ removed: true as const }),
        (error) => ({ removed: false as const, error }),
      );
      const process = async () => {
        try {
          const requestRemoval = await removeRequest;
          if (!requestRemoval.removed) {
            onError(requestRemoval.error);
            throw requestRemoval.error;
          }
          const result = await dispatch(message);
          await storage.set({ [responseKey]: { id, result } });
        } catch (error) {
          try {
            await storage.set({
              [responseKey]: {
                id,
                result: commandFailure(
                  error,
                  "Unable to process command. Please try again.",
                ),
              },
            });
          } catch (responseError) {
            onError(responseError);
          }
        } finally {
          claimedIds.delete(id);
          try {
            await storage.remove([requestKey, responseKey]);
          } catch (cleanupError) {
            onError(cleanupError);
          }
        }
      };
      queue = queue.then(process, process);
      void queue.catch(onError);
    }
  };
  storageBrowser.storage.onChanged.addListener(listener);
  return () => storageBrowser.storage.onChanged.removeListener(listener);
}

function requestId(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
}

function isTimeout(result: CommandResult<unknown, unknown>): boolean {
  return (
    !result.success &&
    (result.error === "Command timeout" ||
      (isConnectInstanceFailure(result.error) &&
        result.error.message === "Command timeout"))
  );
}

const INDETERMINATE_TIMEOUT_ERROR = "Command timeout; outcome is indeterminate";

function reconciliationRead(
  command: CommandMessage,
): CommandMessage | undefined {
  switch (command.type) {
    case "SET_BLOCKING":
      return { type: "GET_BLOCKING_STATUS" };
    case "ADD_TO_ALLOWLIST":
    case "ADD_TO_DENYLIST":
    case "REMOVE_FROM_ALLOWLIST":
    case "REMOVE_FROM_DENYLIST":
      return {
        type: "SEARCH_DOMAIN",
        payload: { domain: command.payload.domain },
      };
    case "ADD_INSTANCE":
    case "UPDATE_INSTANCE":
    case "DELETE_INSTANCE":
    case "SET_ACTIVE_INSTANCE":
      return { type: "GET_INSTANCES" };
    case "CONNECT_INSTANCE":
    case "DISCONNECT_INSTANCE":
      return {
        type: "GET_INSTANCE_STATE",
        payload: { instanceId: command.payload.instanceId },
      };
    case "CREATE_TEMPORARY_ALLOWS":
    case "REMOVE_TEMPORARY_ALLOWS":
      return { type: "GET_TEMPORARY_ALLOWS" };
    default:
      return undefined;
  }
}

function indeterminateTimeout(): CommandFailure {
  return { success: false, error: INDETERMINATE_TIMEOUT_ERROR };
}

async function reconcileTimeout(
  command: CommandMessage,
  transport: CommandTransport,
): Promise<CommandResult<unknown>> {
  const read = reconciliationRead(command);
  if (!read) return indeterminateTimeout();

  const observed = normalize<unknown>(read, await transport.send(read));
  if (!observed.success) return indeterminateTimeout();

  if (command.type === "CONNECT_INSTANCE") {
    const state = observed.data as InstanceState;
    if (state.isConnected)
      return { success: true, data: { kind: "connected" } };
    if (state.totpRequired)
      return { success: true, data: { kind: "totp-required" } };
    return indeterminateTimeout();
  }

  if (
    command.type === "SET_ACTIVE_INSTANCE" &&
    (observed.data as PersistedInstances).activeInstanceId ===
      command.payload.instanceId
  ) {
    return { success: true, data: undefined };
  }

  if (
    command.type === "DISCONNECT_INSTANCE" &&
    !(observed.data as InstanceState).isConnected
  ) {
    return { success: true, data: undefined };
  }

  return indeterminateTimeout();
}

export function createStorageExtensionCommands({
  browser: storageBrowser = browser,
  timeoutMs = TIMEOUTS.MESSAGE,
  connectTimeoutMs = TIMEOUTS.CONNECTION_ATTEMPT,
  onError = () => {},
}: StorageCommandOptions = {}): ExtensionCommands {
  const usesSession = storageBrowser.storage.session !== undefined;
  const storage =
    storageBrowser.storage.session ?? storageBrowser.storage.local;
  const areaName = usesSession ? "session" : "local";
  const reportError = (error: unknown) => {
    try {
      onError(error);
    } catch {
      // Reporting must not prevent the caller from receiving its known outcome.
    }
  };
  const send = async (
    command: CommandMessage,
  ): Promise<MessageResponse<unknown>> => {
    const id = requestId();
    const requestKey = `${STORAGE_COMMAND_REQUEST_PREFIX}${id}`;
    const responseKey = `${STORAGE_COMMAND_RESPONSE_PREFIX}${id}`;
    let resolve!: (result: MessageResponse<unknown>) => void;
    const promise = new Promise<MessageResponse<unknown>>((settlePromise) => {
      resolve = settlePromise;
    });
    let settled = false;
    const cleanup = async () => {
      clearTimeout(timeout);
      storageBrowser.storage.onChanged.removeListener(listener);
      const keys = usesSession ? [requestKey, responseKey] : [responseKey];
      try {
        await storage.remove(keys);
      } catch (error) {
        reportError(error);
        try {
          await storage.remove(keys);
        } catch (retryError) {
          reportError(retryError);
        }
      }
    };
    const settle = (result: MessageResponse<unknown>) => {
      if (settled) return;
      settled = true;
      void cleanup().then(() => resolve(result));
    };
    const listener: StorageChangeListener = (changes, changedArea) => {
      if (changedArea !== areaName) return;
      const envelope = changes[responseKey]?.newValue;
      if (!isRecord(envelope) || envelope.id !== id) return;
      settle(normalize(command, envelope.result));
    };

    storageBrowser.storage.onChanged.addListener(listener);
    const timeout = setTimeout(
      () => settle({ success: false, error: "Command timeout" }),
      command.type === "CONNECT_INSTANCE" ? connectTimeoutMs : timeoutMs,
    ) as unknown as number;
    try {
      if (usesSession) {
        await storage.set({ [requestKey]: { id, message: command } });
      } else if (storageBrowser.runtime) {
        await storageBrowser.runtime.sendMessage({
          type: STORAGE_COMMAND_SIGNAL_TYPE,
          id,
          command,
        } satisfies StorageCommandSignal);
      } else {
        throw new Error("Runtime command transport is unavailable.");
      }
    } catch (error) {
      settle(
        commandFailure(error, "Unable to send command. Please try again."),
      );
    }
    return promise;
  };
  const rawTransport: CommandTransport = { send };
  return createExtensionCommands({
    send: async (command) => {
      const result = normalize<unknown>(
        command,
        await rawTransport.send(command),
      );
      return isTimeout(result)
        ? reconcileTimeout(command, rawTransport)
        : result;
    },
  });
}
