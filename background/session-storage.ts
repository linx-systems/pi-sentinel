import browser from "webextension-polyfill";
import { encryption } from "~/background/crypto/encryption";
import { STORAGE_KEYS } from "~/utils/constants";
import { logger } from "~/utils/logger";
import type { EncryptedSessionData, SessionData } from "~/utils/types";

export function isSessionData(value: unknown): value is SessionData {
  if (!value || typeof value !== "object") {
    return false;
  }
  const session = value as Record<string, unknown>;
  return (
    typeof session.sid === "string" &&
    typeof session.csrf === "string" &&
    Number.isFinite(session.expiresAt)
  );
}

export async function storeInstanceSession(
  instanceId: string,
  sid: string,
  csrf: string,
  validity: number,
  encryptionKey: string | null,
): Promise<void> {
  const expiresAt = Date.now() + validity * 1000;
  const session: SessionData = { sid, csrf, expiresAt };
  const sessionKey = `${STORAGE_KEYS.INSTANCE_SESSION_PREFIX}${instanceId}`;

  if (encryptionKey) {
    try {
      const encryptedSession = await encryption.encrypt(
        JSON.stringify(session),
        encryptionKey,
      );
      const storedData: EncryptedSessionData = {
        encrypted: encryptedSession,
        expiresAt,
      };
      await browser.storage.session.set({ [sessionKey]: storedData });
      return;
    } catch (error) {
      logger.warn(
        "[PiSentinel] Failed to encrypt instance session, storing unencrypted:",
        error,
      );
    }
  }

  await browser.storage.session.set({ [sessionKey]: session });
}

export async function getInstanceSession(
  instanceId: string,
  encryptionKey: string | null,
): Promise<SessionData | null> {
  const sessionKey = `${STORAGE_KEYS.INSTANCE_SESSION_PREFIX}${instanceId}`;
  const result = await browser.storage.session.get(sessionKey);
  const storedData = result[sessionKey];

  if (!storedData) {
    return null;
  }

  if (
    encryptionKey &&
    typeof storedData === "object" &&
    "encrypted" in storedData &&
    "expiresAt" in storedData
  ) {
    const encryptedSession = storedData as EncryptedSessionData;
    if (encryptedSession.expiresAt < Date.now()) {
      return null;
    }

    try {
      const decrypted = await encryption.decrypt(
        encryptedSession.encrypted,
        encryptionKey,
      );
      const session = JSON.parse(decrypted) as unknown;
      return isSessionData(session) ? session : null;
    } catch (error) {
      logger.debug("[PiSentinel] Failed to decrypt instance session:", error);
      return null;
    }
  }

  return isSessionData(storedData) ? storedData : null;
}
