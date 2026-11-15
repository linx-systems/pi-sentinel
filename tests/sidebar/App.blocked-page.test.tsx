import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/preact";
import browser from "webextension-polyfill";

const mocks = vi.hoisted(() => ({
  getTabDomains: vi.fn(),
  addToAllowlist: vi.fn(),
  getTemporaryAllows: vi.fn().mockResolvedValue({ success: true, data: [] }),
}));
vi.mock("~/utils/extension-commands", () => ({
  createRuntimeExtensionCommands: () => mocks,
}));
vi.mock("~/utils/hooks/useExtensionState", () => ({
  useExtensionState: () => ({ state: { isConnected: true }, isLoading: false }),
}));
vi.mock("~/components/InstanceSelector", () => ({
  InstanceSelector: () => null,
}));
vi.mock("~/entrypoints/sidebar/components/DomainList", () => ({
  DomainList: () => null,
}));
import { App } from "~/entrypoints/sidebar/components/App";

const data = {
  tabId: 1,
  pageUrl: "https://blocked.test/",
  firstPartyDomain: "blocked.test",
  domains: ["blocked.test"],
  thirdPartyDomains: [],
  pageBlocked: { domain: "blocked.test", instanceName: "Home" },
};
beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  Object.assign(browser.tabs, {
    onActivated: { addListener: vi.fn(), removeListener: vi.fn() },
  });
  vi.mocked(browser.tabs.query).mockResolvedValue([{ id: 1 }] as any);
  mocks.getTabDomains.mockResolvedValue({ success: true, data });
  mocks.addToAllowlist.mockResolvedValue({ success: true });
});
describe("blocked page banner", () => {
  it("shows the evidence and allows the blocked domain through the existing command", async () => {
    render(<App />);
    await screen.findByText(/This page may be blocked by Pi-hole/);
    fireEvent.click(screen.getByRole("button", { name: "Allow domain" }));
    await waitFor(() =>
      expect(mocks.addToAllowlist).toHaveBeenCalledWith("blocked.test"),
    );
    await screen.findByText("Added blocked.test to allowlist");
  });
  it("shows a failed allow without claiming success", async () => {
    mocks.addToAllowlist.mockResolvedValue({
      success: false,
      error: "Pi-hole unavailable",
    });
    render(<App />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Allow domain" }),
    );
    await screen.findByText("Pi-hole unavailable");
    expect(screen.queryByText("Added blocked.test to allowlist")).toBeNull();
  });
  it("hides the banner when navigation resets the block state", async () => {
    render(<App />);
    await screen.findByText(/This page may be blocked by Pi-hole/);
    for (const [listener] of vi.mocked(browser.runtime.onMessage.addListener)
      .mock.calls) {
      await (listener as any)({
        type: "TAB_DOMAINS_UPDATED",
        payload: { ...data, pageBlocked: null },
      });
    }
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Allow domain" })).toBeNull(),
    );
  });
});
