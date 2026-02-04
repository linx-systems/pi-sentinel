/**
 * Network endpoints.
 */

import type { PiholeError } from "../errors.js";
import type { HttpClient } from "../http.js";
import type { Result } from "../result.js";
import type {
  DevicesResponse,
  GatewayInfo,
  InterfacesResponse,
  NetworkDevice,
  NetworkInterface,
  Route,
  RoutesResponse,
} from "../types/network.js";

/**
 * Network endpoint methods.
 */
export class NetworkEndpoints {
  constructor(
    private http: HttpClient,
    private getAuthHeaders: () => Record<string, string> | undefined,
  ) {}

  /**
   * Get gateway information.
   */
  async getGateway(): Promise<Result<GatewayInfo, PiholeError>> {
    return this.http.request<GatewayInfo>(
      {
        method: "GET",
        path: "/api/network/gateway",
      },
      this.getAuthHeaders(),
    );
  }

  /**
   * Get routing table.
   */
  async getRoutes(): Promise<Result<Route[], PiholeError>> {
    const result = await this.http.request<RoutesResponse>(
      {
        method: "GET",
        path: "/api/network/routes",
      },
      this.getAuthHeaders(),
    );

    if (result.ok) {
      return { ok: true, data: result.data.routes };
    }
    return result;
  }

  /**
   * Get network interfaces.
   */
  async getInterfaces(): Promise<Result<NetworkInterface[], PiholeError>> {
    const result = await this.http.request<InterfacesResponse>(
      {
        method: "GET",
        path: "/api/network/interfaces",
      },
      this.getAuthHeaders(),
    );

    if (result.ok) {
      return { ok: true, data: result.data.interfaces };
    }
    return result;
  }

  /**
   * Get known network devices.
   */
  async getDevices(): Promise<Result<NetworkDevice[], PiholeError>> {
    const result = await this.http.request<DevicesResponse>(
      {
        method: "GET",
        path: "/api/network/devices",
      },
      this.getAuthHeaders(),
    );

    if (result.ok) {
      return { ok: true, data: result.data.devices };
    }
    return result;
  }

  /**
   * Delete a network device from the database.
   * @param id Device ID to delete
   */
  async deleteDevice(id: number): Promise<Result<void, PiholeError>> {
    return this.http.request<void>(
      {
        method: "DELETE",
        path: `/api/network/devices/${id}`,
      },
      this.getAuthHeaders(),
    );
  }
}
