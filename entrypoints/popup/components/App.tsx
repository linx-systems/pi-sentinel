import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import browser from "webextension-polyfill";
import { StatsCard } from "./StatsCard";
import { BlockingToggle } from "./BlockingToggle";
import { InstanceSelector } from "~/components/InstanceSelector";
import { DomainIcon, ExternalLinkIcon, SettingsIcon } from "~/utils/icons";
import { DEFAULTS, STORAGE_KEYS } from "~/utils/constants";
import { formatNumber } from "~/utils/utils";
import { logger } from "~/utils/logger";
import type { MessageResponse } from "~/utils/messaging";
import type {
  PersistedConfig,
  PersistedInstances,
  PiHoleInstance,
} from "~/utils/types";
import { useExtensionState } from "~/utils/hooks/useExtensionState";

type ViewState = "loading" | "not-configured" | "connected" | "error";

export function App() {
  // Use shared extension state hook
  const { state, isLoading, error: stateError, refetch } = useExtensionState();
  const [viewState, setViewState] = useState<ViewState>("loading");
  const [error, setError] = useState<string | null>(null);
  const [piholeUrl, setPiholeUrl] = useState<string | null>(null);
  const [instances, setInstances] = useState<PiHoleInstance[]>([]);
  const [activeInstanceId, setActiveInstanceId] = useState<string | null>(null);
  const [instancesLoaded, setInstancesLoaded] = useState(false);
  const hasInstances = instances.length > 0;
  const lastStatsRequest = useRef<{ key: string; at: number } | null>(null);

  // Update viewState based on extension state
  useEffect(() => {
    if (isLoading || !instancesLoaded) {
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
    } else if (state?.connectionError) {
      setViewState("error");
      setError(state.connectionError);
    } else {
      setViewState("not-configured");
    }
  }, [
    state,
    isLoading,
    stateError,
    hasInstances,
    activeInstanceId,
    instancesLoaded,
  ]);

  useEffect(() => {
    if (!instancesLoaded || !state?.isConnected) return;
    if (hasInstances && activeInstanceId === null) return;

    const key = hasInstances ? (activeInstanceId ?? "legacy") : "legacy";
    const now = Date.now();
    const lastUpdated = state?.statsLastUpdated || 0;
    const statsStale = now - lastUpdated > DEFAULTS.CACHE_TTL;
    const lastRequest = lastStatsRequest.current;
    const requestExpired =
      !lastRequest ||
      lastRequest.key !== key ||
      now - lastRequest.at > DEFAULTS.CACHE_TTL;

    if (statsStale && requestExpired) {
      lastStatsRequest.current = { key, at: now };
      void browser.runtime
        .sendMessage({ type: "GET_STATS" })
        .catch((err) =>
          logger.debug("Failed to fetch stats for popup:", err),
        );
      void browser.runtime
        .sendMessage({ type: "GET_BLOCKING_STATUS" })
        .catch((err) =>
          logger.debug("Failed to fetch blocking status for popup:", err),
        );
    }
  }, [
    instancesLoaded,
    state?.isConnected,
    state?.statsLastUpdated,
    hasInstances,
    activeInstanceId,
  ]);

  const loadInstances = useCallback(async () => {
    let config: PersistedInstances | null = null;

    try {
      const response = (await browser.runtime.sendMessage({
        type: "GET_INSTANCES",
      })) as MessageResponse<PersistedInstances>;

      if (response?.success && response.data) {
        config = response.data;
      }
    } catch (err) {
      logger.error("Failed to fetch instances:", err);
    }

    if (!config) {
      try {
        const stored = await browser.storage.local.get(STORAGE_KEYS.INSTANCES);
        const storedConfig = stored[
          STORAGE_KEYS.INSTANCES
        ] as PersistedInstances | undefined;
        if (storedConfig) {
          config = storedConfig;
        }
      } catch (err) {
        logger.error("Failed to read instances from storage:", err);
      }
    }

    if (config && config.instances.length > 0) {
      setInstances(config.instances);
      setActiveInstanceId(config.activeInstanceId ?? null);
      setPiholeUrl(null);
      setInstancesLoaded(true);
      return;
    }

    try {
      const storage = await browser.storage.local.get(STORAGE_KEYS.CONFIG);
      const legacy = storage[STORAGE_KEYS.CONFIG] as
        | PersistedConfig
        | undefined;
      if (legacy?.piholeUrl) {
        setPiholeUrl(legacy.piholeUrl);
      }
    } catch (err) {
      logger.error("Failed to fetch legacy config:", err);
    } finally {
      setInstancesLoaded(true);
    }
  }, []);

  // Fetch instance config on mount and when instance list changes
  useEffect(() => {
    loadInstances();

    const handleMessage = (message: unknown) => {
      const msg = message as { type: string };
      if (msg.type === "INSTANCES_UPDATED") {
        loadInstances();
      }
    };

    browser.runtime.onMessage.addListener(handleMessage);
    return () => browser.runtime.onMessage.removeListener(handleMessage);
  }, [loadInstances]);

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

  const effectiveInstance = activeInstanceId
    ? instances.find((instance) => instance.id === activeInstanceId)
    : instances.length === 1
      ? instances[0]
      : null;
  const adminUrl = hasInstances
    ? effectiveInstance?.piholeUrl ?? null
    : piholeUrl;
  const showAdminLink =
    Boolean(adminUrl) &&
    (!hasInstances || activeInstanceId !== null || instances.length === 1);

  const openAdminPage = () => {
    if (adminUrl) {
      browser.tabs.create({ url: `${adminUrl}/admin` });
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

  const handleInstanceChange = (instanceId: string | null) => {
    setActiveInstanceId(instanceId);
    refetch();

    if (!hasInstances || instanceId !== null) {
      void browser.runtime
        .sendMessage({ type: "GET_STATS" })
        .catch((err) =>
          logger.debug("Failed to fetch stats after instance switch:", err),
        );
      void browser.runtime
        .sendMessage({ type: "GET_BLOCKING_STATUS" })
        .catch((err) =>
          logger.debug(
            "Failed to fetch blocking status after instance switch:",
            err,
          ),
        );
    }
  };

  return (
    <div>
      <header class="header">
        <h1>
          <img src="../icons/icon-32.svg" alt="" class="logo" />
          PiSentinel
        </h1>
        <div class="header-actions">
          <InstanceSelector onInstanceChange={handleInstanceChange} compact />
          <button class="settings-btn" onClick={openOptions} title="Settings">
            <SettingsIcon />
          </button>
        </div>
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
        {showAdminLink && (
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
