import browser from "webextension-polyfill";
import { logger } from "./logger";
import { ERROR_MESSAGES } from "./constants";
import type { MessageResponse } from "./messaging";

/**
 * Storage-based message communication helper.
 *
 * Workaround for Firefox options page not receiving runtime.sendMessage responses.
 * Uses storage.local as a communication channel between options page and background script.
 *
 * @param requestKey - Storage key for the request (e.g., "pendingTestConnection")
 * @param responseKey - Storage key for the response (e.g., "testConnectionResponse")
 * @param payload - Data to send to the background script
 * @param timeoutMs - Timeout in milliseconds (default: 10000)
 * @returns Promise that resolves with the response from background script
 */
export async function sendViaStorage<T>(
  requestKey: string,
  responseKey: string,
  payload: any,
  timeoutMs = 10000,
): Promise<MessageResponse<T>> {
  // Clear previous response to avoid stale data
  await browser.storage.local.remove(responseKey);

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      cleanup();
      logger.debug(`[StorageMessage] Timeout waiting for ${responseKey}`);
      resolve({
        success: false,
        error: ERROR_MESSAGES.TIMEOUT,
      });
    }, timeoutMs);

    const listener = (changes: any, areaName: string) => {
      if (areaName === "local" && changes[responseKey]) {
        cleanup();
        logger.debug(
          `[StorageMessage] Received ${responseKey}:`,
          changes[responseKey].newValue,
        );
        resolve(changes[responseKey].newValue);
      }
    };

    const cleanup = () => {
      clearTimeout(timeout);
      browser.storage.onChanged.removeListener(listener);
    };

    browser.storage.onChanged.addListener(listener);

    // Send request
    browser.storage.local
      .set({
        [requestKey]: { ...payload, timestamp: Date.now() },
      })
      .then(() => {
        logger.debug(`[StorageMessage] Sent ${requestKey}:`, payload);
      });
  });
}
