import { describe, expect, it, vi } from "vitest";
import {
  createDomainInspection,
  type DomainInspectionDependencies,
} from "~/utils/domain-inspection";
import type { SearchDomainData } from "~/utils/extension-commands";

const success = (): SearchDomainData => ({
  entries: [
    {
      instanceId: "primary",
      instanceName: "Primary",
      allowlist: false,
      denylist: false,
      gravity: false,
    },
  ],
  failures: [],
  complete: true,
});

const incomplete = (message = "offline"): SearchDomainData => ({
  entries: [],
  failures: [{ instanceId: "primary", instanceName: "Primary", message }],
  complete: false,
});

type Deferred<T> = {
  promise: Promise<T>;
  resolve(value: T): void;
};

function deferred<T>(): Deferred<T> {
  const { promise, resolve } = Promise.withResolvers<T>();
  return { promise, resolve };
}

function createRevisionSource() {
  const listeners = new Set<() => void>();
  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    advance() {
      for (const listener of listeners) listener();
    },
    get listenerCount() {
      return listeners.size;
    },
  };
}

function createInspection(
  searchDomain = vi.fn().mockResolvedValue({ success: true, data: success() }),
  overrides: Partial<DomainInspectionDependencies> = {},
) {
  const revision = createRevisionSource();
  const inspection = createDomainInspection({
    commands: { searchDomain },
    revision,
    clock: { now: () => 1, sleep: async () => {} },
    concurrency: 2,
    ...overrides,
  });
  return { inspection, revision, searchDomain };
}

