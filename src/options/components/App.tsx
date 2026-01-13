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
    // Check background script health and load state
    checkBackgroundHealth();
  }, []);

  const checkBackgroundHealth = async () => {
    const maxRetries = 5;
    const baseDelay = 100; // Start with 100ms

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        console.log(`[Options] Checking background script health (attempt ${attempt + 1}/${maxRetries})`);
        const healthCheck = (await browser.runtime.sendMessage({ type: 'HEALTH_CHECK' })) as MessageResponse<{
          ready: boolean;
          timestamp: number;
          version: string;
        }>;

        if (healthCheck && healthCheck.success) {
          console.log('[Options] Background script is ready, loading state');
          await loadState();
          return;
        }

        console.warn('[Options] Health check returned unsuccessful response, retrying...');
      } catch (error) {
        console.warn(`[Options] Health check attempt ${attempt + 1} failed:`, error);
      }

      // Wait before retrying (exponential backoff)
      if (attempt < maxRetries - 1) {
        const delay = baseDelay * Math.pow(2, attempt);
        console.log(`[Options] Waiting ${delay}ms before retry...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    // All retries failed
    console.error('[Options] All health check attempts failed');
    setMessage({
      type: 'error',
      text: 'Background script not ready. Please reload the extension.',
    });
  };

  const loadState = async () => {
    try {
      const response = (await browser.runtime.sendMessage({
        type: 'GET_STATE',
      })) as MessageResponse<ExtensionState>;

      if (response?.success && response.data) {
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
    console.log('[Options] handleSaveAndConnect called', { url, rememberPassword });
    setIsLoading(true);
    setMessage(null);
    setSavedUrl(url);

    try {
      // WORKAROUND: Use storage-based communication instead of messages
      console.log('[Options] Setting up storage listener and writing config');

      // Clean up any old response first
      await browser.storage.local.remove('configResponse');

      // Set up listener BEFORE writing config
      const saveResponse = await new Promise<MessageResponse<void>>((resolve) => {
        const timeout = setTimeout(() => {
          console.log('[Options] Timeout waiting for response');
          browser.storage.onChanged.removeListener(listener);
          resolve({ success: false, error: 'Timeout waiting for background response' });
        }, 10000);

        const listener = (changes: any, areaName: string) => {
          console.log('[Options] Storage changed:', changes, areaName);
          if (areaName === 'local' && changes.configResponse) {
            console.log('[Options] Received configResponse:', changes.configResponse.newValue);
            clearTimeout(timeout);
            browser.storage.onChanged.removeListener(listener);
            resolve(changes.configResponse.newValue);
          }
        };

        browser.storage.onChanged.addListener(listener);

        // Now write the config (listener is ready)
        console.log('[Options] Writing config to storage');
        browser.storage.local.set({
          pendingConfig: {
            piholeUrl: url,
            password,
            rememberPassword,
            timestamp: Date.now(),
          },
        }).then(() => {
          console.log('[Options] Config written, waiting for response');
        });
      });

      console.log('[Options] SAVE_CONFIG response:', saveResponse);

      if (!saveResponse.success) {
        throw new Error(saveResponse.error || 'Failed to save configuration');
      }

      // Authenticate using storage-based communication
      console.log('[Options] Starting authentication via storage');
      await browser.storage.local.remove('authResponse');

      const authResponse = await new Promise<MessageResponse<{ totpRequired?: boolean }>>((resolve) => {
        const timeout = setTimeout(() => {
          console.log('[Options] Timeout waiting for auth response');
          browser.storage.onChanged.removeListener(authListener);
          resolve({ success: false, error: 'Timeout waiting for authentication response' });
        }, 10000);

        const authListener = (changes: any, areaName: string) => {
          if (areaName === 'local' && changes.authResponse) {
            console.log('[Options] Received authResponse:', changes.authResponse.newValue);
            clearTimeout(timeout);
            browser.storage.onChanged.removeListener(authListener);
            resolve(changes.authResponse.newValue);
          }
        };

        browser.storage.onChanged.addListener(authListener);

        // Write auth request
        browser.storage.local.set({
          pendingAuth: {
            password,
            timestamp: Date.now(),
          },
        }).then(() => {
          console.log('[Options] Auth request written, waiting for response');
        });
      });

      console.log('[Options] AUTHENTICATE response:', authResponse);

      if (!authResponse) {
        throw new Error('Background script not ready. Please try again.');
      }

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
      // Use storage-based communication for TOTP auth
      console.log('[Options] Starting TOTP authentication via storage');
      await browser.storage.local.remove('authResponse');

      const response = await new Promise<MessageResponse<void>>((resolve) => {
        const timeout = setTimeout(() => {
          console.log('[Options] Timeout waiting for TOTP auth response');
          browser.storage.onChanged.removeListener(totpListener);
          resolve({ success: false, error: 'Timeout waiting for authentication response' });
        }, 10000);

        const totpListener = (changes: any, areaName: string) => {
          if (areaName === 'local' && changes.authResponse) {
            console.log('[Options] Received TOTP authResponse:', changes.authResponse.newValue);
            clearTimeout(timeout);
            browser.storage.onChanged.removeListener(totpListener);
            resolve(changes.authResponse.newValue);
          }
        };

        browser.storage.onChanged.addListener(totpListener);

        // Write TOTP auth request
        browser.storage.local.set({
          pendingAuth: {
            password,
            totp,
            timestamp: Date.now(),
          },
        }).then(() => {
          console.log('[Options] TOTP auth request written, waiting for response');
        });
      });

      if (!response) {
        throw new Error('Background script not ready. Please try again.');
      }

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
      // Use storage-based communication for logout
      console.log('[Options] Logging out via storage');
      await browser.storage.local.remove('logoutResponse');

      const response = await new Promise<MessageResponse<void>>((resolve) => {
        const timeout = setTimeout(() => {
          console.log('[Options] Timeout waiting for logout response');
          browser.storage.onChanged.removeListener(logoutListener);
          resolve({ success: false, error: 'Timeout waiting for logout response' });
        }, 10000);

        const logoutListener = (changes: any, areaName: string) => {
          if (areaName === 'local' && changes.logoutResponse) {
            console.log('[Options] Received logoutResponse:', changes.logoutResponse.newValue);
            clearTimeout(timeout);
            browser.storage.onChanged.removeListener(logoutListener);
            resolve(changes.logoutResponse.newValue);
          }
        };

        browser.storage.onChanged.addListener(logoutListener);

        // Write logout request
        browser.storage.local.set({
          pendingLogout: {
            timestamp: Date.now(),
          },
        }).then(() => {
          console.log('[Options] Logout request written, waiting for response');
        });
      });

      if (response.success) {
        setConnectionState('disconnected');
        setMessage({ type: 'info', text: 'Disconnected from Pi-hole' });
      } else {
        console.error('Logout failed:', response.error);
      }
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
