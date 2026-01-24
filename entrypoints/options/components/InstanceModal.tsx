import { useState, useEffect } from "preact/hooks";
import type { PiHoleInstance } from "~/utils/types";
import { sendViaStorage } from "~/utils/storage-message";
import { logger } from "~/utils/logger";

interface InstanceModalProps {
  instance: PiHoleInstance | null; // null = add mode, otherwise edit mode
  onClose: () => void;
  onSaved: () => void;
}

export function InstanceModal({
  instance,
  onClose,
  onSaved,
}: InstanceModalProps) {
  const isEditMode = instance !== null;

  const [name, setName] = useState(instance?.name || "");
  const [url, setUrl] = useState(instance?.piholeUrl || "");
  const [password, setPassword] = useState("");
  const [noPassword, setNoPassword] = useState(instance?.passwordless ?? false);
  const [rememberPassword, setRememberPassword] = useState(
    instance?.rememberPassword ?? false,
  );
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testStatus, setTestStatus] = useState<
    "idle" | "testing" | "success" | "error"
  >("idle");

  useEffect(() => {
    if (noPassword && rememberPassword) {
      setRememberPassword(false);
    }
  }, [noPassword, rememberPassword]);

  // Close modal on escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const handleTestConnection = async () => {
    if (!url) return;

    setTestStatus("testing");
    setError(null);

    try {
      let testUrl = url.trim();
      if (!testUrl.startsWith("http://") && !testUrl.startsWith("https://")) {
        testUrl = `http://${testUrl}`;
      }

      const response = await sendViaStorage<void>(
        "pendingTestConnection",
        "testConnectionResponse",
        { url: testUrl },
      );

      if (response.success) {
        setTestStatus("success");
        setUrl(testUrl);
      } else {
        setTestStatus("error");
        setError(response.error || "Connection failed");
      }
    } catch (err) {
      setTestStatus("error");
      setError(err instanceof Error ? err.message : "Connection failed");
    }
  };

  const handleSubmit = async (e: Event) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    try {
      // Normalize URL
      let saveUrl = url.trim();
      if (!saveUrl.startsWith("http://") && !saveUrl.startsWith("https://")) {
        saveUrl = `http://${saveUrl}`;
      }

      if (isEditMode) {
        // Update existing instance
        const passwordToSend = noPassword
          ? ""
          : password.length > 0
            ? password
            : undefined;
        const response = await sendViaStorage<unknown>(
          "pendingUpdateInstance",
          "updateInstanceResponse",
          {
            instanceId: instance.id,
            name: name || null,
            piholeUrl: saveUrl,
            password: passwordToSend, // Only send if provided or cleared
            rememberPassword,
          },
        );

        if (!response.success) {
          throw new Error(response.error || "Failed to update instance");
        }
      } else {
        // Add new instance
        const passwordToSend = noPassword ? "" : password;
        const response = await sendViaStorage<unknown>(
          "pendingAddInstance",
          "addInstanceResponse",
          {
            name: name || null,
            piholeUrl: saveUrl,
            password: passwordToSend,
            rememberPassword,
          },
        );

        if (!response.success) {
          throw new Error(response.error || "Failed to add instance");
        }
      }

      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Operation failed");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div class="modal-overlay" onClick={onClose}>
      <div class="modal" onClick={(e) => e.stopPropagation()}>
        <div class="modal-header">
          <h2>{isEditMode ? "Edit Pi-hole" : "Add Pi-hole"}</h2>
          <button class="modal-close" onClick={onClose} title="Close">
            <CloseIcon />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div class="modal-body">
            {error && (
              <div class="error-message">
                <ErrorIcon />
                {error}
              </div>
            )}

            <div class="form-group">
              <label for="instance-name">Name (optional)</label>
              <input
                type="text"
                id="instance-name"
                value={name}
                onInput={(e) => setName((e.target as HTMLInputElement).value)}
                placeholder="My Pi-hole"
                disabled={isLoading}
              />
              <p class="hint">
                A friendly name to identify this Pi-hole (defaults to hostname)
              </p>
            </div>

            <div class="form-group">
              <label for="instance-url">Pi-hole URL</label>
              <input
                type="text"
                id="instance-url"
                value={url}
                onInput={(e) => {
                  setUrl((e.target as HTMLInputElement).value);
                  setTestStatus("idle");
                }}
                placeholder="http://pi.hole or http://192.168.1.100"
                disabled={isLoading}
                required
              />
              <p class="hint">
                The address of your Pi-hole web interface (without /admin)
              </p>

              {testStatus !== "idle" && (
                <div class={`connection-status ${testStatus}`}>
                  {testStatus === "testing" && (
                    <>
                      <span class="spinner" />
                      Testing connection...
                    </>
                  )}
                  {testStatus === "success" && (
                    <>
                      <CheckIcon />
                      Connection successful
                    </>
                  )}
                  {testStatus === "error" && (
                    <>
                      <ErrorIcon />
                      {error || "Connection failed"}
                    </>
                  )}
                </div>
              )}
            </div>

            <div class="form-group">
              <label class="checkbox-label">
                <input
                  type="checkbox"
                  id="instance-no-password"
                  checked={noPassword}
                  onChange={(e) => {
                    const checked = (e.target as HTMLInputElement).checked;
                    setNoPassword(checked);
                    if (checked) {
                      setPassword("");
                      setRememberPassword(false);
                    }
                  }}
                  disabled={isLoading}
                />
                <span class="checkbox-text">No password required</span>
              </label>
              <p class="hint">
                {isEditMode
                  ? "Use this to clear the stored password for this instance."
                  : "Enable this if your Pi-hole does not require a password."}
              </p>
            </div>

            {!noPassword && (
              <>
                <div class="form-group">
                  <label for="instance-password">
                    Web Interface Password
                    {isEditMode && " (leave blank to keep current)"}
                  </label>
                  <input
                    type="password"
                    id="instance-password"
                    value={password}
                    onInput={(e) =>
                      setPassword((e.target as HTMLInputElement).value)
                    }
                    placeholder={
                      isEditMode ? "Enter new password" : "Leave blank if none"
                    }
                    disabled={isLoading}
                  />
                  <p class="hint">
                    {isEditMode
                      ? "Leave blank to keep the current password. If this Pi-hole has no password, leaving it blank is fine."
                      : "Leave blank if this Pi-hole doesn't require a password."}
                  </p>
                </div>

                <div class="form-group">
                  <label class="checkbox-label">
                    <input
                      type="checkbox"
                      id="instance-remember"
                      checked={rememberPassword}
                      onChange={(e) =>
                        setRememberPassword(
                          (e.target as HTMLInputElement).checked,
                        )
                      }
                      disabled={isLoading}
                    />
                    <span class="checkbox-text">Remember Password</span>
                  </label>
                  <p class="hint">
                    Stay logged in across browser restarts. Password is
                    encrypted but stored locally. Disable on shared computers.
                    <br />
                    <strong>Note:</strong> Does not work with TOTP 2FA. Use an
                    app password instead.
                  </p>
                </div>
              </>
            )}
          </div>

          <div class="modal-footer">
            <button
              type="button"
              class="btn btn-secondary"
              onClick={handleTestConnection}
              disabled={!url || isLoading || testStatus === "testing"}
            >
              {testStatus === "testing" ? "Testing..." : "Test Connection"}
            </button>
            <div class="modal-footer-right">
              <button
                type="button"
                class="btn btn-secondary"
                onClick={onClose}
                disabled={isLoading}
              >
                Cancel
              </button>
              <button
                type="submit"
                class="btn btn-primary"
                disabled={!url || isLoading}
              >
                {isLoading
                  ? "Saving..."
                  : isEditMode
                    ? "Save Changes"
                    : "Add Pi-hole"}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

function CloseIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
    >
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function ErrorIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
    >
      <circle cx="12" cy="12" r="10" />
      <line x1="15" y1="9" x2="9" y2="15" />
      <line x1="9" y1="9" x2="15" y2="15" />
    </svg>
  );
}
