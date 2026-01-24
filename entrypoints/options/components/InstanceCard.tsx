import type { PiHoleInstance, InstanceState } from "~/utils/types";

interface InstanceCardProps {
  instance: PiHoleInstance;
  state: InstanceState | null;
  isActive: boolean;
  onEdit: (instance: PiHoleInstance) => void;
  onDelete: (instanceId: string) => void;
  onConnect: (instanceId: string) => void;
  onDisconnect: (instanceId: string) => void;
  onSetActive: (instanceId: string) => void;
}

export function InstanceCard({
  instance,
  state,
  isActive,
  onEdit,
  onDelete,
  onConnect,
  onDisconnect,
  onSetActive,
}: InstanceCardProps) {
  const isConnected = state?.isConnected ?? false;
  const displayName = instance.name || extractHostname(instance.piholeUrl);

  return (
    <div class={`instance-card ${isActive ? "active" : ""}`}>
      <div class="instance-card-header">
        <div class="instance-info">
          <h3 class="instance-name">{displayName}</h3>
          <span class="instance-url">{instance.piholeUrl}</span>
        </div>
        <div class="instance-status">
          {isActive && <span class="active-indicator">Active</span>}
          <span
            class={`status-badge ${isConnected ? "connected" : "disconnected"}`}
          >
            <span class="status-dot" />
            {isConnected ? "Connected" : "Disconnected"}
          </span>
        </div>
      </div>

      {state?.connectionError && (
        <div class="instance-error">
          <ErrorIcon />
          {state.connectionError}
        </div>
      )}

      {isConnected && state?.stats && (
        <div class="instance-stats">
          <div class="stat-item">
            <span class="stat-value">
              {formatNumber(state.stats.queries.total)}
            </span>
            <span class="stat-label">Queries</span>
          </div>
          <div class="stat-item">
            <span class="stat-value">
              {formatNumber(state.stats.queries.blocked)}
            </span>
            <span class="stat-label">Blocked</span>
          </div>
          <div class="stat-item">
            <span class="stat-value">
              {state.stats.queries.percent_blocked.toFixed(1)}%
            </span>
            <span class="stat-label">Block Rate</span>
          </div>
        </div>
      )}

      <div class="instance-card-actions">
        {isConnected ? (
          <button
            class="btn btn-small btn-secondary"
            onClick={() => onDisconnect(instance.id)}
          >
            Disconnect
          </button>
        ) : (
          <button
            class="btn btn-small btn-primary"
            onClick={() => onConnect(instance.id)}
          >
            Connect
          </button>
        )}

        {!isActive && (
          <button
            class="btn btn-small btn-secondary"
            onClick={() => onSetActive(instance.id)}
            title="Set as active Pi-hole"
          >
            Set Active
          </button>
        )}

        <button
          class="btn btn-small btn-secondary btn-icon"
          onClick={() => onEdit(instance)}
          title="Edit"
        >
          <EditIcon />
        </button>

        <button
          class="btn btn-small btn-danger btn-icon"
          onClick={() => onDelete(instance.id)}
          title="Delete"
        >
          <DeleteIcon />
        </button>
      </div>
    </div>
  );
}

function extractHostname(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.hostname;
  } catch {
    return url;
  }
}

function formatNumber(num: number): string {
  if (num >= 1000000) {
    return (num / 1000000).toFixed(1) + "M";
  }
  if (num >= 1000) {
    return (num / 1000).toFixed(1) + "K";
  }
  return num.toString();
}

function ErrorIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
    >
      <circle cx="12" cy="12" r="10" />
      <line x1="15" y1="9" x2="9" y2="15" />
      <line x1="9" y1="9" x2="15" y2="15" />
    </svg>
  );
}

function EditIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
    >
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  );
}

function DeleteIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
    >
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  );
}
