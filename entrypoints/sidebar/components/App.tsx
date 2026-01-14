import { useState, useEffect, useCallback, useRef } from 'preact/hooks';
import browser from 'webextension-polyfill';
import { DomainList } from './DomainList';
import { QueryLog } from './QueryLog';
import type { ExtensionState } from '~/utils/types';
import type { MessageResponse, SerializableTabDomains } from '~/utils/messaging';

type Tab = 'domains' | 'queries';
type TabDomains = SerializableTabDomains;

export function App() {
  const [activeTab, setActiveTab] = useState<Tab>('domains');
  const [isConnected, setIsConnected] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [tabDomains, setTabDomains] = useState<TabDomains | null>(null);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const initialLoadComplete = useRef(false);

  const loadState = useCallback(async () => {
    if (!initialLoadComplete.current) {
      setIsLoading(true);
    }
    try {
      // Get connection state
      const stateResponse = (await browser.runtime.sendMessage({
        type: 'GET_STATE',
      })) as MessageResponse<ExtensionState> | undefined;

      if (stateResponse?.success && stateResponse.data) {
        setIsConnected(stateResponse.data.isConnected);
      }

      // Get current tab
      const [currentTab] = await browser.tabs.query({ active: true, currentWindow: true });
      if (currentTab?.id) {
        const domainsResponse = (await browser.runtime.sendMessage({
          type: 'GET_TAB_DOMAINS',
          payload: { tabId: currentTab.id },
        })) as MessageResponse<TabDomains> | undefined;

        if (domainsResponse?.success && domainsResponse.data) {
          setTabDomains(domainsResponse.data);
        }
      }
    } catch (err) {
      console.error('Failed to load state:', err);
    } finally {
      setIsLoading(false);
      initialLoadComplete.current = true;
    }
  }, []);

  useEffect(() => {
    loadState();

    // Listen for tab changes
    const handleTabActivated = () => loadState();
    browser.tabs.onActivated.addListener(handleTabActivated);

    // Listen for state and domain updates
    const handleMessage = async (message: unknown) => {
      const msg = message as { type: string; payload?: TabDomains };
      if (msg.type === 'STATE_UPDATED') {
        loadState();
      } else if (msg.type === 'TAB_DOMAINS_UPDATED' && msg.payload) {
        // Real-time domain update - check if it's for the current tab
        const [currentTab] = await browser.tabs.query({ active: true, currentWindow: true });
        if (currentTab?.id === msg.payload.tabId) {
          setTabDomains(msg.payload);
        }
      }
    };
    browser.runtime.onMessage.addListener(handleMessage);

    return () => {
      browser.tabs.onActivated.removeListener(handleTabActivated);
      browser.runtime.onMessage.removeListener(handleMessage);
    };
  }, [loadState]);

  const showToast = (type: 'success' | 'error', text: string) => {
    setToast({ type, text });
    setTimeout(() => setToast(null), 3000);
  };

  const handleAddToList = async (domain: string, listType: 'allow' | 'deny') => {
    try {
      const response = (await browser.runtime.sendMessage({
        type: listType === 'allow' ? 'ADD_TO_ALLOWLIST' : 'ADD_TO_DENYLIST',
        payload: { domain },
      })) as MessageResponse<void> | undefined;

      if (response?.success) {
        showToast('success', `Added ${domain} to ${listType}list`);
      } else {
        showToast('error', response?.error || 'Failed to add domain');
      }
    } catch (err) {
      showToast('error', 'Failed to add domain');
    }
  };

  const openOptions = () => {
    browser.runtime.openOptionsPage();
  };

  if (isLoading) {
    return (
      <div class="loading">
        <div class="spinner" />
        <span>Loading...</span>
      </div>
    );
  }

  if (!isConnected) {
    return (
      <div class="not-connected">
        <h2>Not Connected</h2>
        <p>Configure your Pi-hole connection to view domains.</p>
        <button onClick={openOptions}>Configure Pi-hole</button>
      </div>
    );
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <header class="header">
        <h1>PiSentinel Domains</h1>
        {tabDomains && (
          <div class="current-site" title={tabDomains.pageUrl}>
            {tabDomains.firstPartyDomain}
          </div>
        )}
      </header>

      <div class="tabs">
        <button
          class={`tab ${activeTab === 'domains' ? 'active' : ''}`}
          onClick={() => setActiveTab('domains')}
        >
          Domains ({tabDomains?.domains.length || 0})
        </button>
        <button
          class={`tab ${activeTab === 'queries' ? 'active' : ''}`}
          onClick={() => setActiveTab('queries')}
        >
          Query Log
        </button>
      </div>

      <div class="content">
        {activeTab === 'domains' ? (
          <DomainList
            domains={tabDomains?.domains || []}
            thirdPartyDomains={tabDomains?.thirdPartyDomains || []}
            firstPartyDomain={tabDomains?.firstPartyDomain || ''}
            onAddToList={handleAddToList}
          />
        ) : (
          <QueryLog />
        )}
      </div>

      {toast && <div class={`toast ${toast.type}`}>{toast.text}</div>}
    </div>
  );
}
