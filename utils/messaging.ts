import type {
  AggregatedState,
  BlockingStatus,
  ExtensionState,
  InstanceState,
  PersistedInstances,
  PiHoleInstance,
  QueryEntry,
  StatsSummary,
  TabDomainData,
} from "./types";
import { TIMEOUTS } from "./constants";
import { ErrorHandler, ErrorType } from "./error-handler";

// Message Types
export type MessageType =
  | "AUTHENTICATE"
  | "LOGOUT"
  | "GET_STATE"
  | "GET_STATS"
  | "GET_BLOCKING_STATUS"
  | "SET_BLOCKING"
  | "GET_TAB_DOMAINS"
  | "ADD_TO_ALLOWLIST"
  | "ADD_TO_DENYLIST"
  | "REMOVE_FROM_ALLOWLIST"
  | "REMOVE_FROM_DENYLIST"
  | "SEARCH_DOMAIN"
  | "GET_QUERIES"
  | "SAVE_CONFIG"
  | "TEST_CONNECTION"
  | "HEALTH_CHECK"
  | "STATE_UPDATED"
  | "TAB_DOMAINS_UPDATED"
  | "INSTANCES_UPDATED"
  // Multi-instance message types
  | "GET_INSTANCES"
  | "ADD_INSTANCE"
  | "UPDATE_INSTANCE"
  | "DELETE_INSTANCE"
  | "SET_ACTIVE_INSTANCE"
  | "CONNECT_INSTANCE"
  | "DISCONNECT_INSTANCE"
  | "GET_INSTANCE_STATE"
  | "GET_AGGREGATED_STATE";

// Message Payloads
export interface AuthenticatePayload {
  password: string;
  totp?: string;
}

export interface SetBlockingPayload {
  enabled: boolean;
  timer?: number;
}

export interface DomainPayload {
  domain: string;
  comment?: string;
}

export interface GetQueriesPayload {
  length?: number;
  from?: number;
}

export interface SaveConfigPayload {
  piholeUrl: string;
  password: string;
  notificationsEnabled?: boolean;
  refreshInterval?: number;
  rememberPassword?: boolean;
}

export interface TestConnectionPayload {
  url: string;
}

// Multi-instance Payloads
export interface AddInstancePayload {
  name: string | null;
  piholeUrl: string;
  password: string;
  rememberPassword: boolean;
}

export interface UpdateInstancePayload {
  instanceId: string;
  name?: string | null;
  piholeUrl?: string;
  password?: string;
  rememberPassword?: boolean;
}

export interface DeleteInstancePayload {
  instanceId: string;
}

export interface SetActiveInstancePayload {
  /** Instance ID to set as active, or null for "All" mode */
  instanceId: string | null;
}

export interface ConnectInstancePayload {
  instanceId: string;
  password: string;
  totp?: string;
}

export interface DisconnectInstancePayload {
  instanceId: string;
}

export interface GetInstanceStatePayload {
  instanceId: string;
}

// Response Types
export interface MessageResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

