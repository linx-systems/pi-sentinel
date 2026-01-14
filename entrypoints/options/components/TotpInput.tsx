import { useState, useRef, useEffect } from 'preact/hooks';

interface TotpInputProps {
  onSubmit: (totp: string, password: string) => Promise<void>;
  isLoading: boolean;
}

export function TotpInput({ onSubmit, isLoading }: TotpInputProps) {
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSubmit = async (e: Event) => {
    e.preventDefault();
    if (code.length !== 6 || !password) return;
    await onSubmit(code, password);
  };

  const handleCodeChange = (e: Event) => {
    const value = (e.target as HTMLInputElement).value.replace(/\D/g, '').slice(0, 6);
    setCode(value);
  };

  return (
    <div class="card">
      <h2>
        <LockIcon />
        Two-Factor Authentication
      </h2>

      <p style={{ color: '#888', marginBottom: '16px' }}>
        Your Pi-hole has 2FA enabled. Please enter the code from your authenticator app.
      </p>

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

        <div class="form-group" style={{ marginTop: '16px' }}>
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

        <div class="btn-group">
          <button
            type="submit"
            class="btn btn-primary"
            disabled={code.length !== 6 || !password || isLoading}
          >
            {isLoading ? 'Verifying...' : 'Verify'}
          </button>
        </div>
      </form>
    </div>
  );
}

function LockIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}
