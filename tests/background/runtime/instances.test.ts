import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { InstanceRuntime } from "~/background/runtime/instances";
import type { ConnectInstanceFailure } from "~/utils/connection-failure";

type TestInstance = {
  id: string;
  name: string;
  url: string;
  savedPassword: string | null;
};

type TestSession = {
  sid: string;
  csrf: string;
  expiresAt: number;
};

type TestStats = {
  queries: number;
};

type AuthenticationResult =
  | { ok: true; session: TestSession }
  | {
      ok: false;
      reason: "totp" | "invalid";
      message: string;
      error?: ConnectInstanceFailure;
    };

type StatsResult =
  | { ok: true; stats: TestStats }
  | { ok: false; unauthorized: boolean; message: string };

type BlockingStatus = {
  blocking: "enabled" | "disabled";
  timer: number | null;
};

type BlockingResult =
  { ok: true; status: BlockingStatus } | { ok: false; message: string };

type RuntimeAdapters = {
  storage: {
    loadInstances(): Promise<{
      instances: TestInstance[];
      activeInstanceId: string | null;
    }>;
    addInstance(input: {
      name: string | null;
      piholeUrl: string;
      password: string;
      rememberPassword: boolean;
    }): Promise<TestInstance>;
    updateInstance(input: {
      instanceId: string;
      name?: string | null;
      piholeUrl?: string;
      password?: string;
      rememberPassword?: boolean;
    }): Promise<TestInstance | null>;
    removeInstanceConfiguration(instanceId: string): Promise<boolean>;
    setActiveInstance(instanceId: string | null): Promise<void>;
    loadSessions(): Promise<Map<string, TestSession>>;
    saveSession(instanceId: string, session: TestSession): Promise<void>;
    deleteSession(instanceId: string): Promise<void>;
    deleteInstanceCredentials(instanceId: string): Promise<void>;
  };
  clients: {
    configure(instance: TestInstance): TestClient;
    remove(instanceId: string): void;
  };
  state: {
    connectionSucceeded(instanceId: string): Promise<void>;
    requireTotp(instanceId: string): Promise<void>;
    connectionFailed(instanceId: string, error: string): Promise<void>;
    recordStatsSnapshot(instanceId: string, stats: TestStats): Promise<void>;
    recordBlockingSnapshot(
      instanceId: string,
      status: BlockingStatus,
    ): Promise<boolean>;
    disconnectInstance(instanceId: string): Promise<void>;
    selectInstance(instanceId: string | null): Promise<void>;
    removeInstance(
      instanceId: string,
      activeInstanceId: string | null,
    ): Promise<void>;
  };
  temporaryAllows: {
    removeForInstance(instanceId: string): Promise<void>;
  };
  now(): number;
  maxConsecutiveRenewalFailures: number;
  lifecycle?: {
    loadRenewalFailures(): Promise<Map<string, number>>;
    saveRenewalFailures(failures: Map<string, number>): Promise<void>;
  };
};

type InstanceRuntimeFactory = (adapters: RuntimeAdapters) => InstanceRuntime;

type RuntimeModule = {
  createInstanceRuntime: InstanceRuntimeFactory;
};

type Deferred<T> = {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(reason?: unknown): void;
};

type TestClient = {
  setSession: Mock<(sid: string, csrf: string) => void>;
  authenticate: Mock<
    (password: string | null, totp?: string) => Promise<AuthenticationResult>
  >;
  logout: Mock<() => Promise<void>>;
  getStats: Mock<() => Promise<StatsResult>>;
  getBlockingStatus: Mock<() => Promise<BlockingResult>>;
  setBlocking: Mock<
    (enabled: boolean, timer?: number) => Promise<BlockingResult>
  >;
};

const primary: TestInstance = {
  id: "primary",
  name: "Primary",
  url: "https://primary.test",
  savedPassword: "saved-password",
};

const secondary: TestInstance = {
  id: "secondary",
  name: "Secondary",
  url: "https://secondary.test",
  savedPassword: "secondary-password",
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, resolve, reject };
}

function successfulSession(expiresAt = 20_000): TestSession {
  return { sid: "sid", csrf: "csrf", expiresAt };
}