// Message Definitions
export type Message =
  | { type: "AUTHENTICATE"; payload: AuthenticatePayload }
  | { type: "LOGOUT" }
  | { type: "GET_STATE" }
  | { type: "GET_STATS" }
  | { type: "GET_BLOCKING_STATUS" }
  | { type: "SET_BLOCKING"; payload: SetBlockingPayload }
  | { type: "GET_TAB_DOMAINS"; payload: { tabId: number } }
  | { type: "ADD_TO_ALLOWLIST"; payload: DomainPayload }
  | { type: "ADD_TO_DENYLIST"; payload: DomainPayload }
  | { type: "REMOVE_FROM_ALLOWLIST"; payload: DomainPayload }
  | { type: "REMOVE_FROM_DENYLIST"; payload: DomainPayload }
  | { type: "SEARCH_DOMAIN"; payload: { domain: string } }
  | { type: "GET_QUERIES"; payload?: GetQueriesPayload }
  | { type: "SAVE_CONFIG"; payload: SaveConfigPayload }
  | { type: "TEST_CONNECTION"; payload: TestConnectionPayload }
  | { type: "HEALTH_CHECK" }
  | { type: "STATE_UPDATED"; payload: Partial<ExtensionState> }
  | { type: "TAB_DOMAINS_UPDATED"; payload: SerializableTabDomains }
  | { type: "INSTANCES_UPDATED" }
  // Multi-instance messages
  | { type: "GET_INSTANCES" }
  | { type: "ADD_INSTANCE"; payload: AddInstancePayload }
  | { type: "UPDATE_INSTANCE"; payload: UpdateInstancePayload }
  | { type: "DELETE_INSTANCE"; payload: DeleteInstancePayload }
  | { type: "SET_ACTIVE_INSTANCE"; payload: SetActiveInstancePayload }
  | { type: "CONNECT_INSTANCE"; payload: ConnectInstancePayload }
  | { type: "DISCONNECT_INSTANCE"; payload: DisconnectInstancePayload }
  | { type: "GET_INSTANCE_STATE"; payload: GetInstanceStatePayload }
  | { type: "GET_AGGREGATED_STATE" };

// Serializable version of TabDomainData for messaging
export interface SerializableTabDomains {
  tabId: number;
  pageUrl: string;
  firstPartyDomain: string;
  domains: string[];
  thirdPartyDomains: string[];
}

/**
 * Type-safe message sender with timeout handling
 * @param message - The message to send
 * @param timeoutMs - Timeout in milliseconds (default: 10000ms)
 * @returns Promise resolving to message response or error
 */
export async function sendMessage<T>(
  message: Message,
  timeoutMs = TIMEOUTS.MESSAGE,
): Promise<MessageResponse<T>> {
  const browser = (await import("webextension-polyfill")).default;

  try {
    // Race between message send and timeout
    const response = await Promise.race<MessageResponse<T>>([
      browser.runtime.sendMessage(message) as Promise<MessageResponse<T>>,
      new Promise<MessageResponse<T>>((_, reject) =>
        setTimeout(
          () =>
            reject(
              new Error(
                `Message timeout: ${message.type} exceeded ${timeoutMs}ms`,
              ),
            ),
          timeoutMs,
        ),
      ),
    ]);

    return response;
  } catch (error) {
    // Handle timeout or message sending errors
    const appError = ErrorHandler.handle(
      error,
      `sendMessage(${message.type})`,
      ErrorType.INTERNAL,
    );

    return {
      success: false,
      error: appError.message,
    };
  }
}

// Response Types for each message
export type AuthenticateResponse = MessageResponse<{ totpRequired?: boolean }>;
export type GetStateResponse = MessageResponse<ExtensionState>;
export type GetStatsResponse = MessageResponse<StatsSummary>;
export type GetBlockingStatusResponse = MessageResponse<BlockingStatus>;
export type SetBlockingResponse = MessageResponse<BlockingStatus>;
export type GetTabDomainsResponse = MessageResponse<TabDomainData>;
export type GetQueriesResponse = MessageResponse<QueryEntry[]>;
export type DomainActionResponse = MessageResponse<void>;
export type SearchDomainResponse = MessageResponse<{
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
}>;

// Multi-instance Response Types
export type GetInstancesResponse = MessageResponse<PersistedInstances>;
export type AddInstanceResponse = MessageResponse<PiHoleInstance>;
export type UpdateInstanceResponse = MessageResponse<PiHoleInstance>;
export type DeleteInstanceResponse = MessageResponse<void>;
export type SetActiveInstanceResponse = MessageResponse<void>;
export type ConnectInstanceResponse = MessageResponse<{
  totpRequired?: boolean;
}>;
export type DisconnectInstanceResponse = MessageResponse<void>;
export type GetInstanceStateResponse = MessageResponse<InstanceState>;
export type GetAggregatedStateResponse = MessageResponse<AggregatedState>;
