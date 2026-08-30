import { beforeEach, describe, expect, it, vi } from "vitest";
import mockBrowser from "../__mocks__/webextension-polyfill";
import type { TemporaryAllowClient } from "~/background/api/types";
import { TemporaryAllowService } from "~/background/services/temporary-allows";
import { ALARMS, STORAGE_KEYS } from "~/utils/constants";
import type { PiHoleInstance, TemporaryAllowEntry } from "~/utils/types";

const instanceA: PiHoleInstance = {
  id: "instance-a",
  name: "Primary",
  piholeUrl: "https://primary.test",
  encryptedPassword: null,
  encryptedMasterKey: null,
  rememberPassword: false,
  createdAt: 1,
};

const instanceB: PiHoleInstance = {
  ...instanceA,
  id: "instance-b",
  name: "Secondary",
  piholeUrl: "https://secondary.test",
};

function createClient(options?: {
  exactAllow?: boolean;
  removeSuccess?: boolean;
}): TemporaryAllowClient {
  const exactAllow = options?.exactAllow ?? false;
  const removeSuccess = options?.removeSuccess ?? true;
  return {
    searchDomain: vi.fn().mockImplementation(async (domain: string) => ({
      success: true,
      data: {
        gravity: { count: 0, results: [] },
        domains: {
          allow: exactAllow
            ? [
                {
                  id: 1,
                  domain,
                  type: 0,
                  enabled: true,
                  comment: null,
                  date_added: 1,
                  date_modified: 1,
                },
              ]
            : [],
          deny: [],
        },
      },
    })),
    addDomain: vi.fn().mockResolvedValue({ success: true }),
    removeDomain: vi.fn().mockResolvedValue(
      removeSuccess
        ? { success: true }
        : {
            success: false,
            error: { key: "offline", message: "Offline", status: 0 },
          },
    ),
  };
}

