// API-specific types that extend shared types

import type {
  AuthResponse,
  StatsSummary,
  BlockingStatus,
  QueryEntry,
  DomainEntry,
  ApiError,
} from '../../shared/types';

export interface ApiConfig {
  baseUrl: string;
  timeout: number;
}

export interface ApiResult<T> {
  success: boolean;
  data?: T;
  error?: {
    key: string;
    message: string;
    hint?: string;
    status: number;
  };
}

// Re-export for convenience
export type {
  AuthResponse,
  StatsSummary,
  BlockingStatus,
  QueryEntry,
  DomainEntry,
  ApiError,
};

// Domain list types
export type DomainListType = 'allow' | 'deny';
export type DomainMatchType = 'exact' | 'regex';

// Query params
export interface QueryParams {
  length?: number;
  from?: number;
  until?: number;
  client?: string;
  domain?: string;
  type?: string;
  status?: string;
}

// Search result
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
}

// Config patch for settings
export interface ConfigPatch {
  dns?: {
    queryLogging?: boolean;
  };
  misc?: {
    privacylevel?: number; // 0-3
  };
}
