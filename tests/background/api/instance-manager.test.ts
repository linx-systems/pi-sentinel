import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import browser from "webextension-polyfill";
import { InstanceManager } from "~/background/api/instance-manager";
import { encryption } from "~/background/crypto/encryption";
import { STORAGE_KEYS } from "~/utils/constants";
import type { PersistedConfig, PersistedInstances } from "~/utils/types";

type BrowserStorageMocks = {
  local: {
    get: Mock;
    set: Mock;
  };
  session: {
    get: Mock;
    set: Mock;
    remove: Mock;
  };
};

type InstanceManagerCredentialState = {
  masterKeys: Map<string, string>;
};

const instanceId = "primary";
const masterKey = "master-key";
const masterKeyStorageKey = `masterKey_${instanceId}`;
const sessionStorageKey = `${STORAGE_KEYS.INSTANCE_SESSION_PREFIX}${instanceId}`;

function persistedInstances(): PersistedInstances {
  return {
    instances: [
      {
        id: instanceId,
        name: "Primary",
        piholeUrl: "https://primary.test",
        encryptedPassword: null,
        encryptedMasterKey: null,
        rememberPassword: false,
        createdAt: 1,
      },
    ],
    activeInstanceId: instanceId,
    globalSettings: {
      notificationsEnabled: true,
      refreshInterval: 30,
    },
  };
}

describe("InstanceManager credential cleanup", () => {
  let manager: InstanceManager;
  let config: PersistedInstances;
  let sessionStorage: Map<string, unknown>;
  let storage: BrowserStorageMocks;
  // The manager deliberately keeps this credential cache private in production.
  let credentials: InstanceManagerCredentialState;

  beforeEach(() => {
    manager = new InstanceManager();
    config = persistedInstances();
    sessionStorage = new Map([[sessionStorageKey, { sid: "sid" }]]);
    storage = browser.storage as unknown as BrowserStorageMocks;
    credentials = manager as unknown as InstanceManagerCredentialState;

    storage.local.get.mockReset();
    storage.local.set.mockReset();
    storage.session.get.mockReset();
    storage.session.set.mockReset();
    storage.session.remove.mockReset();

    storage.local.get.mockImplementation(async () => ({
      [STORAGE_KEYS.INSTANCES]: config,
    }));
    storage.local.set.mockImplementation(async (values) => {
      config = values[STORAGE_KEYS.INSTANCES] as PersistedInstances;
    });
    storage.session.get.mockImplementation(async (keys: string | string[]) => {
      const requested = Array.isArray(keys) ? keys : [keys];
      return Object.fromEntries(
        requested
          .filter((key) => sessionStorage.has(key))
          .map((key) => [key, sessionStorage.get(key)]),
      );
    });
    storage.session.set.mockImplementation(async (values) => {
      for (const [key, value] of Object.entries(values)) {
        sessionStorage.set(key, value);
      }
    });
    storage.session.remove.mockImplementation(
      async (keys: string | string[]) => {
        for (const key of Array.isArray(keys) ? keys : [keys]) {
          sessionStorage.delete(key);
        }
      },
    );
  });

  it("removes session and master-key material only after durable instance deletion", async () => {
    await manager.setMasterKey(instanceId, masterKey);

    const deleted = await manager.deleteInstance(instanceId);

    expect(deleted).toBe(true);
    expect(config.instances).toEqual([]);
    expect(sessionStorage.has(sessionStorageKey)).toBe(false);
    expect(sessionStorage.has(masterKeyStorageKey)).toBe(false);
    expect(credentials.masterKeys.has(instanceId)).toBe(false);
  });

  it("retains all credential material when durable instance deletion fails", async () => {
    await manager.setMasterKey(instanceId, masterKey);
    storage.local.set.mockRejectedValueOnce(new Error("storage offline"));

    await expect(manager.deleteInstance(instanceId)).rejects.toThrow(
      "storage offline",
    );

    expect(config.instances).toHaveLength(1);
    expect(sessionStorage.get(sessionStorageKey)).toEqual({ sid: "sid" });
    expect(sessionStorage.get(masterKeyStorageKey)).toBe(masterKey);
    expect(credentials.masterKeys.get(instanceId)).toBe(masterKey);
  });
});

