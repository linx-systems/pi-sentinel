import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import {
  createFleetQueries,
  type FleetQueries,
} from "~/background/fleet/queries";
import type { PiHoleInstance } from "~/utils/types";

type TestInstance = PiHoleInstance;

type TestState = { isConnected: boolean } | undefined;

type SearchResult = {
  success: boolean;
  data?: unknown;
  error?: { message: string };
};

type QueryResult = {
  success: boolean;
  data?: unknown;
  error?: { message: string };
};

type TestClient = {
  searchDomain: Mock<(domain: string) => Promise<SearchResult>>;
  getQueries: Mock<
    (input?: { length?: number; from?: number }) => Promise<QueryResult>
  >;
};

const instances: TestInstance[] = [
  {
    id: "primary",
    name: "Primary",
    piholeUrl: "https://primary.test",
    encryptedPassword: null,
    encryptedMasterKey: null,
    rememberPassword: false,
    createdAt: 0,
  },
  {
    id: "secondary",
    name: null,
    piholeUrl: "https://secondary.test",
    encryptedPassword: null,
    encryptedMasterKey: null,
    rememberPassword: false,
    createdAt: 0,
  },
  {
    id: "offline",
    name: "Offline",
    piholeUrl: "https://offline.test",
    encryptedPassword: null,
    encryptedMasterKey: null,
    rememberPassword: false,
    createdAt: 0,
  },
];

function searchData(
  overrides: { gravity?: unknown[]; domains?: unknown[] } = {},
) {
  return {
    search: {
      gravity: overrides.gravity ?? [],
      domains: overrides.domains ?? [],
    },
  };
}

class FleetHarness {
  activeInstanceId: string | null = null;
  states = new Map<string, TestState>();
  clients = new Map<string, TestClient>();
  getInstances = vi.fn(async () => ({ instances }));
  getDisplayName = vi.fn(
    (instance: TestInstance) =>
      instance.name ?? new URL(instance.piholeUrl).hostname,
  );

  constructor() {
    for (const instance of instances) {
      this.clients.set(instance.id, {
        searchDomain: vi
          .fn()
          .mockResolvedValue({ success: true, data: searchData() }),
        getQueries: vi.fn().mockResolvedValue({ success: true, data: [] }),
      });
    }
  }

  create(): FleetQueries {
    return createFleetQueries({
      store: {
        getActiveInstanceId: () => this.activeInstanceId,
        getInstanceState: (instanceId) => this.states.get(instanceId),
      },
      instances: {
        getInstances: this.getInstances,
        getDisplayName: this.getDisplayName,
      },
      clients: {
        getClient: (instanceId) => {
          const client = this.clients.get(instanceId);
          if (!client) throw new Error(`Missing client ${instanceId}`);
          return client;
        },
      },
    });
  }

  client(instanceId: string): TestClient {
    return this.clients.get(instanceId)!;
  }
}

let harness: FleetHarness;
let queries: FleetQueries;

beforeEach(() => {
  vi.clearAllMocks();
  harness = new FleetHarness();
  queries = harness.create();
});

