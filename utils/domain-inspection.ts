import browser from "webextension-polyfill";
import type { FleetTargetFailure } from "~/background/fleet/queries";
import {
  createRuntimeExtensionCommands,
  type ExtensionCommands,
  type SearchDomainData,
} from "~/utils/extension-commands";
import { logger } from "~/utils/logger";

const DEFAULT_CONCURRENCY = 2;
const DEFAULT_RETRY_COUNT = 2;
const DEFAULT_CIRCUIT_FAILURE_THRESHOLD = 3;
const DEFAULT_CIRCUIT_COOLDOWN_MS = 30_000;
const RETRY_DELAYS_MS = [1_000, 2_000];

export type DomainInspectionResult = SearchDomainData;

export interface DomainInspection {
  lookup(domain: string): Promise<DomainInspectionResult>;
  lookupMany(domains: readonly string[]): Promise<void>;
  resultFor(domain: string): DomainInspectionResult | undefined;
  subscribe(callback: () => void): () => void;
  clear(): void;
  destroy(): void;
}

type DomainInspectionCommands = Pick<ExtensionCommands, "searchDomain">;

export interface DomainInspectionClock {
  now(): number;
  sleep(milliseconds: number): Promise<void>;
}

export interface DomainInspectionRevisionSource {
  subscribe(callback: () => void): () => void;
}

export interface DomainInspectionDependencies {
  commands: DomainInspectionCommands;
  clock?: DomainInspectionClock;
  revision?: DomainInspectionRevisionSource;
  concurrency?: number;
  retryCount?: number;
  circuitFailureThreshold?: number;
  circuitCooldownMs?: number;
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T | PromiseLike<T>): void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve: Deferred<T>["resolve"] = () => {
    throw new Error("Deferred resolver was not initialized");
  };
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function defaultClock(): DomainInspectionClock {
  return {
    now: () => Date.now(),
    sleep: (milliseconds) => {
      const deferred = createDeferred<void>();
      window.setTimeout(deferred.resolve, milliseconds);
      return deferred.promise;
    },
  };
}

function browserRevisionSource(): DomainInspectionRevisionSource {
  return {
    subscribe(callback) {
      const listener = (message: unknown) => {
        if (
          typeof message === "object" &&
          message !== null &&
          "type" in message &&
          message.type === "INSTANCES_UPDATED"
        ) {
          callback();
        }
      };
      browser.runtime.onMessage.addListener(listener);
      return () => browser.runtime.onMessage.removeListener(listener);
    },
  };
}

function failure(message: string): DomainInspectionResult {
  const fleetFailure: FleetTargetFailure = {
    instanceId: "fleet",
    instanceName: "Pi-hole",
    message,
  };
  return { entries: [], failures: [fleetFailure], complete: false };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Domain lookup failed";
}

class SidebarDomainInspection implements DomainInspection {
  private revision = 0;
  private readonly completeCache = new Map<string, DomainInspectionResult>();
  private readonly results = new Map<string, DomainInspectionResult>();
  private readonly inFlight = new Map<
    string,
    Promise<DomainInspectionResult>
  >();
  private readonly subscribers = new Set<() => void>();
  private circuitFailures = 0;
  private circuitOpenedAt = 0;
  private destroyed = false;
  private readonly unsubscribeRevision: () => void;

  constructor(
    private readonly dependencies: Required<DomainInspectionDependencies>,
  ) {
    this.unsubscribeRevision = dependencies.revision.subscribe(() => {
      this.advanceRevision();
    });
  }

  lookup(domain: string): Promise<DomainInspectionResult> {
    if (this.destroyed) return Promise.resolve(failure("Inspection destroyed"));
    return this.startLookup(domain, this.revision);
  }

  async lookupMany(domains: readonly string[]): Promise<void> {
    if (this.destroyed) return;
    const batchRevision = this.revision;
    const pendingDomains = [...new Set(domains)].filter(
      (domain) => !this.completeCache.has(this.key(batchRevision, domain)),
    );
    let nextIndex = 0;

    const worker = async () => {
      while (
        nextIndex < pendingDomains.length &&
        batchRevision === this.revision &&
        !this.destroyed
      ) {
        if (this.batchCircuitIsOpen()) {
          this.publishCircuitSkipped(
            pendingDomains.slice(nextIndex),
            batchRevision,
          );
          nextIndex = pendingDomains.length;
          return;
        }
        const domain = pendingDomains[nextIndex++];
        const result = await this.startLookup(domain, batchRevision);
        if (batchRevision !== this.revision || this.destroyed) return;
        this.recordBatchOutcome(result);
      }
    };

    await Promise.all(
      Array.from(
        {
          length: Math.min(
            this.dependencies.concurrency,
            pendingDomains.length,
          ),
        },
        worker,
      ),
    );
  }

  resultFor(domain: string): DomainInspectionResult | undefined {
    return this.results.get(this.key(this.revision, domain));
  }

