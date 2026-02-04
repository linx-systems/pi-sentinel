/**
 * Teleporter endpoints.
 */

import type { PiholeError } from "../errors.js";
import type { HttpClient } from "../http.js";
import type { Result } from "../result.js";
import type {
  TeleporterExport,
  TeleporterImportOptions,
} from "../types/index.js";

/**
 * Teleporter endpoint methods.
 */
export class TeleporterEndpoints {
  constructor(
    private http: HttpClient,
    private getAuthHeaders: () => Record<string, string> | undefined,
  ) {}

  /**
   * Export Pi-hole configuration (teleporter backup).
   * Returns the backup as binary data.
   */
  async export(): Promise<Result<TeleporterExport, PiholeError>> {
    // This endpoint returns a binary file, so we need special handling
    const baseUrl = this.http.getBaseUrl();
    const authHeaders = this.getAuthHeaders();

    try {
      const response = await fetch(`${baseUrl}/api/teleporter`, {
        method: "GET",
        headers: {
          ...authHeaders,
        },
      });

      if (!response.ok) {
        return {
          ok: false,
          error: {
            code: "unknown" as any,
            message: `HTTP ${response.status}`,
            status: response.status,
          },
        };
      }

      const data = await response.arrayBuffer();
      const contentDisposition = response.headers.get("Content-Disposition");
      const filename =
        contentDisposition?.match(/filename="?([^"]+)"?/)?.[1] ??
        `pihole-teleporter-${Date.now()}.tar.gz`;

      return {
        ok: true,
        data: { data, filename },
      };
    } catch (error) {
      return {
        ok: false,
        error: {
          code: "network_error" as any,
          message: error instanceof Error ? error.message : "Unknown error",
          status: 0,
        },
      };
    }
  }

  /**
   * Import Pi-hole configuration (teleporter restore).
   * @param data Backup data as ArrayBuffer
   * @param options Import options
   */
  async import(
    data: ArrayBuffer,
    options?: TeleporterImportOptions,
  ): Promise<Result<void, PiholeError>> {
    // This endpoint expects multipart/form-data
    const baseUrl = this.http.getBaseUrl();
    const authHeaders = this.getAuthHeaders();

    try {
      const formData = new FormData();
      formData.append("file", new Blob([data]), "backup.tar.gz");
      if (options?.overwrite) {
        formData.append("overwrite", "true");
      }

      const response = await fetch(`${baseUrl}/api/teleporter`, {
        method: "POST",
        headers: {
          ...authHeaders,
          // Don't set Content-Type - browser will set it with boundary
        },
        body: formData,
      });

      if (!response.ok) {
        let errorMessage = `HTTP ${response.status}`;
        try {
          const errorData = (await response.json()) as {
            error?: { message?: string };
          };
          if (errorData.error?.message) {
            errorMessage = errorData.error.message;
          }
        } catch {
          // Ignore parse errors
        }

        return {
          ok: false,
          error: {
            code: "unknown" as any,
            message: errorMessage,
            status: response.status,
          },
        };
      }

      return { ok: true, data: undefined };
    } catch (error) {
      return {
        ok: false,
        error: {
          code: "network_error" as any,
          message: error instanceof Error ? error.message : "Unknown error",
          status: 0,
        },
      };
    }
  }
}
