/**
 * List (adlist) types.
 */

export type ListType = "block" | "allow";

export interface List {
  id: number;
  address: string;
  type: ListType;
  enabled: boolean;
  comment: string | null;
  date_added: number;
  date_modified: number;
  number: number;
  invalid_domains: number;
  status: number;
  groups: number[];
}

export interface ListsResponse {
  lists: List[];
  took?: number;
}

export interface ListAddOptions {
  /** List type: block or allow */
  type?: ListType;
  /** Whether the list is enabled */
  enabled?: boolean;
  /** Comment */
  comment?: string;
  /** Groups to assign */
  groups?: number[];
}

export interface ListUpdateOptions {
  /** Update address */
  address?: string;
  /** Update type */
  type?: ListType;
  /** Enable/disable */
  enabled?: boolean;
  /** Update comment */
  comment?: string;
  /** Update groups */
  groups?: number[];
}
