/**
 * System info types.
 */

export interface ClientInfo {
  ip: string;
  remote_addr: string;
  name: string | null;
  took?: number;
}

export interface SystemInfo {
  uptime: number;
  memory: {
    ram: {
      total: number;
      used: number;
      free: number;
      available: number;
      perc_used: number;
    };
    swap: {
      total: number;
      used: number;
      free: number;
      perc_used: number;
    };
  };
  cpu: {
    nprocs: number;
    load: {
      raw: [number, number, number];
      percent: [number, number, number];
    };
  };
  disk: {
    total: number;
    used: number;
    free: number;
    perc_used: number;
  };
  took?: number;
}

export interface HostInfo {
  uname: {
    sysname: string;
    nodename: string;
    release: string;
    version: string;
    machine: string;
  };
  model: string | null;
  dnsmasq: {
    user: string;
    group: string;
  };
  took?: number;
}

export interface FtlInfo {
  version: string;
  branch: string;
  hash: string;
  date: string;
  pid: number;
  uptime: number;
  database: {
    gravity: number;
    groups: number;
    lists: number;
    clients: number;
    domains: {
      allowed: number;
      denied: number;
    };
  };
  privacy_level: number;
  clients: {
    total: number;
    active: number;
  };
  took?: number;
}

export interface SensorsInfo {
  cpu_temp?: number;
  hot?: boolean;
  unit?: string;
  sensors?: Array<{
    name: string;
    value: number;
    unit: string;
    path: string;
  }>;
  took?: number;
}

export interface DatabaseInfo {
  gravity: {
    size: number;
    rows: number;
  };
  ftl: {
    size: number;
    queries: number;
  };
  took?: number;
}

export interface VersionInfo {
  core: {
    local: { version: string; branch: string; hash: string };
    remote: { version: string; branch: string; hash: string };
    update: boolean;
  };
  ftl: {
    local: { version: string; branch: string; hash: string };
    remote: { version: string; branch: string; hash: string };
    update: boolean;
  };
  web: {
    local: { version: string; branch: string; hash: string };
    remote: { version: string; branch: string; hash: string };
    update: boolean;
  };
  docker: {
    local: string | null;
    remote: string | null;
  };
  took?: number;
}

export interface MetricsInfo {
  dns: {
    cache: {
      size: number;
      inserted: number;
      evicted: number;
    };
    replies: Record<string, number>;
  };
  took?: number;
}

export interface LoginInfo {
  valid: boolean;
  totp: boolean;
  sid?: string;
  csrf?: string;
  validity?: number;
  message?: string;
  took?: number;
}

export interface Message {
  id: number;
  timestamp: number;
  type: string;
  message: string;
  blob1?: string;
  blob2?: string;
  blob3?: string;
  blob4?: string;
  blob5?: string;
}

export interface MessagesResponse {
  messages: Message[];
  took?: number;
}

export interface MessageCountResponse {
  count: number;
  took?: number;
}
