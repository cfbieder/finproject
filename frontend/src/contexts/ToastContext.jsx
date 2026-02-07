import { createContext, useCallback, useContext, useState } from "react";
import Toast from "../components/Toast";

const ToastContext = createContext(null);

let toastId = 0;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const removeToast = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const addToast = useCallback((message, type = "info", duration = 5000) => {
    const id = ++toastId;
    setToasts((prev) => [...prev.slice(-2), { id, message, type, duration }]);
    if (duration > 0) {
      setTimeout(() => removeToast(id), duration);
    }
    return id;
  }, [removeToast]);

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

  return (
    <ToastContext.Provider
      value={{ addToast, showSuccess, showError, showWarning, showInfo }}
    >
      {children}
      <div className="toast-container" role="region" aria-label="Notifications">
        {toasts.map((toast) => (
          <Toast
            key={toast.id}
            message={toast.message}
            type={toast.type}
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
