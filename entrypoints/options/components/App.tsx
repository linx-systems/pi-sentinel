import { useState } from "preact/hooks";
import { InstanceList } from "./InstanceList";
import { CheckIcon, ErrorIcon, InfoIcon } from "~/utils/icons";

export function App() {
  const [message, setMessage] = useState<{
    type: "success" | "error" | "info";
    text: string;
  } | null>(null);

  const handleMessage = (msg: {
    type: "success" | "error" | "info";
    text: string;
  }) => {
    setMessage(msg);
    // Auto-clear success and info messages after 5 seconds
    if (msg.type !== "error") {
      setTimeout(() => setMessage(null), 5000);
    }
  };

  return (
    <div>
      <header class="header">
        <h1>
          <img src="../icons/icon-48.svg" alt="" class="logo" />
          PiSentinel Settings
        </h1>
        <p class="subtitle">Manage your Pi-hole instances</p>
      </header>

      {message && (
        <div class={`status-message ${message.type}`}>
          {message.type === "success" && <CheckIcon />}
          {message.type === "error" && <ErrorIcon />}
          {message.type === "info" && <InfoIcon />}
          {message.text}
          <button
            class="message-dismiss"
            onClick={() => setMessage(null)}
            title="Dismiss"
          >
            ×
          </button>
        </div>
      )}

      <InstanceList onMessage={handleMessage} />

      <footer class="footer">
        <p>
          PiSentinel v0.0.1 |{" "}
          <a
            href="https://github.com/pisentinel"
            target="_blank"
            rel="noopener"
          >
            GitHub
          </a>
        </p>
      </footer>
    </div>
  );
}