describe("TemporaryAllowService", () => {
  let stored: Record<string, unknown>;
  let sessionStored: Record<string, unknown>;
  let now: number;
  let clients: Map<string, TemporaryAllowClient>;
  let service: TemporaryAllowService;

  beforeEach(() => {
    stored = {};
    sessionStored = {};
    now = 10_000;
    clients = new Map();
    vi.clearAllMocks();
    mockBrowser.storage.local.get.mockImplementation(async (key: string) => ({
      [key]: stored[key],
    }));
    mockBrowser.storage.local.set.mockImplementation(
      async (values: Record<string, unknown>) => {
        Object.assign(stored, values);
      },
    );
    mockBrowser.storage.session.get.mockImplementation(async (key: string) => ({
      [key]: sessionStored[key],
    }));
    mockBrowser.storage.session.set.mockImplementation(
      async (values: Record<string, unknown>) => {
        Object.assign(sessionStored, values);
      },
    );
    service = new TemporaryAllowService({
      getInstances: async () => ({
        instances: [instanceA, instanceB],
        activeInstanceId: instanceA.id,
      }),
      getClient: (instanceId) => clients.get(instanceId),
      now: () => now,
      createId: () => "entry-1",
    });
  });

  it("creates an exact allow then extends the same managed entry", async () => {
    const client = createClient();
    clients.set(instanceA.id, client);

    const created = await service.create(["Example.TEST"], 60);
    now += 1_000;
    vi.mocked(client.searchDomain).mockResolvedValueOnce({
      success: true,
      data: {
        gravity: { count: 0, results: [] },
        domains: {
          allow: [
            {
              id: 1,
              domain: "example.test",
              type: 0,
              enabled: true,
              comment: null,
              date_added: 1,
              date_modified: 1,
            },
          ],
          deny: [],
        },
      },
    });
    const extended = await service.create(["example.test"], 120);

    expect(created.entries).toHaveLength(1);
    expect(extended.entries[0]).toMatchObject({
      id: "entry-1",
      domain: "example.test",
      expiresAt: 131_000,
      createdByExtension: true,
    });
    expect(client.addDomain).toHaveBeenCalledTimes(1);
    expect(mockBrowser.alarms.create).toHaveBeenLastCalledWith(
      ALARMS.TEMPORARY_ALLOW_CLEANUP,
      { when: 131_000 },
    );
    expect(mockBrowser.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "TEMPORARY_ALLOWS_UPDATED" }),
    );
  });

  it("skips a pre-existing permanent exact allow without creating a cleanup record", async () => {
    const client = createClient({ exactAllow: true });
    clients.set(instanceA.id, client);

    const result = await service.create(["already-allowed.test"], 60);

    expect(result).toMatchObject({
      entries: [],
      skippedDomains: ["already-allowed.test"],
      failures: [],
    });
    expect(client.addDomain).not.toHaveBeenCalled();
    expect(stored[STORAGE_KEYS.TEMPORARY_ALLOWS]).toBeUndefined();
  });

  it("keeps failed manual cleanup records retryable and removes them on the next alarm", async () => {
    const entry: TemporaryAllowEntry = {
      id: "entry-1",
      domain: "retry.test",
      instanceId: instanceA.id,
      instanceName: "Primary",
      createdAt: 1,
      expiresAt: now + 60_000,
      createdByExtension: true,
    };
    stored[STORAGE_KEYS.TEMPORARY_ALLOWS] = [entry];
    const client = createClient({ removeSuccess: false });
    clients.set(instanceA.id, client);

    const failed = await service.remove([entry.id]);
    vi.mocked(client.removeDomain).mockResolvedValueOnce({ success: true });
    await service.handleAlarm();
    expect(failed.failures).toMatchObject([
      { entryId: entry.id, error: "Offline" },
    ]);
    expect(stored[STORAGE_KEYS.TEMPORARY_ALLOWS]).toEqual([]);
    expect(client.removeDomain).toHaveBeenCalledTimes(2);
  });

  it("removes an expired timed allow from its originating instance", async () => {
    const client = createClient();
    clients.set(instanceA.id, client);

    await service.create(["expires.test"], 1);
    now += 1_000;
    await service.handleAlarm();

    expect(client.removeDomain).toHaveBeenCalledWith(
      "expires.test",
      "allow",
      "exact",
    );
    expect(stored[STORAGE_KEYS.TEMPORARY_ALLOWS]).toEqual([]);
  });

  it("cleans expired timed entries during startup", async () => {
    const entry: TemporaryAllowEntry = {
      id: "expired-entry",
      domain: "expired.test",
      instanceId: instanceA.id,
      instanceName: "Primary",
      createdAt: 1,
      expiresAt: now - 1,
      createdByExtension: true,
    };
    stored[STORAGE_KEYS.TEMPORARY_ALLOWS] = [entry];
    sessionStored[STORAGE_KEYS.TEMPORARY_ALLOW_SESSION_INITIALIZED] = true;
    const client = createClient();
    clients.set(instanceA.id, client);

    await service.initialize();

    expect(client.removeDomain).toHaveBeenCalledWith(
      "expired.test",
      "allow",
      "exact",
    );
    expect(stored[STORAGE_KEYS.TEMPORARY_ALLOWS]).toEqual([]);
  });

  it("cleans session entries at startup using their original instance", async () => {
    const entry: TemporaryAllowEntry = {
      id: "session-entry",
      domain: "session.test",
      instanceId: instanceB.id,
      instanceName: "Secondary",
      createdAt: 1,
      expiresAt: null,
      createdByExtension: true,
    };
    stored[STORAGE_KEYS.TEMPORARY_ALLOWS] = [entry];
    const client = createClient();
    clients.set(instanceB.id, client);

    await service.initialize();

    expect(client.removeDomain).toHaveBeenCalledWith(
      "session.test",
      "allow",
      "exact",
    );
    expect(
      sessionStored[STORAGE_KEYS.TEMPORARY_ALLOW_SESSION_INITIALIZED],
    ).toBe(true);
    expect(stored[STORAGE_KEYS.TEMPORARY_ALLOWS]).toEqual([]);
  });

  it("preserves session entries across service-worker restarts", async () => {
    const entry: TemporaryAllowEntry = {
      id: "current-session-entry",
      domain: "current-session.test",
      instanceId: instanceA.id,
      instanceName: "Primary",
      createdAt: 1,
      expiresAt: null,
      createdByExtension: true,
    };
    stored[STORAGE_KEYS.TEMPORARY_ALLOWS] = [entry];
    sessionStored[STORAGE_KEYS.TEMPORARY_ALLOW_SESSION_INITIALIZED] = true;
    const client = createClient();
    clients.set(instanceA.id, client);

    await service.initialize();

    expect(client.removeDomain).not.toHaveBeenCalled();
    expect(stored[STORAGE_KEYS.TEMPORARY_ALLOWS]).toEqual([entry]);
  });

  it("returns target-specific failures while applying the remaining batch", async () => {
    const client = createClient();
    clients.set(instanceA.id, client);

    const result = await service.create(["partial.test"], 60, [
      instanceA.id,
      instanceB.id,
    ]);

    expect(result.entries).toHaveLength(1);
    expect(result.failures).toMatchObject([
      {
        domain: "partial.test",
        instanceId: instanceB.id,
        error: "Instance is not connected",
      },
    ]);
  });
});
