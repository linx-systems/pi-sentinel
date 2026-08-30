import browser from "webextension-polyfill";
import type { ApiResult, IPiholeClient } from "~/background/api/types";
import { ALARMS, STORAGE_KEYS } from "~/utils/constants";
import type {
  CreateTemporaryAllowsResult,
  RemoveTemporaryAllowsResult,
  TemporaryAllowFailure,
  TemporaryAllowRemovalFailure,
} from "~/utils/messaging";
import type { PiHoleInstance, TemporaryAllowEntry } from "~/utils/types";

const RETRY_DELAY_MS = 60_000;

interface TemporaryAllowDependencies {
  getInstances(): Promise<{
    instances: PiHoleInstance[];
    activeInstanceId: string | null;
  }>;
  getClient(instanceId: string): IPiholeClient | undefined;
  now?: () => number;
  createId?: () => string;
}

/**
 * Persists exact allowlist entries that PiSentinel owns so they can be safely
 * removed on expiry, undo, or the next browser startup for session entries.
 */
export class TemporaryAllowService {
  private readonly now: () => number;
  private readonly createId: () => string;
  private mutationQueue: Promise<void> = Promise.resolve();

  constructor(private readonly dependencies: TemporaryAllowDependencies) {
    this.now = dependencies.now ?? (() => Date.now());
    this.createId = dependencies.createId ?? (() => crypto.randomUUID());
  }

  async initialize(): Promise<void> {
    await this.runExclusive(async () => {
      const sessionState = await browser.storage.session.get(
        STORAGE_KEYS.TEMPORARY_ALLOW_SESSION_INITIALIZED,
      );
      const firstInitializationInBrowserSession =
        sessionState[STORAGE_KEYS.TEMPORARY_ALLOW_SESSION_INITIALIZED] !== true;

      await this.cleanupMatching(
        (entry) =>
          entry.cleanupPending === true ||
          (entry.expiresAt !== null && entry.expiresAt <= this.now()) ||
          (firstInitializationInBrowserSession && entry.expiresAt === null),
      );
      if (firstInitializationInBrowserSession) {
        await browser.storage.session.set({
          [STORAGE_KEYS.TEMPORARY_ALLOW_SESSION_INITIALIZED]: true,
        });
      }
      await this.reschedule();
    });
  }

  async create(
    domains: string[],
    durationSeconds: number | null,
    instanceIds?: string[],
  ): Promise<CreateTemporaryAllowsResult> {
    return this.runExclusive(async () => {
      const entries = await this.readEntries();
      const { targets, missingInstanceIds } =
        await this.resolveTargets(instanceIds);
      const normalizedDomains = [
        ...new Set(domains.map(normalizeDomain).filter(Boolean)),
      ];
      const result: CreateTemporaryAllowsResult = {
        entries: [],
        skippedDomains: [],
        failures: [],
      };
      const skippedDomains = new Set<string>();
      let changed = false;
      for (const instanceId of missingInstanceIds) {
        for (const domain of normalizedDomains) {
          result.failures.push({
            domain,
            instanceId,
            instanceName: "",
            error: "Instance was not found",
          });
        }
      }

      for (const target of targets) {
        const client = this.dependencies.getClient(target.id);
        for (const domain of normalizedDomains) {
          if (!client) {
            result.failures.push(
              this.failure(domain, target, "Instance is not connected"),
            );
            continue;
          }

          let exactAllowExists = false;
          try {
            const status = await client.searchDomain(domain);
            if (!status.success || !status.data) {
              result.failures.push(
                this.failure(
                  domain,
                  target,
                  apiError(status.error, "Unable to inspect domain status"),
                ),
              );
              continue;
            }
            exactAllowExists = status.data.domains.allow.some(
              (entry) =>
                entry.domain.toLowerCase() === domain && entry.type === 0,
            );
          } catch (error) {
            result.failures.push(
              this.failure(
                domain,
                target,
                exceptionMessage(error, "Unable to inspect domain status"),
              ),
            );
            continue;
          }

          const managedEntry = entries.find(
            (entry) =>
              entry.domain === domain && entry.instanceId === target.id,
          );

          if (exactAllowExists && !managedEntry) {
            skippedDomains.add(domain);
            continue;
          }

          if (exactAllowExists && managedEntry?.createdByExtension) {
            this.extend(managedEntry, durationSeconds);
            result.entries.push(managedEntry);
            changed = true;
            continue;
          }

          try {
            const added = await client.addDomain(
              domain,
              "allow",
              "exact",
              "Temporary PiSentinel allow",
            );
            if (!added.success) {
              result.failures.push(
                this.failure(
                  domain,
                  target,
                  apiError(added.error, "Unable to add temporary allow"),
                ),
              );
              continue;
            }
          } catch (error) {
            result.failures.push(
              this.failure(
                domain,
                target,
                exceptionMessage(error, "Unable to add temporary allow"),
              ),
            );
            continue;
          }

          if (managedEntry) {
            managedEntry.createdByExtension = true;
            this.extend(managedEntry, durationSeconds);
            result.entries.push(managedEntry);
          } else {
            const entry: TemporaryAllowEntry = {
              id: this.createId(),
              domain,
              instanceId: target.id,
              instanceName: instanceName(target),
              createdAt: this.now(),
              expiresAt: expiryFor(durationSeconds, this.now()),
              createdByExtension: true,
            };
            entries.push(entry);
            result.entries.push(entry);
          }
          changed = true;
        }
      }

      result.skippedDomains = [...skippedDomains];
      if (changed) {
        await this.writeEntries(entries);
        await this.reschedule(entries);
        await this.broadcast(entries);
      }
      return result;
    });
  }

