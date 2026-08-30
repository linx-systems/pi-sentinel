import type { ConnectInstanceFailure } from "~/utils/connection-failure";
import type { BlockingStatus } from "~/utils/types";

export type ConnectInstanceInput = {
  instanceId: string;
  password?: string;
  totp?: string;
};

export type AddInstanceInput = {
  name: string | null;
  piholeUrl: string;
  password: string;
  rememberPassword: boolean;
};

export type UpdateInstanceInput = {
  instanceId: string;
  name?: string | null;
  piholeUrl?: string;
  password?: string;
  rememberPassword?: boolean;
};

export type ConnectResult =
  | { ok: true }
  | { ok: false; totpRequired: true }
  | {
      ok: false;
      totpRequired: false;
      message: string;
      error?: ConnectInstanceFailure;
    };

export type BlockingOperationResult =
  { ok: true; status: BlockingStatus } | { ok: false; message: string };

export interface InstanceRuntime {
  initialize(): Promise<void>;
  add(input: AddInstanceInput): Promise<RuntimeInstance>;
  update(input: UpdateInstanceInput): Promise<RuntimeInstance | null>;
  connect(input: ConnectInstanceInput): Promise<ConnectResult>;
  disconnect(instanceId: string): Promise<void>;
  select(instanceId: string | null): Promise<void>;
  remove(instanceId: string): Promise<boolean>;
  keepAlive(): Promise<void>;
  refreshStats(): Promise<void>;
  getBlockingStatus(instanceId: string): Promise<BlockingOperationResult>;
  setBlocking(
    instanceId: string,
    enabled: boolean,
    timer?: number,
  ): Promise<BlockingOperationResult>;
}

export type RuntimeInstance = {
  id: string;
  savedPassword: string | null;
  piholeUrl?: string;
};
type RuntimeSession = {
  sid: string;
  csrf: string;
  expiresAt: number;
};

type AuthenticationResult =
  | { ok: true; session: RuntimeSession }
  | {
      ok: false;
      reason: "totp" | "invalid";
      message: string;
      error?: ConnectInstanceFailure;
    };

type StatsResult =
  | { ok: true; stats: unknown }
  | { ok: false; unauthorized: boolean; message: string };

type RuntimeClient = {
  setSession(sid: string, csrf: string): void;
  authenticate(
    password: string | null,
    totp?: string,
  ): Promise<AuthenticationResult>;
  logout(): Promise<unknown>;
  getStats(): Promise<StatsResult>;
  getBlockingStatus(): Promise<BlockingOperationResult>;
  setBlocking(
    enabled: boolean,
    timer?: number,
  ): Promise<BlockingOperationResult>;
};

