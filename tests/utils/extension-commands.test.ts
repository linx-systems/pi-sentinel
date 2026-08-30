import { describe, expect, it, vi, type Mock } from "vitest";
import {
  createRuntimeStorageCommandSignalReceiver,
  createExtensionCommands,
  createRuntimeExtensionCommands,
  createStorageExtensionCommands,
  registerStorageCommandReceiver,
  STORAGE_COMMAND_REQUEST_PREFIX,
  STORAGE_COMMAND_RESPONSE_PREFIX,
  STORAGE_COMMAND_SIGNAL_TYPE,
  type StorageCommandBrowser,
  type StorageCommandSignal,
} from "~/utils/extension-commands";
import type { CommandMessage } from "~/utils/messaging";
import { createCommandDispatcher } from "~/utils/commands/dispatcher";

type ChangeListener = (
  changes: Record<string, { newValue?: unknown }>,
  areaName: string,
) => void;

function storageBrowser(sessionAvailable = true): {
  browser: StorageCommandBrowser;
  values: Map<string, unknown>;
  listeners: ChangeListener[];
  setCalls: Array<Record<string, unknown>>;
  removeCalls: Array<string | string[]>;
  runtimeSend: Mock;
} {
  const values = new Map<string, unknown>();
  const listeners: ChangeListener[] = [];
  const setCalls: Array<Record<string, unknown>> = [];
  const removeCalls: Array<string | string[]> = [];
  const runtimeSend = vi.fn(async () => undefined);
  const notify = (
    changes: Record<string, { newValue?: unknown }>,
    area: string,
  ) => {
    for (const listener of [...listeners]) listener(changes, area);
  };
  const area = (name: string) => ({
    set: async (entries: Record<string, unknown>) => {
      setCalls.push(entries);
      for (const [key, value] of Object.entries(entries))
        values.set(key, value);
      notify(
        Object.fromEntries(
          Object.entries(entries).map(([key, newValue]) => [key, { newValue }]),
        ),
        name,
      );
    },
    remove: async (keys: string | string[]) => {
      removeCalls.push(keys);
      for (const key of typeof keys === "string" ? [keys] : keys) {
        values.delete(key);
        notify({ [key]: { newValue: undefined } }, name);
      }
    },
  });
  const local = area("local");
  return {
    browser: {
      runtime: { sendMessage: runtimeSend },
      storage: {
        local,
        ...(sessionAvailable ? { session: area("session") } : {}),
        onChanged: {
          addListener: (listener: ChangeListener) => listeners.push(listener),
          removeListener: (listener: ChangeListener) => {
            const index = listeners.indexOf(listener);
            if (index >= 0) listeners.splice(index, 1);
          },
        },
      },
    },
    values,
    listeners,
    setCalls,
    removeCalls,
    runtimeSend,
  };
}