describe("FleetQueries", () => {
  it("uses the active instance alone and preserves its search metadata", async () => {
    harness.activeInstanceId = "primary";
    harness.client("primary").searchDomain.mockResolvedValue({
      success: true,
      data: searchData({
        gravity: [{ domain: "example.com" }],
        domains: [{ type: "allow" }],
      }),
    });

    await expect(queries.searchDomain("example.com")).resolves.toEqual({
      entries: [
        {
          instanceId: "primary",
          instanceName: "Primary",
          gravity: true,
          allowlist: true,
          denylist: false,
        },
      ],
      failures: [],
      complete: true,
    });
    expect(harness.client("secondary").searchDomain).not.toHaveBeenCalled();
  });

  it("treats a malformed successful domain response container as a target failure", async () => {
    harness.activeInstanceId = "primary";
    harness.client("primary").searchDomain.mockResolvedValue({
      success: true,
      data: {},
    });

    await expect(queries.searchDomain("example.com")).resolves.toEqual({
      entries: [],
      failures: [
        {
          instanceId: "primary",
          instanceName: "Primary",
          message: "Invalid search response",
        },
      ],
      complete: false,
    });
  });
  it("treats a v5 flat domain entry without a recognized type as a target failure", async () => {
    harness.activeInstanceId = "primary";
    harness.client("primary").searchDomain.mockResolvedValue({
      success: true,
      data: searchData({ domains: [{}] }),
    });

    await expect(queries.searchDomain("example.com")).resolves.toEqual({
      entries: [],
      failures: [
        {
          instanceId: "primary",
          instanceName: "Primary",
          message: "Invalid search response",
        },
      ],
      complete: false,
    });
  });
  it("treats a v5 flat domain entry with an unknown type as a target failure", async () => {
    harness.activeInstanceId = "primary";
    harness.client("primary").searchDomain.mockResolvedValue({
      success: true,
      data: searchData({ domains: [{ type: "unknown" }] }),
    });

    await expect(queries.searchDomain("example.com")).resolves.toEqual({
      entries: [],
      failures: [
        {
          instanceId: "primary",
          instanceName: "Primary",
          message: "Invalid search response",
        },
      ],
      complete: false,
    });
  });

  it.each([
    ["a null allowlist entry", { allow: [null], deny: [] }],
    ["a malformed denylist entry", { allow: [], deny: [{}] }],
  ])(
    "treats a v6 response with %s as a target failure",
    async (_label, domains) => {
      harness.activeInstanceId = "primary";
      harness.client("primary").searchDomain.mockResolvedValue({
        success: true,
        data: {
          gravity: { count: 0 },
          domains,
        },
      });

      await expect(queries.searchDomain("example.com")).resolves.toEqual({
        entries: [],
        failures: [
          {
            instanceId: "primary",
            instanceName: "Primary",
            message: "Invalid search response",
          },
        ],
        complete: false,
      });
    },
  );

  it("accepts a v6 domain entry with a domain and numeric type", async () => {
    harness.activeInstanceId = "primary";
    harness.client("primary").searchDomain.mockResolvedValue({
      success: true,
      data: {
        gravity: { count: 0 },
        domains: {
          allow: [{ domain: "example.com", type: 0 }],
          deny: [],
        },
      },
    });

    await expect(queries.searchDomain("example.com")).resolves.toEqual({
      entries: [
        {
          instanceId: "primary",
          instanceName: "Primary",
          gravity: false,
          allowlist: true,
          denylist: false,
        },
      ],
      failures: [],
      complete: true,
    });
  });

  it("treats malformed successful domain response fields as a target failure", async () => {
    harness.activeInstanceId = "primary";
    harness.client("primary").searchDomain.mockResolvedValue({
      success: true,
      data: {
        gravity: { count: "1" },
        domains: { allow: [], deny: [] },
      },
    });

    await expect(queries.searchDomain("example.com")).resolves.toEqual({
      entries: [],
      failures: [
        {
          instanceId: "primary",
          instanceName: "Primary",
          message: "Invalid search response",
        },
      ],
      complete: false,
    });
  });

  it("accepts an empty v6 domain response as a complete search", async () => {
    harness.activeInstanceId = "primary";
    harness.client("primary").searchDomain.mockResolvedValue({
      success: true,
      data: {
        gravity: { count: 0 },
        domains: { allow: [], deny: [] },
      },
    });

    await expect(queries.searchDomain("example.com")).resolves.toEqual({
      entries: [
        {
          instanceId: "primary",
          instanceName: "Primary",
          gravity: false,
          allowlist: false,
          denylist: false,
        },
      ],
      failures: [],
      complete: true,
    });
  });
  it("uses all and only connected instances when no active instance is selected", async () => {
    harness.states.set("primary", { isConnected: true });
    harness.states.set("secondary", { isConnected: true });
    harness.states.set("offline", { isConnected: false });
    harness.client("primary").getQueries.mockResolvedValue({
      success: true,
      data: [
        {
          id: "primary-query",
          domain: "primary.test",
          timestamp: 10,
          status: "FORWARDED",
        },
      ],
    });
    harness.client("secondary").getQueries.mockResolvedValue({
      success: true,
      data: [
        {
          id: "secondary-query",
          domain: "secondary.test",
          timestamp: 20,
          status: 2,
        },
      ],
    });

    await expect(queries.recentQueries({ length: 25 })).resolves.toEqual({
      entries: [
        {
          id: "secondary-query",
          domain: "secondary.test",
          timestamp: 20,
          status: 2,
          instanceId: "secondary",
          instanceName: "secondary.test",
        },
        {
          id: "primary-query",
          domain: "primary.test",
          timestamp: 10,
          status: "FORWARDED",
          instanceId: "primary",
          instanceName: "Primary",
        },
      ],
      failures: [],
      complete: true,
    });
    expect(harness.client("offline").getQueries).not.toHaveBeenCalled();
  });

  it("reports no connected targets as incomplete rather than an authoritative empty result", async () => {
    harness.states.set("primary", { isConnected: false });
    harness.states.set("secondary", undefined);
    harness.states.set("offline", { isConnected: false });

    await expect(queries.searchDomain("example.com")).resolves.toEqual({
      entries: [],
      failures: [],
      complete: false,
    });
  });

  it("treats a malformed successful query response container as a target failure", async () => {
    harness.activeInstanceId = "primary";
    harness.client("primary").getQueries.mockResolvedValue({
      success: true,
      data: {},
    });

    await expect(queries.recentQueries()).resolves.toEqual({
      entries: [],
      failures: [
        {
          instanceId: "primary",
          instanceName: "Primary",
          message: "Invalid query response",
        },
      ],
      complete: false,
    });
  });

  it("treats malformed successful query entries as a target failure", async () => {
    harness.activeInstanceId = "primary";
    harness.client("primary").getQueries.mockResolvedValue({
      success: true,
      data: [{ domain: "example.com", timestamp: "invalid" }],
    });

    await expect(queries.recentQueries()).resolves.toEqual({
      entries: [],
      failures: [
        {
          instanceId: "primary",
          instanceName: "Primary",
          message: "Invalid query response",
        },
      ],
      complete: false,
    });
  });

  it("treats a query without a status as a target failure", async () => {
    harness.activeInstanceId = "primary";
    harness.client("primary").getQueries.mockResolvedValue({
      success: true,
      data: [{ domain: "blocked.test", timestamp: 1 }],
    });

    await expect(queries.recentQueries()).resolves.toEqual({
      entries: [],
      failures: [
        {
          instanceId: "primary",
          instanceName: "Primary",
          message: "Invalid query response",
        },
      ],
      complete: false,
    });
  });

  it("keeps valid empty query arrays complete", async () => {
    harness.states.set("primary", { isConnected: true });
    harness.states.set("secondary", { isConnected: true });
    harness.client("primary").getQueries.mockResolvedValue({
      success: true,
      data: [],
    });
    harness.client("secondary").getQueries.mockResolvedValue({
      success: true,
      data: { queries: [] },
    });

    await expect(queries.recentQueries()).resolves.toEqual({
      entries: [],
      failures: [],
      complete: true,
    });
  });
  it("normalizes a v5 query time field from a queries container", async () => {
    harness.activeInstanceId = "primary";
    harness.client("primary").getQueries.mockResolvedValue({
      success: true,
      data: {
        queries: [
          { id: "legacy-query", domain: "legacy.test", time: 25, status: 2 },
        ],
      },
    });

    await expect(queries.recentQueries()).resolves.toMatchObject({
      entries: [
        {
          id: "legacy-query",
          domain: "legacy.test",
          status: 2,
          instanceId: "primary",
          instanceName: "Primary",
        },
      ],
      failures: [],
      complete: true,
    });
  });

  it("keeps successful query entries visible alongside per-target failures", async () => {
    harness.states.set("primary", { isConnected: true });
    harness.states.set("secondary", { isConnected: true });
    harness.client("primary").getQueries.mockResolvedValue({
      success: true,
      data: [
        {
          id: "primary-query",
          domain: "primary.test",
          timestamp: 10,
          status: "GRAVITY",
        },
      ],
    });

    harness.client("secondary").getQueries.mockResolvedValue({
      success: false,
      error: { message: "secondary unavailable" },
    });

    await expect(queries.recentQueries()).resolves.toEqual({
      entries: [
        {
          id: "primary-query",
          domain: "primary.test",
          timestamp: 10,
          status: "GRAVITY",
          instanceId: "primary",
          instanceName: "Primary",
        },
      ],
      failures: [
        {
          instanceId: "secondary",
          instanceName: "secondary.test",
          message: "secondary unavailable",
        },
      ],
      complete: false,
    });
  });
  it("keeps successful domain entries visible alongside target failures", async () => {
    harness.states.set("primary", { isConnected: true });
    harness.states.set("secondary", { isConnected: true });
    harness.client("primary").searchDomain.mockResolvedValue({
      success: true,
      data: searchData({ domains: [{ type: "deny" }] }),
    });
    harness.client("secondary").searchDomain.mockResolvedValue({
      success: false,
      error: { message: "secondary unavailable" },
    });

    await expect(queries.searchDomain("example.com")).resolves.toEqual({
      entries: [
        {
          instanceId: "primary",
          instanceName: "Primary",
          gravity: false,
          allowlist: false,
          denylist: true,
        },
      ],
      failures: [
        {
          instanceId: "secondary",
          instanceName: "secondary.test",
          message: "secondary unavailable",
        },
      ],
      complete: false,
    });
  });

  it("does not represent all failed domain searches as a complete empty result", async () => {
    harness.states.set("primary", { isConnected: true });
    harness.states.set("secondary", { isConnected: true });
    harness
      .client("primary")
      .searchDomain.mockRejectedValue(new Error("network down"));
    harness.client("secondary").searchDomain.mockResolvedValue({
      success: false,
      error: { message: "authentication expired" },
    });

    await expect(queries.searchDomain("example.com")).resolves.toEqual({
      entries: [],
      failures: [
        {
          instanceId: "primary",
          instanceName: "Primary",
          message: "network down",
        },
        {
          instanceId: "secondary",
          instanceName: "secondary.test",
          message: "authentication expired",
        },
      ],
      complete: false,
    });
  });
  it("does not represent all failed query requests as a complete empty result", async () => {
    harness.states.set("primary", { isConnected: true });
    harness.states.set("secondary", { isConnected: true });
    harness.client("primary").getQueries.mockResolvedValue({
      success: false,
      error: { message: "primary unavailable" },
    });
    harness
      .client("secondary")
      .getQueries.mockRejectedValue(new Error("network down"));

    await expect(queries.recentQueries()).resolves.toEqual({
      entries: [],
      failures: [
        {
          instanceId: "primary",
          instanceName: "Primary",
          message: "primary unavailable",
        },
        {
          instanceId: "secondary",
          instanceName: "secondary.test",
          message: "network down",
        },
      ],
      complete: false,
    });
  });
});
