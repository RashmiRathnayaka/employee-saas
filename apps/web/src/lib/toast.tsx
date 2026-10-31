import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { cn } from "./cn";

type ToastVariant = "success" | "error";
type Toast = { id: number; variant: ToastVariant; message: string };

type ToastApi = {
  success: (message: string) => void;
  error: (message: string) => void;
};

const ToastContext = createContext<ToastApi | null>(null);

const AUTO_DISMISS_MS = 5000;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(0);

  const remove = useCallback((id: number) => {
    setToasts((current) => current.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (variant: ToastVariant, message: string) => {
      const id = nextId.current++;
      setToasts((current) => [...current, { id, variant, message }]);
      setTimeout(() => remove(id), AUTO_DISMISS_MS);
    },
    [remove],
  );

  const api: ToastApi = {
    success: (message) => push("success", message),
    error: (message) => push("error", message),
  };

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2" role="region" aria-live="polite">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            role="status"
            className={cn(
              "min-w-[260px] max-w-sm rounded-md px-4 py-3 text-sm shadow-lg",
              toast.variant === "success" ? "bg-emerald-600 text-white" : "bg-red-600 text-white",
            )}
          >
            <div className="flex items-start justify-between gap-3">
              <span>{toast.message}</span>
              <button
                type="button"
                onClick={() => remove(toast.id)}
                className="opacity-80 hover:opacity-100"
                aria-label="Dismiss"
              >
                &times;
              </button>
            </div>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast must be used within a ToastProvider");
  }
  return ctx;
}
