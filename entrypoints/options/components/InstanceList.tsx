import { useState, useEffect } from "preact/hooks";
import browser from "webextension-polyfill";
import { InstanceCard } from "./InstanceCard";
import { InstanceModal } from "./InstanceModal";
import { TotpInput } from "./TotpInput";
import type {
  InstanceState,
  PersistedInstances,
  PiHoleInstance,
} from "~/utils/types";
import type { MessageResponse } from "~/utils/messaging";
import { sendViaStorage } from "~/utils/storage-message";
import { logger } from "~/utils/logger";

interface InstanceListProps {
  onMessage: (message: {
    type: "success" | "error" | "info";
    text: string;
  }) => void;
}

export function InstanceList({ onMessage }: InstanceListProps) {
  const [instances, setInstances] = useState<PiHoleInstance[]>([]);
  const [activeInstanceId, setActiveInstanceId] = useState<string | null>(null);
  const [instanceStates, setInstanceStates] = useState<
    Map<string, InstanceState>
  >(new Map());
  const [isLoading, setIsLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingInstance, setEditingInstance] = useState<PiHoleInstance | null>(
    null,
  );
  const [connectingInstanceId, setConnectingInstanceId] = useState<
    string | null
  >(null);
  const [totpRequired, setTotpRequired] = useState(false);
  const [pendingPassword, setPendingPassword] = useState("");

  // Load instances on mount
  useEffect(() => {
    loadInstances();

    // Listen for state updates
    const handleMessage = (message: unknown) => {
      const msg = message as { type: string; payload?: unknown };
      if (msg.type === "STATE_UPDATED") {
        // Reload everything to avoid stale closure issues
        loadInstances();
      }
    };
    browser.runtime.onMessage.addListener(handleMessage);

    return () => {
      browser.runtime.onMessage.removeListener(handleMessage);
    };
  }, []);

  const loadInstances = async () => {
    setIsLoading(true);
    try {
      // Use sendViaStorage for Firefox options page compatibility
      const response = await sendViaStorage<PersistedInstances>(
        "pendingGetInstances",
        "getInstancesResponse",
        {},
      );

      if (response?.success && response.data) {
        const newInstances = response.data.instances;
        setInstances(newInstances);
        setActiveInstanceId(response.data.activeInstanceId);
        // Pass instances directly to avoid stale closure
        await refreshInstanceStates(newInstances);
      }
    } catch (err) {
      logger.error("Failed to load instances:", err);
      onMessage({ type: "error", text: "Failed to load Pi-hole instances" });
    } finally {
      setIsLoading(false);
    }
  };

  const refreshInstanceStates = async (
    instanceList: PiHoleInstance[] = instances,
  ) => {
    const newStates = new Map<string, InstanceState>();

    for (const instance of instanceList) {
      try {
        // Use sendViaStorage for Firefox options page compatibility
        const response = await sendViaStorage<InstanceState>(
          "pendingGetInstanceState",
          "getInstanceStateResponse",
          { instanceId: instance.id },
        );

        if (response?.success && response.data) {
          newStates.set(instance.id, response.data);
        }
      } catch (err) {
        logger.error(`Failed to get state for instance ${instance.id}:`, err);
      }
    }

    setInstanceStates(newStates);
  };

  // Refresh states when instances change
  useEffect(() => {
    if (instances.length > 0) {
      refreshInstanceStates();
    }
  }, [instances]);

  const handleAddInstance = () => {
    setEditingInstance(null);
    setShowModal(true);
  };

  const handleEditInstance = (instance: PiHoleInstance) => {
    setEditingInstance(instance);
    setShowModal(true);
  };

  const handleDeleteInstance = async (instanceId: string) => {
    const instance = instances.find((i) => i.id === instanceId);
    const displayName = instance?.name || "this Pi-hole";

    if (!confirm(`Are you sure you want to delete ${displayName}?`)) {
      return;
    }

    try {
      const response = await sendViaStorage<void>(
        "pendingDeleteInstance",
        "deleteInstanceResponse",
        { instanceId },
      );

      if (response?.success) {
        onMessage({ type: "success", text: "Pi-hole deleted successfully" });
        await loadInstances();
      } else {
        throw new Error(response?.error || "Failed to delete");
      }
    } catch (err) {
      logger.error("Failed to delete instance:", err);
      onMessage({
        type: "error",
        text: err instanceof Error ? err.message : "Failed to delete Pi-hole",
      });
    }
  };

  const handleConnectInstance = async (instanceId: string) => {
    setConnectingInstanceId(instanceId);
    setTotpRequired(false);

    // Prompt for password
    const password = prompt("Enter your Pi-hole password:");
    if (!password) {
      setConnectingInstanceId(null);
      return;
    }

    setPendingPassword(password);

    try {
      const response = await sendViaStorage<{ totpRequired?: boolean }>(
        "pendingConnectInstance",
        "connectInstanceResponse",
        { instanceId, password },
      );

      if (response?.success) {
        onMessage({ type: "success", text: "Connected to Pi-hole" });
        await loadInstances();
      } else if (response?.data?.totpRequired) {
        setTotpRequired(true);
        // Don't clear connectingInstanceId - we need it for TOTP submission
      } else {
        throw new Error(response?.error || "Connection failed");
      }
    } catch (err) {
      logger.error("Failed to connect instance:", err);
      onMessage({
        type: "error",
        text: err instanceof Error ? err.message : "Failed to connect",
      });
    }

    if (!totpRequired) {
      setConnectingInstanceId(null);
    }
  };

  const handleTotpSubmit = async (totp: string): Promise<void> => {
    if (!connectingInstanceId || !pendingPassword) return;

    try {
      const response = await sendViaStorage<void>(
        "pendingConnectInstance",
        "connectInstanceResponse",
        {
          instanceId: connectingInstanceId,
          password: pendingPassword,
          totp,
        },
      );

      if (response?.success) {
        onMessage({ type: "success", text: "Connected to Pi-hole" });
        setTotpRequired(false);
        setConnectingInstanceId(null);
        setPendingPassword("");
        await loadInstances();
      } else {
        throw new Error(response?.error || "Invalid TOTP code");
      }
    } catch (err) {
      onMessage({
        type: "error",
        text: err instanceof Error ? err.message : "Authentication failed",
      });
    }
  };

  const handleDisconnectInstance = async (instanceId: string) => {
    try {
      const response = await sendViaStorage<void>(
        "pendingDisconnectInstance",
        "disconnectInstanceResponse",
        { instanceId },
      );

      if (response?.success) {
        onMessage({ type: "info", text: "Disconnected from Pi-hole" });
        await loadInstances();
      } else {
        throw new Error(response?.error || "Failed to disconnect");
      }
    } catch (err) {
      logger.error("Failed to disconnect instance:", err);
      onMessage({
        type: "error",
        text: err instanceof Error ? err.message : "Failed to disconnect",
      });
    }
  };

  const handleSetActiveInstance = async (instanceId: string) => {
    try {
      const response = await sendViaStorage<void>(
        "pendingSetActiveInstance",
        "setActiveInstanceResponse",
        { instanceId },
      );

      if (response?.success) {
        setActiveInstanceId(instanceId);
        onMessage({ type: "success", text: "Active Pi-hole updated" });
      } else {
        throw new Error(response?.error || "Failed to set active");
      }
    } catch (err) {
      logger.error("Failed to set active instance:", err);
      onMessage({
        type: "error",
        text:
          err instanceof Error ? err.message : "Failed to set active Pi-hole",
      });
    }
  };

  const handleModalSaved = () => {
    loadInstances();
    onMessage({
      type: "success",
      text: editingInstance ? "Pi-hole updated" : "Pi-hole added",
    });
  };

  if (isLoading) {
    return (
      <div class="loading">
        <div class="spinner" />
        <span>Loading...</span>
      </div>
    );
  }

  if (totpRequired && connectingInstanceId) {
    return (
      <TotpInput
        onSubmit={async (totp: string, _password: string) => {
          // Use the stored pendingPassword instead of the one from TotpInput
          // since we already captured it during the initial connect attempt
          await handleTotpSubmit(totp);
        }}
        isLoading={false}
      />
    );
  }

  return (
    <div class="instance-list">
      <div class="instance-list-header">
        <h2>
          <ServerIcon />
          Pi-hole Instances
        </h2>
        <button class="btn btn-primary" onClick={handleAddInstance}>
          <PlusIcon />
          Add Pi-hole
        </button>
      </div>

      {instances.length === 0 ? (
        <div class="empty-state">
          <div class="empty-icon">
            <ServerIcon size={48} />
          </div>
          <h3>No Pi-holes configured</h3>
          <p>Add your first Pi-hole instance to get started.</p>
          <button class="btn btn-primary" onClick={handleAddInstance}>
            Add Pi-hole
          </button>
        </div>
      ) : (
        <div class="instance-cards">
          {instances.map((instance) => (
            <InstanceCard
              key={instance.id}
              instance={instance}
              state={instanceStates.get(instance.id) || null}
              isActive={instance.id === activeInstanceId}
              onEdit={handleEditInstance}
              onDelete={handleDeleteInstance}
              onConnect={handleConnectInstance}
              onDisconnect={handleDisconnectInstance}
              onSetActive={handleSetActiveInstance}
            />
          ))}
        </div>
      )}

      {showModal && (
        <InstanceModal
          instance={editingInstance}
          onClose={() => {
            setShowModal(false);
            setEditingInstance(null);
          }}
          onSaved={handleModalSaved}
        />
      )}
    </div>
  );
}

function ServerIcon({ size = 18 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
    >
      <rect x="2" y="2" width="20" height="8" rx="2" ry="2" />
      <rect x="2" y="14" width="20" height="8" rx="2" ry="2" />
      <line x1="6" y1="6" x2="6.01" y2="6" />
      <line x1="6" y1="18" x2="6.01" y2="18" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
    >
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}