  async list(): Promise<TemporaryAllowEntry[]> {
    return this.readEntries();
  }

  async remove(entryIds: string[]): Promise<RemoveTemporaryAllowsResult> {
    return this.runExclusive(async () => {
      const entries = await this.readEntries();
      const result: RemoveTemporaryAllowsResult = {
        removedIds: [],
        failures: [],
      };
      const requestedIds = [...new Set(entryIds)];
      const entriesById = new Map(entries.map((entry) => [entry.id, entry]));
      const toRemove = new Set<string>();
      const failedCleanupIds = new Set<string>();

      for (const entryId of requestedIds) {
        const entry = entriesById.get(entryId);
        if (!entry) {
          result.failures.push({
            entryId,
            domain: "",
            instanceId: "",
            instanceName: "",
            error: "Temporary allow entry was not found",
          });
          continue;
        }
        const failure = await this.removeEntry(entry);
        if (failure) {
          entry.cleanupPending = true;
          failedCleanupIds.add(entry.id);
          result.failures.push(failure);
        } else {
          toRemove.add(entry.id);
          result.removedIds.push(entry.id);
        }
      }

      if (toRemove.size > 0 || failedCleanupIds.size > 0) {
        const remaining = entries.filter((entry) => !toRemove.has(entry.id));
        await this.writeEntries(remaining);
        await this.reschedule(remaining);
        await this.broadcast(remaining);
      }
      return result;
    });
  }

  async handleAlarm(): Promise<void> {
    await this.runExclusive(async () => {
      await this.cleanupMatching(
        (entry) =>
          entry.cleanupPending === true ||
          (entry.expiresAt !== null && entry.expiresAt <= this.now()),
      );
      await this.reschedule();
    });
  }

  private async cleanupMatching(
    shouldRemove: (entry: TemporaryAllowEntry) => boolean,
  ): Promise<void> {
    const entries = await this.readEntries();
    const remaining: TemporaryAllowEntry[] = [];
    let changed = false;

    for (const entry of entries) {
      if (!shouldRemove(entry)) {
        remaining.push(entry);
        continue;
      }
      const failure = await this.removeEntry(entry);
      if (failure) {
        entry.cleanupPending = true;
        remaining.push(entry);
        changed = true;
      } else {
        changed = true;
      }
    }

    if (changed) {
      await this.writeEntries(remaining);
      await this.broadcast(remaining);
    }
  }

