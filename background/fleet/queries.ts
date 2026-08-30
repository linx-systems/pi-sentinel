import type { PiHoleInstance, QueryEntry } from "~/utils/types";

export type FleetTargetFailure = {
  instanceId: string;
  instanceName: string;
  message: string;
};

export type FleetResult<T> = {
  entries: T[];
  failures: FleetTargetFailure[];
  complete: boolean;
};

export type DomainSearchEntry = {
  instanceId: string;
  instanceName: string;
  gravity: boolean;
  allowlist: boolean;
  denylist: boolean;
};

export type FleetQueryEntry = QueryEntry & {
  instanceId: string;
  instanceName: string;
};

export type QueryRequest = {
  length?: number;
  from?: number;
};

export interface FleetQueries {
  searchDomain(domain: string): Promise<FleetResult<DomainSearchEntry>>;
  recentQueries(input?: QueryRequest): Promise<FleetResult<FleetQueryEntry>>;
}
type FleetStore = {
  getActiveInstanceId(): string | null;
  getInstanceState(instanceId: string): { isConnected: boolean } | null;
};

type FleetTarget = {
  instanceId: string;
  instanceName: string;
};

type FleetClient = {
  searchDomain(domain: string): Promise<{
    success: boolean;
    data?: unknown;
    error?: { message: string };
  }>;
  getQueries(input?: QueryRequest): Promise<{
    success: boolean;
    data?: unknown;
    error?: { message: string };
  }>;
};

type FleetInstanceManager = {
  getInstances(): Promise<{ instances: PiHoleInstance[] }>;
  getDisplayName(instance: PiHoleInstance): string;
};

type FleetClientRegistry = {
  getClient(instanceId: string): FleetClient;
};

type FleetQueriesAdapters = {
  store: FleetStore;
  instances: FleetInstanceManager;
  clients: FleetClientRegistry;
};

function messageFrom(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === "string" ? error : "Request failed";
}

function parseSearchResult(
  raw: unknown,
): Omit<DomainSearchEntry, "instanceId" | "instanceName"> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error("Invalid search response");
  }

  if ("search" in raw) {
    const search = raw.search;
    if (
      typeof search !== "object" ||
      search === null ||
      Array.isArray(search)
    ) {
      throw new Error("Invalid search response");
    }
    if (
      !("gravity" in search) ||
      !Array.isArray(search.gravity) ||
      !("domains" in search) ||
      !Array.isArray(search.domains)
    ) {
      throw new Error("Invalid search response");
    }
    if (
      search.domains.some(
        (entry) =>
          typeof entry !== "object" ||
          entry === null ||
          Array.isArray(entry) ||
          !("type" in entry) ||
          (entry.type !== "allow" && entry.type !== "deny"),
      )
    ) {
      throw new Error("Invalid search response");
    }

    return {
      gravity: search.gravity.length > 0,
      allowlist: search.domains.some(
        (entry) =>
          typeof entry === "object" &&
          entry !== null &&
          !Array.isArray(entry) &&
          "type" in entry &&
          entry.type === "allow",
      ),
      denylist: search.domains.some(
        (entry) =>
          typeof entry === "object" &&
          entry !== null &&
          !Array.isArray(entry) &&
          "type" in entry &&
          entry.type === "deny",
      ),
    };
  }

  if (!("gravity" in raw)) throw new Error("Invalid search response");
  const gravity = raw.gravity;
  if (
    typeof gravity !== "object" ||
    gravity === null ||
    Array.isArray(gravity)
  ) {
    throw new Error("Invalid search response");
  }
  if (
    !("count" in gravity) ||
    typeof gravity.count !== "number" ||
    !Number.isFinite(gravity.count) ||
    gravity.count < 0
  ) {
    throw new Error("Invalid search response");
  }
  if (!("domains" in raw)) throw new Error("Invalid search response");
  const domains = raw.domains;
  if (
    typeof domains !== "object" ||
    domains === null ||
    Array.isArray(domains)
  ) {
    throw new Error("Invalid search response");
  }
  if (
    !("allow" in domains) ||
    !Array.isArray(domains.allow) ||
    !("deny" in domains) ||
    !Array.isArray(domains.deny)
  ) {
    throw new Error("Invalid search response");
  }

  if (
    [...domains.allow, ...domains.deny].some(
      (entry) =>
        typeof entry !== "object" ||
        entry === null ||
        Array.isArray(entry) ||
        !("domain" in entry) ||
        typeof entry.domain !== "string" ||
        entry.domain.length === 0 ||
        !("type" in entry) ||
        typeof entry.type !== "number" ||
        !Number.isFinite(entry.type) ||
        !Number.isInteger(entry.type),
    )
  ) {
    throw new Error("Invalid search response");
  }
  return {
    gravity: gravity.count > 0,
    allowlist: domains.allow.length > 0,
    denylist: domains.deny.length > 0,
  };
}

