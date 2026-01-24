import type { ComponentChildren } from "preact";
import { createContext } from "preact";
import { useCallback, useContext, useState } from "preact/hooks";

export type ToastType = "success" | "error" | "warning";

export interface Toast {
  type: ToastType;
  message: string;
  duration?: number;
}

interface ToastContextValue {
  showToast: (toast: Toast) => void;
}

const ToastContext = createContext<ToastContextValue | undefined>(undefined);

export function ToastProvider({ children }: { children: ComponentChildren }) {
  const [toast, setToast] = useState<Toast | null>(null);
  const [timeoutId, setTimeoutId] = useState<number | null>(null);

  const showToast = useCallback(
    (newToast: Toast) => {
      // Clear existing timeout if any
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
      }

      setToast(newToast);

      // Auto-dismiss after duration (default 3000ms)
      const duration = newToast.duration || 3000;
      const id = window.setTimeout(() => {
        setToast(null);
        setTimeoutId(null);
      }, duration);

      setTimeoutId(id);
    },
    [timeoutId],
  );

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      {toast && <div class={`toast ${toast.type}`}>{toast.message}</div>}
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used within ToastProvider");
  }
  return context;
}
