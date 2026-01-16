import { useEffect, useState } from "preact/hooks";
import browser from "webextension-polyfill";
import { ServerConfig } from "./ServerConfig";
import { TotpInput } from "./TotpInput";
import { CheckIcon, ErrorIcon, InfoIcon } from "~/utils/icons";
import { logger } from "~/utils/logger";
import type { ExtensionState } from "~/utils/types";
import type { MessageResponse } from "~/utils/messaging";
import { sendViaStorage } from "~/utils/storage-message";

type ConnectionState =
  | "disconnected"
  | "connecting"
  | "totp-required"
  | "connected";

export function App() {
  const [connectionState, setConnectionState] =
    useState<ConnectionState>("disconnected");
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState<{
    type: "success" | "error" | "info";
    text: string;
  } | null>(null);
  const [savedUrl, setSavedUrl] = useState("");

  useEffect(() => {
    // Check background script health and load state
    checkBackgroundHealth();
  }, []);

  const checkBackgroundHealth = async () => {
    const maxRetries = 5;
    const baseDelay = 100; // Start with 100ms

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        logger.debug(
          `[Options] Checking background script health (attempt ${attempt + 1}/${maxRetries})`,
        );
        const healthCheck = (await browser.runtime.sendMessage({
          type: "HEALTH_CHECK",
        })) as MessageResponse<{
          ready: boolean;
          timestamp: number;
          version: string;
        }>;

        if (healthCheck && healthCheck.success) {
          logger.debug("[Options] Background script is ready, loading state");
          await loadState();
          return;
        }

        logger.warn(
          "[Options] Health check returned unsuccessful response, retrying...",
        );
      } catch (error) {
        logger.warn(
          `[Options] Health check attempt ${attempt + 1} failed:`,
          error,
        );
      }

      // Wait before retrying (exponential backoff)
      if (attempt < maxRetries - 1) {
        const delay = baseDelay * Math.pow(2, attempt);
        logger.debug(`[Options] Waiting ${delay}ms before retry...`);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    // All retries failed
    logger.error("[Options] All health check attempts failed");
    setMessage({
      type: "error",
      text: "Background script not ready. Please reload the extension.",
    });
  };

  const loadState = async () => {
    try {
      const response = (await browser.runtime.sendMessage({
        type: "GET_STATE",
      })) as MessageResponse<ExtensionState>;

      if (response?.success && response.data) {
        if (response.data.isConnected) {
          setConnectionState("connected");
        } else if (response.data.totpRequired) {
          setConnectionState("totp-required");
        }
      }
    } catch (err) {
      logger.error("Failed to load state:", err);
    }
  };

  const handleSaveAndConnect = async (
    url: string,
    password: string,
    rememberPassword: boolean,
  ) => {
    logger.debug("[Options] handleSaveAndConnect called", {
      url,
      rememberPassword,
    });
    setIsLoading(true);
    setMessage(null);
    setSavedUrl(url);

    try {
      // Use storage-based communication helper
      logger.debug("[Options] Saving config via storage");

      const saveResponse = await sendViaStorage<void>(
        "pendingConfig",
        "configResponse",
        {
          url,
          password,
          rememberPassword,
        },
      );

      logger.debug("[Options] SAVE_CONFIG response:", saveResponse);

      if (!saveResponse.success) {
        throw new Error(saveResponse.error || "Failed to save configuration");
      }

      // Authenticate using storage-based communication
      logger.debug("[Options] Starting authentication via storage");

      const authResponse = await sendViaStorage<{
        totpRequired?: boolean;
      }>("pendingAuth", "authResponse", {
        password,
      });

      logger.debug("[Options] AUTHENTICATE response:", authResponse);

      if (!authResponse) {
        throw new Error("Background script not ready. Please try again.");
      }

      if (authResponse.success) {
        setConnectionState("connected");
        setMessage({
          type: "success",
          text: "Connected to Pi-hole successfully!",
        });
      } else if (authResponse.data?.totpRequired) {
        setConnectionState("totp-required");
        setMessage({ type: "info", text: "Please enter your 2FA code" });
      } else {
        setConnectionState("disconnected");
        setMessage({
          type: "error",
          text: authResponse.error || "Authentication failed",
        });
      }
    } catch (err) {
      setConnectionState("disconnected");
      setMessage({
        type: "error",
        text: err instanceof Error ? err.message : "Connection failed",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleTotpSubmit = async (totp: string, password: string) => {
    setIsLoading(true);
    setMessage(null);

    try {
      // Use storage-based communication for TOTP auth
      logger.debug("[Options] Starting TOTP authentication via storage");

      const response = await sendViaStorage<void>(
        "pendingAuth",
        "authResponse",
        {
          password,
          totp,
        },
      );

      if (!response) {
        throw new Error("Background script not ready. Please try again.");
      }

      if (response.success) {
        setConnectionState("connected");
        setMessage({
          type: "success",
          text: "Connected to Pi-hole successfully!",
        });
      } else {
        setConnectionState("totp-required");
        setMessage({
          type: "error",
          text: response.error || "Invalid 2FA code",
        });
      }
    } catch (err) {
      setConnectionState("totp-required");
      setMessage({
        type: "error",
        text: err instanceof Error ? err.message : "Authentication failed",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleDisconnect = async () => {
    try {
      // Use storage-based communication for logout
      logger.debug("[Options] Logging out via storage");

      const response = await sendViaStorage<void>(
        "pendingLogout",
        "logoutResponse",
        {},
      );

      if (response.success) {
        setConnectionState("disconnected");
        setMessage({ type: "info", text: "Disconnected from Pi-hole" });
      } else {
        logger.error("Logout failed:", response.error);
      }
    } catch (err) {
      logger.error("Logout failed:", err);
    }
  };

  return (
    <div>
      <header class="header">
        <h1>
          <img src="../icons/icon-48.svg" alt="" class="logo" />
          PiSentinel Settings
        </h1>
        <p class="subtitle">Configure your Pi-hole connection</p>
      </header>

      {message && (
        <div class={`status-message ${message.type}`}>
          {message.type === "success" && <CheckIcon />}
          {message.type === "error" && <ErrorIcon />}
          {message.type === "info" && <InfoIcon />}
          {message.text}
        </div>
      )}

      {connectionState === "connected" ? (
        <div class="card">
          <h2>
            <CheckIcon />
            Connected to Pi-hole
          </h2>
          <p style={{ color: "#888", marginBottom: "16px" }}>
            Your extension is connected to {savedUrl || "Pi-hole"}.
          </p>
          <button class="btn btn-danger" onClick={handleDisconnect}>
            Disconnect
          </button>
        </div>
      ) : connectionState === "totp-required" ? (
        <TotpInput onSubmit={handleTotpSubmit} isLoading={isLoading} />
      ) : (
        <ServerConfig onSave={handleSaveAndConnect} isLoading={isLoading} />
      )}

      <footer class="footer">
        <p>
          PiSentinel v0.0.1 |{" "}
          <a
            href="https://github.com/pisentinel"
            target="_blank"
            rel="noopener"
          >
            GitHub
          </a>
        </p>
      </footer>
    </div>
  );
}
