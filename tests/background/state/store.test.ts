import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StateStore } from "~/background/state/store";
import browser from "webextension-polyfill";

describe("StateStore", () => {
  let store: StateStore;

  beforeEach(() => {
    vi.clearAllMocks();

    // Reset the mock to resolve successfully
    vi.mocked(browser.runtime.sendMessage).mockResolvedValue({});

    // Create a fresh instance for each test
    store = new StateStore();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("getState", () => {
    it("should return initial state", () => {
      const state = store.getState();

      expect(state).toMatchObject({
        isConnected: false,
        connectionError: null,
        blockingEnabled: true,
        blockingTimer: null,
        stats: null,
        statsLastUpdated: 0,
        totpRequired: false,
      });
    });

    it("should return immutable copy of state", () => {
      const state1 = store.getState();
      const state2 = store.getState();

      expect(state1).not.toBe(state2);
      expect(state1).toEqual(state2);
    });
  });

  describe("instance lifecycle transitions", () => {
    const stats = {
      queries: {
        total: 10,
        blocked: 2,
        percent_blocked: 20,
        unique_domains: 8,
        forwarded: 4,
        cached: 6,
      },
      clients: { active: 3, total: 5 },
      gravity: { domains_being_blocked: 100, last_update: 123 },
    };

    it("projects the selected instance through connection and blocking snapshots", async () => {
      await store.selectInstance("primary");
      vi.clearAllMocks();

      await store.connectionSucceeded("primary");
      expect(browser.runtime.sendMessage).toHaveBeenCalledTimes(1);
      vi.clearAllMocks();

      await store.recordBlockingSnapshot("primary", {
        blocking: "disabled",
        timer: 60,
      });
      expect(browser.runtime.sendMessage).toHaveBeenCalledTimes(1);

      expect(store.getState()).toMatchObject({
        isConnected: true,
        blockingEnabled: false,
        blockingTimer: 60,
        totpRequired: false,
        connectionError: null,
      });
    });

    it("records a TOTP challenge without marking the instance connected", async () => {
      await store.selectInstance("primary");
      await store.connectionSucceeded("primary");
      vi.clearAllMocks();

      await store.requireTotp("primary");

      expect(store.getInstanceState("primary")).toMatchObject({
        isConnected: false,
        totpRequired: true,
        connectionError: null,
      });
      expect(browser.runtime.sendMessage).toHaveBeenCalledTimes(1);
    });

    it("publishes stats and blocking snapshots atomically", async () => {
      await store.selectInstance("primary");
      vi.clearAllMocks();

      await store.recordStatsSnapshot("primary", stats);

      expect(store.getInstanceState("primary")).toMatchObject({
        stats,
        statsLastUpdated: expect.any(Number),
      });
      expect(store.getCachedStats("primary")).toEqual(stats);
      expect(browser.runtime.sendMessage).toHaveBeenCalledTimes(1);

      vi.clearAllMocks();
      await store.recordBlockingSnapshot("primary", {
        blocking: "disabled",
        timer: 60,
      });

      expect(store.getInstanceState("primary")).toMatchObject({
        blockingEnabled: false,
        blockingTimer: 60,
      });
      expect(browser.runtime.sendMessage).toHaveBeenCalledTimes(1);
    });

    it("projects the selected instance and publishes selection once", async () => {
      await store.connectionSucceeded("primary");
      await store.connectionSucceeded("secondary");
      await store.recordBlockingSnapshot("secondary", {
        blocking: "disabled",
        timer: null,
      });
      vi.clearAllMocks();

      await store.selectInstance("secondary");

      expect(store.getState()).toMatchObject({
        isConnected: true,
        blockingEnabled: false,
      });
      expect(browser.runtime.sendMessage).toHaveBeenCalledTimes(1);
    });

    it("disconnects by clearing session-derived state and its cache", async () => {
      await store.selectInstance("primary");
      await store.connectionSucceeded("primary");
      await store.recordStatsSnapshot("primary", stats);
      await store.recordBlockingSnapshot("primary", {
        blocking: "disabled",
        timer: 60,
      });
      vi.clearAllMocks();

      await store.disconnectInstance("primary");

      expect(store.getInstanceState("primary")).toEqual({
        instanceId: "primary",
        isConnected: false,
        connectionError: null,
        blockingEnabled: true,
        blockingTimer: null,
        stats: null,
        statsLastUpdated: 0,
        totpRequired: false,
      });
      expect(store.getCachedStats("primary")).toBeNull();
      expect(browser.runtime.sendMessage).toHaveBeenCalledTimes(1);
    });

    it("removes the selected instance and publishes once", async () => {
      await store.selectInstance("primary");
      await store.connectionSucceeded("primary");
      vi.clearAllMocks();

      await store.removeInstance("primary");

      expect(store.getActiveInstanceId()).toBeNull();
      expect(store.getInstanceState("primary")).toBeNull();
      expect(store.getState()).toMatchObject({ isConnected: false });
      expect(browser.runtime.sendMessage).toHaveBeenCalledTimes(1);
    });
    it("rejects blocking snapshots for absent, disconnected, or TOTP-challenged instances", async () => {
      await expect(
        store.recordBlockingSnapshot("primary", {
          blocking: "disabled",
          timer: 60,
        }),
      ).resolves.toBe(false);
      expect(store.getInstanceState("primary")).toBeNull();

      await store.connectionSucceeded("primary");
      await store.requireTotp("primary");
      vi.clearAllMocks();

      await expect(
        store.recordBlockingSnapshot("primary", {
          blocking: "disabled",
          timer: 60,
        }),
      ).resolves.toBe(false);

      expect(store.getInstanceState("primary")).toMatchObject({
        isConnected: false,
        totpRequired: true,
        blockingEnabled: true,
        blockingTimer: null,
      });
      expect(browser.runtime.sendMessage).not.toHaveBeenCalled();
    });
  });

  describe("state publication", () => {
    it("tolerates the known no-receiver error after committing state", async () => {
      vi.mocked(browser.runtime.sendMessage).mockRejectedValueOnce(
        new Error(
          "Could not establish connection. Receiving end does not exist.",
        ),
      );

      await expect(
        store.connectionSucceeded("primary"),
      ).resolves.toBeUndefined();
      expect(store.getInstanceState("primary")).toMatchObject({
        isConnected: true,
      });
    });

    it("rejects non-benign broadcast errors after committing state", async () => {
      vi.mocked(browser.runtime.sendMessage).mockRejectedValueOnce(
        new Error("runtime transport unavailable"),
      );

      await expect(store.connectionSucceeded("primary")).rejects.toThrow(
        "runtime transport unavailable",
      );
      expect(store.getInstanceState("primary")).toMatchObject({
        isConnected: true,
      });
    });
  });

  describe("subscribe", () => {
    it("returns an unsubscribe function", async () => {
      const listener = vi.fn();
      const unsubscribe = store.subscribe(listener);

      unsubscribe();
      await store.selectInstance("primary");
      await store.connectionSucceeded("primary");

      expect(listener).not.toHaveBeenCalled();
    });

    it("isolates listener errors", async () => {
      const errorListener = vi.fn().mockImplementation(() => {
        throw new Error("Listener error");
      });
      const consoleErrorSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});
      store.subscribe(errorListener);
      await store.selectInstance("primary");
      await store.connectionSucceeded("primary");

      expect(consoleErrorSpy).toHaveBeenCalled();
      consoleErrorSpy.mockRestore();
    });
  });

  describe("tab domain tracking", () => {
    describe("initTabDomains", () => {
      it("should initialize domain tracking for a tab", () => {
        store.initTabDomains(1, "https://example.com", "example.com");

        const tabDomains = store.getTabDomains(1);
        expect(tabDomains).toMatchObject({
          tabId: 1,
          pageUrl: "https://example.com",
          firstPartyDomain: "example.com",
        });
        expect(tabDomains?.domains.has("example.com")).toBe(true);
      });
    });

    describe("addTabDomain", () => {
      it("should add domain to existing tab", () => {
        store.initTabDomains(1, "https://example.com", "example.com");

        store.addTabDomain(1, "api.example.com");

        const tabDomains = store.getTabDomains(1);
        expect(tabDomains?.domains.has("api.example.com")).toBe(true);
      });

      it("should identify third-party domains", () => {
        store.initTabDomains(1, "https://example.com", "example.com");

        store.addTabDomain(1, "tracker.com");

        const tabDomains = store.getTabDomains(1);
        expect(tabDomains?.thirdPartyDomains.has("tracker.com")).toBe(true);
      });

      it("should not mark same-site subdomains as third-party", () => {
        store.initTabDomains(1, "https://example.com", "example.com");

        store.addTabDomain(1, "api.example.com");
        store.addTabDomain(1, "cdn.example.com");

        const tabDomains = store.getTabDomains(1);
        expect(tabDomains?.thirdPartyDomains.size).toBe(0);
      });

      it("should broadcast update for new domains", () => {
        store.initTabDomains(1, "https://example.com", "example.com");
        vi.clearAllMocks();

        store.addTabDomain(1, "tracker.com");

        expect(browser.runtime.sendMessage).toHaveBeenCalledWith({
          type: "TAB_DOMAINS_UPDATED",
          payload: expect.objectContaining({
            tabId: 1,
            domains: expect.arrayContaining(["tracker.com"]),
          }),
        });
      });

      it("should not broadcast update for duplicate domains", () => {
        store.initTabDomains(1, "https://example.com", "example.com");
        store.addTabDomain(1, "tracker.com");
        vi.clearAllMocks();

        store.addTabDomain(1, "tracker.com");

        expect(browser.runtime.sendMessage).not.toHaveBeenCalled();
      });

      it("should do nothing if tab not initialized", () => {
        store.addTabDomain(999, "example.com");

        const tabDomains = store.getTabDomains(999);
        expect(tabDomains).toBeNull();
      });
    });

    describe("clearTabDomains", () => {
      it("should clear domain tracking for a tab", () => {
        store.initTabDomains(1, "https://example.com", "example.com");

        store.clearTabDomains(1);

        const tabDomains = store.getTabDomains(1);
        expect(tabDomains).toBeNull();
      });
    });

    describe("getAllTrackedTabs", () => {
      it("should return all tracked tab IDs", () => {
        store.initTabDomains(1, "https://example.com", "example.com");
        store.initTabDomains(2, "https://test.com", "test.com");
        store.initTabDomains(3, "https://other.com", "other.com");

        const tabs = store.getAllTrackedTabs();

        expect(tabs).toEqual(expect.arrayContaining([1, 2, 3]));
        expect(tabs.length).toBe(3);
      });

      it("should return empty array if no tabs tracked", () => {
        const tabs = store.getAllTrackedTabs();

        expect(tabs).toEqual([]);
      });
    });

    describe("getSerializableTabDomains", () => {
      it("should convert Sets to Arrays", () => {
        store.initTabDomains(1, "https://example.com", "example.com");
        store.addTabDomain(1, "tracker.com");

        const serializable = store.getSerializableTabDomains(1);

        expect(Array.isArray(serializable?.domains)).toBe(true);
        expect(Array.isArray(serializable?.thirdPartyDomains)).toBe(true);
        expect(serializable?.domains).toContain("example.com");
        expect(serializable?.thirdPartyDomains).toContain("tracker.com");
      });

      it("should return null for non-existent tab", () => {
        const serializable = store.getSerializableTabDomains(999);

        expect(serializable).toBeNull();
      });
    });
  });
});
