import type {
  DomainSearchEntry,
  FleetQueryEntry,
} from "~/background/fleet/queries";
import type {
  CreateTemporaryAllowsResult,
  CommandMessage,
  RemoveTemporaryAllowsResult,
  SerializableTabDomains,
} from "~/utils/messaging";
import type {
  ExtensionState,
  InstanceState,
  PersistedInstances,
  PiHoleInstance,
  StatsSummary,
  TemporaryAllowEntry,
} from "~/utils/types";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((entry) => typeof entry === "string")
  );
}

function isStatsSummary(value: unknown): value is StatsSummary {
  if (
    !isRecord(value) ||
    !isRecord(value.queries) ||
    !isRecord(value.clients) ||
    !isRecord(value.gravity)
  )
    return false;
  const { queries, clients, gravity } = value;
  return [
    queries.total,
    queries.blocked,
    queries.percent_blocked,
    queries.unique_domains,
    queries.forwarded,
    queries.cached,
    clients.active,
    clients.total,
    gravity.domains_being_blocked,
    gravity.last_update,
  ].every(isFiniteNumber);
}

function isExtensionState(value: unknown): value is ExtensionState {
  return (
    isRecord(value) &&
    typeof value.isConnected === "boolean" &&
    (typeof value.connectionError === "string" ||
      value.connectionError === null) &&
    typeof value.blockingEnabled === "boolean" &&
    (isFiniteNumber(value.blockingTimer) || value.blockingTimer === null) &&
    (isStatsSummary(value.stats) || value.stats === null) &&
    isFiniteNumber(value.statsLastUpdated) &&
    typeof value.totpRequired === "boolean"
  );
}

function isBlockingStatus(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.blocking === "boolean" &&
    (isFiniteNumber(value.timer) || value.timer === null)
  );
}

function isTabDomains(value: unknown): value is SerializableTabDomains | null {
  return (
    value === null ||
    (isRecord(value) &&
      isFiniteNumber(value.tabId) &&
      typeof value.pageUrl === "string" &&
      typeof value.firstPartyDomain === "string" &&
      isStringArray(value.domains) &&
      isStringArray(value.thirdPartyDomains))
  );
}

function isEncryptedData(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.ciphertext === "string" &&
    typeof value.salt === "string" &&
    typeof value.iv === "string"
  );
}

function isInstance(value: unknown): value is PiHoleInstance {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    (typeof value.name === "string" || value.name === null) &&
    typeof value.piholeUrl === "string" &&
    (isEncryptedData(value.encryptedPassword) ||
      value.encryptedPassword === null) &&
    (value.passwordless === undefined ||
      typeof value.passwordless === "boolean") &&
    (isEncryptedData(value.encryptedMasterKey) ||
      value.encryptedMasterKey === null) &&
    typeof value.rememberPassword === "boolean" &&
    isFiniteNumber(value.createdAt)
  );
}

function isPersistedInstances(value: unknown): value is PersistedInstances {
  return (
    isRecord(value) &&
    Array.isArray(value.instances) &&
    value.instances.every(isInstance) &&
    (typeof value.activeInstanceId === "string" ||
      value.activeInstanceId === null) &&
    isRecord(value.globalSettings) &&
    typeof value.globalSettings.notificationsEnabled === "boolean" &&
    isFiniteNumber(value.globalSettings.refreshInterval)
  );
}

function isInstanceState(value: unknown): value is InstanceState {
  return (
    isRecord(value) &&
    typeof value.instanceId === "string" &&
    typeof value.isConnected === "boolean" &&
    (typeof value.connectionError === "string" ||
      value.connectionError === null) &&
    typeof value.blockingEnabled === "boolean" &&
    (isFiniteNumber(value.blockingTimer) || value.blockingTimer === null) &&
    (isStatsSummary(value.stats) || value.stats === null) &&
    isFiniteNumber(value.statsLastUpdated) &&
    typeof value.totpRequired === "boolean"
  );
}

function isTemporaryAllow(value: unknown): value is TemporaryAllowEntry {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.domain === "string" &&
    typeof value.instanceId === "string" &&
    typeof value.instanceName === "string" &&
    isFiniteNumber(value.createdAt) &&
    (isFiniteNumber(value.expiresAt) || value.expiresAt === null) &&
    (value.cleanupPending === undefined ||
      typeof value.cleanupPending === "boolean") &&
    typeof value.createdByExtension === "boolean"
  );
}

