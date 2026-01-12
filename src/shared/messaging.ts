import type {
  ExtensionState,
  StatsSummary,
  BlockingStatus,
  QueryEntry,
  TabDomainData,
} from './types';

// Message Types
export type MessageType =
  | 'AUTHENTICATE'
  | 'LOGOUT'
  | 'GET_STATE'
  | 'GET_STATS'
  | 'GET_BLOCKING_STATUS'
  | 'SET_BLOCKING'
  | 'GET_TAB_DOMAINS'
  | 'ADD_TO_ALLOWLIST'
  | 'ADD_TO_DENYLIST'
  | 'REMOVE_FROM_ALLOWLIST'
  | 'REMOVE_FROM_DENYLIST'
  | 'SEARCH_DOMAIN'
  | 'GET_QUERIES'
  | 'SAVE_CONFIG'
  | 'TEST_CONNECTION'
  | 'STATE_UPDATED';

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

// Response Types
export interface MessageResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

// Message Definitions
export type Message =
  | { type: 'AUTHENTICATE'; payload: AuthenticatePayload }
  | { type: 'LOGOUT' }
  | { type: 'GET_STATE' }
  | { type: 'GET_STATS' }
  | { type: 'GET_BLOCKING_STATUS' }
  | { type: 'SET_BLOCKING'; payload: SetBlockingPayload }
  | { type: 'GET_TAB_DOMAINS'; payload: { tabId: number } }
  | { type: 'ADD_TO_ALLOWLIST'; payload: DomainPayload }
  | { type: 'ADD_TO_DENYLIST'; payload: DomainPayload }
  | { type: 'REMOVE_FROM_ALLOWLIST'; payload: DomainPayload }
  | { type: 'REMOVE_FROM_DENYLIST'; payload: DomainPayload }
  | { type: 'SEARCH_DOMAIN'; payload: { domain: string } }
  | { type: 'GET_QUERIES'; payload?: GetQueriesPayload }
  | { type: 'SAVE_CONFIG'; payload: SaveConfigPayload }
  | { type: 'TEST_CONNECTION'; payload: TestConnectionPayload }
  | { type: 'STATE_UPDATED'; payload: Partial<ExtensionState> };

// Type-safe message sender
export async function sendMessage<T>(message: Message): Promise<MessageResponse<T>> {
  const browser = (await import('webextension-polyfill')).default;
  return browser.runtime.sendMessage(message);
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
}>;
