import { describe, expect, it, vi } from "vitest";
import type {
  CreateTemporaryAllowsResult,
  RemoveTemporaryAllowsResult,
} from "~/utils/messaging";
import type { TemporaryAllowEntry } from "~/utils/types";
import type { ExtensionCommands } from "~/utils/extension-commands";
import {
  SidebarTemporaryAllows,
  type TemporaryAllowMessageSource,
  type TemporaryAllowOutcome,
} from "~/entrypoints/sidebar/components/temporary-allows";
const entry: TemporaryAllowEntry = {
  id: "allow-1",
  domain: "cdn.example.test",
  instanceId: "primary",
  instanceName: "Primary",
  createdAt: 1_700_000_000,
  expiresAt: 1_700_000_300,
  createdByExtension: true,
};

type TemporaryAllowCommands = Pick<
  ExtensionCommands,
  "getTemporaryAllows" | "createTemporaryAllows" | "removeTemporaryAllows"
>;

function createHarness() {
  let messageListener: ((message: unknown) => unknown) | undefined;
  const source: TemporaryAllowMessageSource = {
    onMessage: {
      addListener: vi.fn((listener) => {
        messageListener = listener;
      }),
      removeListener: vi.fn(),
    },
  };
  const commandMocks = {
    getTemporaryAllows: vi.fn(),
    createTemporaryAllows: vi.fn(),
    removeTemporaryAllows: vi.fn(),
  };

  return {
    commands: commandMocks as unknown as TemporaryAllowCommands,
    commandMocks,
    source,
    receive(message: unknown) {
      if (!messageListener) {
        throw new Error("Temporary allow listener was not registered");
      }
      messageListener(message);
    },
  };
}

describe("TemporaryAllowOutcome", () => {
  it("keeps success data and failure errors mutually exclusive for callers", () => {
    const success: TemporaryAllowOutcome<CreateTemporaryAllowsResult> = {
      success: true,
      data: { entries: [entry], skippedDomains: [], failures: [] },
    };
    const failure: TemporaryAllowOutcome<CreateTemporaryAllowsResult> = {
      success: false,
      error: "Primary is unavailable",
    };

    expect(success.success ? success.data.entries : []).toEqual([entry]);
    expect(failure.success ? "" : failure.error).toBe("Primary is unavailable");
  });
});

describe("SidebarTemporaryAllows", () => {
  it("publishes the initial list and authoritative temporary-allow broadcasts", async () => {
    const harness = createHarness();
    harness.commandMocks.getTemporaryAllows.mockResolvedValue({
      success: true,
      data: [],
    });
    const temporaryAllows = new SidebarTemporaryAllows(
      harness.commands,
      harness.source,
    );
    const published = vi.fn();
    temporaryAllows.subscribe(published);

    await temporaryAllows.start();
    harness.receive({ type: "TEMPORARY_ALLOWS_UPDATED", payload: [entry] });

    expect(temporaryAllows.entries).toEqual([entry]);
    expect(published).toHaveBeenCalledTimes(2);
  });

  it("refreshes once after successful create and returns the structured outcome", async () => {
    const harness = createHarness();
    harness.commandMocks.getTemporaryAllows
      .mockResolvedValueOnce({ success: true, data: [] })
      .mockResolvedValueOnce({ success: true, data: [entry] });
    const createResult: CreateTemporaryAllowsResult = {
      entries: [entry],
      skippedDomains: [],
      failures: [],
    };
    harness.commandMocks.createTemporaryAllows.mockResolvedValue({
      success: true,
      data: createResult,
    });
    const temporaryAllows = new SidebarTemporaryAllows(
      harness.commands,
      harness.source,
    );

    await temporaryAllows.start();
    await expect(
      temporaryAllows.allow({
        domains: [entry.domain],
        durationSeconds: 300,
      }),
    ).resolves.toEqual({ success: true, data: createResult });

    expect(harness.commandMocks.getTemporaryAllows).toHaveBeenCalledTimes(2);
    expect(temporaryAllows.entries).toEqual([entry]);
  });

  it("does not refresh after a failed create and preserves its normalized error", async () => {
    const harness = createHarness();
    harness.commandMocks.getTemporaryAllows.mockResolvedValue({
      success: true,
      data: [entry],
    });
    harness.commandMocks.createTemporaryAllows.mockResolvedValue({
      success: false,
      error: "Primary is unavailable",
    });
    const temporaryAllows = new SidebarTemporaryAllows(
      harness.commands,
      harness.source,
    );

    await temporaryAllows.start();
    await expect(
      temporaryAllows.allow({
        domains: [entry.domain],
        durationSeconds: 300,
      }),
    ).resolves.toEqual({ success: false, error: "Primary is unavailable" });

    expect(harness.commandMocks.getTemporaryAllows).toHaveBeenCalledTimes(1);
    expect(temporaryAllows.entries).toEqual([entry]);
  });

  it("refreshes once after successful revocation and returns partial failures", async () => {
    const harness = createHarness();
    harness.commandMocks.getTemporaryAllows
      .mockResolvedValueOnce({ success: true, data: [entry] })
      .mockResolvedValueOnce({ success: true, data: [] });
    const removeResult: RemoveTemporaryAllowsResult = {
      removedIds: [entry.id],
      failures: [{ entryId: "other", message: "Primary is unavailable" }],
    };
    harness.commandMocks.removeTemporaryAllows.mockResolvedValue({
      success: true,
      data: removeResult,
    });
    const temporaryAllows = new SidebarTemporaryAllows(
      harness.commands,
      harness.source,
    );

    await temporaryAllows.start();
    await expect(temporaryAllows.revoke([entry.id])).resolves.toEqual({
      success: true,
      data: removeResult,
    });

    expect(harness.commandMocks.getTemporaryAllows).toHaveBeenCalledTimes(2);
    expect(temporaryAllows.entries).toEqual([]);
  });
});