class RuntimeHarness {
  readonly clients = new Map<string, TestClient>();
  readonly instanceState = new Map<
    string,
    {
      connected: boolean;
      totpRequired: boolean;
      error: string | null;
      stats?: TestStats;
      blocking?: BlockingStatus;
    }
  >();
  readonly events: string[] = [];
  readonly sessions = new Map<string, TestSession>();
  readonly storage = {
    loadInstances: vi.fn(),
    addInstance: vi.fn(),
    updateInstance: vi.fn(),
    removeInstanceConfiguration: vi.fn(),
    setActiveInstance: vi.fn(),
    saveInstances: vi.fn(),
    loadSessions: vi.fn(),
    saveSession: vi.fn(),
    deleteSession: vi.fn(),
    deleteInstanceCredentials: vi.fn(),
  };
  readonly clientRegistry = {
    configure: vi.fn(),
    remove: vi.fn(),
  };
  readonly state = {
    connectionSucceeded: vi.fn(),
    requireTotp: vi.fn(),
    connectionFailed: vi.fn(),
    recordStatsSnapshot: vi.fn(),
    recordBlockingSnapshot: vi.fn(),
    disconnectInstance: vi.fn(),
    selectInstance: vi.fn(),
    removeInstance: vi.fn(),
  };
  readonly temporaryAllows = {
    removeForInstance: vi.fn(),
  };
  snapshot = {
    instances: [primary],
    activeInstanceId: primary.id as string | null,
  };
  now = 10_000;
  maxConsecutiveRenewalFailures = 3;

  constructor() {
    this.storage.loadInstances.mockImplementation(async () => this.snapshot);
    this.storage.saveInstances.mockImplementation(async (snapshot) => {
      this.events.push("storage.saveInstances");
      this.snapshot = structuredClone(snapshot);
    });
    this.storage.addInstance.mockImplementation(async (input) => {
      const instance: TestInstance = {
        id: input.piholeUrl,
        name: input.name ?? input.piholeUrl,
        url: input.piholeUrl,
        savedPassword: input.password,
      };
      this.snapshot.instances.push(instance);
      if (this.snapshot.instances.length === 1) {
        this.snapshot.activeInstanceId = instance.id;
      }
      return instance;
    });
    this.storage.updateInstance.mockImplementation(async (input) => {
      const instance = this.snapshot.instances.find(
        (candidate) => candidate.id === input.instanceId,
      );
      if (!instance) return null;
      if (input.name !== undefined) instance.name = input.name ?? "";
      if (input.piholeUrl !== undefined) instance.url = input.piholeUrl;
      if (input.password !== undefined) instance.savedPassword = input.password;
      return instance;
    });
    this.storage.removeInstanceConfiguration.mockImplementation(
      async (instanceId) => {
        const index = this.snapshot.instances.findIndex(
          (instance) => instance.id === instanceId,
        );
        if (index === -1) return false;
        this.events.push("storage.saveInstances");
        this.snapshot.instances.splice(index, 1);
        if (this.snapshot.activeInstanceId === instanceId) {
          this.snapshot.activeInstanceId =
            this.snapshot.instances[0]?.id ?? null;
        }
        return true;
      },
    );
    this.storage.setActiveInstance.mockImplementation(async (instanceId) => {
      if (
        instanceId !== null &&
        !this.snapshot.instances.some((instance) => instance.id === instanceId)
      ) {
        throw new Error(`Unknown instance: ${instanceId}`);
      }
      this.events.push("storage.saveInstances");
      this.snapshot.activeInstanceId = instanceId;
    });
    this.storage.loadSessions.mockImplementation(async () => this.sessions);
    this.storage.saveSession.mockImplementation(async (instanceId, session) => {
      this.events.push(`storage.saveSession:${instanceId}`);
      this.sessions.set(instanceId, session);
    });
    this.storage.deleteSession.mockImplementation(async (instanceId) => {
      this.events.push(`storage.deleteSession:${instanceId}`);
      this.sessions.delete(instanceId);
    });
    this.storage.deleteInstanceCredentials.mockImplementation(
      async (instanceId) => {
        this.events.push(`storage.deleteInstanceCredentials:${instanceId}`);
        this.sessions.delete(instanceId);
      },
    );
    this.clientRegistry.configure.mockImplementation((instance: TestInstance) =>
      this.client(instance.id),
    );
    this.clientRegistry.remove.mockImplementation((instanceId) => {
      this.events.push(`clients.remove:${instanceId}`);
      this.clients.delete(instanceId);
    });
    this.state.connectionSucceeded.mockImplementation(async (instanceId) => {
      this.events.push(`state.connected:${instanceId}`);
      this.instanceState.set(instanceId, {
        ...this.instanceState.get(instanceId),
        connected: true,
        totpRequired: false,
        error: null,
      });
    });
    this.state.requireTotp.mockImplementation(async (instanceId) => {
      this.events.push(`state.totp:${instanceId}`);
      this.instanceState.set(instanceId, {
        connected: false,
        totpRequired: true,
        error: null,
      });
    });
    this.state.connectionFailed.mockImplementation(
      async (instanceId, error) => {
        this.events.push(`state.failed:${instanceId}`);
        this.instanceState.set(instanceId, {
          connected: false,
          totpRequired: false,
          error,
        });
      },
    );
    this.state.recordStatsSnapshot.mockImplementation(
      async (instanceId, stats) => {
        this.events.push(`state.stats:${instanceId}`);
        this.instanceState.set(instanceId, {
          ...this.instanceState.get(instanceId),
          connected: true,
          totpRequired: false,
          error: null,
          stats,
        });
      },
    );
    this.state.recordBlockingSnapshot.mockImplementation(
      async (instanceId, status) => {
        this.events.push(`state.blocking:${instanceId}`);
        const state = this.instanceState.get(instanceId);
        if (!state?.connected || state.totpRequired) return false;
        this.instanceState.set(instanceId, {
          ...state,
          blocking: status,
        });
        return true;
      },
    );
    this.state.disconnectInstance.mockImplementation(async (instanceId) => {
      this.events.push(`state.disconnected:${instanceId}`);
      this.instanceState.set(instanceId, {
        connected: false,
        totpRequired: false,
        error: null,
      });
    });
    this.state.selectInstance.mockImplementation(async (instanceId) => {
      this.events.push("state.selection");
      this.snapshot.activeInstanceId = instanceId;
    });
    this.state.removeInstance.mockImplementation(
      async (instanceId, activeInstanceId) => {
        this.events.push(`state.removed:${instanceId}`);
        this.instanceState.delete(instanceId);
        this.snapshot.activeInstanceId = activeInstanceId;
      },
    );
    this.temporaryAllows.removeForInstance.mockImplementation(
      async (instanceId) => {
        this.events.push(`temporaryAllows.remove:${instanceId}`);
      },
    );
  }

