import { useEffect, useState } from "preact/hooks";
import browser from "webextension-polyfill";
import { StatsCard } from "./StatsCard";
import { BlockingToggle } from "./BlockingToggle";
import { DomainIcon, ExternalLinkIcon, SettingsIcon } from "~/utils/icons";
import { formatNumber } from "~/utils/utils";
import { logger } from "~/utils/logger";
import type { PersistedConfig } from "~/utils/types";
import { useExtensionState } from "~/utils/hooks/useExtensionState";

type ViewState = "loading" | "not-configured" | "connected" | "error";

export function App() {
  // Use shared extension state hook
  const { state, isLoading, error: stateError, refetch } = useExtensionState();
  const [viewState, setViewState] = useState<ViewState>("loading");
  const [error, setError] = useState<string | null>(null);
  const [piholeUrl, setPiholeUrl] = useState<string | null>(null);

  // Update viewState based on extension state
  useEffect(() => {
    if (isLoading) {
      setViewState("loading");
      return;
    }

    if (stateError) {
      setViewState("error");
      setError(stateError);
      return;
    }

    if (state?.isConnected) {
      setViewState("connected");
      // Fetch fresh stats
      browser.runtime.sendMessage({ type: "GET_STATS" });
      browser.runtime.sendMessage({ type: "GET_BLOCKING_STATUS" });
    } else if (state?.connectionError) {
      setViewState("error");
      setError(state.connectionError);
    } else {
      setViewState("not-configured");
    }
  }, [state, isLoading, stateError]);

  // Fetch Pi-hole URL from storage on mount
  useEffect(() => {
    const fetchConfig = async () => {
      try {
        const storage = await browser.storage.local.get("pisentinel_config");
        const config = storage.pisentinel_config as PersistedConfig | undefined;
        if (config?.piholeUrl) {
          setPiholeUrl(config.piholeUrl);
        }
      } catch (err) {
        logger.error("Failed to fetch config:", err);
      }
    };

    fetchConfig();
  }, []);

  const openOptions = () => {
    browser.runtime.openOptionsPage();
  };

  const openSidebar = async () => {
    try {
      await browser.sidebarAction.open();
    } catch {
      // Fallback: open sidebar panel in new tab
      browser.tabs.create({
        url: browser.runtime.getURL("sidebar/sidebar.html"),
      });
    }
  };

  const openAdminPage = () => {
    if (piholeUrl) {
      browser.tabs.create({ url: `${piholeUrl}/admin` });
    }
  };

  if (viewState === "loading") {
    return (
      <div class="loading">
        <div class="spinner" />
        <span>Loading...</span>
      </div>
    );
  }

  if (viewState === "not-configured") {
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

  if (viewState === "error") {
    return (
      <div class="error-state">
        <div class="message">{error || "Connection error"}</div>
        <button class="retry-btn" onClick={refetch}>
          Retry
        </button>
        <button
          class="config-btn"
          onClick={openOptions}
          style={{ marginLeft: "8px" }}
        >
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

      <div
        class={`status-indicator ${state?.isConnected ? "connected" : "disconnected"}`}
      >
        <span class={`status-dot ${state?.isConnected ? "" : "pulse"}`} />
        <span>
          {state?.isConnected ? "Connected to Pi-hole" : "Disconnected"}
        </span>
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
        <a
          href="#"
          class="footer-link"
          onClick={(e) => {
            e.preventDefault();
            openSidebar();
          }}
        >
          <DomainIcon />
          View domains
        </a>
        {piholeUrl && (
          <a
            href="#"
            class="footer-link"
            onClick={(e) => {
              e.preventDefault();
              openAdminPage();
            }}
          >
            <ExternalLinkIcon />
            Pi-hole Admin
          </a>
        )}
      </footer>
    </div>
  );
}
