import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/preact";
import { useExtensionState } from "~/utils/hooks/useExtensionState";
import type { ExtensionState } from "~/utils/types";

const { getState, addMessageListener, removeMessageListener } = vi.hoisted(
  () => ({
    getState: vi.fn(),
    addMessageListener: vi.fn(),
    removeMessageListener: vi.fn(),
  }),
);

vi.mock("~/utils/extension-commands", () => ({
  createRuntimeExtensionCommands: () => ({ getState }),
}));

vi.mock("webextension-polyfill", () => ({
  default: {
    runtime: {
      getManifest: () => ({}),
      onMessage: {
        addListener: addMessageListener,
        removeListener: removeMessageListener,
      },
    },
    storage: {
      local: {
        get: vi.fn(async () => ({})),
      },
    },
  },
}));

const extensionState = {
  isConnected: true,
  connectionError: null,
  stats: null,
  statsLastUpdated: 0,
  blockingEnabled: true,
  blockingTimer: null,
  totpRequired: false,
} satisfies ExtensionState;

function StateView() {
  const { state, isLoading, error } = useExtensionState();
  return (
    <output>
      {isLoading
        ? "loading"
        : error
          ? error
          : state?.isConnected
            ? "connected"
            : "disconnected"}
    </output>
  );
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  getState.mockReset();
  addMessageListener.mockReset();
  removeMessageListener.mockReset();
});

describe("useExtensionState commands", () => {
  it("loads state through the runtime command interface", async () => {
    getState.mockResolvedValue({ success: true, data: extensionState });

    render(<StateView />);

    await waitFor(() => {
      expect(getState).toHaveBeenCalledOnce();
      expect(screen.getByText("connected")).toBeTruthy();
    });
  });

  it("merges a valid partial state update with the loaded state", async () => {
    getState.mockResolvedValue({ success: true, data: extensionState });

    render(<StateView />);
    await screen.findByText("connected");

    const listener = addMessageListener.mock.calls[0]?.[0];
    expect(listener).toBeTypeOf("function");
    if (typeof listener !== "function") {
      throw new Error("State update listener was not registered");
    }

    await act(async () => {
      listener({
        type: "STATE_UPDATED",
        payload: { blockingEnabled: false },
      });
    });

    expect(screen.getByText("connected")).toBeTruthy();
  });

  it("retries normalized absent-background failures without exposing transport details", async () => {
    vi.useFakeTimers();
    getState
      .mockResolvedValueOnce({
        success: false,
        error: "Could not establish connection. Receiving end does not exist.",
      })
      .mockResolvedValueOnce({ success: true, data: extensionState });

    render(<StateView />);

    await act(async () => {
      await Promise.resolve();
    });

    expect(getState).toHaveBeenCalledOnce();
    expect(screen.getByText("Failed to fetch extension state")).toBeTruthy();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    expect(getState).toHaveBeenCalledTimes(2);
    expect(screen.getByText("connected")).toBeTruthy();
  });

  it("retries thrown transient errors without exposing transport details", async () => {
    vi.useFakeTimers();
    getState
      .mockRejectedValueOnce(new Error("Extension context invalidated."))
      .mockResolvedValueOnce({ success: true, data: extensionState });

    render(<StateView />);

    await act(async () => {
      await Promise.resolve();
    });

    expect(getState).toHaveBeenCalledOnce();
    expect(screen.getByText("Failed to fetch extension state")).toBeTruthy();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    expect(getState).toHaveBeenCalledTimes(2);
    expect(screen.getByText("connected")).toBeTruthy();
  });

  it("does not retry permanent command failures", async () => {
    vi.useFakeTimers();
    getState.mockResolvedValue({
      success: false,
      error: "State service unavailable",
    });

    render(<StateView />);

    await act(async () => {
      await Promise.resolve();
    });

    expect(getState).toHaveBeenCalledOnce();
    expect(screen.getByText("State service unavailable")).toBeTruthy();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    expect(getState).toHaveBeenCalledOnce();
  });
});
