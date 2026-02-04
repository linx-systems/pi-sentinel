/**
 * Client types.
 */

export interface Client {
  id: number;
  client: string;
  name: string | null;
  comment: string | null;
  groups: number[];
  date_added: number;
  date_modified: number;
}

export interface ClientsResponse {
  clients: Client[];
  took?: number;
}

export interface ClientCreateOptions {
  /** Client name */
  name?: string;
  /** Comment */
  comment?: string;
  /** Groups to assign */
  groups?: number[];
}

export interface ClientUpdateOptions {
  /** Update client identifier */
  client?: string;
  /** Update name */
  name?: string;
  /** Update comment */
  comment?: string;
  /** Update groups */
  groups?: number[];
}

export interface ClientSuggestions {
  suggestions: Array<{
    ip: string;
    name?: string;
    hwaddr?: string;
  }>;
  took?: number;
}