  subscribe(callback: () => void): () => void {
    this.subscribers.add(callback);
    this.notify(callback);
    return () => this.subscribers.delete(callback);
  }

  clear(): void {
    this.advanceRevision();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.unsubscribeRevision();
    this.revision++;
    this.completeCache.clear();
    this.results.clear();
    this.inFlight.clear();
    this.circuitFailures = 0;
    this.circuitOpenedAt = 0;
    this.subscribers.clear();
  }

  private startLookup(
    domain: string,
    lookupRevision: number,
  ): Promise<DomainInspectionResult> {
    if (this.destroyed) return Promise.resolve(failure("Inspection destroyed"));
    const key = this.key(lookupRevision, domain);
    const existing = this.inFlight.get(key);
    if (existing) return existing;

    const cached = this.completeCache.get(key);
    if (cached) return Promise.resolve(cached);

    const lookup = (async () => {
      const result = await this.execute(domain);
      if (lookupRevision !== this.revision || this.destroyed) {
        return failure(
          this.destroyed
            ? "Lookup discarded after inspection destroyed"
            : "Lookup discarded after fleet change",
        );
      }
      this.results.set(key, result);
      if (result.complete) this.completeCache.set(key, result);
      this.publish();
      return result;
    })();
    this.inFlight.set(key, lookup);
    void lookup.then(
      () => this.inFlight.delete(key),
      () => this.inFlight.delete(key),
    );
    return lookup;
  }

  private async execute(domain: string): Promise<DomainInspectionResult> {
    let lastIncomplete: DomainInspectionResult | undefined;
    for (let attempt = 0; attempt <= this.dependencies.retryCount; attempt++) {
      try {
        const response = await this.dependencies.commands.searchDomain(domain);
        if (response.success) {
          if (response.data.complete) return response.data;
          lastIncomplete = response.data;
        } else if (attempt === this.dependencies.retryCount) {
          return lastIncomplete ?? failure(response.error);
        }
      } catch (error) {
        if (attempt === this.dependencies.retryCount) {
          return lastIncomplete ?? failure(errorMessage(error));
        }
      }
      if (attempt < this.dependencies.retryCount) {
        await this.dependencies.clock.sleep(
          RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)],
        );
      }
    }
    return lastIncomplete ?? failure("Domain lookup failed");
  }

  private recordBatchOutcome(result: DomainInspectionResult): void {
    if (result.complete) {
      this.circuitFailures = 0;
      return;
    }
    this.circuitFailures++;
    this.circuitOpenedAt = this.dependencies.clock.now();
  }

  private batchCircuitIsOpen(): boolean {
    if (this.circuitFailures < this.dependencies.circuitFailureThreshold) {
      return false;
    }
    if (
      this.dependencies.clock.now() - this.circuitOpenedAt >=
      this.dependencies.circuitCooldownMs
    ) {
      this.circuitFailures = 0;
      return false;
    }
    return true;
  }

  private publishCircuitSkipped(
    domains: readonly string[],
    batchRevision: number,
  ): void {
    if (
      batchRevision !== this.revision ||
      this.destroyed ||
      domains.length === 0
    ) {
      return;
    }
    for (const domain of domains) {
      this.results.set(
        this.key(batchRevision, domain),
        failure("Batch lookup skipped while circuit is open"),
      );
    }
    this.publish();
  }

  private advanceRevision(): void {
    if (this.destroyed) return;
    this.revision++;
    this.completeCache.clear();
    this.results.clear();
    this.inFlight.clear();
    this.circuitFailures = 0;
    this.circuitOpenedAt = 0;
    this.publish();
  }

  private key(revision: number, domain: string): string {
    return `${revision}:${domain}`;
  }

  private publish(): void {
    for (const callback of this.subscribers) this.notify(callback);
  }

  private notify(callback: () => void): void {
    try {
      callback();
    } catch (error) {
      try {
        logger.error("[DomainInspection] Subscriber failed:", error);
      } catch {
        // Subscriber failures must not disrupt domain-inspection state.
      }
    }
  }
}

export function createDomainInspection(
  options: Partial<DomainInspectionDependencies> = {},
): DomainInspection {
  const dependencies: Required<DomainInspectionDependencies> = {
    commands: options.commands ?? createRuntimeExtensionCommands(),
    clock: options.clock ?? defaultClock(),
    revision: options.revision ?? browserRevisionSource(),
    concurrency: options.concurrency ?? DEFAULT_CONCURRENCY,
    retryCount: options.retryCount ?? DEFAULT_RETRY_COUNT,
    circuitFailureThreshold:
      options.circuitFailureThreshold ?? DEFAULT_CIRCUIT_FAILURE_THRESHOLD,
    circuitCooldownMs: options.circuitCooldownMs ?? DEFAULT_CIRCUIT_COOLDOWN_MS,
  };
  return new SidebarDomainInspection(dependencies);
}
