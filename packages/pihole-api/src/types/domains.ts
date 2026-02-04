/**
 * Domain management types.
 */

import type { DomainKind, DomainType } from "./common.js";

export interface DomainEntry {
  id: number;
  domain: string;
  type: number;
  enabled: boolean;
  comment: string | null;
  date_added: number;
  date_modified: number;
  groups?: number[];
}

export interface DomainsResponse {
  domains: DomainEntry[];
  took?: number;
}

export interface DomainAddOptions {
  /** Comment for the domain */
  comment?: string;
  /** Whether the domain is enabled */
  enabled?: boolean;
  /** Groups to assign the domain to */
  groups?: number[];
}

export interface DomainUpdateOptions {
  /** New comment */
  comment?: string;
  /** Enable/disable the domain */
  enabled?: boolean;
  /** Update groups */
  groups?: number[];
}

export interface SearchResult {
  gravity: {
    count: number;
    results: Array<{
      domain: string;
      group: string;
    }>;
  };
  domains: {
    allow: DomainEntry[];
    deny: DomainEntry[];
  };
  took?: number;
}

export interface DomainBatchDeleteItem {
  domain: string;
  type: DomainType;
  kind: DomainKind;
}
