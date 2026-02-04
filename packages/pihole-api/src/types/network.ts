/**
 * Network types.
 */

export interface GatewayInfo {
  address: string;
  interface: string;
  took?: number;
}

export interface Route {
  destination: string;
  gateway: string;
  interface: string;
  metric: number;
  flags: string;
}

export interface RoutesResponse {
  routes: Route[];
  took?: number;
}

export interface NetworkInterface {
  name: string;
  flags: string[];
  addresses: Array<{
    address: string;
    family: string;
    prefixlen: number;
  }>;
  mtu: number;
  carrier: boolean;
  speed?: number;
  took?: number;
}

export interface InterfacesResponse {
  interfaces: NetworkInterface[];
  took?: number;
}

export interface NetworkDevice {
  id: number;
  hwaddr: string;
  interface: string;
  name: string | null;
  firstSeen: number;
  lastQuery: number;
  numQueries: number;
  macVendor: string | null;
  ips: Array<{
    ip: string;
    name: string | null;
  }>;
}

export interface DevicesResponse {
  devices: NetworkDevice[];
  took?: number;
}

export interface HistoryEntry {
  timestamp: number;
  total: number;
  cached: number;
  blocked: number;
  forwarded: number;
}

export interface HistoryResponse {
  history: HistoryEntry[];
  took?: number;
}

export interface ClientHistoryEntry {
  timestamp: number;
  data: Record<string, number>;
}

export interface ClientHistoryResponse {
  history: ClientHistoryEntry[];
  clients: Array<{
    ip: string;
    name: string | null;
  }>;
  took?: number;
}
