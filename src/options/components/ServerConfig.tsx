import { useState } from 'preact/hooks';
import browser from 'webextension-polyfill';
import type { MessageResponse } from '../../shared/messaging';

interface ServerConfigProps {
  onSave: (url: string, password: string) => Promise<void>;
  isLoading: boolean;
}

export function ServerConfig({ onSave, isLoading }: ServerConfigProps) {
  const [url, setUrl] = useState('');
  const [password, setPassword] = useState('');
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
  const [testError, setTestError] = useState('');

  const handleTestConnection = async () => {
    if (!url) return;

    setTestStatus('testing');
    setTestError('');

    try {
      // Normalize URL
      let testUrl = url.trim();
      if (!testUrl.startsWith('http://') && !testUrl.startsWith('https://')) {
        testUrl = `http://${testUrl}`;
      }

      const response = (await browser.runtime.sendMessage({
        type: 'TEST_CONNECTION',
        payload: { url: testUrl },
      })) as MessageResponse<void>;

      if (response.success) {
        setTestStatus('success');
        setUrl(testUrl);
      } else {
        setTestStatus('error');
        setTestError(response.error || 'Connection failed');
      }
    } catch (err) {
      setTestStatus('error');
      setTestError(err instanceof Error ? err.message : 'Connection failed');
    }
  };

  const handleSubmit = async (e: Event) => {
    e.preventDefault();
    if (!url || !password) return;

    // Normalize URL
    let saveUrl = url.trim();
    if (!saveUrl.startsWith('http://') && !saveUrl.startsWith('https://')) {
      saveUrl = `http://${saveUrl}`;
    }

    await onSave(saveUrl, password);
  };

  return (
    <div class="card">
      <h2>
        <ServerIcon />
        Pi-hole Server
      </h2>

      <form onSubmit={handleSubmit}>
        <div class="form-group">
          <label for="url">Pi-hole URL</label>
          <input
            type="text"
            id="url"
            value={url}
            onInput={(e) => {
              setUrl((e.target as HTMLInputElement).value);
              setTestStatus('idle');
            }}
            placeholder="http://pi.hole or http://192.168.1.100"
            disabled={isLoading}
          />
          <p class="hint">
            The address of your Pi-hole web interface (without /admin)
          </p>

          {testStatus !== 'idle' && (
            <div class={`connection-status ${testStatus}`}>
              {testStatus === 'testing' && (
                <>
                  <span class="spinner" />
                  Testing connection...
                </>
              )}
              {testStatus === 'success' && (
                <>
                  <CheckIcon />
                  Connection successful
                </>
              )}
              {testStatus === 'error' && (
                <>
                  <ErrorIcon />
                  {testError || 'Connection failed'}
                </>
              )}
            </div>
          )}
        </div>

        <div class="form-group">
          <label for="password">Web Interface Password</label>
          <input
            type="password"
            id="password"
            value={password}
            onInput={(e) => setPassword((e.target as HTMLInputElement).value)}
            placeholder="Your Pi-hole password"
            disabled={isLoading}
          />
          <p class="hint">
            The password you use to log into Pi-hole's web interface
          </p>
        </div>

        <div class="btn-group">
          <button
            type="button"
            class="btn btn-secondary"
            onClick={handleTestConnection}
            disabled={!url || isLoading || testStatus === 'testing'}
          >
            {testStatus === 'testing' ? 'Testing...' : 'Test Connection'}
          </button>
          <button
            type="submit"
            class="btn btn-primary"
            disabled={!url || !password || isLoading}
          >
            {isLoading ? 'Connecting...' : 'Save & Connect'}
          </button>
        </div>
      </form>
    </div>
  );
}

function ServerIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <rect x="2" y="2" width="20" height="8" rx="2" ry="2" />
      <rect x="2" y="14" width="20" height="8" rx="2" ry="2" />
      <line x1="6" y1="6" x2="6.01" y2="6" />
      <line x1="6" y1="18" x2="6.01" y2="18" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function ErrorIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <circle cx="12" cy="12" r="10" />
      <line x1="15" y1="9" x2="9" y2="15" />
      <line x1="9" y1="9" x2="15" y2="15" />
    </svg>
  );
}
