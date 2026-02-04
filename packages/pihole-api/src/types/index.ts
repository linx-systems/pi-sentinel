/**
 * Export all types.
 */

export * from "./common.js";
export * from "./auth.js";
export * from "./stats.js";
export * from "./queries.js";
export * from "./domains.js";
export * from "./groups.js";
export * from "./clients.js";
export * from "./lists.js";
export * from "./dhcp.js";
export * from "./config.js";
export * from "./info.js";
export * from "./network.js";
export * from "./dns.js";

// Additional types for teleporter
export interface TeleporterExport {
  data: ArrayBuffer;
  filename: string;
}

export interface TeleporterImportOptions {
  /** Overwrite existing data */
  overwrite?: boolean;
}

// Logs
export interface LogsResponse {
  log: string[];
  took?: number;
}

export interface LogsOptions {
  /** Number of lines to return */
  lines?: number;
}

// Actions
export interface ActionResponse {
  success: boolean;
  message?: string;
  took?: number;
}

// Endpoints list
export interface EndpointInfo {
  method: string;
  path: string;
  description: string;
}

export interface EndpointsResponse {
  endpoints: EndpointInfo[];
  took?: number;
}
