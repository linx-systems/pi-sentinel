import { render } from "@testing-library/preact";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TIMEOUTS } from "~/utils/constants";

const mocks = vi.hoisted(() => ({
  createStorageExtensionCommands: vi.fn(),
  error: vi.fn(),
}));

vi.mock("~/entrypoints/options/components/InstanceList", () => ({
  InstanceList: () => null,
}));

vi.mock("~/utils/extension-commands", () => ({
  createStorageExtensionCommands: mocks.createStorageExtensionCommands,
}));

vi.mock("~/utils/logger", () => ({
  logger: { error: mocks.error },
}));

import { App } from "~/entrypoints/options/components/App";

describe("Options app command construction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createStorageExtensionCommands.mockReturnValue({});
  });

  it("reports storage command cleanup errors through the production logger", () => {
    render(<App />);

    expect(mocks.createStorageExtensionCommands).toHaveBeenCalledWith(
      expect.objectContaining({ onError: expect.any(Function) }),
    );
    const [{ onError }] = mocks.createStorageExtensionCommands.mock.lastCall!;
    const cleanupError = new Error("storage cleanup failed");
    onError(cleanupError);

    expect(mocks.error).toHaveBeenCalledWith(
      "[PiSentinel] Storage command cleanup failed:",
      cleanupError,
    );
  });

  it("uses the connection-attempt budget only for CONNECT_INSTANCE storage commands", () => {
    render(<App />);

    expect(mocks.createStorageExtensionCommands).toHaveBeenCalledWith(
      expect.objectContaining({
        connectTimeoutMs: TIMEOUTS.CONNECTION_ATTEMPT,
      }),
    );
  });
});
