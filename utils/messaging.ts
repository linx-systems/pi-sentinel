import type { ExtensionState, TemporaryAllowEntry } from "./types";
import type { ConnectInstanceFailure } from "./connection-failure";

// Message Types

// Message Payloads

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
  password?: string;
  totp?: string;
}

export interface DisconnectInstancePayload {
  instanceId: string;
}

export interface GetInstanceStatePayload {
  instanceId: string;
}

export interface CheckPasswordAvailablePayload {
  instanceId: string;
}

export interface CreateTemporaryAllowsPayload {
  domains: string[];
  /** Null grants access for the current browser session. */
  durationSeconds: number | null;
  /** Omitted targets the active instance, or every configured instance in All mode. */
  instanceIds?: string[];
}

export interface RemoveTemporaryAllowsPayload {
  entryIds: string[];
}

export interface TemporaryAllowFailure {
  domain: string;
  instanceId: string;
  instanceName: string;
  error: string;
}

export interface TemporaryAllowRemovalFailure extends TemporaryAllowFailure {
  entryId: string;
}

export interface CreateTemporaryAllowsResult {
  entries: TemporaryAllowEntry[];
  skippedDomains: string[];
  failures: TemporaryAllowFailure[];
}

export interface RemoveTemporaryAllowsResult {
  removedIds: string[];
  failures: TemporaryAllowRemovalFailure[];
}

export interface MessageResponse<
  T = unknown,
  Failure = string | ConnectInstanceFailure,
> {
  success: boolean;
  data?: T;
  error?: Failure;
}

// Message Definitions
export type CommandMessage =
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
  | { type: "TEST_CONNECTION"; payload: TestConnectionPayload }
  | { type: "HEALTH_CHECK" }
  | { type: "GET_INSTANCES" }
  | { type: "ADD_INSTANCE"; payload: AddInstancePayload }
  | { type: "UPDATE_INSTANCE"; payload: UpdateInstancePayload }
  | { type: "DELETE_INSTANCE"; payload: DeleteInstancePayload }
  | { type: "SET_ACTIVE_INSTANCE"; payload: SetActiveInstancePayload }
  | { type: "CONNECT_INSTANCE"; payload: ConnectInstancePayload }
  | { type: "DISCONNECT_INSTANCE"; payload: DisconnectInstancePayload }
  | { type: "GET_INSTANCE_STATE"; payload: GetInstanceStatePayload }
  | {
      type: "CHECK_PASSWORD_AVAILABLE";
      payload: CheckPasswordAvailablePayload;
    }
  | {
      type: "CREATE_TEMPORARY_ALLOWS";
      payload: CreateTemporaryAllowsPayload;
    }
  | { type: "GET_TEMPORARY_ALLOWS" }
  | {
      type: "REMOVE_TEMPORARY_ALLOWS";
      payload: RemoveTemporaryAllowsPayload;
    };

export type BroadcastMessage =
  | { type: "STATE_UPDATED"; payload: Partial<ExtensionState> }
  | { type: "TAB_DOMAINS_UPDATED"; payload: SerializableTabDomains }
  | { type: "INSTANCES_UPDATED" }
  | { type: "TEMPORARY_ALLOWS_UPDATED"; payload: TemporaryAllowEntry[] };

export type Message = CommandMessage | BroadcastMessage;
export type MessageType = Message["type"];

// Serializable version of TabDomainData for messaging
export interface SerializableTabDomains {
  tabId: number;
  pageUrl: string;
  firstPartyDomain: string;
  domains: string[];
  thirdPartyDomains: string[];
}
