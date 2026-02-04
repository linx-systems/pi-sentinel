/**
 * DHCP types.
 */

export interface DhcpLease {
  ip: string;
  hwaddr: string;
  hostname: string | null;
  expires: number;
  client_id: string | null;
}

export interface DhcpLeasesResponse {
  leases: DhcpLease[];
  took?: number;
}
