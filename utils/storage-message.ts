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
  // Generate a unique requestId to match responses in parallel scenarios
  const requestId = `${Date.now()}_${Math.random().toString(36).slice(2)}`;

  // Clear previous response to avoid stale data
  try {
    await browser.storage.local.remove(responseKey);
  } catch (error) {
    logger.error(`[StorageMessage] Failed to clear ${responseKey}:`, error);
    return {
      success: false,
      error: ERROR_MESSAGES.STORAGE_ERROR,
    };
  }

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      cleanup();
      logger.debug(
        `[StorageMessage] Timeout waiting for ${responseKey} (requestId=${requestId})`,
      );
      resolve({
        success: false,
        error: ERROR_MESSAGES.TIMEOUT,
      });
    }, timeoutMs);

    const listener = (changes: any, areaName: string) => {
      if (areaName === "local" && changes[responseKey]) {
        const response = changes[responseKey].newValue;
        // Only accept responses matching our requestId
        if (response?._requestId !== requestId) return;
        cleanup();
        logger.debug(
          `[StorageMessage] Received ${responseKey} (requestId=${requestId}):`,
          response,
        );
        resolve(response);
      }
    };

    const cleanup = () => {
      clearTimeout(timeout);
      browser.storage.onChanged.removeListener(listener);
    };

    browser.storage.onChanged.addListener(listener);

    // Send request with requestId for response matching
    browser.storage.local
      .set({
        [requestKey]: {
          ...payload,
          _requestId: requestId,
          timestamp: Date.now(),
        },
      })
      .then(() => {
        logger.debug(
          `[StorageMessage] Sent ${requestKey} (requestId=${requestId}):`,
          payload,
        );
      })
      .catch((error) => {
        cleanup();
        logger.error(`[StorageMessage] Failed to send ${requestKey}:`, error);
        resolve({
          success: false,
          error: ERROR_MESSAGES.STORAGE_ERROR,
        });
      });
  });
}
