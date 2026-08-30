/**
 * Sidebar main component - displays per-tab domain list and query log.
 * @module sidebar/App
 */
import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import browser from "webextension-polyfill";
import { DomainList } from "./DomainList";
import { QueryLog } from "./QueryLog";
import { Repair } from "./Repair";
import { ToastProvider, useToast } from "./ToastContext";
import { InstanceSelector } from "~/components/InstanceSelector";
import { logger } from "~/utils/logger";
import type { SerializableTabDomains } from "~/utils/messaging";
import { createRuntimeExtensionCommands } from "~/utils/extension-commands";
import { useExtensionState } from "~/utils/hooks/useExtensionState";
import { useTemporaryAllows } from "./temporary-allows";

type Tab = "domains" | "queries" | "repair";
type TabDomains = SerializableTabDomains;

const commands = createRuntimeExtensionCommands();
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
  const temporaryAllows = useTemporaryAllows(commands);

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
        const domainsResponse = await commands.getTabDomains(currentTab.id);

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
      const msg = message as {
        type: string;
        payload?: TabDomains;
      };
      if (msg.type === "TAB_DOMAINS_UPDATED") {
        if (msg.payload) {
          const [currentTab] = await browser.tabs.query({
            active: true,
            currentWindow: true,
          });
          if (currentTab?.id === msg.payload.tabId) {
            setTabDomains(msg.payload);
          }
        } else {
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
      const response =
        listType === "allow"
          ? await commands.addToAllowlist(domain)
          : await commands.addToDenylist(domain);

      if (response?.success) {
        showToast({
          type: "success",
          message: `Added ${domain} to ${listType}list`,
        });
        return true;
      }
      showToast({
        type: "error",
        message: response?.error || "Failed to add domain",
      });
      return false;
    } catch {
      showToast({ type: "error", message: "Failed to add domain" });
      return false;
    }
  };

  const handleCreateTemporaryAllow = async (
    domain: string,
    durationSeconds: number | null,
  ) => {
    try {
      const response = await temporaryAllows.allow({
        domains: [domain],
        durationSeconds,
      });
      if (!response.success) {
        showToast({
          type: "error",
          message: response.error || "Failed to create temporary allow",
        });
        return false;
      }

      const result = response.data;
      if (result.failures.length > 0) {
        showToast({
          type: "error",
          message: `Allowed ${result.entries.length} entry; ${result.failures.length} target failed.`,
        });
      } else if (result.skippedDomains.length > 0) {
        showToast({
          type: "warning",
          message: `${domain} is already allowed.`,
        });
      } else {
        showToast({
          type: "success",
          message: `Temporarily allowed ${domain}.`,
        });
      }
      return result.entries.length > 0;
    } catch {
      showToast({ type: "error", message: "Failed to create temporary allow" });
      return false;
    }
  };

  const handleRemoveTemporaryAllows = async (entryIds: string[]) => {
    try {
      const response = await temporaryAllows.revoke(entryIds);
      if (!response.success) {
        showToast({
          type: "error",
          message: response.error || "Failed to cancel temporary allow",
        });
        return false;
      }

      const result = response.data;
      showToast({
        type: result.failures.length ? "error" : "success",
        message: result.failures.length
          ? `Cancelled ${result.removedIds.length} entries; ${result.failures.length} could not be removed.`
          : `Cancelled ${result.removedIds.length} temporary ${result.removedIds.length === 1 ? "allow" : "allows"}.`,
      });
      return result.removedIds.length > 0;
    } catch {
      showToast({ type: "error", message: "Failed to cancel temporary allow" });
      return false;
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

      <div class="tabs" role="tablist" aria-label="Sidebar views">
        <button
          class={`tab ${activeTab === "domains" ? "active" : ""}`}
          onClick={() => setActiveTab("domains")}
          role="tab"
          aria-selected={activeTab === "domains"}
        >
          Domains ({tabDomains?.domains.length || 0})
        </button>
        <button
          class={`tab ${activeTab === "queries" ? "active" : ""}`}
          onClick={() => setActiveTab("queries")}
          role="tab"
          aria-selected={activeTab === "queries"}
        >
          Query Log
        </button>
        <button
          class={`tab ${activeTab === "repair" ? "active" : ""}`}
          onClick={() => setActiveTab("repair")}
          role="tab"
          aria-selected={activeTab === "repair"}
        >
          Repair
        </button>
      </div>

      <div class="content" role="tabpanel" aria-label={`${activeTab} view`}>
        {activeTab === "domains" ? (
          <DomainList
            domains={tabDomains?.domains || []}
            firstPartyDomain={tabDomains?.firstPartyDomain || ""}
            onAddToList={handleAddToList}
            temporaryAllows={temporaryAllows.entries}
            onCreateTemporaryAllow={handleCreateTemporaryAllow}
            onRemoveTemporaryAllows={handleRemoveTemporaryAllows}
          />
        ) : activeTab === "queries" ? (
          <QueryLog onAddToList={handleAddToList} />
        ) : (
          <Repair temporaryAllows={temporaryAllows} />
        )}
      </div>
    </div>
  );
}
