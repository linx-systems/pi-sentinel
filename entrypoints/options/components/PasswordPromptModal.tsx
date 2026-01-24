import { useEffect, useRef, useState } from "preact/hooks";
import type { PiHoleInstance } from "~/utils/types";

interface PasswordPromptModalProps {
  instance: PiHoleInstance;
  isLoading: boolean;
  error?: string | null;
  onSubmit: (password: string) => void;
  onClose: () => void;
}

export function PasswordPromptModal({
  instance,
  isLoading,
  error,
  onSubmit,
  onClose,
}: PasswordPromptModalProps) {
  const [password, setPassword] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const handleSubmit = async (e: Event) => {
    e.preventDefault();
    if (isLoading) return;
    onSubmit(password);
  };

  const displayName = instance.name || extractHostname(instance.piholeUrl);

  return (
    <div class="modal-overlay" onClick={onClose}>
      <div class="modal password-modal" onClick={(e) => e.stopPropagation()}>
        <div class="modal-header">
          <h2>Connect to {displayName}</h2>
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

            <p class="modal-description">
              This instance does not store your password. Enter it to connect,
              or leave it blank if there's no password.
            </p>

            <div class="form-group">
              <label for="connect-password">Pi-hole Password (optional)</label>
              <input
                ref={inputRef}
                type="password"
                id="connect-password"
                value={password}
                onInput={(e) =>
                  setPassword((e.target as HTMLInputElement).value)
                }
                placeholder="Leave blank if none"
                autoComplete="current-password"
                disabled={isLoading}
              />
              <p class="hint">Your password is used only for this session.</p>
            </div>
          </div>

          <div class="modal-footer">
            <button
              type="button"
              class="btn btn-secondary"
              onClick={onClose}
              disabled={isLoading}
            >
              Cancel
            </button>
            <button type="submit" class="btn btn-primary" disabled={isLoading}>
              {isLoading ? "Connecting..." : "Connect"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function extractHostname(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.hostname;
  } catch {
    return url;
  }
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
