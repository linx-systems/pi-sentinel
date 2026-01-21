import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import browser from "webextension-polyfill";
import { DomainList } from "./DomainList";
import { QueryLog } from "./QueryLog";
import { ToastProvider, useToast } from "./ToastContext";
import { InstanceSelector } from "~/components/InstanceSelector";
import { logger } from "~/utils/logger";
import type {
  MessageResponse,
  SerializableTabDomains,
} from "~/utils/messaging";
import { useExtensionState } from "~/utils/hooks/useExtensionState";

type Tab = "domains" | "queries";
type TabDomains = SerializableTabDomains;

export function App() {
  return (
    <ToastProvider>
      <AppContent />
    </ToastProvider>
  );
}

function AppContent() {
  const [activeTab, setActiveTab] = useState<Tab>("domains");
  const [tabDomains, setTabDomains] = useState<TabDomains | null>(null);
  const initialLoadComplete = useRef(false);
  const { showToast } = useToast();

  // Use shared extension state hook
  const { state, isLoading: stateLoading } = useExtensionState();
  const isConnected = state?.isConnected ?? false;
  const isLoading = !initialLoadComplete.current && stateLoading;

  const loadTabDomains = useCallback(async () => {
    try {
      // Get current tab
      const [currentTab] = await browser.tabs.query({
        active: true,
        currentWindow: true,
      });
      if (currentTab?.id) {
        const domainsResponse = (await browser.runtime.sendMessage({
          type: "GET_TAB_DOMAINS",
          payload: { tabId: currentTab.id },
        })) as MessageResponse<TabDomains> | undefined;

        if (domainsResponse?.success && domainsResponse.data) {
          setTabDomains(domainsResponse.data);
        }
      }
    } catch (err) {
      logger.error("Failed to load tab domains:", err);
    } finally {
      initialLoadComplete.current = true;
    }
  }, []);

  useEffect(() => {
    loadTabDomains();

    // Listen for tab changes
    const handleTabActivated = () => loadTabDomains();
    browser.tabs.onActivated.addListener(handleTabActivated);

    // Listen for domain updates
    const handleMessage = async (message: unknown) => {
      const msg = message as { type: string; payload?: TabDomains };
      if (msg.type === "TAB_DOMAINS_UPDATED") {
        if (msg.payload) {
          // Real-time domain update - check if it's for the current tab
          const [currentTab] = await browser.tabs.query({
            active: true,
            currentWindow: true,
          });
          if (currentTab?.id === msg.payload.tabId) {
            setTabDomains(msg.payload);
          }
        } else {
          // Generic update - reload all domains
          loadTabDomains();
        }
      }
    };
    browser.runtime.onMessage.addListener(handleMessage);

    return () => {
      browser.tabs.onActivated.removeListener(handleTabActivated);
      browser.runtime.onMessage.removeListener(handleMessage);
    };
  }, [loadTabDomains]);

  const handleAddToList = async (
    domain: string,
    listType: "allow" | "deny",
  ) => {
    try {
      const response = (await browser.runtime.sendMessage({
        type: listType === "allow" ? "ADD_TO_ALLOWLIST" : "ADD_TO_DENYLIST",
        payload: { domain },
      })) as MessageResponse<void> | undefined;

      if (response?.success) {
        showToast({
          type: "success",
          message: `Added ${domain} to ${listType}list`,
        });
      } else {
        showToast({
          type: "error",
          message: response?.error || "Failed to add domain",
        });
      }
    } catch (err) {
      showToast({ type: "error", message: "Failed to add domain" });
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
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <header class="header">
        <div class="header-top">
          <h1>PiSentinel Domains</h1>
          <InstanceSelector compact />
        </div>
        {tabDomains && (
          <div class="current-site" title={tabDomains.pageUrl}>
            {tabDomains.firstPartyDomain}
          </div>
        )}
      </header>

      <div class="tabs">
        <button
          class={`tab ${activeTab === "domains" ? "active" : ""}`}
          onClick={() => setActiveTab("domains")}
        >
          Domains ({tabDomains?.domains.length || 0})
        </button>
        <button
          class={`tab ${activeTab === "queries" ? "active" : ""}`}
          onClick={() => setActiveTab("queries")}
        >
          Query Log
        </button>
      </div>

      <div class="content">
        {activeTab === "domains" ? (
          <DomainList
            domains={tabDomains?.domains || []}
            thirdPartyDomains={tabDomains?.thirdPartyDomains || []}
            firstPartyDomain={tabDomains?.firstPartyDomain || ""}
            onAddToList={handleAddToList}
          />
        ) : (
          <QueryLog onAddToList={handleAddToList} />
        )}
      </div>
    </div>
  );
}