describe("InstanceManager concurrent configuration mutations", () => {
  let manager: InstanceManager;
  let config: PersistedInstances;
  let storage: BrowserStorageMocks;

  beforeEach(() => {
    manager = new InstanceManager();
    config = persistedInstances();
    storage = browser.storage as unknown as BrowserStorageMocks;

    storage.local.get.mockReset();
    storage.local.set.mockReset();
    storage.session.get.mockReset();
    storage.session.set.mockReset();
    storage.session.remove.mockReset();

    storage.local.get.mockImplementation(async () => ({
      [STORAGE_KEYS.INSTANCES]: structuredClone(config),
    }));
    storage.local.set.mockImplementation(async (values) => {
      config = structuredClone(
        values[STORAGE_KEYS.INSTANCES] as PersistedInstances,
      );
    });
    storage.session.get.mockResolvedValue({});
    storage.session.set.mockResolvedValue(undefined);
    storage.session.remove.mockResolvedValue(undefined);
  });

  it("commits both concurrently added instances", async () => {
    const encrypt = vi
      .spyOn(encryption, "encrypt")
      .mockResolvedValue({ ciphertext: "ciphertext", salt: "salt", iv: "iv" });

    try {
      const [first, second] = await Promise.all([
        manager.addInstance("First", "https://first.test", "", false),
        manager.addInstance("Second", "https://second.test", "", false),
      ]);

      expect(config.instances.map((instance) => instance.id)).toEqual([
        instanceId,
        first.id,
        second.id,
      ]);
    } finally {
      encrypt.mockRestore();
    }
  });

  it("does not resurrect an instance when update races after deletion", async () => {
    const deletion = manager.deleteInstance(instanceId);
    const update = manager.updateInstance(instanceId, { name: "Renamed" });

    await expect(deletion).resolves.toBe(true);
    await expect(update).resolves.toBeNull();
    expect(config.instances).toEqual([]);
  });

  it("does not select an instance deleted by a concurrent request", async () => {
    config.instances.push({
      ...persistedInstances().instances[0],
      id: "secondary",
      name: "Secondary",
      piholeUrl: "https://secondary.test",
    });
    config.activeInstanceId = "secondary";

    const deletion = manager.deleteInstance(instanceId);
    const selection = manager.setActiveInstance(instanceId);

    await expect(deletion).resolves.toBe(true);
    await expect(selection).rejects.toThrow(
      `Instance not found: ${instanceId}`,
    );
    expect(config.activeInstanceId).toBe("secondary");
  });
});

type LegacyStorage = {
  local: Map<string, unknown>;
  session: Map<string, unknown>;
  failWrite?: number;
  failRemoveKey?: string;
  writes: number;
};

function createLegacyConfig(
  overrides: Partial<PersistedConfig> = {},
): PersistedConfig {
  return {
    piholeUrl: "https://legacy.test",
    encryptedPassword: {
      ciphertext: "legacy-password",
      salt: "salt",
      iv: "iv",
    },
    encryptedMasterKey: {
      ciphertext: "legacy-master-key",
      salt: "salt",
      iv: "iv",
    },
    rememberPassword: true,
    notificationsEnabled: false,
    refreshInterval: 90,
    ...overrides,
  };
}

