/**
 * System info endpoints.
 */

import type { PiholeError } from "../errors.js";
import type { HttpClient } from "../http.js";
import type { Result } from "../result.js";
import type {
  ClientInfo,
  DatabaseInfo,
  FtlInfo,
  HostInfo,
  LoginInfo,
  Message,
  MessageCountResponse,
  MessagesResponse,
  MetricsInfo,
  SensorsInfo,
  SystemInfo,
  VersionInfo,
} from "../types/info.js";

/**
 * System info endpoint methods.
 */
export class InfoEndpoints {
  constructor(
    private http: HttpClient,
    private getAuthHeaders: () => Record<string, string> | undefined,
  ) {}

  /**
   * Get client info (requesting client's IP, etc.).
   */
  async getClient(): Promise<Result<ClientInfo, PiholeError>> {
    return this.http.request<ClientInfo>(
      {
        method: "GET",
        path: "/api/info/client",
      },
      this.getAuthHeaders(),
    );
  }

  /**
   * Get system info (memory, CPU, disk usage).
   */
  async getSystem(): Promise<Result<SystemInfo, PiholeError>> {
    return this.http.request<SystemInfo>(
      {
        method: "GET",
        path: "/api/info/system",
      },
      this.getAuthHeaders(),
    );
  }

  /**
   * Get host info (OS, hostname, etc.).
   */
  async getHost(): Promise<Result<HostInfo, PiholeError>> {
    return this.http.request<HostInfo>(
      {
        method: "GET",
        path: "/api/info/host",
      },
      this.getAuthHeaders(),
    );
  }

  /**
   * Get FTL (pihole-FTL) info.
   */
  async getFtl(): Promise<Result<FtlInfo, PiholeError>> {
    return this.http.request<FtlInfo>(
      {
        method: "GET",
        path: "/api/info/ftl",
      },
      this.getAuthHeaders(),
    );
  }

  /**
   * Get sensor readings (CPU temperature, etc.).
   */
  async getSensors(): Promise<Result<SensorsInfo, PiholeError>> {
    return this.http.request<SensorsInfo>(
      {
        method: "GET",
        path: "/api/info/sensors",
      },
      this.getAuthHeaders(),
    );
  }

  /**
   * Get database info (gravity and FTL database sizes).
   */
  async getDatabase(): Promise<Result<DatabaseInfo, PiholeError>> {
    return this.http.request<DatabaseInfo>(
      {
        method: "GET",
        path: "/api/info/database",
      },
      this.getAuthHeaders(),
    );
  }

  /**
   * Get version info for all Pi-hole components.
   */
  async getVersion(): Promise<Result<VersionInfo, PiholeError>> {
    return this.http.request<VersionInfo>(
      {
        method: "GET",
        path: "/api/info/version",
      },
      this.getAuthHeaders(),
    );
  }

  /**
   * Get DNS metrics.
   */
  async getMetrics(): Promise<Result<MetricsInfo, PiholeError>> {
    return this.http.request<MetricsInfo>(
      {
        method: "GET",
        path: "/api/info/metrics",
      },
      this.getAuthHeaders(),
    );
  }

  /**
   * Get login info (session status without authenticating).
   */
  async getLogin(): Promise<Result<LoginInfo, PiholeError>> {
    return this.http.request<LoginInfo>(
      {
        method: "GET",
        path: "/api/info/login",
      },
      this.getAuthHeaders(),
    );
  }

  /**
   * Get all system messages.
   */
  async getMessages(): Promise<Result<Message[], PiholeError>> {
    const result = await this.http.request<MessagesResponse>(
      {
        method: "GET",
        path: "/api/info/messages",
      },
      this.getAuthHeaders(),
    );

    if (result.ok) {
      return { ok: true, data: result.data.messages };
    }
    return result;
  }

  /**
   * Get count of system messages.
   */
  async getMessageCount(): Promise<Result<number, PiholeError>> {
    const result = await this.http.request<MessageCountResponse>(
      {
        method: "GET",
        path: "/api/info/messages/count",
      },
      this.getAuthHeaders(),
    );

    if (result.ok) {
      return { ok: true, data: result.data.count };
    }
    return result;
  }

  /**
   * Delete a system message.
   * @param id Message ID to delete
   */
  async deleteMessage(id: number): Promise<Result<void, PiholeError>> {
    return this.http.request<void>(
      {
        method: "DELETE",
        path: `/api/info/messages/${id}`,
      },
      this.getAuthHeaders(),
    );
  }
}
