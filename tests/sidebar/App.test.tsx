import { fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { describe, expect, it, vi } from "vitest";
import browser from "webextension-polyfill";
import type { TemporaryAllowEntry } from "~/utils/types";

const {
  getTemporaryAllows,
  createTemporaryAllows,
  getTabDomains,
  addToAllowlist,
  addToDenylist,
} = vi.hoisted(() => ({
  getTemporaryAllows: vi.fn(),
  createTemporaryAllows: vi.fn(),
  getTabDomains: vi.fn(),
  addToAllowlist: vi.fn(),
  addToDenylist: vi.fn(),
}));

vi.mock("~/utils/extension-commands", () => ({
  createRuntimeExtensionCommands: () => ({
    getTemporaryAllows,
    createTemporaryAllows,
    getTabDomains,
    addToAllowlist,
    addToDenylist,
  }),
}));

vi.mock("~/utils/hooks/useExtensionState", () => ({
  useExtensionState: () => ({
    state: { isConnected: true },
    isLoading: false,
  }),
}));

vi.mock("~/components/InstanceSelector", () => ({
  InstanceSelector: () => <div>Instance selector</div>,
}));

vi.mock("~/entrypoints/sidebar/components/DomainList", () => ({
  DomainList: ({
    temporaryAllows,
    onCreateTemporaryAllow,
  }: {
    temporaryAllows: readonly TemporaryAllowEntry[];
    onCreateTemporaryAllow: (
      domain: string,
      durationSeconds: number | null,
    ) => Promise<boolean>;
  }) => (
    <>
      <output aria-label="temporary allow count">
        {temporaryAllows.length}
      </output>
      <button
        onClick={() => void onCreateTemporaryAllow("cdn.example.test", 300)}
      >
        Create temporary allow
      </button>
    </>
  ),
}));

vi.mock("~/entrypoints/sidebar/components/QueryLog", () => ({
  QueryLog: () => <div>Query log</div>,
}));

vi.mock("~/entrypoints/sidebar/components/Repair", () => ({
  Repair: () => <div>Repair</div>,
}));

import { App } from "~/entrypoints/sidebar/components/App";

(
  browser.tabs as typeof browser.tabs & {
    onActivated: {
      addListener(listener: () => void): void;
      removeListener(listener: () => void): void;
    };
  }
).onActivated = {
  addListener: vi.fn(),
  removeListener: vi.fn(),
};

const entry: TemporaryAllowEntry = {
  id: "allow-1",
  domain: "cdn.example.test",
  instanceId: "primary",
  instanceName: "Primary",
  createdAt: 1_700_000_000,
  expiresAt: 1_700_000_300,
  createdByExtension: true,
};

describe("App temporary allows", () => {
  it("shares the refreshed temporary-allow snapshot with the domain view after creation", async () => {
    getTemporaryAllows
      .mockResolvedValueOnce({ success: true, data: [] })
      .mockResolvedValueOnce({ success: true, data: [entry] });
    createTemporaryAllows.mockResolvedValue({
      success: true,
      data: { entries: [entry], skippedDomains: [], failures: [] },
    });

    render(<App />);
    await waitFor(() => {
      expect(screen.getByLabelText("temporary allow count").textContent).toBe(
        "0",
      );
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Create temporary allow" }),
    );

    await waitFor(() => {
      expect(createTemporaryAllows).toHaveBeenCalledWith({
        domains: [entry.domain],
        durationSeconds: 300,
      });
      expect(screen.getByLabelText("temporary allow count").textContent).toBe(
        "1",
      );
    });
  });
});
