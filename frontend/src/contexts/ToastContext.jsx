import { createContext, useCallback, useContext, useRef, useState } from "react";
import Toast from "../components/Toast";

const ToastContext = createContext(null);

let toastId = 0;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const timers = useRef(new Map());

  const removeToast = useCallback((id) => {
    clearTimeout(timers.current.get(id));
    timers.current.delete(id);
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const startTimer = useCallback((id, duration) => {
    clearTimeout(timers.current.get(id));
    if (duration > 0) timers.current.set(id, setTimeout(() => removeToast(id), duration));
  }, [removeToast]);

  // `action` = { label, onClick } puts one button on the toast (e.g. Undo); the
  // toast closes when it is clicked. An action toast is never evicted by the
  // three-toast cap (a review session produces plain toasts steadily), and its
  // timer pauses while it is hovered or focused — see onHold/onRelease.
  const addToast = useCallback((message, type = "info", duration = 5000, action = null) => {
    const id = ++toastId;
    setToasts((prev) => {
      const plain = prev.filter((t) => !t.action);
      const evict = new Set(plain.slice(0, Math.max(0, plain.length - 2)).map((t) => t.id));
      return [...prev.filter((t) => !evict.has(t.id)), { id, message, type, duration, action }];
    });
    startTimer(id, duration);
    return id;
  }, [startTimer]);

  const showSuccess = useCallback(
    (message) => addToast(message, "success"),
    [addToast]
  );

  const showError = useCallback(
    (message) => addToast(message, "error", 8000),
    [addToast]
  );

  const showWarning = useCallback(
    (message) => addToast(message, "warning"),
    [addToast]
  );

  const showInfo = useCallback(
    (message) => addToast(message, "info"),
    [addToast]
  );

  // A success that can be taken back. Longer than a plain success: the owner
  // has to read it, notice the mistake, and reach the button.
  const showUndoable = useCallback(
    (message, onUndo) => addToast(message, "success", 12000, { label: "Undo", onClick: onUndo }),
    [addToast]
  );

  return (
    <ToastContext.Provider
      value={{ addToast, showSuccess, showError, showWarning, showInfo, showUndoable }}
    >
      {children}
      <div className="toast-container" role="region" aria-label="Notifications">
        {toasts.map((toast) => (
          <Toast
            key={toast.id}
            message={toast.message}
            type={toast.type}
            action={toast.action}
            onHold={toast.action ? () => clearTimeout(timers.current.get(toast.id)) : undefined}
            onRelease={toast.action ? () => startTimer(toast.id, toast.duration) : undefined}
            onClose={() => removeToast(toast.id)}
          />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used within a ToastProvider");
  }
  return context;
}