  adapters(): RuntimeAdapters {
    return {
      storage: this.storage,
      clients: this.clientRegistry,
      state: this.state,
      temporaryAllows: this.temporaryAllows,
      now: () => this.now,
      maxConsecutiveRenewalFailures: this.maxConsecutiveRenewalFailures,
    };
  }

  client(instanceId: string): TestClient {
    const existing = this.clients.get(instanceId);
    if (existing) return existing;

    const client: TestClient = {
      setSession: vi.fn<(sid: string, csrf: string) => void>(),
      authenticate: vi
        .fn<
          (
            password: string | null,
            totp?: string,
          ) => Promise<AuthenticationResult>
        >()
        .mockResolvedValue({
          ok: true,
          session: successfulSession(),
        } satisfies AuthenticationResult),
      getBlockingStatus: vi
        .fn<() => Promise<BlockingResult>>()
        .mockResolvedValue({
          ok: true,
          status: { blocking: "enabled", timer: null },
        } satisfies BlockingResult),
      setBlocking: vi
        .fn<(enabled: boolean, timer?: number) => Promise<BlockingResult>>()
        .mockResolvedValue({
          ok: true,
          status: { blocking: "enabled", timer: null },
        } satisfies BlockingResult),
      logout: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
      getStats: vi.fn<() => Promise<StatsResult>>().mockResolvedValue({
        ok: true,
        stats: { queries: 12 },
      } satisfies StatsResult),
    };
    this.clients.set(instanceId, client);
    return client;
  }
}

/**
 * This suite is intentionally written against the public runtime factory and
 * `InstanceRuntime` interface. The adapters are test-only observables: they
 * represent the browser/storage, client registry, state publication, and
 * temporary-allow seams without importing background implementation details.
 *
 * A static value import cannot be used while this RED task deliberately
 * declares no factory implementation.
 */
const runtimeModule =
  (await import("~/background/runtime/instances")) as unknown as RuntimeModule;

let createInstanceRuntime: InstanceRuntimeFactory;
let harness: RuntimeHarness;
let runtime: InstanceRuntime;

