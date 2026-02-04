/**
 * Common types shared across endpoints.
 */

/** Domain type: allow or deny */
export type DomainType = "allow" | "deny";

/** Domain kind: exact match or regex */
export type DomainKind = "exact" | "regex";

/** Batch delete item */
export interface BatchDeleteItem {
  item: string;
}

/** Generic paginated response */
export interface PaginatedResponse<T> {
  data: T[];
  cursor?: string;
  total?: number;
}

/** Processing took time info */
export interface ProcessingTime {
  took: number;
}

/** Generic API response wrapper */
export interface ApiResponseWrapper<T> {
  data?: T;
  took?: number;
}
