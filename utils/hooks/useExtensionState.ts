import { useCallback, useEffect, useState } from "preact/hooks";
import browser from "webextension-polyfill";
import { logger } from "~/utils/logger";
import type { ExtensionState } from "~/utils/types";
import type { MessageResponse } from "~/utils/messaging";

/**
 * Shared hook for managing extension state across UI components.
 *
 * Fetches the current extension state from the background script on mount
 * and subscribes to state updates via runtime messages.
 *
 * @returns Object containing state, loading status, error, and refetch function
 */
export interface UseExtensionStateReturn {
  state: ExtensionState | null;
  isLoading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

export function useExtensionState(): UseExtensionStateReturn {
  const [state, setState] = useState<ExtensionState | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchState = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = (await browser.runtime.sendMessage({
        type: "GET_STATE",
      })) as MessageResponse<ExtensionState> | undefined;

      if (response?.success && response.data) {
        setState(response.data);
      } else {
        setError(response?.error || "Failed to fetch extension state");
      }
    } catch (err) {
      logger.error("Failed to fetch extension state:", err);
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchState();

    // Listen for state updates from background
    const handleMessage = (message: any) => {
      if (message.type === "STATE_UPDATED" && message.payload) {
        setState(message.payload);
      }
    };

    browser.runtime.onMessage.addListener(handleMessage);
    return () => browser.runtime.onMessage.removeListener(handleMessage);
  }, [fetchState]);

  return { state, isLoading, error, refetch: fetchState };
}
