import { beforeEach, describe, expect, it, vi } from "vitest";
import browser from "webextension-polyfill";
import { DomainTrackerService } from "~/background/services/domain-tracker";
import { store } from "~/background/state/store";
import { notificationService } from "~/background/services/notifications";

vi.mock("~/background/services/notifications", () => ({
  notificationService: {
    showPageBlocked: vi.fn().mockResolvedValue(undefined),
  },
}));

const blocked = {
  entries: [
    {
      instanceId: "primary",
      instanceName: "Home",
      gravity: true,
      denylist: false,
      allowlist: false,
    },
  ],
  failures: [],
  complete: true,
};
let failed: (details: any) => void;
let completed: (details: any) => void;
let updated: (id: number, change: any, tab: any) => void;
let removed: (id: number) => void;
let searchDomain: ReturnType<typeof vi.fn>;
const request = (error = "NS_ERROR_UNKNOWN_HOST", type = "main_frame") => ({
  tabId: 1,
  url: "https://blocked.test/",
  type,
  error,
});

beforeEach(async () => {
  vi.clearAllMocks();
  store.clearTabDomains(1);
  Object.assign(browser.webRequest, {
    onCompleted: {
      addListener: vi.fn((listener) => {
        completed = listener;
      }),
    },
    onErrorOccurred: {
      addListener: vi.fn((listener) => {
        failed = listener;
      }),
    },
  });
  vi.mocked(browser.tabs.onUpdated.addListener).mockImplementation(
    (listener: any) => {
      updated = listener;
    },
  );
  vi.mocked(browser.tabs.onRemoved.addListener).mockImplementation(
    (listener: any) => {
      removed = listener;
    },
  );
  searchDomain = vi.fn().mockResolvedValue(blocked);
  new DomainTrackerService().initialize({ searchDomain });
  await Promise.resolve();
});

async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("blocked page detection", () => {
  it.each([
    "NS_ERROR_UNKNOWN_HOST",
    "NS_ERROR_UNKNOWN_PROXY_HOST",
    "net::ERR_NAME_NOT_RESOLVED",
    "net::ERR_NAME_RESOLUTION_FAILED",
    "NS_ERROR_CONNECTION_REFUSED",
    "net::ERR_CONNECTION_REFUSED",
    "net::ERR_ADDRESS_UNREACHABLE",
  ])("verifies %s against Pi-hole", async (error) => {
    failed(request(error));
    await settle();
    expect(searchDomain).toHaveBeenCalledWith("blocked.test");
    expect(store.getSerializableTabDomains(1)?.pageBlocked).toEqual({
      domain: "blocked.test",
      instanceName: "Home",
    });
    expect(notificationService.showPageBlocked).toHaveBeenCalledWith(
      "blocked.test",
    );
  });

  it.each([
    "NS_ERROR_NET_TIMEOUT",
    "net::ERR_ABORTED",
    "net::ERR_CERT_DATE_INVALID",
  ])("does not inspect unrelated error %s", async (error) => {
    failed(request(error));
    await settle();
    expect(searchDomain).not.toHaveBeenCalled();
  });

  it("does not inspect successful pages or failed subresources", () => {
    completed({ tabId: 1, url: "https://blocked.test/", type: "main_frame" });
    failed(request("NS_ERROR_UNKNOWN_HOST", "script"));
    expect(searchDomain).not.toHaveBeenCalled();
  });

  it.each([
    { ...blocked, entries: [] },
    { ...blocked, entries: [{ ...blocked.entries[0], gravity: false }] },
    { ...blocked, entries: [{ ...blocked.entries[0], allowlist: true }] },
    {
      entries: [],
      failures: [
        { instanceId: "primary", instanceName: "Home", message: "offline" },
      ],
      complete: false,
    },
  ])("does not report a block without positive evidence", async (result) => {
    searchDomain.mockResolvedValue(result);
    failed(request());
    await settle();
    expect(store.getSerializableTabDomains(1)?.pageBlocked).toBeNull();
    expect(notificationService.showPageBlocked).not.toHaveBeenCalled();
  });

  it("accepts a denylist match from a responding instance", async () => {
    searchDomain.mockResolvedValue({
      ...blocked,
      entries: [{ ...blocked.entries[0], gravity: false, denylist: true }],
      complete: false,
    });
    failed(request());
    await settle();
    expect(store.getSerializableTabDomains(1)?.pageBlocked?.domain).toBe(
      "blocked.test",
    );
  });

  it("contains lookup failures", async () => {
    searchDomain.mockRejectedValue(new Error("offline"));
    failed(request());
    await settle();
    expect(store.getSerializableTabDomains(1)?.pageBlocked).toBeNull();
  });

  it.each(["navigate", "reload", "close"])(
    "discards a lookup after %s",
    async (action) => {
      let resolve!: (value: typeof blocked) => void;
      searchDomain.mockReturnValue(
        new Promise((done) => {
          resolve = done;
        }),
      );
      failed(request());
      if (action === "close") removed(1);
      else
        updated(
          1,
          { status: "loading" },
          {
            url:
              action === "reload"
                ? "https://blocked.test/"
                : "https://other.test/",
          },
        );
      resolve(blocked);
      await settle();
      expect(
        store.getSerializableTabDomains(1)?.pageBlocked ?? null,
      ).toBeNull();
      expect(notificationService.showPageBlocked).not.toHaveBeenCalled();
    },
  );
});
