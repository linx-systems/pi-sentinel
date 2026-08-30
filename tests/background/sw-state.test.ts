import { beforeEach, describe, expect, it, vi } from "vitest";
import browser from "webextension-polyfill";
import { loadSwState, saveSwState } from "~/background/sw-state";

describe("service worker state storage", () => {
  beforeEach(() => {
    browser.storage.session.get = vi.fn();
    browser.storage.session.set = vi.fn();
  });

  it("returns null only when no state was stored", async () => {
    browser.storage.session.get = vi.fn().mockResolvedValue({});

    await expect(loadSwState()).resolves.toBeNull();
  });

  it("rejects storage read failures instead of treating them as fresh state", async () => {
    browser.storage.session.get = vi
      .fn()
      .mockRejectedValue(new Error("read failed"));

    await expect(loadSwState()).rejects.toThrow("read failed");
  });

  it("rejects storage write failures", async () => {
    browser.storage.session.set = vi
      .fn()
      .mockRejectedValue(new Error("write failed"));

    await expect(
      saveSwState({
        instanceSessionEncryptionKey: "key",
        instanceAuthFailures: {},
      }),
    ).rejects.toThrow("write failed");
  });
});
