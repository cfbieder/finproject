import { CheckCircle, AlertCircle, AlertTriangle, Info, X } from "lucide-react";
import "./Toast.css";

const ICONS = {
  success: CheckCircle,
  error: AlertCircle,
  warning: AlertTriangle,
  info: Info,
};

export default function Toast({ message, type = "info", action = null, onHold, onRelease, onClose }) {
  const Icon = ICONS[type] || ICONS.info;

  return (
    <div
      className={`toast toast--${type}`}
      role="alert"
      aria-live="polite"
      onMouseEnter={onHold}
      onMouseLeave={onRelease}
      onFocus={onHold}
      onBlur={onRelease}
    >
      <Icon size={18} strokeWidth={2} className="toast__icon" />
      <span className="toast__message">{message}</span>
      {action && (
        <button
          type="button"
          className="btn btn--sm btn--outline"
          onClick={() => { onClose(); action.onClick(); }}
        >
          {action.label}
        </button>
      )}
      <button
        type="button"
        className="toast__close"
        onClick={onClose}
        aria-label="Dismiss"
      >
        <X size={14} strokeWidth={2.5} />
      </button>
    </div>
  );
}
