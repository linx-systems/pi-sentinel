import { describe, expect, it, vi } from "vitest";
import { createInitializationGate } from "~/background/readiness";

describe("background initialization gate", () => {
  it("keeps readiness rejected after initialization fails", async () => {
    const gate = createInitializationGate();
    const initialize = vi.fn().mockRejectedValue(new Error("migration failed"));

    await expect(gate.initialize(initialize)).rejects.toThrow(
      "migration failed",
    );
    await expect(gate.wait()).rejects.toThrow("migration failed");
    expect(initialize).toHaveBeenCalledTimes(1);
  });

  it("makes messages, storage requests, and alarms wait for readiness", async () => {
    const gate = createInitializationGate();
    let resolveInitialization: (() => void) | undefined;
    const initialization = new Promise<void>((resolve) => {
      resolveInitialization = resolve;
    });
    const dispatch = vi.fn();

    void gate.initialize(() => initialization);
    const message = gate.wait().then(dispatch);
    const storageRequest = gate.wait().then(dispatch);
    const alarm = gate.wait().then(dispatch);

    await Promise.resolve();
    expect(dispatch).not.toHaveBeenCalled();
    resolveInitialization?.();
    await Promise.all([message, storageRequest, alarm]);
    expect(dispatch).toHaveBeenCalledTimes(3);
  });
});
