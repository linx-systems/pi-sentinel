import { useState, useEffect } from 'preact/hooks';
import browser from 'webextension-polyfill';
import { ServerConfig } from './ServerConfig';
import { TotpInput } from './TotpInput';
import { CheckIcon, ErrorIcon, InfoIcon } from '../../shared/icons';
import type { ExtensionState } from '../../shared/types';
import type { MessageResponse } from '../../shared/messaging';

type ConnectionState = 'disconnected' | 'connecting' | 'totp-required' | 'connected';

export function App() {
  const [connectionState, setConnectionState] = useState<ConnectionState>('disconnected');
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);
  const [savedUrl, setSavedUrl] = useState('');

  useEffect(() => {
    // Load current state
    loadState();
  }, []);

  const loadState = async () => {
    try {
      const response = (await browser.runtime.sendMessage({
        type: 'GET_STATE',
      })) as MessageResponse<ExtensionState>;

      if (response.success && response.data) {
        if (response.data.isConnected) {
          setConnectionState('connected');
        } else if (response.data.totpRequired) {
          setConnectionState('totp-required');
        }
      }
    } catch (err) {
      console.error('Failed to load state:', err);
    }
  };

  const handleSaveAndConnect = async (url: string, password: string, rememberPassword: boolean) => {
    setIsLoading(true);
    setMessage(null);
    setSavedUrl(url);

    try {
      // Save config
      const saveResponse = (await browser.runtime.sendMessage({
        type: 'SAVE_CONFIG',
        payload: { piholeUrl: url, password, rememberPassword },
      })) as MessageResponse<void>;

      if (!saveResponse.success) {
        throw new Error(saveResponse.error || 'Failed to save configuration');
      }

      // Authenticate
      const authResponse = (await browser.runtime.sendMessage({
        type: 'AUTHENTICATE',
        payload: { password },
      })) as MessageResponse<{ totpRequired?: boolean }>;

      if (authResponse.success) {
        setConnectionState('connected');
        setMessage({ type: 'success', text: 'Connected to Pi-hole successfully!' });
      } else if (authResponse.data?.totpRequired) {
        setConnectionState('totp-required');
        setMessage({ type: 'info', text: 'Please enter your 2FA code' });
      } else {
        setConnectionState('disconnected');
        setMessage({ type: 'error', text: authResponse.error || 'Authentication failed' });
      }
    } catch (err) {
      setConnectionState('disconnected');
      setMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'Connection failed',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleTotpSubmit = async (totp: string, password: string) => {
    setIsLoading(true);
    setMessage(null);

    try {
      const response = (await browser.runtime.sendMessage({
        type: 'AUTHENTICATE',
        payload: { password, totp },
      })) as MessageResponse<void>;

      if (response.success) {
        setConnectionState('connected');
        setMessage({ type: 'success', text: 'Connected to Pi-hole successfully!' });
      } else {
        setConnectionState('totp-required');
        setMessage({ type: 'error', text: response.error || 'Invalid 2FA code' });
      }
    } catch (err) {
      setConnectionState('totp-required');
      setMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'Authentication failed',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleDisconnect = async () => {
    try {
      await browser.runtime.sendMessage({ type: 'LOGOUT' });
      setConnectionState('disconnected');
      setMessage({ type: 'info', text: 'Disconnected from Pi-hole' });
    } catch (err) {
      console.error('Logout failed:', err);
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
          {message.type === 'success' && <CheckIcon />}
          {message.type === 'error' && <ErrorIcon />}
          {message.type === 'info' && <InfoIcon />}
          {message.text}
        </div>
      )}

      {connectionState === 'connected' ? (
        <div class="card">
          <h2>
            <CheckIcon />
            Connected to Pi-hole
          </h2>
          <p style={{ color: '#888', marginBottom: '16px' }}>
            Your extension is connected to {savedUrl || 'Pi-hole'}.
          </p>
          <button class="btn btn-danger" onClick={handleDisconnect}>
            Disconnect
          </button>
        </div>
      ) : connectionState === 'totp-required' ? (
        <TotpInput
          onSubmit={handleTotpSubmit}
          isLoading={isLoading}
        />
      ) : (
        <ServerConfig
          onSave={handleSaveAndConnect}
          isLoading={isLoading}
        />
      )}

      <footer class="footer">
        <p>
          PiSentinel v0.0.1 | <a href="https://github.com/pisentinel" target="_blank" rel="noopener">GitHub</a>
        </p>
      </footer>
    </div>
  );
}
