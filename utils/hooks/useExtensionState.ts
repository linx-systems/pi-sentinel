import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import browser from "webextension-polyfill";
import { logger } from "~/utils/logger";
import type { BroadcastMessage } from "~/utils/messaging";
import type { ExtensionState } from "~/utils/types";
import { createRuntimeExtensionCommands } from "~/utils/extension-commands";
import { isRecord } from "~/utils/commands/response-validation";

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

function isTransientRuntimeError(error: unknown): boolean {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "";
  return (
    message.includes("Could not establish connection") ||
    message.includes("Receiving end does not exist") ||
    message.includes("Extension context invalidated")
  );
}

function isStateUpdatedMessage(
  message: unknown,
): message is Extract<BroadcastMessage, { type: "STATE_UPDATED" }> {
  return (
    isRecord(message) &&
    message.type === "STATE_UPDATED" &&
    isRecord(message.payload)
  );
}

const STATE_FETCH_FAILURE_MESSAGE = "Failed to fetch extension state";

const commands = createRuntimeExtensionCommands();

export function useExtensionState(): UseExtensionStateReturn {
  const [state, setState] = useState<ExtensionState | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const retryTimeoutRef = useRef<number | null>(null);

  const fetchState = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    const scheduleRetry = () => {
      if (retryTimeoutRef.current !== null) return;
      retryTimeoutRef.current = window.setTimeout(() => {
        retryTimeoutRef.current = null;
        void fetchState();
      }, 1000);
    };

    try {
      const response = await commands.getState();

      if (response.success) {
        setState(response.data);
      } else {
        const isTransientFailure = isTransientRuntimeError(response.error);
        if (isTransientFailure) scheduleRetry();
        setError(
          isTransientFailure ? STATE_FETCH_FAILURE_MESSAGE : response.error,
        );
      }
    } catch (error) {
      logger.error("Failed to fetch extension state:", error);
      const isTransientFailure = isTransientRuntimeError(error);
      if (isTransientFailure) scheduleRetry();
      setError(
        isTransientFailure
          ? STATE_FETCH_FAILURE_MESSAGE
          : error instanceof Error
            ? error.message
            : "Unknown error",
      );
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchState();

    // Listen for state updates from background
    const handleMessage = (message: unknown) => {
      if (isStateUpdatedMessage(message)) {
        setState((current) =>
          current === null ? current : { ...current, ...message.payload },
        );
        setError(null);
        setIsLoading(false);
      }
    };

    browser.runtime.onMessage.addListener(handleMessage);
    return () => {
      browser.runtime.onMessage.removeListener(handleMessage);
      if (retryTimeoutRef.current !== null) {
        clearTimeout(retryTimeoutRef.current);
        retryTimeoutRef.current = null;
      }
    };
  }, [fetchState]);

  return { state, isLoading, error, refetch: fetchState };
}