function normalizeQueries(raw: unknown): QueryEntry[] {
  const source = Array.isArray(raw)
    ? raw
    : typeof raw === "object" &&
        raw !== null &&
        !Array.isArray(raw) &&
        "queries" in raw
      ? raw.queries
      : undefined;
  if (!Array.isArray(source)) throw new Error("Invalid query response");

  return source.map((query) => {
    if (
      typeof query !== "object" ||
      query === null ||
      Array.isArray(query) ||
      !("domain" in query)
    ) {
      throw new Error("Invalid query response");
    }
    const domain = query.domain;
    if (
      typeof domain !== "string" ||
      !("status" in query) ||
      (typeof query.status !== "string" && typeof query.status !== "number") ||
      (typeof query.status === "string" && query.status.length === 0) ||
      (typeof query.status === "number" &&
        (!Number.isFinite(query.status) || !Number.isInteger(query.status)))
    ) {
      throw new Error("Invalid query response");
    }
    const timestamp =
      "timestamp" in query && typeof query.timestamp === "number"
        ? query.timestamp
        : "time" in query && typeof query.time === "number"
          ? query.time
          : undefined;
    if (timestamp === undefined || !Number.isFinite(timestamp)) {
      throw new Error("Invalid query response");
    }
    const id = "id" in query ? query.id : undefined;

    return {
      ...query,
      id: id ?? `${domain}-${timestamp}`,
      timestamp,
    } as QueryEntry;
  });
}

export function createFleetQueries({
  store,
  instances,
  clients,
}: FleetQueriesAdapters): FleetQueries {
  const resolveTargets = async (): Promise<FleetTarget[]> => {
    const configuration = await instances.getInstances();
    const activeInstanceId = store.getActiveInstanceId();
    const selected = activeInstanceId
      ? configuration.instances.filter(
          (instance) => instance.id === activeInstanceId,
        )
      : configuration.instances.filter(
          (instance) => store.getInstanceState(instance.id)?.isConnected,
        );
    return selected.map((instance) => ({
      instanceId: instance.id,
      instanceName: instances.getDisplayName(instance),
    }));
  };

  const searchDomain = async (
    domain: string,
  ): Promise<FleetResult<DomainSearchEntry>> => {
    const targets = await resolveTargets();
    const outcomes = await Promise.all(
      targets.map(async (target) => {
        try {
          const result = await clients
            .getClient(target.instanceId)
            .searchDomain(domain);
          if (!result.success) {
            return {
              failure: {
                ...target,
                message: result.error?.message ?? "Search failed",
              },
            };
          }
          return {
            entry: {
              ...target,
              ...parseSearchResult(result.data),
            },
          };
        } catch (error) {
          return { failure: { ...target, message: messageFrom(error) } };
        }
      }),
    );
    const entries = outcomes.flatMap((outcome) =>
      outcome.entry ? [outcome.entry] : [],
    );
    const failures = outcomes.flatMap((outcome) =>
      outcome.failure ? [outcome.failure] : [],
    );
    return {
      entries,
      failures,
      complete: targets.length > 0 && failures.length === 0,
    };
  };

  const recentQueries = async (
    input?: QueryRequest,
  ): Promise<FleetResult<FleetQueryEntry>> => {
    const targets = await resolveTargets();
    const outcomes = await Promise.all(
      targets.map(async (target) => {
        try {
          const result = await clients
            .getClient(target.instanceId)
            .getQueries(input);
          if (!result.success) {
            return {
              failure: {
                ...target,
                message: result.error?.message ?? "Query request failed",
              },
            };
          }
          return {
            entries: normalizeQueries(result.data).map((query) => ({
              ...query,
              id:
                query.id ??
                `${target.instanceId}-${query.timestamp}-${query.domain}`,
              ...target,
            })),
          };
        } catch (error) {
          return { failure: { ...target, message: messageFrom(error) } };
        }
      }),
    );
    const entries = outcomes
      .flatMap((outcome) => outcome.entries ?? [])
      .sort((left, right) => right.timestamp - left.timestamp);
    const failures = outcomes.flatMap((outcome) =>
      outcome.failure ? [outcome.failure] : [],
    );
    return {
      entries,
      failures,
      complete: targets.length > 0 && failures.length === 0,
    };
  };

  return { searchDomain, recentQueries };
}