describe("DomainInspection", () => {
  it("returns an in-memory complete-result cache hit without another command", async () => {
    const { inspection, searchDomain } = createInspection();

    await expect(inspection.lookup("example.com")).resolves.toEqual(success());
    await expect(inspection.lookup("example.com")).resolves.toEqual(success());

    expect(searchDomain).toHaveBeenCalledTimes(1);
  });

  it("deduplicates in-flight lookups for the same fleet revision", async () => {
    const pending = deferred<{ success: true; data: SearchDomainData }>();
    const { inspection, searchDomain } = createInspection(
      vi.fn().mockReturnValue(pending.promise),
    );

    const first = inspection.lookup("example.com");
    const second = inspection.lookup("example.com");
    await vi.waitFor(() => expect(searchDomain).toHaveBeenCalledTimes(1));

    pending.resolve({ success: true, data: success() });
    await expect(Promise.all([first, second])).resolves.toEqual([
      success(),
      success(),
    ]);
  });

  it("bounds lookupMany concurrency", async () => {
    const pending = new Map<
      string,
      Deferred<{ success: true; data: SearchDomainData }>
    >();
    let active = 0;
    let maximum = 0;
    const { inspection } = createInspection(
      vi.fn((domain: string) => {
        active++;
        maximum = Math.max(maximum, active);
        const next = deferred<{ success: true; data: SearchDomainData }>();
        pending.set(domain, next);
        return next.promise.finally(() => active--);
      }),
    );

    const batch = inspection.lookupMany(["one.test", "two.test", "three.test"]);
    await vi.waitFor(() => expect(pending.size).toBe(2));
    expect(maximum).toBe(2);
    pending.get("one.test")!.resolve({ success: true, data: success() });
    await vi.waitFor(() => expect(pending.size).toBe(3));
    pending.get("two.test")!.resolve({ success: true, data: success() });
    pending.get("three.test")!.resolve({ success: true, data: success() });
    await batch;
    expect(maximum).toBe(2);
  });

  it("retries a transient command failure before publishing the result", async () => {
    const { inspection, searchDomain } = createInspection(
      vi
        .fn()
        .mockResolvedValueOnce({ success: false, error: "offline" })
        .mockResolvedValueOnce({ success: true, data: success() }),
    );

    await expect(inspection.lookup("example.com")).resolves.toEqual(success());
    expect(searchDomain).toHaveBeenCalledTimes(2);
  });

  it("retries incomplete fleet results before publishing and counting them", async () => {
    const { inspection, searchDomain } = createInspection(
      vi
        .fn()
        .mockResolvedValueOnce({ success: true, data: incomplete() })
        .mockResolvedValueOnce({ success: true, data: success() }),
    );
    const publish = vi.fn();
    inspection.subscribe(publish);

    await expect(inspection.lookup("example.com")).resolves.toEqual(success());

    expect(searchDomain).toHaveBeenCalledTimes(2);
    expect(publish).toHaveBeenCalledTimes(2);
  });

  it("retains the last incomplete fleet result when a later retry fails", async () => {
    const partial = incomplete("primary offline");
    const { inspection, searchDomain } = createInspection(
      vi
        .fn()
        .mockResolvedValueOnce({ success: true, data: partial })
        .mockResolvedValueOnce({ success: false, error: "fleet offline" }),
      { retryCount: 1 },
    );

    await expect(inspection.lookup("example.com")).resolves.toEqual(partial);
    expect(searchDomain).toHaveBeenCalledTimes(2);
  });
  it("relooks up incomplete outcomes instead of caching them", async () => {
    const { inspection, searchDomain } = createInspection(
      vi
        .fn()
        .mockResolvedValueOnce({ success: true, data: incomplete() })
        .mockResolvedValueOnce({ success: true, data: success() }),
      { retryCount: 0 },
    );

    await expect(inspection.lookup("example.com")).resolves.toEqual(
      incomplete(),
    );
    await expect(inspection.lookup("example.com")).resolves.toEqual(success());

    expect(searchDomain).toHaveBeenCalledTimes(2);
    expect(inspection.resultFor("example.com")).toEqual(success());
  });

  it("publishes circuit-skipped batch domains while explicit lookup bypasses the circuit", async () => {
    const { inspection, searchDomain } = createInspection(
      vi.fn().mockResolvedValue({ success: false, error: "offline" }),
      { concurrency: 1, retryCount: 0, circuitFailureThreshold: 1 },
    );

    await inspection.lookupMany(["one.test", "two.test", "three.test"]);

    expect(searchDomain).toHaveBeenCalledTimes(1);
    expect(inspection.resultFor("two.test")).toMatchObject({
      complete: false,
      failures: [
        {
          message: "Batch lookup skipped while circuit is open",
        },
      ],
    });
    await inspection.lookup("two.test");
    expect(searchDomain).toHaveBeenCalledTimes(2);
  });

  it("isolates throwing subscribers from publication and lookup results", async () => {
    const { inspection } = createInspection();
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const throwing = vi.fn(() => {
      throw new Error("subscriber failure");
    });
    const observing = vi.fn();

    expect(() => inspection.subscribe(throwing)).not.toThrow();
    inspection.subscribe(observing);
    await expect(inspection.lookup("example.com")).resolves.toEqual(success());

    expect(observing).toHaveBeenCalledTimes(2);
    expect(inspection.resultFor("example.com")).toEqual(success());
    consoleError.mockRestore();
  });

  it("publishes snapshots and clears results and the fleet revision", async () => {
    const { inspection } = createInspection();
    const publish = vi.fn();
    const unsubscribe = inspection.subscribe(publish);
    expect(publish).toHaveBeenCalledTimes(1);

    await inspection.lookup("example.com");
    expect(publish).toHaveBeenCalledTimes(2);
    expect(inspection.resultFor("example.com")).toEqual(success());

    inspection.clear();
    expect(inspection.resultFor("example.com")).toBeUndefined();
    expect(publish).toHaveBeenCalledTimes(3);
    unsubscribe();
  });

  it("invalidates cached state on a fleet revision change", async () => {
    const { inspection, revision } = createInspection();
    await inspection.lookup("example.com");

    revision.advance();
    expect(inspection.resultFor("example.com")).toBeUndefined();
  });

  it("discards a completion from an earlier fleet revision", async () => {
    const pending = deferred<{ success: true; data: SearchDomainData }>();
    const { inspection, revision } = createInspection(
      vi
        .fn()
        .mockReturnValueOnce(pending.promise)
        .mockResolvedValueOnce({ success: true, data: success() }),
    );

    const staleLookup = inspection.lookup("example.com");
    revision.advance();
    pending.resolve({ success: true, data: success() });
    await expect(staleLookup).resolves.toMatchObject({ complete: false });

    expect(inspection.resultFor("example.com")).toBeUndefined();
    await inspection.lookup("example.com");
    expect(inspection.resultFor("example.com")).toEqual(success());
  });

  it("removes revision listeners and discards in-flight completion on destroy", async () => {
    const pending = deferred<{ success: true; data: SearchDomainData }>();
    const { inspection, revision } = createInspection(
      vi.fn().mockReturnValue(pending.promise),
    );
    const publish = vi.fn();
    inspection.subscribe(publish);
    const staleLookup = inspection.lookup("example.com");

    expect(revision.listenerCount).toBe(1);
    inspection.destroy();
    expect(revision.listenerCount).toBe(0);

    pending.resolve({ success: true, data: success() });
    await expect(staleLookup).resolves.toMatchObject({ complete: false });
    expect(inspection.resultFor("example.com")).toBeUndefined();
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it("keeps mutable lookup state isolated between view instances", async () => {
    const first = createInspection();
    const second = createInspection();

    await first.inspection.lookup("example.com");
    expect(first.inspection.resultFor("example.com")).toEqual(success());
    expect(second.inspection.resultFor("example.com")).toBeUndefined();
    expect(first.searchDomain).toHaveBeenCalledTimes(1);
    expect(second.searchDomain).not.toHaveBeenCalled();
  });
});
