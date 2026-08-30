import { useState, useEffect, useRef } from "preact/hooks";
import browser from "webextension-polyfill";
import { InstanceCard } from "./InstanceCard";
import { InstanceModal } from "./InstanceModal";
import { PasswordPromptModal } from "./PasswordPromptModal";
import { TotpInput } from "./TotpInput";
import type { ConnectInstanceFailure } from "~/utils/connection-failure";
import type { InstanceState, PiHoleInstance } from "~/utils/types";
import type { ExtensionCommands } from "~/utils/extension-commands";
import { logger } from "~/utils/logger";

type InstanceListCommands = Pick<
  ExtensionCommands,
  | "getInstances"
  | "getInstanceState"
  | "deleteInstance"
  | "checkPasswordAvailable"
  | "connectInstance"
  | "disconnectInstance"
  | "setActiveInstance"
  | "testConnection"
  | "addInstance"
  | "updateInstance"
>;

interface InstanceListProps {
  commands: InstanceListCommands;
  onMessage: (message: {
    type: "success" | "error" | "info";
    text: string;
  }) => void;
}

export function InstanceList({ commands, onMessage }: InstanceListProps) {
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
  const [activeFlowInstanceId, setActiveFlowInstanceId] = useState<
    string | null
  >(null);
  const [totpRequired, setTotpRequired] = useState(false);
  const [pendingPassword, setPendingPassword] = useState("");
  const [passwordPromptInstance, setPasswordPromptInstance] =
    useState<PiHoleInstance | null>(null);
  const [passwordPromptError, setPasswordPromptError] = useState<string | null>(
    null,
  );
  const [passwordPromptLoading, setPasswordPromptLoading] = useState(false);
  const [totpError, setTotpError] = useState<string | null>(null);
  const [connectionFailures, setConnectionFailures] = useState<
    Map<string, ConnectInstanceFailure>
  >(new Map());

  const [useStoredPasswordForTotp, setUseStoredPasswordForTotp] =
    useState(false);

  const loadDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stateDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const activeFlowInstanceIdRef = useRef<string | null>(null);
  const requestInFlightRef = useRef(false);
  const [requestInFlight, setRequestInFlight] = useState(false);

  // Load instances on mount
  useEffect(() => {
    loadInstances();

    const handleMessage = (message: unknown) => {
      const type =
        typeof message === "object" &&
        message !== null &&
        "type" in message &&
        typeof message.type === "string"
          ? message.type
          : undefined;
      if (type === "INSTANCES_UPDATED") {
        // Leading-edge debounce: fire immediately on first event,
        // then ignore subsequent events within the 100ms window
        if (!loadDebounceRef.current) {
          loadInstances();
        } else {
          clearTimeout(loadDebounceRef.current);
        }
        loadDebounceRef.current = setTimeout(() => {
          loadDebounceRef.current = null;
        }, 100);
      }

      // Listen for STATE_UPDATED to pick up connection state changes.
      // Only refreshes states (not full loadInstances) to avoid clearing modal fields.
      // Debounced at 3s to avoid message storms from stats polls.
      if (type === "STATE_UPDATED") {
        if (stateDebounceRef.current) clearTimeout(stateDebounceRef.current);
        stateDebounceRef.current = setTimeout(() => {
          refreshInstanceStates();
          stateDebounceRef.current = null;
        }, 3000);
      }
    };
    browser.runtime.onMessage.addListener(handleMessage);

    return () => {
      browser.runtime.onMessage.removeListener(handleMessage);
      if (loadDebounceRef.current) {
        clearTimeout(loadDebounceRef.current);
      }
      if (stateDebounceRef.current) {
        clearTimeout(stateDebounceRef.current);
      }
    };
  }, []);

  const loadInstances = async () => {
    setIsLoading(true);
    try {
      const response = await commands.getInstances();

      if (response.success) {
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
    const states = await Promise.all(
      instanceList.map(async (instance) => {
        try {
          const response = await commands.getInstanceState(instance.id);
          return response.success
            ? { instanceId: instance.id, state: response.data }
            : null;
        } catch (err) {
          logger.error(`Failed to get state for instance ${instance.id}:`, err);
          return null;
        }
      }),
    );

    const connectedIds = new Set(
      states.flatMap((result) =>
        result?.state.isConnected ? [result.instanceId] : [],
      ),
    );
    setInstanceStates((prev) => {
      const merged = new Map(prev);
      for (const state of states) {
        if (state) merged.set(state.instanceId, state.state);
      }
      return merged;
    });
    if (connectedIds.size > 0) {
      setConnectionFailures((current) => {
        const next = new Map(current);
        for (const instanceId of connectedIds) next.delete(instanceId);
        return next;
      });
    }
  };

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
      logger.debug(`[InstanceList] Deleting instance: ${instanceId}`);
      const response = await commands.deleteInstance(instanceId);

      if (response.success) {
        onMessage({ type: "success", text: "Pi-hole deleted successfully" });
      } else {
        throw new Error(response.error);
      }
    } catch (err) {
      logger.error("Failed to delete instance:", err);
      onMessage({
        type: "error",
        text: err instanceof Error ? err.message : "Failed to delete Pi-hole",
      });
    }
  };

  const beginRequest = (instanceId: string) => {
    if (
      activeFlowInstanceIdRef.current !== instanceId ||
      requestInFlightRef.current
    ) {
      return false;
    }
    requestInFlightRef.current = true;
    setRequestInFlight(true);
    return true;
  };

  const endRequest = () => {
    requestInFlightRef.current = false;
    setRequestInFlight(false);
  };

  const finishConnection = (instanceId: string) => {
    if (activeFlowInstanceIdRef.current !== instanceId) return;
    activeFlowInstanceIdRef.current = null;
    setActiveFlowInstanceId(null);
    setTotpRequired(false);
    setTotpError(null);
    setPendingPassword("");
    setUseStoredPasswordForTotp(false);
  };

  const handleConnectInstance = async (instanceId: string) => {
    if (activeFlowInstanceIdRef.current) return;

    const instance = instances.find((item) => item.id === instanceId);
    if (!instance) {
      onMessage({ type: "error", text: "Pi-hole not found" });
      return;
    }

    activeFlowInstanceIdRef.current = instanceId;
    setActiveFlowInstanceId(instanceId);
    setConnectionFailures((current) => {
      const next = new Map(current);
      next.delete(instanceId);
      return next;
    });
    setTotpRequired(false);
    setTotpError(null);
    setPendingPassword("");
    setUseStoredPasswordForTotp(false);
    setPasswordPromptError(null);

    if (instance.passwordless) {
      await connectInstance({ instanceId, password: "" });
      return;
    }

    if (!beginRequest(instanceId)) return;
    try {
      const checkResponse = await commands.checkPasswordAvailable(instanceId);
      if (checkResponse.success && checkResponse.data.available) {
        setUseStoredPasswordForTotp(true);
        endRequest();
        await connectInstance({ instanceId });
        return;
      }

      setPasswordPromptInstance(instance);
      endRequest();
    } catch (error) {
      logger.error("Failed to prepare connection:", error);
      onMessage({
        type: "error",
        text: "Couldn't start the connection. Check the Pi-hole and try again.",
      });
      endRequest();
      finishConnection(instanceId);
    }
  };

  const connectInstance = async ({
    instanceId,
    password,
    totp,
    fromPrompt = false,
  }: {
    instanceId: string;
    password?: string;
    totp?: string;
    fromPrompt?: boolean;
  }): Promise<void> => {
    if (!beginRequest(instanceId)) return;

    const source = fromPrompt ? "prompt" : totp ? "totp" : "direct";
    let keepFlow = false;
    if (source === "prompt") {
      setPasswordPromptLoading(true);
    }

    try {
      const response = await commands.connectInstance({
        instanceId,
        ...(password !== undefined ? { password } : {}),
        ...(totp ? { totp } : {}),
      });

      if (!response.success) {
        const failure = response.error;
        setConnectionFailures((current) => {
          const next = new Map(current);
          next.set(instanceId, failure);
          return next;
        });
        if (source === "prompt") {
          if (failure.kind === "authentication") {
            keepFlow = true;
            setPasswordPromptError(failure.message);
          } else {
            setPasswordPromptInstance(null);
            setPasswordPromptError(null);
          }
        } else if (source === "totp") {
          keepFlow = true;
          setTotpError(failure.message);
        } else {
          onMessage({ type: "error", text: failure.message });
        }
        return;
      }

      if (response.data.kind === "connected") {
        setInstanceStates((prev) => {
          const next = new Map(prev);
          const current = next.get(instanceId);
          if (current) {
            next.set(instanceId, {
              ...current,
              isConnected: true,
              connectionError: null,
            });
          }
          return next;
        });
        setConnectionFailures((current) => {
          const next = new Map(current);
          next.delete(instanceId);
          return next;
        });
        onMessage({ type: "success", text: "Connected to Pi-hole" });
        setPasswordPromptInstance(null);
        setPasswordPromptError(null);
      } else {
        keepFlow = true;
        setTotpRequired(true);
        setTotpError(null);
        setPendingPassword(password ?? "");
        setUseStoredPasswordForTotp(password === undefined);
        setPasswordPromptInstance(null);
        setPasswordPromptError(null);
      }
    } catch (error) {
      logger.error("Failed to connect instance:", error);
      const message =
        "Couldn't connect to the Pi-hole. Check the URL and try again.";

      if (source === "prompt") {
        keepFlow = true;
        setPasswordPromptError(message);
      } else if (source === "totp") {
        keepFlow = true;
        setTotpError(message);
      } else {
        onMessage({ type: "error", text: message });
      }
    } finally {
      if (source === "prompt") {
        setPasswordPromptLoading(false);
      }
      endRequest();
      if (!keepFlow) {
        finishConnection(instanceId);
      }
    }
  };

  const handleTotpSubmit = async (
    totp: string,
    passwordFromInput?: string,
  ): Promise<void> => {
    const instanceId = activeFlowInstanceIdRef.current;
    if (!instanceId || !totpRequired) return;

    const password = useStoredPasswordForTotp
      ? undefined
      : (passwordFromInput ?? pendingPassword);

    await connectInstance({ instanceId, password, totp });
  };

  const handleTotpCancel = () => {
    if (requestInFlightRef.current) return;
    const instanceId = activeFlowInstanceIdRef.current;
    if (!instanceId) return;
    finishConnection(instanceId);
  };

  const handlePasswordPromptClose = () => {
    if (requestInFlightRef.current) return;
    const instanceId = activeFlowInstanceIdRef.current;
    if (!instanceId) return;
    setPasswordPromptInstance(null);
    setPasswordPromptError(null);
    finishConnection(instanceId);
  };

  const handleDisconnectInstance = async (instanceId: string) => {
    try {
      const response = await commands.disconnectInstance(instanceId);

      if (response.success) {
        onMessage({ type: "info", text: "Disconnected from Pi-hole" });
        // Optimistic UI: immediately show disconnected state
        setInstanceStates((prev) => {
          const next = new Map(prev);
          const current = next.get(instanceId);
          if (current) {
            next.set(instanceId, { ...current, isConnected: false });
          }
          return next;
        });
      } else {
        throw new Error(response.error);
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
      const response = await commands.setActiveInstance(instanceId);

      if (response.success) {
        setActiveInstanceId(instanceId);
        onMessage({ type: "success", text: "Active Pi-hole updated" });
      } else {
        throw new Error(response.error);
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

  if (totpRequired && activeFlowInstanceId) {
    return (
      <TotpInput
        onSubmit={handleTotpSubmit}
        onCancel={handleTotpCancel}
        isLoading={requestInFlight}
        error={totpError}
        showPassword={false}
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
              connectionFailure={connectionFailures.get(instance.id) || null}
              isActive={instance.id === activeInstanceId}
              isConnecting={activeFlowInstanceId === instance.id}
              isConnectionFlowActive={activeFlowInstanceId !== null}
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
          commands={commands}
          instance={editingInstance}
          onClose={() => {
            setShowModal(false);
            setEditingInstance(null);
          }}
          onSaved={handleModalSaved}
        />
      )}

      {passwordPromptInstance && (
        <PasswordPromptModal
          instance={passwordPromptInstance}
          isLoading={passwordPromptLoading}
          error={passwordPromptError}
          onClose={handlePasswordPromptClose}
          onSubmit={(password) =>
            connectInstance({
              instanceId: passwordPromptInstance.id,
              password,
              fromPrompt: true,
            })
          }
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