function isFleetFailure(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.instanceId === "string" &&
    typeof value.instanceName === "string" &&
    typeof value.message === "string"
  );
}

function isFleetResult(
  value: unknown,
  isEntry: (entry: unknown) => boolean,
): boolean {
  return (
    isRecord(value) &&
    Array.isArray(value.entries) &&
    value.entries.every(isEntry) &&
    Array.isArray(value.failures) &&
    value.failures.every(isFleetFailure) &&
    typeof value.complete === "boolean"
  );
}

function isDomainSearchEntry(value: unknown): value is DomainSearchEntry {
  return (
    isRecord(value) &&
    typeof value.instanceId === "string" &&
    typeof value.instanceName === "string" &&
    typeof value.gravity === "boolean" &&
    typeof value.allowlist === "boolean" &&
    typeof value.denylist === "boolean"
  );
}

function isFleetQueryEntry(value: unknown): value is FleetQueryEntry {
  return (
    isRecord(value) &&
    (typeof value.id === "string" || isFiniteNumber(value.id)) &&
    isFiniteNumber(value.timestamp) &&
    typeof value.type === "string" &&
    typeof value.domain === "string" &&
    typeof value.client === "string" &&
    typeof value.status === "string" &&
    typeof value.reply_type === "string" &&
    isFiniteNumber(value.reply_time) &&
    typeof value.instanceId === "string" &&
    typeof value.instanceName === "string"
  );
}

function isTemporaryAllowFailure(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.domain === "string" &&
    typeof value.instanceId === "string" &&
    typeof value.instanceName === "string" &&
    typeof value.error === "string"
  );
}

function isCreateTemporaryAllowsResult(
  value: unknown,
): value is CreateTemporaryAllowsResult {
  return (
    isRecord(value) &&
    Array.isArray(value.entries) &&
    value.entries.every(isTemporaryAllow) &&
    isStringArray(value.skippedDomains) &&
    Array.isArray(value.failures) &&
    value.failures.every(isTemporaryAllowFailure)
  );
}

function isRemoveTemporaryAllowsResult(
  value: unknown,
): value is RemoveTemporaryAllowsResult {
  return (
    isRecord(value) &&
    isStringArray(value.removedIds) &&
    Array.isArray(value.failures) &&
    value.failures.every(
      (failure) =>
        isTemporaryAllowFailure(failure) && typeof failure.entryId === "string",
    )
  );
}

export function hasValidCommandData(
  command: CommandMessage,
  data: unknown,
): boolean {
  switch (command.type) {
    case "GET_STATE":
      return isExtensionState(data);
    case "GET_STATS":
      return isStatsSummary(data);
    case "GET_BLOCKING_STATUS":
    case "SET_BLOCKING":
      return isBlockingStatus(data);
    case "GET_TAB_DOMAINS":
      return isTabDomains(data);
    case "ADD_TO_ALLOWLIST":
    case "ADD_TO_DENYLIST":
    case "REMOVE_FROM_ALLOWLIST":
    case "REMOVE_FROM_DENYLIST":
    case "TEST_CONNECTION":
    case "DELETE_INSTANCE":
    case "SET_ACTIVE_INSTANCE":
    case "DISCONNECT_INSTANCE":
      return data === undefined;
    case "SEARCH_DOMAIN":
      return isFleetResult(data, isDomainSearchEntry);
    case "GET_QUERIES":
      return isFleetResult(data, isFleetQueryEntry);
    case "HEALTH_CHECK":
      return (
        isRecord(data) &&
        typeof data.ready === "boolean" &&
        isFiniteNumber(data.timestamp) &&
        typeof data.version === "string"
      );
    case "GET_INSTANCES":
      return isPersistedInstances(data);
    case "ADD_INSTANCE":
    case "UPDATE_INSTANCE":
      return isInstance(data);
    case "CONNECT_INSTANCE":
      return (
        isRecord(data) &&
        (data.kind === "connected" || data.kind === "totp-required")
      );
    case "GET_INSTANCE_STATE":
      return isInstanceState(data);
    case "CHECK_PASSWORD_AVAILABLE":
      return isRecord(data) && typeof data.available === "boolean";
    case "CREATE_TEMPORARY_ALLOWS":
      return isCreateTemporaryAllowsResult(data);
    case "GET_TEMPORARY_ALLOWS":
      return Array.isArray(data) && data.every(isTemporaryAllow);
    case "REMOVE_TEMPORARY_ALLOWS":
      return isRemoveTemporaryAllowsResult(data);
  }
}
