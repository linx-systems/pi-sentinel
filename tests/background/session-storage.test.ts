import { beforeEach, describe, expect, it, vi } from "vitest";
import browser from "webextension-polyfill";
import { encryption } from "~/background/crypto/encryption";
import { getInstanceSession } from "~/background/session-storage";
import { STORAGE_KEYS } from "~/utils/constants";

describe("instance session storage", () => {
  const instanceId = "legacy-c9b6fc1c";
  const sessionKey = `${STORAGE_KEYS.INSTANCE_SESSION_PREFIX}${instanceId}`;

  beforeEach(() => {
    vi.restoreAllMocks();
    browser.storage.session.get = vi.fn();
  });

  it("decodes a raw session migrated from legacy storage", async () => {
    browser.storage.session.get = vi.fn().mockResolvedValue({
      [sessionKey]: {
        sid: "legacy-sid",
        csrf: "legacy-csrf",
        expiresAt: Date.now() + 60_000,
      },
    });

    await expect(
      getInstanceSession(instanceId, "runtime-key"),
    ).resolves.toEqual({
      sid: "legacy-sid",
      csrf: "legacy-csrf",
      expiresAt: expect.any(Number),
    });
  });

  it("decodes an encrypted session copied from a prior random instance ID", async () => {
    const expiresAt = Date.now() + 60_000;
    browser.storage.session.get = vi.fn().mockResolvedValue({
      [sessionKey]: {
        encrypted: { ciphertext: "ciphertext", salt: "salt", iv: "iv" },
        expiresAt,
      },
    });
    vi.spyOn(encryption, "decrypt").mockResolvedValue(
      JSON.stringify({ sid: "current-sid", csrf: "current-csrf", expiresAt }),
    );

    await expect(
      getInstanceSession(instanceId, "runtime-key"),
    ).resolves.toEqual({
      sid: "current-sid",
      csrf: "current-csrf",
      expiresAt,
    });
  });

  it("rejects an encrypted legacy session that cannot be decrypted with the runtime key", async () => {
    browser.storage.session.get = vi.fn().mockResolvedValue({
      [sessionKey]: {
        encrypted: { ciphertext: "legacy", salt: "salt", iv: "iv" },
        expiresAt: Date.now() + 60_000,
      },
    });
    vi.spyOn(encryption, "decrypt").mockRejectedValue(new Error("wrong key"));

    await expect(
      getInstanceSession(instanceId, "runtime-key"),
    ).resolves.toBeNull();
  });
});