function configureMigrationStorage(state: LegacyStorage): void {
  const storage = browser.storage as unknown as BrowserStorageMocks;
  storage.local.get.mockImplementation(async (keys?: string | string[]) => {
    const requested =
      keys === undefined
        ? Array.from(state.local.keys())
        : Array.isArray(keys)
          ? keys
          : [keys];
    return Object.fromEntries(
      requested
        .filter((key) => state.local.has(key))
        .map((key) => [key, state.local.get(key)]),
    );
  });
  storage.local.set.mockImplementation(async (values) => {
    state.writes += 1;
    if (state.failWrite === state.writes) {
      throw new Error(`write ${state.writes} interrupted`);
    }
    for (const [key, value] of Object.entries(values)) {
      state.local.set(key, value);
    }
  });
  storage.session.get.mockImplementation(async (keys: string | string[]) => {
    const requested = Array.isArray(keys) ? keys : [keys];
    return Object.fromEntries(
      requested
        .filter((key) => state.session.has(key))
        .map((key) => [key, state.session.get(key)]),
    );
  });
  storage.session.set.mockImplementation(async (values) => {
    state.writes += 1;
    if (state.failWrite === state.writes) {
      throw new Error(`write ${state.writes} interrupted`);
    }
    for (const [key, value] of Object.entries(values)) {
      state.session.set(key, value);
    }
  });
  storage.session.remove.mockImplementation(async (keys: string | string[]) => {
    for (const key of Array.isArray(keys) ? keys : [keys]) {
      if (state.failRemoveKey === key) {
        throw new Error(`remove ${key} interrupted`);
      }
      state.session.delete(key);
    }
  });
}