type RuntimeAdapters = {
  storage: {
    loadInstances(): Promise<{
      instances: RuntimeInstance[];
      activeInstanceId: string | null;
    }>;
    addInstance(input: AddInstanceInput): Promise<RuntimeInstance>;
    updateInstance(input: UpdateInstanceInput): Promise<RuntimeInstance | null>;
    removeInstanceConfiguration(instanceId: string): Promise<boolean>;
    setActiveInstance(instanceId: string | null): Promise<void>;
    loadSessions(): Promise<Map<string, RuntimeSession>>;
    saveSession(instanceId: string, session: RuntimeSession): Promise<void>;
    deleteSession(instanceId: string): Promise<void>;
    deleteInstanceCredentials(instanceId: string): Promise<void>;
  };
  clients: {
    configure(instance: RuntimeInstance): RuntimeClient;
    remove(instanceId: string): void;
  };
  state: {
    connectionSucceeded(instanceId: string): Promise<void>;
    requireTotp(instanceId: string): Promise<void>;
    connectionFailed(instanceId: string, error: string): Promise<void>;
    recordStatsSnapshot(instanceId: string, stats: unknown): Promise<void>;
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
  getSavedPassword?(instance: RuntimeInstance): Promise<string | null>;
  lifecycle?: {
    loadRenewalFailures(): Promise<Map<string, number>>;
    saveRenewalFailures(failures: Map<string, number>): Promise<void>;
  };
};

type InstanceState = {
  connected: boolean;
  session: RuntimeSession | null;
};

const RENEWAL_WINDOW_MS = 60_000;

class ManagedInstanceRuntime implements InstanceRuntime {
  private initialization: Promise<void> | null = null;
  private initialized = false;
  private readonly removing = new Set<string>();
  private snapshot: {
    instances: RuntimeInstance[];
    activeInstanceId: string | null;
  } = { instances: [], activeInstanceId: null };
  private sessions = new Map<string, RuntimeSession>();
  private readonly clients = new Map<string, RuntimeClient>();
  private readonly states = new Map<string, InstanceState>();
  private readonly generations = new Map<string, number>();
  private readonly renewalFailures = new Map<string, number>();
  private readonly operationTails = new Map<string, Promise<void>>();
  private mutationTail: Promise<void> = Promise.resolve();

  constructor(private readonly adapters: RuntimeAdapters) {}

  initialize(): Promise<void> {
    this.initialization ??= this.initializeOnce();
    return this.initialization;
  }

  async add(input: AddInstanceInput): Promise<RuntimeInstance> {
    await this.ready();
    return this.mutate(async () => {
      const instance = await this.adapters.storage.addInstance(input);
      await this.reloadSnapshot();
      await this.adapters.state.selectInstance(this.snapshot.activeInstanceId);
      return instance;
    });
  }

  async update(input: UpdateInstanceInput): Promise<RuntimeInstance | null> {
    await this.ready();
    return this.mutate(async () => {
      const instance = await this.adapters.storage.updateInstance(input);
      if (!instance) return null;
      this.clients.delete(input.instanceId);
      this.adapters.clients.remove(input.instanceId);
      await this.reloadSnapshot();
      return instance;
    });
  }

  async connect(input: ConnectInstanceInput): Promise<ConnectResult> {
    this.invalidate(input.instanceId);
    const generation = this.generation(input.instanceId);
    await this.ready();
    await this.reloadSnapshot();
    const instance = this.instance(input.instanceId);
    if (!instance) return this.failure(`Unknown instance: ${input.instanceId}`);

    await this.resetRenewalFailures(input.instanceId);
    return this.enqueue(input.instanceId, async () => {
      const client = this.client(instance);
      const password =
        input.password ?? (await this.getSavedPassword(instance));
      let result: AuthenticationResult;
      try {
        result = await client.authenticate(password, input.totp);
      } catch (error) {
        return this.failure(errorMessage(error));
      }

      if (!this.current(input.instanceId, generation)) {
        return {
          ok: false,
          totpRequired: false,
          message: "Operation superseded",
        };
      }

      if (!result.ok) {
        if (result.reason === "totp") {
          await this.adapters.state.requireTotp(input.instanceId);
          return { ok: false, totpRequired: true };
        }

        await this.adapters.state.connectionFailed(
          input.instanceId,
          result.message,
        );
        return this.failure(result.message, result.error);
      }

      try {
        await this.adapters.storage.saveSession(
          input.instanceId,
          result.session,
        );
      } catch (error) {
        return this.failure(errorMessage(error));
      }

      if (!this.current(input.instanceId, generation)) {
        return {
          ok: false,
          totpRequired: false,
          message: "Operation superseded",
        };
      }

      this.sessions.set(input.instanceId, result.session);
      this.states.set(input.instanceId, {
        connected: true,
        session: result.session,
      });
      await this.adapters.state.connectionSucceeded(input.instanceId);
      return { ok: true };
    });
  }

  async disconnect(instanceId: string): Promise<void> {
    this.invalidate(instanceId);
    await this.ready();
    await this.enqueue(instanceId, async () => {
      const client = this.clients.get(instanceId);
      try {
        await client?.logout();
      } finally {
        await this.adapters.storage.deleteSession(instanceId);
      }

      this.sessions.delete(instanceId);
      this.states.set(instanceId, { connected: false, session: null });
      await this.adapters.state.disconnectInstance(instanceId);
    });
  }

  async select(instanceId: string | null): Promise<void> {
    await this.ready();
    await this.mutate(async () => {
      await this.adapters.storage.setActiveInstance(instanceId);
      await this.reloadSnapshot();
      await this.adapters.state.selectInstance(this.snapshot.activeInstanceId);
    });
  }

  async remove(instanceId: string): Promise<boolean> {
    this.invalidate(instanceId);
    this.removing.add(instanceId);
    try {
      await this.ready();
      return await this.mutate(async () => {
        await this.reloadSnapshot();
        if (!this.instance(instanceId)) return false;

        await this.adapters.temporaryAllows.removeForInstance(instanceId);
        if (
          !(await this.adapters.storage.removeInstanceConfiguration(instanceId))
        ) {
          return false;
        }

        await this.reloadSnapshot();
        await this.adapters.storage.deleteInstanceCredentials(instanceId);
        this.sessions.delete(instanceId);
        this.states.delete(instanceId);
        this.clients.delete(instanceId);
        this.adapters.clients.remove(instanceId);
        await this.adapters.state.removeInstance(
          instanceId,
          this.snapshot.activeInstanceId,
        );
        return true;
      });
    } catch (error) {
      this.removing.delete(instanceId);
      throw error;
    }
  }

  async keepAlive(): Promise<void> {
    await this.ready();
    await Promise.all(
      this.snapshot.instances.map(async (instance) => {
        const state = this.states.get(instance.id);
        if (
          !state?.connected ||
          !state.session ||
          state.session.expiresAt - this.adapters.now() > RENEWAL_WINDOW_MS ||
          (this.renewalFailures.get(instance.id) ?? 0) >=
            this.adapters.maxConsecutiveRenewalFailures
        ) {
          return;
        }

        const generation = this.generation(instance.id);
        await this.enqueue(instance.id, async () => {
          const password = await this.getSavedPassword(instance);
          if (password === null) return;

          let result: AuthenticationResult;
          try {
            result = await this.client(instance).authenticate(
              password,
              undefined,
            );
          } catch (error) {
            if (!this.current(instance.id, generation)) return;
            await this.recordRenewalFailure(instance.id);
            await this.adapters.state.connectionFailed(
              instance.id,
              errorMessage(error),
            );
            return;
          }

          if (!this.current(instance.id, generation)) return;
          if (!result.ok) {
            await this.recordRenewalFailure(instance.id);
            await this.adapters.state.connectionFailed(
              instance.id,
              result.message,
            );
            return;
          }

          await this.adapters.storage.saveSession(instance.id, result.session);
          if (!this.current(instance.id, generation)) return;
          this.sessions.set(instance.id, result.session);
          this.states.set(instance.id, {
            connected: true,
            session: result.session,
          });
          await this.resetRenewalFailures(instance.id);
          await this.adapters.state.connectionSucceeded(instance.id);
        });
      }),
    );
  }

  async refreshStats(): Promise<void> {
    await this.ready();
    await Promise.all(
      this.snapshot.instances.map(async (instance) => {
        if (!this.states.get(instance.id)?.connected) return;
        const generation = this.generation(instance.id);
        let result: StatsResult;
        try {
          result = await this.client(instance).getStats();
        } catch {
          // A failed refresh does not change the connection lifecycle state.
          return;
        }

        if (!this.current(instance.id, generation) || !result.ok) return;
        await this.adapters.state.recordStatsSnapshot(
          instance.id,
          result.stats,
        );
      }),
    );
  }

  async getBlockingStatus(
    instanceId: string,
  ): Promise<BlockingOperationResult> {
    return this.blockingOperation(instanceId, (client) =>
      client.getBlockingStatus(),
    );
  }

  async setBlocking(
    instanceId: string,
    enabled: boolean,
    timer?: number,
  ): Promise<BlockingOperationResult> {
    return this.blockingOperation(instanceId, (client) =>
      client.setBlocking(enabled, timer),
    );
  }

  private async initializeOnce(): Promise<void> {
    const [loaded, sessions, renewalFailures] = await Promise.all([
      this.adapters.storage.loadInstances(),
      this.adapters.storage.loadSessions(),
      this.adapters.lifecycle?.loadRenewalFailures() ??
        Promise.resolve(new Map<string, number>()),
    ]);
    this.snapshot = structuredClone(loaded);
    this.sessions = new Map(sessions);
    this.renewalFailures.clear();
    for (const [instanceId, failures] of renewalFailures) {
      this.renewalFailures.set(instanceId, failures);
    }

    for (const instance of this.snapshot.instances) {
      const client = this.client(instance);
      const session = this.sessions.get(instance.id);
      if (!session || session.expiresAt <= this.adapters.now()) continue;

      client.setSession(session.sid, session.csrf);
      this.states.set(instance.id, { connected: true, session });
      const stats = await client.getStats();
      if (stats.ok) {
        await this.adapters.state.recordStatsSnapshot(instance.id, stats.stats);
      } else {
        await this.adapters.state.connectionSucceeded(instance.id);
      }
    }
    await this.adapters.state.selectInstance(this.snapshot.activeInstanceId);

    this.initialized = true;
  }

  private async blockingOperation(
    instanceId: string,
    operation: (client: RuntimeClient) => Promise<BlockingOperationResult>,
  ): Promise<BlockingOperationResult> {
    const generation = this.generation(instanceId);
    await this.ready();
    await this.reloadSnapshot();
    const instance = this.instance(instanceId);
    if (!instance) {
      return { ok: false, message: `Unknown instance: ${instanceId}` };
    }
    if (!this.current(instanceId, generation)) return this.superseded();

    return this.enqueue(instanceId, async () => {
      if (!this.current(instanceId, generation)) return this.superseded();
      const result = await operation(this.client(instance));
      if (!this.current(instanceId, generation)) return this.superseded();
      if (!result.ok) return result;

      return (await this.adapters.state.recordBlockingSnapshot(
        instanceId,
        result.status,
      ))
        ? result
        : this.superseded();
    });
  }

  private async ready(): Promise<void> {
    await this.initialize();
    if (!this.initialized)
      throw new Error("Instance runtime initialization failed");
  }

  private async reloadSnapshot(): Promise<void> {
    const snapshot = await this.adapters.storage.loadInstances();
    this.snapshot = structuredClone(snapshot);
  }

  private instance(instanceId: string): RuntimeInstance | undefined {
    return this.snapshot.instances.find(
      (instance) => instance.id === instanceId,
    );
  }

  private client(instance: RuntimeInstance): RuntimeClient {
    let client = this.clients.get(instance.id);
    if (!client) {
      client = this.adapters.clients.configure(instance);
      this.clients.set(instance.id, client);
    }
    return client;
  }

  private async getSavedPassword(
    instance: RuntimeInstance,
  ): Promise<string | null> {
    return this.adapters.getSavedPassword
      ? this.adapters.getSavedPassword(instance)
      : instance.savedPassword;
  }

  private generation(instanceId: string): number {
    return this.generations.get(instanceId) ?? 0;
  }

  private current(instanceId: string, generation: number): boolean {
    return (
      !this.removing.has(instanceId) &&
      this.instance(instanceId) !== undefined &&
      this.generation(instanceId) === generation
    );
  }

  private superseded(): BlockingOperationResult {
    return { ok: false, message: "Operation superseded" };
  }

  private async recordRenewalFailure(instanceId: string): Promise<void> {
    this.renewalFailures.set(
      instanceId,
      (this.renewalFailures.get(instanceId) ?? 0) + 1,
    );
    await this.adapters.lifecycle?.saveRenewalFailures(this.renewalFailures);
  }

  private async resetRenewalFailures(instanceId: string): Promise<void> {
    if (!this.renewalFailures.delete(instanceId)) return;
    await this.adapters.lifecycle?.saveRenewalFailures(this.renewalFailures);
  }

  private invalidate(instanceId: string): void {
    this.generations.set(instanceId, this.generation(instanceId) + 1);
  }

  private enqueue<T>(
    instanceId: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const previous = this.operationTails.get(instanceId) ?? Promise.resolve();
    const result = previous.catch(() => undefined).then(operation);
    this.operationTails.set(
      instanceId,
      result.then(
        () => undefined,
        () => undefined,
      ),
    );
    return result;
  }

  private mutate<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutationTail.catch(() => undefined).then(operation);
    this.mutationTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private failure(
    message: string,
    error?: ConnectInstanceFailure,
  ): ConnectResult {
    return { ok: false, totpRequired: false, message, error };
  }
}

export function createInstanceRuntime(
  adapters: RuntimeAdapters,
): InstanceRuntime {
  return new ManagedInstanceRuntime(adapters);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
