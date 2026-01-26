import { useEffect, useRef, useState } from "preact/hooks";

interface TotpInputProps {
  onSubmit: (totp: string, password: string) => Promise<void>;
  onCancel?: () => void;
  isLoading: boolean;
  showPassword?: boolean;
}

export function TotpInput({
  onSubmit,
  onCancel,
  isLoading,
  showPassword = true,
}: TotpInputProps) {
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSubmit = async (e: Event) => {
    e.preventDefault();
    if (code.length !== 6 || (showPassword && !password)) return;
    await onSubmit(code, password);
  };

  const handleCodeChange = (e: Event) => {
    const value = (e.target as HTMLInputElement).value
      .replace(/\D/g, "")
      .slice(0, 6);
    setCode(value);
  };

  return (
    <div class="card">
      <h2>
        <LockIcon />
        Two-Factor Authentication
      </h2>

      <div class="totp-explanation">
        <p style={{ color: "#888", marginBottom: "8px" }}>
          Your Pi-hole has Two-Factor Authentication enabled.
        </p>
        <p style={{ color: "#aaa", fontSize: "13px", marginBottom: "8px" }}>
          Open your authenticator app (like Google Authenticator, Authy, or
          1Password) and enter the 6-digit code shown for your Pi-hole.
        </p>
        <p style={{ color: "#666", fontSize: "12px", marginBottom: "16px" }}>
          This code changes every 30 seconds.
        </p>
      </div>

      <form onSubmit={handleSubmit}>
        <div class="totp-section">
          <div class="label">6-digit code</div>
          <div class="totp-input">
            <input
              ref={inputRef}
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={6}
              value={code}
              onInput={handleCodeChange}
              placeholder="000000"
              disabled={isLoading}
              autoComplete="one-time-code"
            />
          </div>
        </div>

        {showPassword && (
          <div class="form-group" style={{ marginTop: "16px" }}>
            <label for="totp-password">Password (for re-authentication)</label>
            <input
              type="password"
              id="totp-password"
              value={password}
              onInput={(e) => setPassword((e.target as HTMLInputElement).value)}
              placeholder="Your Pi-hole password"
              disabled={isLoading}
            />
          </div>
        )}

        <div class="btn-group">
          {onCancel && (
            <button
              type="button"
              class="btn btn-secondary"
              onClick={onCancel}
              disabled={isLoading}
            >
              Cancel
            </button>
          )}
          <button
            type="submit"
            class="btn btn-primary"
            disabled={
              code.length !== 6 || (showPassword && !password) || isLoading
            }
          >
            {isLoading ? "Verifying..." : "Verify"}
          </button>
        </div>
      </form>
    </div>
  );
}

function LockIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
    >
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}