describe("InstanceManager legacy migration", () => {
  let storage: BrowserStorageMocks;

  beforeEach(() => {
    storage = browser.storage as unknown as BrowserStorageMocks;
    storage.local.get.mockReset();
    storage.local.set.mockReset();
    storage.session.get.mockReset();
    storage.session.set.mockReset();
    storage.session.remove.mockReset();
  });

  it("migrates remembered credentials into one stable multi-instance target", async () => {
    const state: LegacyStorage = {
      local: new Map([[STORAGE_KEYS.CONFIG, createLegacyConfig()]]),
      session: new Map(),
      writes: 0,
    };
    configureMigrationStorage(state);

    await new InstanceManager().initialize();

    const migrated = state.local.get(
      STORAGE_KEYS.INSTANCES,
    ) as PersistedInstances;
    expect(migrated).toMatchObject({
      activeInstanceId: migrated.instances[0].id,
      globalSettings: { notificationsEnabled: false, refreshInterval: 90 },
      instances: [
        {
          id: expect.stringMatching(/^legacy-/),
          piholeUrl: "https://legacy.test",
          rememberPassword: true,
          passwordless: false,
        },
      ],
    });
    expect(state.local.get(STORAGE_KEYS.CONFIG)).toEqual(createLegacyConfig());
    expect(state.local.get("pisentinel_instances_migration_v1")).toMatchObject({
      version: 1,
    });
  });

  it("migrates a non-remembered legacy session and master key without persisting them locally", async () => {
    const state: LegacyStorage = {
      local: new Map([
        [
          STORAGE_KEYS.CONFIG,
          createLegacyConfig({
            encryptedMasterKey: null,
            rememberPassword: false,
          }),
        ],
      ]),
      session: new Map([
        [
          STORAGE_KEYS.SESSION,
          { sid: "legacy-sid", csrf: "legacy-csrf", expiresAt: 1 },
        ],
        ["masterKey", "legacy-master-key"],
      ]),
      writes: 0,
    };
    configureMigrationStorage(state);

    await new InstanceManager().initialize();

    const migrated = state.local.get(
      STORAGE_KEYS.INSTANCES,
    ) as PersistedInstances;
    const instanceId = migrated.instances[0].id;
    expect(
      state.session.get(`${STORAGE_KEYS.INSTANCE_SESSION_PREFIX}${instanceId}`),
    ).toEqual({ sid: "legacy-sid", csrf: "legacy-csrf", expiresAt: 1 });
    expect(state.session.get(`masterKey_${instanceId}`)).toBe(
      "legacy-master-key",
    );
    expect(migrated.instances[0].encryptedMasterKey).toBeNull();
  });

  it("migrates a passwordless legacy configuration", async () => {
    const state: LegacyStorage = {
      local: new Map([
        [
          STORAGE_KEYS.CONFIG,
          createLegacyConfig({
            encryptedPassword: null,
            encryptedMasterKey: null,
            rememberPassword: false,
          }),
        ],
      ]),
      session: new Map(),
      writes: 0,
    };
    configureMigrationStorage(state);

    await new InstanceManager().initialize();

    const migrated = state.local.get(
      STORAGE_KEYS.INSTANCES,
    ) as PersistedInstances;
    expect(migrated.instances[0]).toMatchObject({
      passwordless: true,
      encryptedPassword: null,
      rememberPassword: false,
    });
  });

  it("leaves corrupt legacy storage untouched and does not mark migration complete", async () => {
    const corruptConfig = {
      ...createLegacyConfig(),
      piholeUrl: 42,
    };
    const state: LegacyStorage = {
      local: new Map([[STORAGE_KEYS.CONFIG, corruptConfig]]),
      session: new Map(),
      writes: 0,
    };
    configureMigrationStorage(state);

    await new InstanceManager().initialize();

    expect(state.local.get(STORAGE_KEYS.CONFIG)).toBe(corruptConfig);
    expect(state.local.has(STORAGE_KEYS.INSTANCES)).toBe(false);
    expect(state.local.has("pisentinel_instances_migration_v1")).toBe(false);
  });

  it.each([1, 2, 3, 4])(
    "resumes after interruption at migration write %i without losing the source",
    async (write) => {
      const source = createLegacyConfig({
        encryptedMasterKey: null,
        rememberPassword: false,
      });
      const state: LegacyStorage = {
        local: new Map([[STORAGE_KEYS.CONFIG, source]]),
        session: new Map([
          [
            STORAGE_KEYS.SESSION,
            { sid: "legacy-sid", csrf: "legacy-csrf", expiresAt: 1 },
          ],
          ["masterKey", "legacy-master-key"],
        ]),
        failWrite: write,
        writes: 0,
      };
      configureMigrationStorage(state);

      await expect(new InstanceManager().initialize()).rejects.toThrow(
        `write ${write} interrupted`,
      );
      expect(state.local.get(STORAGE_KEYS.CONFIG)).toBe(source);

      state.failWrite = undefined;
      await new InstanceManager().initialize();

      const migrated = state.local.get(
        STORAGE_KEYS.INSTANCES,
      ) as PersistedInstances;
      expect(migrated.instances).toHaveLength(1);
      expect(
        state.local.get("pisentinel_instances_migration_v1"),
      ).toMatchObject({
        version: 1,
      });
      expect(
        state.session.get(
          `${STORAGE_KEYS.INSTANCE_SESSION_PREFIX}${migrated.instances[0].id}`,
        ),
      ).toEqual({ sid: "legacy-sid", csrf: "legacy-csrf", expiresAt: 1 });
    },
  );

  it("converges repeated initialization on the same stable instance ID", async () => {
    const state: LegacyStorage = {
      local: new Map([[STORAGE_KEYS.CONFIG, createLegacyConfig()]]),
      session: new Map(),
      writes: 0,
    };
    configureMigrationStorage(state);

    await new InstanceManager().initialize();
    const first = state.local.get(STORAGE_KEYS.INSTANCES) as PersistedInstances;
    await new InstanceManager().initialize();
    const second = state.local.get(
      STORAGE_KEYS.INSTANCES,
    ) as PersistedInstances;

    expect(second).toEqual(first);
    expect(second.instances).toHaveLength(1);
  });

  it("does not resurrect a deleted migrated instance after completion", async () => {
    const state: LegacyStorage = {
      local: new Map([[STORAGE_KEYS.CONFIG, createLegacyConfig()]]),
      session: new Map(),
      writes: 0,
    };
    configureMigrationStorage(state);

    const manager = new InstanceManager();
    await manager.initialize();
    const { instances } = state.local.get(
      STORAGE_KEYS.INSTANCES,
    ) as PersistedInstances;
    await manager.deleteInstance(instances[0].id);

    await new InstanceManager().initialize();

    expect(
      (state.local.get(STORAGE_KEYS.INSTANCES) as PersistedInstances).instances,
    ).toEqual([]);
    expect(state.local.get("pisentinel_instances_migration_v1")).toMatchObject({
      version: 1,
    });
  });

  it("requires reconnect rather than copying an undecodable encrypted legacy session", async () => {
    const state: LegacyStorage = {
      local: new Map([[STORAGE_KEYS.CONFIG, createLegacyConfig()]]),
      session: new Map([
        [
          STORAGE_KEYS.SESSION,
          {
            encrypted: { ciphertext: "legacy-session", salt: "salt", iv: "iv" },
            expiresAt: Date.now() + 60_000,
          },
        ],
      ]),
      writes: 0,
    };
    configureMigrationStorage(state);

    await new InstanceManager().initialize();

    const migrated = state.local.get(
      STORAGE_KEYS.INSTANCES,
    ) as PersistedInstances;
    expect(
      state.session.has(
        `${STORAGE_KEYS.INSTANCE_SESSION_PREFIX}${migrated.instances[0].id}`,
      ),
    ).toBe(false);
    expect(state.local.get("pisentinel_instances_migration_v1")).toMatchObject({
      version: 1,
    });
  });

  it("preserves an equivalent random-ID instance, its credentials, and temporary allows", async () => {
    const legacy = createLegacyConfig({
      encryptedMasterKey: null,
      rememberPassword: false,
    });
    const oldId = "b65e8ca3-4b80-4e1d-8adc-2162bd3bc8d5";
    const oldSession = {
      encrypted: { ciphertext: "current-session", salt: "salt", iv: "iv" },
      expiresAt: Date.now() + 60_000,
    };
    const temporaryAllows = [
      {
        id: "temporary-allow",
        instanceId: oldId,
        expiresAt: Date.now() + 60_000,
      },
    ];
    const state: LegacyStorage = {
      local: new Map([
        [STORAGE_KEYS.CONFIG, legacy],
        [
          STORAGE_KEYS.INSTANCES,
          {
            instances: [
              {
                id: oldId,
                name: "Renamed legacy",
                piholeUrl: legacy.piholeUrl,
                encryptedPassword: legacy.encryptedPassword,
                encryptedMasterKey: legacy.encryptedMasterKey,
                rememberPassword: legacy.rememberPassword,
                passwordless: false,
                createdAt: 1,
              },
            ],
            activeInstanceId: oldId,
            globalSettings: {
              notificationsEnabled: legacy.notificationsEnabled,
              refreshInterval: legacy.refreshInterval,
            },
          } satisfies PersistedInstances,
        ],
        [STORAGE_KEYS.TEMPORARY_ALLOWS, temporaryAllows],
      ]),
      session: new Map([
        [`${STORAGE_KEYS.INSTANCE_SESSION_PREFIX}${oldId}`, oldSession],
        [`masterKey_${oldId}`, "current-master-key"],
      ]),
      writes: 0,
    };
    configureMigrationStorage(state);

    await new InstanceManager().initialize();

    const migrated = state.local.get(
      STORAGE_KEYS.INSTANCES,
    ) as PersistedInstances;
    expect(migrated.instances[0]).toMatchObject({
      id: oldId,
      name: "Renamed legacy",
    });
    expect(migrated.activeInstanceId).toBe(oldId);
    expect(
      state.session.get(`${STORAGE_KEYS.INSTANCE_SESSION_PREFIX}${oldId}`),
    ).toEqual(oldSession);
    expect(state.session.get(`masterKey_${oldId}`)).toBe("current-master-key");
    expect(state.local.get(STORAGE_KEYS.TEMPORARY_ALLOWS)).toEqual(
      temporaryAllows,
    );
    expect(state.local.get("pisentinel_instances_migration_v1")).toEqual({
      version: 1,
      instanceId: oldId,
    });
  });
  it.each([null, "other-instance"])(
    "preserves %s selection when an equivalent instance already exists",
    async (activeInstanceId) => {
      const legacy = createLegacyConfig();
      const existingInstance = {
        id: "random-instance",
        name: "Renamed legacy",
        piholeUrl: legacy.piholeUrl,
        encryptedPassword: legacy.encryptedPassword,
        encryptedMasterKey: legacy.encryptedMasterKey,
        rememberPassword: legacy.rememberPassword,
        passwordless: false,
        createdAt: 1,
      };
      const state: LegacyStorage = {
        local: new Map([
          [STORAGE_KEYS.CONFIG, legacy],
          [
            STORAGE_KEYS.INSTANCES,
            {
              instances: [
                existingInstance,
                {
                  ...existingInstance,
                  id: "other-instance",
                  piholeUrl: "https://other.test",
                },
              ],
              activeInstanceId,
              globalSettings: {
                notificationsEnabled: legacy.notificationsEnabled,
                refreshInterval: legacy.refreshInterval,
              },
            } satisfies PersistedInstances,
          ],
        ]),
        session: new Map(),
        writes: 0,
      };
      configureMigrationStorage(state);

      await new InstanceManager().initialize();

      expect(
        (state.local.get(STORAGE_KEYS.INSTANCES) as PersistedInstances)
          .activeInstanceId,
      ).toBe(activeInstanceId);
    },
  );

  it("fails closed when storage cannot read the legacy migration input", async () => {
    storage.local.get.mockRejectedValueOnce(new Error("storage offline"));

    await expect(new InstanceManager().initialize()).rejects.toThrow(
      "storage offline",
    );
    expect(storage.local.set).not.toHaveBeenCalled();
  });

  it.each([1, 2, 3])(
    "recovers missing equivalent random-ID credentials after migration write %i",
    async (write) => {
      const legacy = createLegacyConfig({
        encryptedMasterKey: null,
        rememberPassword: false,
      });
      const oldId = "b65e8ca3-4b80-4e1d-8adc-2162bd3bc8d5";
      const legacySession = {
        sid: "legacy-sid",
        csrf: "legacy-csrf",
        expiresAt: Date.now() + 60_000,
      };
      const state: LegacyStorage = {
        local: new Map([
          [STORAGE_KEYS.CONFIG, legacy],
          [
            STORAGE_KEYS.INSTANCES,
            {
              instances: [
                {
                  id: oldId,
                  name: "Renamed legacy",
                  piholeUrl: legacy.piholeUrl,
                  encryptedPassword: legacy.encryptedPassword,
                  encryptedMasterKey: legacy.encryptedMasterKey,
                  rememberPassword: legacy.rememberPassword,
                  passwordless: false,
                  createdAt: 1,
                },
              ],
              activeInstanceId: oldId,
              globalSettings: {
                notificationsEnabled: legacy.notificationsEnabled,
                refreshInterval: legacy.refreshInterval,
              },
            } satisfies PersistedInstances,
          ],
        ]),
        session: new Map([
          [STORAGE_KEYS.SESSION, legacySession],
          ["masterKey", "legacy-master-key"],
        ]),
        failWrite: write,
        writes: 0,
      };
      configureMigrationStorage(state);

      await expect(new InstanceManager().initialize()).rejects.toThrow(
        `write ${write} interrupted`,
      );
      state.failWrite = undefined;
      await new InstanceManager().initialize();

      const migrated = state.local.get(
        STORAGE_KEYS.INSTANCES,
      ) as PersistedInstances;
      expect(migrated.instances[0].id).toBe(oldId);
      expect(migrated.instances[0].name).toBe("Renamed legacy");
      expect(migrated.activeInstanceId).toBe(oldId);
      expect(
        state.session.get(`${STORAGE_KEYS.INSTANCE_SESSION_PREFIX}${oldId}`),
      ).toEqual(legacySession);
      expect(state.session.get(`masterKey_${oldId}`)).toBe("legacy-master-key");
      expect(state.local.get("pisentinel_instances_migration_v1")).toEqual({
        version: 1,
        instanceId: oldId,
      });
    },
  );
});