  private async removeEntry(
    entry: TemporaryAllowEntry,
  ): Promise<TemporaryAllowRemovalFailure | null> {
    if (!entry.createdByExtension) {
      return null;
    }
    const client = this.dependencies.getClient(entry.instanceId);
    if (!client) {
      return this.removalFailure(entry, "Instance is not connected");
    }

    try {
      const removed = await client.removeDomain(entry.domain, "allow", "exact");
      if (!removed.success) {
        return this.removalFailure(
          entry,
          apiError(removed.error, "Unable to remove temporary allow"),
        );
      }
      return null;
    } catch (error) {
      return this.removalFailure(
        entry,
        exceptionMessage(error, "Unable to remove temporary allow"),
      );
    }
  }

  private async resolveTargets(instanceIds?: string[]): Promise<{
    targets: PiHoleInstance[];
    missingInstanceIds: string[];
  }> {
    const config = await this.dependencies.getInstances();
    const requestedIds = instanceIds?.length
      ? [...new Set(instanceIds)]
      : config.activeInstanceId
        ? [config.activeInstanceId]
        : config.instances.map((instance) => instance.id);
    const targets = requestedIds
      .map((id) => config.instances.find((instance) => instance.id === id))
      .filter((instance): instance is PiHoleInstance => instance !== undefined);
    const targetIds = new Set(targets.map((instance) => instance.id));
    return {
      targets,
      missingInstanceIds: requestedIds.filter((id) => !targetIds.has(id)),
    };
  }

  private extend(
    entry: TemporaryAllowEntry,
    durationSeconds: number | null,
  ): void {
    entry.expiresAt = expiryFor(durationSeconds, this.now());
    entry.cleanupPending = false;
  }

  private async readEntries(): Promise<TemporaryAllowEntry[]> {
    const result = await browser.storage.local.get(
      STORAGE_KEYS.TEMPORARY_ALLOWS,
    );
    const stored = result[STORAGE_KEYS.TEMPORARY_ALLOWS];
    return Array.isArray(stored) ? stored : [];
  }

  private async writeEntries(entries: TemporaryAllowEntry[]): Promise<void> {
    await browser.storage.local.set({
      [STORAGE_KEYS.TEMPORARY_ALLOWS]: entries,
    });
  }

  private async reschedule(entries?: TemporaryAllowEntry[]): Promise<void> {
    const records = entries ?? (await this.readEntries());
    const nextExpiry = records
      .filter(
        (entry) =>
          entry.cleanupPending === true ||
          (entry.expiresAt !== null && entry.expiresAt > this.now()),
      )
      .map((entry) =>
        entry.cleanupPending ? this.now() + RETRY_DELAY_MS : entry.expiresAt!,
      )
      .sort((left, right) => left - right)[0];

    if (nextExpiry === undefined) {
      await browser.alarms.clear(ALARMS.TEMPORARY_ALLOW_CLEANUP);
      return;
    }
    await browser.alarms.create(ALARMS.TEMPORARY_ALLOW_CLEANUP, {
      when: Math.max(nextExpiry, this.now() + 1),
    });
  }

  private async broadcast(entries: TemporaryAllowEntry[]): Promise<void> {
    try {
      await browser.runtime.sendMessage({
        type: "TEMPORARY_ALLOWS_UPDATED",
        payload: entries,
      });
    } catch {
      // UI listeners are optional; persistence is the source of truth.
    }
  }

  private failure(
    domain: string,
    instance: PiHoleInstance,
    error: string,
  ): TemporaryAllowFailure {
    return {
      domain,
      instanceId: instance.id,
      instanceName: instanceName(instance),
      error,
    };
  }

  private removalFailure(
    entry: TemporaryAllowEntry,
    error: string,
  ): TemporaryAllowRemovalFailure {
    return {
      entryId: entry.id,
      domain: entry.domain,
      instanceId: entry.instanceId,
      instanceName: entry.instanceName,
      error,
    };
  }

  private async runExclusive<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.mutationQueue;
    let release!: () => void;
    this.mutationQueue = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }
}

function normalizeDomain(domain: string): string {
  return domain.trim().toLowerCase().replace(/\.$/, "");
}

function expiryFor(durationSeconds: number | null, now: number): number | null {
  return durationSeconds === null ? null : now + durationSeconds * 1000;
}

function instanceName(instance: PiHoleInstance): string {
  return instance.name ?? instance.piholeUrl;
}

function apiError(
  error: ApiResult<unknown>["error"],
  fallback: string,
): string {
  return error?.message ?? fallback;
}

function exceptionMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}