describe("ExtensionCommands", () => {
  it("normalizes an absent runtime background into a command failure", async () => {
    const sendMessage = vi
      .fn()
      .mockRejectedValue(
        new Error(
          "Could not establish connection. Receiving end does not exist.",
        ),
      );
    const commands = createRuntimeExtensionCommands({
      runtime: { sendMessage },
    });

    await expect(commands.getInstances()).resolves.toEqual({
      success: false,
      error: "Could not establish connection. Receiving end does not exist.",
    });
  });

  it("returns an actionable failure when transport rejects without an error message", async () => {
    const commands = createExtensionCommands({
      send: vi.fn().mockRejectedValue({}),
    });

    await expect(commands.getInstances()).resolves.toEqual({
      success: false,
      error: "Unable to contact PiSentinel. Please try again.",
    });
  });

  it("gives malformed command failures an actionable message", async () => {
    const commands = createExtensionCommands({
      send: vi.fn().mockResolvedValue({ success: false }),
    });

    await expect(commands.getInstances()).resolves.toEqual({
      success: false,
      error: "Command failed. Please try again.",
    });
  });

  it("preserves structured TOTP outcomes through the runtime adapter", async () => {
    const sendMessage = vi.fn().mockResolvedValue({
      success: true,
      data: { kind: "totp-required" },
    });
    const commands = createRuntimeExtensionCommands({
      runtime: { sendMessage },
    });

    await expect(
      commands.connectInstance({ instanceId: "home", totp: "123456" }),
    ).resolves.toEqual({
      success: true,
      data: { kind: "totp-required" },
    });
  });

  it("preserves partial fleet results through the runtime adapter", async () => {
    const outcome = {
      entries: [
        {
          instanceId: "home",
          instanceName: "Home",
          gravity: true,
          allowlist: false,
          denylist: false,
        },
      ],
      failures: [
        { instanceId: "remote", instanceName: "Remote", message: "Offline" },
      ],
      complete: false,
    };
    const commands = createRuntimeExtensionCommands({
      runtime: {
        sendMessage: vi
          .fn()
          .mockResolvedValue({ success: true, data: outcome }),
      },
    });

    await expect(commands.searchDomain("example.test")).resolves.toEqual({
      success: true,
      data: outcome,
    });
  });

  it("rejects malformed temporary-allow success data before exposing it to callers", async () => {
    const commands = createRuntimeExtensionCommands({
      runtime: {
        sendMessage: vi
          .fn()
          .mockResolvedValue({ success: true, data: { entries: "invalid" } }),
      },
    });

    await expect(commands.getTemporaryAllows()).resolves.toEqual({
      success: false,
      error: "Invalid command response. Please try again.",
    });
  });

  it("rejects an unknown structured connection outcome", async () => {
    const commands = createRuntimeExtensionCommands({
      runtime: {
        sendMessage: vi
          .fn()
          .mockResolvedValue({ success: true, data: { kind: "waiting" } }),
      },
    });

    await expect(
      commands.connectInstance({ instanceId: "home" }),
    ).resolves.toEqual({
      success: false,
      error: {
        kind: "other",
        message: "Invalid command response. Please try again.",
        status: null,
      },
    });
  });

  it("rejects malformed fleet results before exposing them to callers", async () => {
    const commands = createRuntimeExtensionCommands({
      runtime: {
        sendMessage: vi.fn().mockResolvedValue({
          success: true,
          data: { entries: [], failures: "offline", complete: false },
        }),
      },
    });

    await expect(commands.searchDomain("example.test")).resolves.toEqual({
      success: false,
      error: "Invalid command response. Please try again.",
    });
  });

  it("accepts omitted data for void command successes", async () => {
    const commands = createRuntimeExtensionCommands({
      runtime: { sendMessage: vi.fn().mockResolvedValue({ success: true }) },
    });

    await expect(commands.disconnectInstance("home")).resolves.toEqual({
      success: true,
      data: undefined,
    });
  });

  it("accepts the boolean blocking result produced by the background handler", async () => {
    const commands = createRuntimeExtensionCommands({
      runtime: {
        sendMessage: vi.fn().mockResolvedValue({
          success: true,
          data: { blocking: true, timer: null },
        }),
      },
    });

    await expect(commands.getBlockingStatus()).resolves.toEqual({
      success: true,
      data: { blocking: true, timer: null },
    });
  });

  it("preserves a null tab-domain result when the tab has not been inspected", async () => {
    const commands = createRuntimeExtensionCommands({
      runtime: {
        sendMessage: vi.fn().mockResolvedValue({ success: true, data: null }),
      },
    });

    await expect(commands.getTabDomains(42)).resolves.toEqual({
      success: true,
      data: null,
    });
  });

  it("uses unique ephemeral envelopes for concurrent same-command calls from multiple adapters", async () => {
    const fake = storageBrowser();
    const requestMessages: CommandMessage[] = [];
    fake.listeners.push((changes, areaName) => {
      if (areaName !== "session") return;
      for (const [key, change] of Object.entries(changes)) {
        if (!key.startsWith("pisentinel.command.request.") || !change.newValue)
          continue;
        const request = change.newValue as {
          id: string;
          message: CommandMessage;
        };
        requestMessages.push(request.message);
        void fake.browser.storage.session!.set({
          [`pisentinel.command.response.${request.id}`]: {
            id: request.id,
            result: {
              success: true,
              data: {
                instances: [],
                activeInstanceId: null,
                globalSettings: {
                  notificationsEnabled: true,
                  refreshInterval: 60,
                },
              },
            },
          },
        });
      }
    });
    const first = createStorageExtensionCommands({ browser: fake.browser });
    const second = createStorageExtensionCommands({ browser: fake.browser });
    const runtime = createRuntimeExtensionCommands({
      runtime: {
        sendMessage: vi.fn().mockResolvedValue({
          success: true,
          data: {
            instances: [],
            activeInstanceId: null,
            globalSettings: { notificationsEnabled: true, refreshInterval: 60 },
          },
        }),
      },
    });
    const storageOutcomes = await Promise.all([
      first.getInstances(),
      second.getInstances(),
    ]);
    await expect(runtime.getInstances()).resolves.toEqual(storageOutcomes[0]);
    expect(storageOutcomes).toEqual([
      {
        success: true,
        data: {
          instances: [],
          activeInstanceId: null,
          globalSettings: { notificationsEnabled: true, refreshInterval: 60 },
        },
      },
      {
        success: true,
        data: {
          instances: [],
          activeInstanceId: null,
          globalSettings: { notificationsEnabled: true, refreshInterval: 60 },
        },
      },
    ]);
    expect(requestMessages).toEqual([
      { type: "GET_INSTANCES" },
      { type: "GET_INSTANCES" },
    ]);
    expect(fake.values).toEqual(new Map());
    expect(
      fake.setCalls.every((entries) =>
        Object.keys(entries).every((key) => !key.includes("password")),
      ),
    ).toBe(true);
  });

  it("uses a one-way runtime signal and a local response mailbox when session storage is unavailable", async () => {
    const fake = storageBrowser(false);
    const dispatch = vi.fn(async () => ({
      success: true as const,
      data: undefined,
    }));
    const receiveSignal = createRuntimeStorageCommandSignalReceiver({
      storage: fake.browser.storage.local,
      dispatch,
    });
    fake.runtimeSend.mockImplementation(
      async (signal: StorageCommandSignal) => {
        await receiveSignal(signal);
        return undefined;
      },
    );

    await expect(
      createStorageExtensionCommands({
        browser: fake.browser,
      }).disconnectInstance("home"),
    ).resolves.toEqual({ success: true, data: undefined });

    expect(dispatch).toHaveBeenCalledWith({
      type: "DISCONNECT_INSTANCE",
      payload: { instanceId: "home" },
    });
    expect(fake.runtimeSend).toHaveBeenCalledWith(
      expect.objectContaining({ type: STORAGE_COMMAND_SIGNAL_TYPE }),
    );
    expect(fake.setCalls).toHaveLength(1);
    expect(Object.keys(fake.setCalls[0]!)).toEqual([
      expect.stringMatching(/^pisentinel\.command\.response\./),
    ]);
    expect(fake.values).toEqual(new Map());
  });

  it("never persists credentials when the local fallback signal receiver is absent", async () => {
    const fake = storageBrowser(false);
    fake.runtimeSend.mockRejectedValue(
      new Error(
        "Could not establish connection. Receiving end does not exist.",
      ),
    );

    await expect(
      createStorageExtensionCommands({ browser: fake.browser }).connectInstance(
        {
          instanceId: "home",
          password: "password-not-for-storage",
          totp: "123456",
        },
      ),
    ).resolves.toEqual({
      success: false,
      error: {
        kind: "other",
        message:
          "Could not establish connection. Receiving end does not exist.",
        status: null,
      },
    });

    expect(fake.values).toEqual(new Map());
    expect(JSON.stringify(fake.setCalls)).not.toContain(
      "password-not-for-storage",
    );
    expect(JSON.stringify(fake.setCalls)).not.toContain("123456");
  });

  it("never persists credentials while an unresponsive fallback receiver simulates a crash", async () => {
    const fake = storageBrowser(false);
    vi.useFakeTimers();
    const pending = createStorageExtensionCommands({
      browser: fake.browser,
      timeoutMs: 1,
      connectTimeoutMs: 1,
    }).connectInstance({
      instanceId: "home",
      password: "password-not-for-storage",
      totp: "123456",
    });

    await Promise.resolve();
    expect(fake.values).toEqual(new Map());
    expect(JSON.stringify(fake.setCalls)).not.toContain(
      "password-not-for-storage",
    );
    expect(JSON.stringify(fake.setCalls)).not.toContain("123456");

    await vi.advanceTimersByTimeAsync(2);
    await expect(pending).resolves.toEqual({
      success: false,
      error: {
        kind: "other",
        message: "Command timeout; outcome is indeterminate",
        status: null,
      },
    });
    vi.useRealTimers();
  });

  it("dispatches duplicate local fallback signals only once", async () => {
    const fake = storageBrowser(false);
    const dispatch = vi.fn(async () => ({
      success: true as const,
      data: undefined,
    }));
    const receiveSignal = createRuntimeStorageCommandSignalReceiver({
      storage: fake.browser.storage.local,
      dispatch,
    });
    const signal: StorageCommandSignal = {
      type: STORAGE_COMMAND_SIGNAL_TYPE,
      id: "duplicate-signal",
      command: { type: "DISCONNECT_INSTANCE", payload: { instanceId: "home" } },
    };

    await Promise.all([receiveSignal(signal), receiveSignal(signal)]);

    expect(dispatch).toHaveBeenCalledOnce();
    expect(fake.setCalls).toHaveLength(1);
  });

  it("settles a matching malformed storage response without waiting for timeout", async () => {
    const fake = storageBrowser();
    fake.listeners.push((changes, areaName) => {
      if (areaName !== "session") return;
      for (const [key, change] of Object.entries(changes)) {
        if (!key.startsWith(STORAGE_COMMAND_REQUEST_PREFIX) || !change.newValue)
          continue;
        const request = change.newValue as { id: string };
        void fake.browser.storage.session!.set({
          [`${STORAGE_COMMAND_RESPONSE_PREFIX}${request.id}`]: {
            id: request.id,
          },
        });
      }
    });

    await expect(
      createStorageExtensionCommands({
        browser: fake.browser,
        timeoutMs: 60_000,
      }).getInstances(),
    ).resolves.toEqual({
      success: false,
      error: "Invalid command response. Please try again.",
    });
  });

  it("retries rejected response cleanup without changing a known command outcome", async () => {
    const fake = storageBrowser();
    const cleanupError = new Error("temporary storage failure");
    const onError = vi.fn();
    const remove = vi
      .fn()
      .mockRejectedValueOnce(cleanupError)
      .mockImplementation(async (keys: string | string[]) => {
        for (const key of typeof keys === "string" ? [keys] : keys) {
          fake.values.delete(key);
        }
      });
    fake.browser.storage.session!.remove = remove;
    fake.listeners.push((changes, areaName) => {
      if (areaName !== "session") return;
      for (const [key, change] of Object.entries(changes)) {
        if (!key.startsWith(STORAGE_COMMAND_REQUEST_PREFIX) || !change.newValue)
          continue;
        const request = change.newValue as { id: string };
        void fake.browser.storage.session!.set({
          [`${STORAGE_COMMAND_RESPONSE_PREFIX}${request.id}`]: {
            id: request.id,
            result: {
              success: true,
              data: {
                instances: [],
                activeInstanceId: null,
                globalSettings: {
                  notificationsEnabled: true,
                  refreshInterval: 60,
                },
              },
            },
          },
        });
      }
    });

    await expect(
      createStorageExtensionCommands({
        browser: fake.browser,
        onError,
      }).getInstances(),
    ).resolves.toEqual({
      success: true,
      data: {
        instances: [],
        activeInstanceId: null,
        globalSettings: { notificationsEnabled: true, refreshInterval: 60 },
      },
    });

    expect(remove).toHaveBeenCalledTimes(2);
    expect(onError).toHaveBeenCalledWith(cleanupError);
  });

  it("claims each storage request once before awaiting and cleans the claim after completion", async () => {
    const fake = storageBrowser();
    const completion = Promise.withResolvers<{
      success: true;
      data: undefined;
    }>();
    const dispatch = vi.fn(() => completion.promise);
    const unregister = registerStorageCommandReceiver({
      browser: fake.browser,
      dispatch,
      isCommand: (value): value is CommandMessage =>
        value !== null && typeof value === "object" && "type" in value,
    });
    const id = "request-42";
    const requestKey = `${STORAGE_COMMAND_REQUEST_PREFIX}${id}`;
    const request = {
      id,
      message: { type: "GET_INSTANCES" } as CommandMessage,
    };

    await fake.browser.storage.session!.set({
      [`${STORAGE_COMMAND_REQUEST_PREFIX}wrong-id`]: request,
    });
    await Promise.resolve();
    expect(dispatch).not.toHaveBeenCalled();
    await fake.browser.storage.session!.set({ [requestKey]: request });
    await vi.waitFor(() => expect(dispatch).toHaveBeenCalledOnce());

    expect(fake.removeCalls).toContain(requestKey);

    for (const listener of fake.listeners) {
      listener({ [requestKey]: { newValue: request } }, "session");
    }
    await Promise.resolve();
    expect(dispatch).toHaveBeenCalledOnce();

    completion.resolve({ success: true, data: undefined });
    const responseKey = `${STORAGE_COMMAND_RESPONSE_PREFIX}${id}`;
    await vi.waitFor(() =>
      expect(fake.setCalls).toContainEqual({
        [responseKey]: {
          id,
          result: { success: true, data: undefined },
        },
      }),
    );

    await fake.browser.storage.session!.set({ [requestKey]: request });
    await vi.waitFor(() => expect(dispatch).toHaveBeenCalledTimes(2));
    unregister();
  });

  it("reports an eagerly rejected request cleanup after the queue reaches it", async () => {
    const fake = storageBrowser();
    const completion = Promise.withResolvers<{
      success: true;
      data: undefined;
    }>();
    const onError = vi.fn();
    const firstId = "first-request";
    const secondId = "second-request";
    const firstKey = `${STORAGE_COMMAND_REQUEST_PREFIX}${firstId}`;
    const secondKey = `${STORAGE_COMMAND_REQUEST_PREFIX}${secondId}`;
    const secondResponseKey = `${STORAGE_COMMAND_RESPONSE_PREFIX}${secondId}`;
    const removeError = new Error("request cleanup failed");
    fake.browser.storage.session!.remove = vi.fn(
      async (keys: string | string[]) => {
        if (keys === secondKey) throw removeError;
        for (const key of typeof keys === "string" ? [keys] : keys) {
          fake.values.delete(key);
        }
      },
    );
    const dispatch = vi.fn(() => completion.promise);
    registerStorageCommandReceiver({
      browser: fake.browser,
      dispatch,
      isCommand: (value): value is CommandMessage =>
        value !== null && typeof value === "object" && "type" in value,
      onError,
    });

    await fake.browser.storage.session!.set({
      [firstKey]: { id: firstId, message: { type: "GET_INSTANCES" } },
    });
    await vi.waitFor(() => expect(dispatch).toHaveBeenCalledOnce());
    await fake.browser.storage.session!.set({
      [secondKey]: { id: secondId, message: { type: "GET_INSTANCES" } },
    });

    completion.resolve({ success: true, data: undefined });
    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith(removeError));

    await vi.waitFor(() =>
      expect(fake.setCalls).toContainEqual({
        [secondResponseKey]: {
          id: secondId,
          result: {
            success: false,
            error: "request cleanup failed",
          },
        },
      }),
    );
    expect(dispatch).toHaveBeenCalledOnce();
  });

  it("keeps CONNECT_INSTANCE alive past the generic timeout through its connection-attempt budget", async () => {
    const fake = storageBrowser();
    const connectCompletion = Promise.withResolvers<{
      success: true;
      data: { kind: "connected" };
    }>();
    registerStorageCommandReceiver({
      browser: fake.browser,
      dispatch: (message) =>
        message.type === "CONNECT_INSTANCE"
          ? connectCompletion.promise
          : { success: false, error: "Unexpected command" },
      isCommand: (value): value is CommandMessage =>
        value !== null && typeof value === "object" && "type" in value,
    });
    vi.useFakeTimers();
    const commands = createStorageExtensionCommands({
      browser: fake.browser,
      timeoutMs: 1,
      connectTimeoutMs: 2,
    });
    const pending = commands.connectInstance({ instanceId: "home" });
    let settled = false;
    void pending.then(() => {
      settled = true;
    });

    await vi.advanceTimersByTimeAsync(1);
    expect(settled).toBe(false);

    connectCompletion.resolve({
      success: true,
      data: { kind: "connected" },
    });
    await expect(pending).resolves.toEqual({
      success: true,
      data: { kind: "connected" },
    });
    vi.useRealTimers();
  });
  it("reconciles a timed-out connection as a structured TOTP outcome after its queued command completes", async () => {
    const fake = storageBrowser();
    const messages: CommandMessage[] = [];
    const connectCompletion = Promise.withResolvers<{
      success: true;
      data: { kind: "totp-required" };
    }>();
    registerStorageCommandReceiver({
      browser: fake.browser,
      dispatch: (message) => {
        messages.push(message);
        if (message.type === "CONNECT_INSTANCE") {
          return connectCompletion.promise;
        }
        if (message.type === "GET_INSTANCE_STATE") {
          return {
            success: true,
            data: {
              instanceId: "home",
              isConnected: false,
              connectionError: null,
              blockingEnabled: true,
              blockingTimer: null,
              stats: null,
              statsLastUpdated: 0,
              totpRequired: true,
            },
          };
        }
        return { success: false, error: "Unexpected command" };
      },
      isCommand: (value): value is CommandMessage =>
        value !== null && typeof value === "object" && "type" in value,
    });
    vi.useFakeTimers();
    const commands = createStorageExtensionCommands({
      browser: fake.browser,
      timeoutMs: 1,
      connectTimeoutMs: 1,
    });
    const pending = commands.connectInstance({
      instanceId: "home",
      password: "secret",
    });
    await vi.advanceTimersByTimeAsync(1);
    connectCompletion.resolve({
      success: true,
      data: { kind: "totp-required" },
    });

    await expect(pending).resolves.toEqual({
      success: true,
      data: { kind: "totp-required" },
    });
    expect(messages).toEqual([
      {
        type: "CONNECT_INSTANCE",
        payload: { instanceId: "home", password: "secret" },
      },
      { type: "GET_INSTANCE_STATE", payload: { instanceId: "home" } },
    ]);
    expect(fake.values).toEqual(new Map());
    vi.useRealTimers();
  });

  it("confirms a timed-out active-instance mutation from the instance configuration", async () => {
    const fake = storageBrowser();
    const messages: CommandMessage[] = [];
    const selectionCompletion = Promise.withResolvers<{
      success: true;
      data: undefined;
    }>();
    registerStorageCommandReceiver({
      browser: fake.browser,
      dispatch: (message) => {
        messages.push(message);
        if (message.type === "SET_ACTIVE_INSTANCE") {
          return selectionCompletion.promise;
        }
        if (message.type === "GET_INSTANCES") {
          return {
            success: true,
            data: {
              instances: [],
              activeInstanceId: "home",
              globalSettings: {
                notificationsEnabled: true,
                refreshInterval: 60,
              },
            },
          };
        }
        return { success: false, error: "Unexpected command" };
      },
      isCommand: (value): value is CommandMessage =>
        value !== null && typeof value === "object" && "type" in value,
    });
    vi.useFakeTimers();
    const pending = createStorageExtensionCommands({
      browser: fake.browser,
      timeoutMs: 1,
    }).setActiveInstance("home");
    await vi.advanceTimersByTimeAsync(1);
    selectionCompletion.resolve({ success: true, data: undefined });

    await expect(pending).resolves.toEqual({ success: true, data: undefined });
    expect(messages).toEqual([
      { type: "SET_ACTIVE_INSTANCE", payload: { instanceId: "home" } },
      { type: "GET_INSTANCES" },
    ]);
    vi.useRealTimers();
  });

  it("reports timed-out temporary-allow creation as indeterminate after consuming its relevant state", async () => {
    const fake = storageBrowser();
    const messages: CommandMessage[] = [];
    const createCompletion = Promise.withResolvers<{
      success: true;
      data: { entries: []; skippedDomains: []; failures: [] };
    }>();
    registerStorageCommandReceiver({
      browser: fake.browser,
      dispatch: (message) => {
        messages.push(message);
        if (message.type === "CREATE_TEMPORARY_ALLOWS") {
          return createCompletion.promise;
        }
        if (message.type === "GET_TEMPORARY_ALLOWS") {
          return { success: true, data: [] };
        }
        return { success: false, error: "Unexpected command" };
      },
      isCommand: (value): value is CommandMessage =>
        value !== null && typeof value === "object" && "type" in value,
    });
    vi.useFakeTimers();
    const pending = createStorageExtensionCommands({
      browser: fake.browser,
      timeoutMs: 1,
    }).createTemporaryAllows({
      domains: ["example.test"],
      durationSeconds: 60,
    });
    await vi.advanceTimersByTimeAsync(1);
    createCompletion.resolve({
      success: true,
      data: { entries: [], skippedDomains: [], failures: [] },
    });

    await expect(pending).resolves.toEqual({
      success: false,
      error: "Command timeout; outcome is indeterminate",
    });
    expect(messages).toEqual([
      {
        type: "CREATE_TEMPORARY_ALLOWS",
        payload: { domains: ["example.test"], durationSeconds: 60 },
      },
      { type: "GET_TEMPORARY_ALLOWS" },
    ]);
    vi.useRealTimers();
  });

  it("contains handler failures in the one canonical dispatcher", async () => {
    const dispatch = createCommandDispatcher({
      GET_INSTANCES: async () => {
        throw new Error("boom");
      },
    });

    await expect(dispatch({ type: "GET_INSTANCES" })).resolves.toEqual({
      success: false,
      error: "boom",
    });
  });

  it("returns an actionable failure for a non-Error handler rejection", async () => {
    const dispatch = createCommandDispatcher({
      GET_INSTANCES: async () => Promise.reject({}),
    });

    await expect(dispatch({ type: "GET_INSTANCES" })).resolves.toEqual({
      success: false,
      error: "Command failed. Please try again.",
    });
  });
});