beforeEach(() => {
  vi.clearAllMocks();
  harness = new RuntimeHarness();
  createInstanceRuntime = runtimeModule.createInstanceRuntime;
  runtime = createInstanceRuntime(harness.adapters());
});

describe("InstanceRuntime", () => {
  it("holds operations behind initialize until session restoration completes", async () => {
    const loading = deferred<{
      instances: TestInstance[];
      activeInstanceId: string | null;
    }>();
    harness.storage.loadInstances.mockReturnValueOnce(loading.promise);

    const initializing = runtime.initialize();
    const connecting = runtime.connect({
      instanceId: primary.id,
      password: "manual-password",
    });

    await Promise.resolve();
    expect(harness.client(primary.id).authenticate).not.toHaveBeenCalled();

    loading.resolve(harness.snapshot);
    await initializing;
    await connecting;

    expect(harness.client(primary.id).authenticate).toHaveBeenCalledWith(
      "manual-password",
      undefined,
    );
  });

  it("publishes a restored connection with available stats in one snapshot", async () => {
    const session = successfulSession(50_000);
    harness.sessions.set(primary.id, session);

    await runtime.initialize();

    expect(harness.client(primary.id).setSession).toHaveBeenCalledWith(
      session.sid,
      session.csrf,
    );
    expect(harness.state.recordStatsSnapshot).toHaveBeenCalledTimes(1);
    expect(harness.state.connectionSucceeded).not.toHaveBeenCalled();
    expect(harness.instanceState.get(primary.id)).toMatchObject({
      connected: true,
      error: null,
      stats: { queries: 12 },
    });
  });

  it("projects the persisted selection after initialization", async () => {
    harness.snapshot.instances = [primary, secondary];
    harness.snapshot.activeInstanceId = secondary.id;

    await runtime.initialize();

    expect(harness.state.selectInstance).toHaveBeenCalledWith(secondary.id);
  });

  it("connects with a supplied password and durably persists its session before publishing", async () => {
    await runtime.initialize();

    const result = await runtime.connect({
      instanceId: primary.id,
      password: "manual-password",
    });

    expect(result).toEqual({ ok: true });
    expect(harness.client(primary.id).authenticate).toHaveBeenCalledWith(
      "manual-password",
      undefined,
    );
    expect(harness.sessions.get(primary.id)).toEqual(successfulSession());
    expect(harness.events).toContain("storage.saveSession:primary");
    expect(harness.events.indexOf("storage.saveSession:primary")).toBeLessThan(
      harness.events.indexOf("state.connected:primary"),
    );
    expect(harness.instanceState.get(primary.id)).toMatchObject({
      connected: true,
      totpRequired: false,
      error: null,
    });
  });

  it("awaits semantic connection publication before resolving", async () => {
    await runtime.initialize();
    const publication = deferred<void>();
    harness.state.connectionSucceeded.mockImplementationOnce(
      async () => publication.promise,
    );

    let resolved = false;
    const connection = runtime
      .connect({ instanceId: primary.id, password: "manual-password" })
      .then(() => {
        resolved = true;
      });
    await vi.waitFor(() => {
      expect(harness.state.connectionSucceeded).toHaveBeenCalledTimes(1);
    });

    expect(resolved).toBe(false);
    publication.resolve(undefined);
    await connection;
    expect(resolved).toBe(true);
  });

  it("propagates connection publication failures without reporting an auth failure", async () => {
    await runtime.initialize();
    harness.state.connectionSucceeded.mockRejectedValueOnce(
      new Error("state broadcast failed"),
    );

    await expect(
      runtime.connect({ instanceId: primary.id, password: "manual-password" }),
    ).rejects.toThrow("state broadcast failed");

    expect(harness.state.connectionFailed).not.toHaveBeenCalled();
  });

  it("returns a structured TOTP challenge without treating it as a failed password", async () => {
    await runtime.initialize();
    harness.client(primary.id).authenticate.mockResolvedValueOnce({
      ok: false,
      reason: "totp",
      message: "One-time password required",
    } satisfies AuthenticationResult);

    const result = await runtime.connect({
      instanceId: primary.id,
      password: "manual-password",
    });

    expect(result).toEqual({ ok: false, totpRequired: true });
    expect(harness.state.requireTotp).toHaveBeenCalledTimes(1);
    expect(harness.state.connectionSucceeded).not.toHaveBeenCalled();
    expect(harness.instanceState.get(primary.id)).toMatchObject({
      connected: false,
      totpRequired: true,
      error: null,
    });
  });

  it("returns normalized password failures and clears a pending TOTP state", async () => {
    await runtime.initialize();
    harness.client(primary.id).authenticate.mockResolvedValueOnce({
      ok: false,
      reason: "invalid",
      message: "Password rejected",
      error: {
        kind: "authentication",
        message: "Password rejected",
        status: 401,
      },
    } satisfies AuthenticationResult);

    const result = await runtime.connect({
      instanceId: primary.id,
      password: "wrong-password",
      totp: "123456",
    });

    expect(result).toEqual({
      ok: false,
      totpRequired: false,
      message: "Password rejected",
      error: {
        kind: "authentication",
        message: "Password rejected",
        status: 401,
      },
    });
    expect(harness.instanceState.get(primary.id)).toMatchObject({
      connected: false,
      totpRequired: false,
      error: "Password rejected",
    });
  });

  it("renews an expiring session from saved credentials", async () => {
    harness.sessions.set(primary.id, successfulSession(10_001));
    await runtime.initialize();
    harness.client(primary.id).authenticate.mockResolvedValueOnce({
      ok: true,
      session: successfulSession(30_000),
    } satisfies AuthenticationResult);

    await runtime.keepAlive();

    expect(harness.client(primary.id).authenticate).toHaveBeenCalledWith(
      primary.savedPassword,
      undefined,
    );
    expect(harness.sessions.get(primary.id)).toEqual(successfulSession(30_000));
    expect(harness.instanceState.get(primary.id)).toMatchObject({
      connected: true,
      error: null,
    });
  });

  it("propagates renewal publication failures without reporting an auth failure", async () => {
    const saveRenewalFailures = vi.fn().mockResolvedValue(undefined);
    runtime = createInstanceRuntime({
      ...harness.adapters(),
      lifecycle: {
        loadRenewalFailures: vi.fn().mockResolvedValue(new Map()),
        saveRenewalFailures,
      },
    });
    harness.sessions.set(primary.id, successfulSession(10_001));
    await runtime.initialize();
    harness.state.connectionSucceeded.mockRejectedValueOnce(
      new Error("state broadcast failed"),
    );

    await expect(runtime.keepAlive()).rejects.toThrow("state broadcast failed");

    expect(harness.state.connectionFailed).not.toHaveBeenCalled();
    expect(saveRenewalFailures).not.toHaveBeenCalled();
  });

  it("opens a per-instance renewal circuit after consecutive failures but lets manual connect retry", async () => {
    harness.sessions.set(primary.id, successfulSession(10_001));
    await runtime.initialize();
    const client = harness.client(primary.id);
    client.authenticate.mockResolvedValue({
      ok: false,
      reason: "invalid",
      message: "Server unavailable",
    } satisfies AuthenticationResult);

    await runtime.keepAlive();
    await runtime.keepAlive();
    await runtime.keepAlive();
    await runtime.keepAlive();

    expect(client.authenticate).toHaveBeenCalledTimes(3);

    client.authenticate.mockResolvedValueOnce({
      ok: true,
      session: successfulSession(30_000),
    } satisfies AuthenticationResult);
    const result = await runtime.connect({
      instanceId: primary.id,
      password: "manual-password",
    });

    expect(result).toEqual({ ok: true });
    expect(client.authenticate).toHaveBeenCalledTimes(4);
  });

  it("durably selects before it publishes the new selection", async () => {
    harness.snapshot.instances = [primary, secondary];
    await runtime.initialize();
    harness.events.length = 0;

    await runtime.select(secondary.id);

    expect(harness.snapshot.activeInstanceId).toBe(secondary.id);
    expect(harness.events.indexOf("storage.saveInstances")).toBeLessThan(
      harness.events.indexOf("state.selection"),
    );
  });

  it("retains a newly committed instance when a stale runtime selects another", async () => {
    await runtime.initialize();
    harness.snapshot.instances.push(secondary);

    await runtime.select(primary.id);

    expect(harness.snapshot.instances.map((instance) => instance.id)).toEqual([
      primary.id,
      secondary.id,
    ]);
  });

  it("updates configuration before connecting with the current saved password", async () => {
    await runtime.initialize();

    await runtime.update({
      instanceId: primary.id,
      password: "updated-password",
    });
    await runtime.connect({ instanceId: primary.id });

    expect(harness.client(primary.id).authenticate).toHaveBeenCalledWith(
      "updated-password",
      undefined,
    );
  });

  it("does not publish a selection when durable selection storage fails", async () => {
    harness.snapshot.instances = [primary, secondary];
    await runtime.initialize();
    harness.state.selectInstance.mockClear();
    harness.storage.setActiveInstance.mockRejectedValueOnce(
      new Error("disk full"),
    );

    await expect(runtime.select(secondary.id)).rejects.toThrow("disk full");

    expect(harness.snapshot.activeInstanceId).toBe(primary.id);
    expect(harness.state.selectInstance).not.toHaveBeenCalled();
  });

  it("refreshes stats only for connected instances", async () => {
    harness.snapshot.instances = [primary, secondary];
    harness.sessions.set(primary.id, successfulSession(50_000));
    await runtime.initialize();
    harness.events.length = 0;

    await runtime.refreshStats();

    expect(harness.client(primary.id).getStats).toHaveBeenCalled();
    expect(harness.client(secondary.id).getStats).not.toHaveBeenCalled();
    expect(harness.state.recordStatsSnapshot).toHaveBeenCalledWith(primary.id, {
      queries: 12,
    });
    expect(harness.instanceState.get(primary.id)).toMatchObject({
      stats: { queries: 12 },
    });
  });

  it("propagates stats publication failures", async () => {
    harness.sessions.set(primary.id, successfulSession(50_000));
    await runtime.initialize();
    harness.state.recordStatsSnapshot.mockRejectedValueOnce(
      new Error("state broadcast failed"),
    );

    await expect(runtime.refreshStats()).rejects.toThrow(
      "state broadcast failed",
    );
  });

  it("disconnects by clearing the durable session and connected state", async () => {
    harness.sessions.set(primary.id, successfulSession(50_000));
    await runtime.initialize();
    harness.events.length = 0;

    await runtime.disconnect(primary.id);

    expect(harness.client(primary.id).logout).toHaveBeenCalledTimes(1);
    expect(harness.sessions.has(primary.id)).toBe(false);
    expect(
      harness.events.indexOf("storage.deleteSession:primary"),
    ).toBeLessThan(harness.events.indexOf("state.disconnected:primary"));
    expect(harness.instanceState.get(primary.id)).toMatchObject({
      connected: false,
      totpRequired: false,
      error: null,
    });
  });

  it("removes temporary allows while the client exists before deleting the instance", async () => {
    harness.sessions.set(primary.id, successfulSession(50_000));
    await runtime.initialize();
    harness.events.length = 0;

    await runtime.remove(primary.id);

    expect(harness.temporaryAllows.removeForInstance).toHaveBeenCalledWith(
      primary.id,
    );
    expect(harness.events).toEqual(
      expect.arrayContaining([
        "temporaryAllows.remove:primary",
        "storage.saveInstances",
        "clients.remove:primary",
      ]),
    );
    expect(
      harness.events.indexOf("temporaryAllows.remove:primary"),
    ).toBeLessThan(harness.events.indexOf("storage.saveInstances"));
    expect(harness.storage.deleteInstanceCredentials).toHaveBeenCalledWith(
      primary.id,
    );
    expect(harness.state.removeInstance).toHaveBeenCalledWith(primary.id, null);
    expect(harness.events.indexOf("storage.saveInstances")).toBeLessThan(
      harness.events.indexOf("storage.deleteInstanceCredentials:primary"),
    );
    expect(harness.snapshot.instances).toEqual([]);
  });

  it("removes a newly added instance before it has ever connected", async () => {
    await runtime.initialize();
    const added = await runtime.add({
      name: "New",
      piholeUrl: "https://new.test",
      password: "new-password",
      rememberPassword: false,
    });

    await expect(runtime.remove(added.id)).resolves.toBe(true);

    expect(harness.snapshot.instances.map((instance) => instance.id)).toEqual([
      primary.id,
    ]);
    expect(harness.storage.removeInstanceConfiguration).toHaveBeenCalledWith(
      added.id,
    );
  });

  it("aborts deletion without publishing a removed instance when temporary-allow cleanup fails", async () => {
    await runtime.initialize();
    harness.temporaryAllows.removeForInstance.mockRejectedValueOnce(
      new Error("managed allow removal failed"),
    );

    await expect(runtime.remove(primary.id)).rejects.toThrow(
      "managed allow removal failed",
    );

    expect(harness.snapshot.instances).toEqual([primary]);
    expect(harness.storage.saveInstances).not.toHaveBeenCalled();
    expect(harness.clientRegistry.remove).not.toHaveBeenCalled();
  });

  it("fails closed when it cannot persist a new session", async () => {
    await runtime.initialize();
    harness.storage.saveSession.mockRejectedValueOnce(
      new Error("storage offline"),
    );

    const result = await runtime.connect({
      instanceId: primary.id,
      password: "manual-password",
    });

    expect(result).toEqual({
      ok: false,
      totpRequired: false,
      message: "storage offline",
    });
    expect(harness.sessions.has(primary.id)).toBe(false);
    expect(harness.instanceState.get(primary.id)).not.toMatchObject({
      connected: true,
    });
  });

  it("does not persist a stale renewal before a queued disconnect completes", async () => {
    harness.sessions.set(primary.id, successfulSession(10_001));
    await runtime.initialize();
    harness.sessions.clear();
    const authentication = deferred<AuthenticationResult>();
    const logout = deferred<void>();
    const client = harness.client(primary.id);
    client.authenticate
      .mockReturnValueOnce(authentication.promise)
      .mockResolvedValueOnce({
        ok: true,
        session: successfulSession(30_000),
      } satisfies AuthenticationResult);
    client.logout.mockReturnValueOnce(logout.promise);

    const connecting = runtime.connect({
      instanceId: primary.id,
      password: "manual-password",
    });
    await vi.waitFor(() => {
      expect(client.authenticate).toHaveBeenCalledTimes(1);
    });

    const renewing = runtime.keepAlive();
    await Promise.resolve();
    await Promise.resolve();
    const disconnecting = runtime.disconnect(primary.id);
    authentication.resolve({
      ok: false,
      reason: "invalid",
      message: "Cancelled",
    } satisfies AuthenticationResult);

    await connecting;
    await renewing;
    await Promise.resolve();

    expect(client.logout).toHaveBeenCalledTimes(1);
    expect(harness.sessions.has(primary.id)).toBe(false);

    logout.resolve();
    await disconnecting;
  });

  it("does not let a stale connect completion resurrect a disconnected instance", async () => {
    await runtime.initialize();
    const authentication = deferred<AuthenticationResult>();
    harness
      .client(primary.id)
      .authenticate.mockReturnValueOnce(authentication.promise);

    const connecting = runtime.connect({
      instanceId: primary.id,
      password: "manual-password",
    });
    await Promise.resolve();
    const disconnecting = runtime.disconnect(primary.id);
    authentication.resolve({ ok: true, session: successfulSession(30_000) });

    await disconnecting;
    await connecting;

    expect(harness.sessions.has(primary.id)).toBe(false);
    expect(harness.instanceState.get(primary.id)).toMatchObject({
      connected: false,
    });
  });

  it("records current blocking reads and writes through the runtime", async () => {
    await runtime.initialize();
    await runtime.connect({
      instanceId: primary.id,
      password: "manual-password",
    });

    await expect(runtime.getBlockingStatus(primary.id)).resolves.toEqual({
      ok: true,
      status: { blocking: "enabled", timer: null },
    });
    await expect(runtime.setBlocking(primary.id, false, 60)).resolves.toEqual({
      ok: true,
      status: { blocking: "enabled", timer: null },
    });

    expect(harness.state.recordBlockingSnapshot).toHaveBeenCalledTimes(2);
    expect(harness.client(primary.id).setBlocking).toHaveBeenCalledWith(
      false,
      60,
    );
  });
  it("does not record a stale blocking-status response after disconnect", async () => {
    await runtime.initialize();
    await runtime.connect({
      instanceId: primary.id,
      password: "manual-password",
    });
    const response = deferred<BlockingResult>();
    harness
      .client(primary.id)
      .getBlockingStatus.mockReturnValueOnce(response.promise);

    const reading = runtime.getBlockingStatus(primary.id);
    await vi.waitFor(() => {
      expect(
        harness.client(primary.id).getBlockingStatus,
      ).toHaveBeenCalledTimes(1);
    });
    const disconnecting = runtime.disconnect(primary.id);
    response.resolve({
      ok: true,
      status: { blocking: "disabled", timer: 60 },
    });

    await expect(reading).resolves.toEqual({
      ok: false,
      message: "Operation superseded",
    });
    await disconnecting;

    expect(harness.state.recordBlockingSnapshot).not.toHaveBeenCalled();
    expect(harness.instanceState.get(primary.id)).toMatchObject({
      connected: false,
    });
  });

  it("does not record a stale set-blocking response after removal", async () => {
    await runtime.initialize();
    await runtime.connect({
      instanceId: primary.id,
      password: "manual-password",
    });
    const response = deferred<BlockingResult>();
    harness
      .client(primary.id)
      .setBlocking.mockReturnValueOnce(response.promise);

    const setting = runtime.setBlocking(primary.id, false, 60);
    await vi.waitFor(() => {
      expect(harness.client(primary.id).setBlocking).toHaveBeenCalledWith(
        false,
        60,
      );
    });
    const removing = runtime.remove(primary.id);
    response.resolve({
      ok: true,
      status: { blocking: "disabled", timer: 60 },
    });

    await expect(setting).resolves.toEqual({
      ok: false,
      message: "Operation superseded",
    });
    await removing;

    expect(harness.state.recordBlockingSnapshot).not.toHaveBeenCalled();
    expect(harness.instanceState.has(primary.id)).toBe(false);
  });

  it("does not record a stale blocking-status response after a TOTP challenge", async () => {
    await runtime.initialize();
    await runtime.connect({
      instanceId: primary.id,
      password: "manual-password",
    });
    const response = deferred<BlockingResult>();
    harness
      .client(primary.id)
      .getBlockingStatus.mockReturnValueOnce(response.promise);
    harness.client(primary.id).authenticate.mockResolvedValueOnce({
      ok: false,
      reason: "totp",
      message: "One-time password required",
    } satisfies AuthenticationResult);

    const reading = runtime.getBlockingStatus(primary.id);
    await vi.waitFor(() => {
      expect(
        harness.client(primary.id).getBlockingStatus,
      ).toHaveBeenCalledTimes(1);
    });
    const reconnecting = runtime.connect({
      instanceId: primary.id,
      password: "manual-password",
    });
    response.resolve({
      ok: true,
      status: { blocking: "disabled", timer: 60 },
    });

    await expect(reading).resolves.toEqual({
      ok: false,
      message: "Operation superseded",
    });
    await expect(reconnecting).resolves.toEqual({
      ok: false,
      totpRequired: true,
    });
    expect(harness.state.recordBlockingSnapshot).not.toHaveBeenCalled();
    expect(harness.instanceState.get(primary.id)).toMatchObject({
      connected: false,
      totpRequired: true,
    });
  });

  it("does not record a stale set-blocking response after reconnect", async () => {
    await runtime.initialize();
    await runtime.connect({
      instanceId: primary.id,
      password: "manual-password",
    });
    const response = deferred<BlockingResult>();
    harness
      .client(primary.id)
      .setBlocking.mockReturnValueOnce(response.promise);

    const setting = runtime.setBlocking(primary.id, false, 60);
    await vi.waitFor(() => {
      expect(harness.client(primary.id).setBlocking).toHaveBeenCalledWith(
        false,
        60,
      );
    });
    const reconnecting = runtime.connect({
      instanceId: primary.id,
      password: "manual-password",
    });
    response.resolve({
      ok: true,
      status: { blocking: "disabled", timer: 60 },
    });

    await expect(setting).resolves.toEqual({
      ok: false,
      message: "Operation superseded",
    });
    await expect(reconnecting).resolves.toEqual({ ok: true });
    expect(harness.state.recordBlockingSnapshot).not.toHaveBeenCalled();
  });

  it("does not publish stats from a refresh that completed after removal", async () => {
    harness.sessions.set(primary.id, successfulSession(50_000));
    await runtime.initialize();
    const stats = deferred<StatsResult>();
    harness.client(primary.id).getStats.mockReturnValueOnce(stats.promise);

    const refreshing = runtime.refreshStats();
    await Promise.resolve();
    const removing = runtime.remove(primary.id);
    stats.resolve({ ok: true, stats: { queries: 99 } });

    await removing;
    await refreshing;

    expect(harness.snapshot.instances).toEqual([]);
    expect(harness.instanceState.get(primary.id)).not.toMatchObject({
      stats: { queries: 99 },
    });
  });
});
