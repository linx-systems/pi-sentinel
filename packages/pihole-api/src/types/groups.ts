/**
 * Group types.
 */

export interface Group {
  id: number;
  name: string;
  enabled: boolean;
  description: string | null;
  date_added: number;
  date_modified: number;
}

export interface GroupsResponse {
  groups: Group[];
  took?: number;
}

export interface GroupCreateOptions {
  /** Whether the group is enabled */
  enabled?: boolean;
  /** Group description */
  description?: string;
}

export interface GroupUpdateOptions {
  /** New name */
  name?: string;
  /** Enable/disable */
  enabled?: boolean;
  /** Update description */
  description?: string;
}
