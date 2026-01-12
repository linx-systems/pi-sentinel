import { useState, useEffect, useCallback } from 'preact/hooks';
import browser from 'webextension-polyfill';
import { StatsCard } from './StatsCard';
import { BlockingToggle } from './BlockingToggle';
import { SettingsIcon, DomainIcon, ExternalLinkIcon } from '../../shared/icons';
import { formatNumber } from '../../shared/utils';
import type { ExtensionState, PersistedConfig } from '../../shared/types';
import type { MessageResponse } from '../../shared/messaging';

type ViewState = 'loading' | 'not-configured' | 'connected' | 'error';

export function App() {
  const [state, setState] = useState<ExtensionState | null>(null);
  const [viewState, setViewState] = useState<ViewState>('loading');
  const [error, setError] = useState<string | null>(null);
  const [piholeUrl, setPiholeUrl] = useState<string | null>(null);

  const fetchState = useCallback(async () => {
    try {
      // Fetch Pi-hole URL from storage
      const storage = await browser.storage.local.get('pisentinel_config');
      const config = storage.pisentinel_config as PersistedConfig | undefined;
      if (config?.piholeUrl) {
        setPiholeUrl(config.piholeUrl);
      }

      const response = (await browser.runtime.sendMessage({
        type: 'GET_STATE',
      })) as MessageResponse<ExtensionState> | undefined;

      if (response?.success && response.data) {
        setState(response.data);

        if (response.data.isConnected) {
          setViewState('connected');
          // Fetch fresh stats
          await browser.runtime.sendMessage({ type: 'GET_STATS' });
          await browser.runtime.sendMessage({ type: 'GET_BLOCKING_STATUS' });
        } else if (response.data.connectionError) {
          setViewState('error');
          setError(response.data.connectionError);
        } else {
          setViewState('not-configured');
        }
      }
    } catch (err) {
      console.error('Failed to fetch state:', err);
      setViewState('error');
      setError('Failed to connect to extension');
    }
  }, []);

  useEffect(() => {
    fetchState();

    // Listen for state updates from background
    const handleMessage = (message: unknown) => {
      const msg = message as { type: string; payload?: ExtensionState };
      if (msg.type === 'STATE_UPDATED' && msg.payload) {
        setState(msg.payload);
      }
    };

    browser.runtime.onMessage.addListener(handleMessage);
    return () => browser.runtime.onMessage.removeListener(handleMessage);
  }, [fetchState]);

  const openOptions = () => {
    browser.runtime.openOptionsPage();
  };

  const openSidebar = async () => {
    try {
      await browser.sidebarAction.open();
    } catch {
      // Fallback: open sidebar panel in new tab
      browser.tabs.create({ url: browser.runtime.getURL('sidebar/sidebar.html') });
    }
  };

  const openAdminPage = () => {
    if (piholeUrl) {
      browser.tabs.create({ url: `${piholeUrl}/admin` });
    }
  };

  if (viewState === 'loading') {
    return (
      <div class="loading">
        <div class="spinner" />
        <span>Loading...</span>
      </div>
    );
  }

  if (viewState === 'not-configured') {
    return (
      <div class="not-configured">
        <h2>Welcome to PiSentinel</h2>
        <p>Configure your Pi-hole server to get started.</p>
        <button class="config-btn" onClick={openOptions}>
          Configure Pi-hole
        </button>
      </div>
    );
  }

  if (viewState === 'error') {
    return (
      <div class="error-state">
        <div class="message">{error || 'Connection error'}</div>
        <button class="retry-btn" onClick={fetchState}>
          Retry
        </button>
        <button class="config-btn" onClick={openOptions} style={{ marginLeft: '8px' }}>
          Settings
        </button>
      </div>
    );
  }

  return (
    <div>
      <header class="header">
        <h1>
          <img src="../icons/icon-32.svg" alt="" class="logo" />
          PiSentinel
        </h1>
        <button class="settings-btn" onClick={openOptions} title="Settings">
          <SettingsIcon />
        </button>
      </header>

      <div class={`status-indicator ${state?.isConnected ? 'connected' : 'disconnected'}`}>
        <span class={`status-dot ${state?.isConnected ? '' : 'pulse'}`} />
        <span>{state?.isConnected ? 'Connected to Pi-hole' : 'Disconnected'}</span>
      </div>

      {state?.stats && (
        <div class="stats-grid">
          <StatsCard
            label="Total Queries"
            value={formatNumber(state.stats.queries.total)}
          />
          <StatsCard
            label="Blocked"
            value={formatNumber(state.stats.queries.blocked)}
            className="blocked"
          />
          <StatsCard
            label="Block Rate"
            value={`${state.stats.queries.percent_blocked.toFixed(1)}%`}
            className="percentage"
          />
          <StatsCard
            label="Active Clients"
            value={state.stats.clients.active.toString()}
          />
        </div>
      )}

      <BlockingToggle
        enabled={state?.blockingEnabled ?? true}
        timer={state?.blockingTimer ?? null}
      />

      <footer class="footer">
        <a href="#" class="footer-link" onClick={(e) => { e.preventDefault(); openSidebar(); }}>
          <DomainIcon />
          View domains
        </a>
        {piholeUrl && (
          <a href="#" class="footer-link" onClick={(e) => { e.preventDefault(); openAdminPage(); }}>
            <ExternalLinkIcon />
            Pi-hole Admin
          </a>
        )}
      </footer>
    </div>
  );
}
