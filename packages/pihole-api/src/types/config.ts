/**
 * Configuration types.
 */

export interface PiholeConfig {
  dns?: DnsConfig;
  dhcp?: DhcpConfig;
  ntp?: NtpConfig;
  resolver?: ResolverConfig;
  database?: DatabaseConfig;
  webserver?: WebserverConfig;
  files?: FilesConfig;
  misc?: MiscConfig;
  debug?: DebugConfig;
  [key: string]: unknown;
}

export interface DnsConfig {
  upstreams?: string[];
  CNAMEdeepInspect?: boolean;
  blockESNI?: boolean;
  EDNS0ECS?: boolean;
  ignoreLocalhost?: boolean;
  showDNSSEC?: boolean;
  analyzeOnlyAandAAAA?: boolean;
  piholePTR?: string;
  replyWhenBusy?: string;
  blockTTL?: number;
  hosts?: string[];
  domainNeeded?: boolean;
  expandHosts?: boolean;
  domain?: string;
  bogusPriv?: boolean;
  dnssec?: boolean;
  interface?: string;
  dnsmasqListening?: string;
  queryLogging?: boolean;
  cnameRecords?: string[];
  port?: number;
  [key: string]: unknown;
}

export interface DhcpConfig {
  active?: boolean;
  start?: string;
  end?: string;
  router?: string;
  domain?: string;
  leaseTime?: number;
  ipv6?: boolean;
  rapidCommit?: boolean;
  [key: string]: unknown;
}

export interface NtpConfig {
  active?: boolean;
  sync?: boolean;
  server?: string;
  [key: string]: unknown;
}

export interface ResolverConfig {
  resolveIPv4?: boolean;
  resolveIPv6?: boolean;
  networkNames?: boolean;
  refreshInterval?: number;
  [key: string]: unknown;
}

export interface DatabaseConfig {
  DBimport?: boolean;
  maxDBdays?: number;
  DBinterval?: number;
  useWAL?: boolean;
  [key: string]: unknown;
}

export interface WebserverConfig {
  port?: string;
  threads?: number;
  interface?: string;
  acl?: string;
  paths?: {
    webroot?: string;
    webhome?: string;
  };
  tls?: {
    cert?: string;
    key?: string;
  };
  session?: {
    timeout?: number;
  };
  [key: string]: unknown;
}

export interface FilesConfig {
  log?: {
    ftl?: string;
    dnsmasq?: string;
    webserver?: string;
  };
  database?: string;
  gravity?: string;
  macvendor?: string;
  pcap?: string;
  [key: string]: unknown;
}

export interface MiscConfig {
  privacylevel?: number;
  delay_startup?: number;
  nice?: number;
  addr2line?: boolean;
  etc_dnsmasq_d?: boolean;
  dnsmasq_lines?: string[];
  [key: string]: unknown;
}

export interface DebugConfig {
  all?: boolean;
  database?: boolean;
  networking?: boolean;
  locks?: boolean;
  queries?: boolean;
  flags?: boolean;
  shmem?: boolean;
  gc?: boolean;
  arp?: boolean;
  regex?: boolean;
  api?: boolean;
  overtime?: boolean;
  status?: boolean;
  caps?: boolean;
  resolver?: boolean;
  edns0?: boolean;
  clients?: boolean;
  aliasclients?: boolean;
  events?: boolean;
  helper?: boolean;
  config?: boolean;
  inotify?: boolean;
  [key: string]: unknown;
}

export interface ConfigResponse {
  config: PiholeConfig;
  took?: number;
}
