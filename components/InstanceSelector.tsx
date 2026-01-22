import { useState, useEffect, useRef } from "preact/hooks";
import browser from "webextension-polyfill";
import type {
  PiHoleInstance,
  InstanceState,
  PersistedInstances,
} from "~/utils/types";
import type { MessageResponse } from "~/utils/messaging";
import { logger } from "~/utils/logger";

interface InstanceSelectorProps {
  /** Callback when instance selection changes */
  onInstanceChange?: (instanceId: string | null) => void;
  /** Compact mode for smaller spaces */
  compact?: boolean;
}

interface InstanceWithState {
  instance: PiHoleInstance;
  state: InstanceState | null;
}

export function InstanceSelector({
  onInstanceChange,
  compact = false,
}: InstanceSelectorProps) {
  const [instances, setInstances] = useState<InstanceWithState[]>([]);
  const [activeInstanceId, setActiveInstanceId] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Load instances on mount
  useEffect(() => {
    loadInstances();

    // Listen for state updates
    const handleMessage = (message: unknown) => {
      const msg = message as { type: string };
      if (msg.type === "STATE_UPDATED" || msg.type === "INSTANCES_UPDATED") {
        loadInstances();
      }
    };
    browser.runtime.onMessage.addListener(handleMessage);

    return () => {
      browser.runtime.onMessage.removeListener(handleMessage);
    };
  }, []);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen]);

  const loadInstances = async () => {
    try {
      const response = (await browser.runtime.sendMessage({
        type: "GET_INSTANCES",
      })) as MessageResponse<PersistedInstances>;

      if (response?.success && response.data) {
        setActiveInstanceId(response.data.activeInstanceId);

        // Fetch state for each instance
        const instancesWithState: InstanceWithState[] = await Promise.all(
          response.data.instances.map(async (instance) => {
            try {
              const stateResponse = (await browser.runtime.sendMessage({
                type: "GET_INSTANCE_STATE",
                payload: { instanceId: instance.id },
              })) as MessageResponse<InstanceState>;

              return {
                instance,
                state: stateResponse?.success
                  ? (stateResponse.data ?? null)
                  : null,
              };
            } catch {
              return { instance, state: null };
            }
          }),
        );

        setInstances(instancesWithState);
      }
    } catch (err) {
      logger.error("Failed to load instances:", err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSelectInstance = async (instanceId: string | null) => {
    try {
      const response = (await browser.runtime.sendMessage({
        type: "SET_ACTIVE_INSTANCE",
        payload: { instanceId },
      })) as MessageResponse<void>;

      if (response?.success) {
        setActiveInstanceId(instanceId);
        setIsOpen(false);
        onInstanceChange?.(instanceId);
      }
    } catch (err) {
      logger.error("Failed to set active instance:", err);
    }
  };

  // Don't show selector if only one instance or no instances
  if (isLoading || instances.length <= 1) {
    return null;
  }

  const activeInstance = instances.find(
    (i) => i.instance.id === activeInstanceId,
  );
  const connectedCount = instances.filter((i) => i.state?.isConnected).length;
  const showAllOption = connectedCount > 1;

  const getDisplayName = (instance: PiHoleInstance): string => {
    if (instance.name) return instance.name;
    try {
      const url = new URL(instance.piholeUrl);
      return url.hostname;
    } catch {
      return instance.piholeUrl;
    }
  };

  const currentLabel =
    activeInstanceId === null
      ? `All Pi-holes (${connectedCount})`
      : activeInstance
        ? getDisplayName(activeInstance.instance)
        : "Select Pi-hole";

  return (
    <div
      class={`instance-selector ${compact ? "compact" : ""}`}
      ref={dropdownRef}
    >
      <button
        class="instance-selector-trigger"
        onClick={() => setIsOpen(!isOpen)}
        title="Switch Pi-hole instance"
      >
        <span class="instance-selector-label">{currentLabel}</span>
        <ChevronIcon isOpen={isOpen} />
      </button>

      {isOpen && (
        <div class="instance-selector-dropdown">
          {showAllOption && (
            <button
              class={`instance-selector-option ${activeInstanceId === null ? "active" : ""}`}
              onClick={() => handleSelectInstance(null)}
            >
              <span class="option-icon">
                <AllIcon />
              </span>
              <span class="option-label">All Pi-holes</span>
              <span class="option-count">{connectedCount} connected</span>
            </button>
          )}

          {instances.map(({ instance, state }) => (
            <button
              key={instance.id}
              class={`instance-selector-option ${instance.id === activeInstanceId ? "active" : ""}`}
              onClick={() => handleSelectInstance(instance.id)}
            >
              <span
                class={`option-status ${state?.isConnected ? "connected" : "disconnected"}`}
              />
              <span class="option-label">{getDisplayName(instance)}</span>
              {state?.isConnected && state.stats && (
                <span class="option-stats">
                  {state.stats.queries.percent_blocked.toFixed(0)}% blocked
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ChevronIcon({ isOpen }: { isOpen: boolean }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      class={`chevron-icon ${isOpen ? "open" : ""}`}
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

function AllIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
    >
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  );
}
