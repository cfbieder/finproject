import { useEffect, useState } from "react";
import { useRegisterSW } from "virtual:pwa-register/react";
import { RefreshCw } from "lucide-react";
import "./PWAUpdatePrompt.css";

export default function PWAUpdatePrompt() {
  const [showPrompt, setShowPrompt] = useState(false);

  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(swUrl, registration) {
      // Check for updates every 60 seconds
      if (registration) {
        setInterval(() => {
          registration.update();
        }, 60 * 1000);
      }
    },
    onRegisterError(error) {
      console.error("SW registration error:", error);
    },
  });

  useEffect(() => {
    if (needRefresh) setShowPrompt(true);
  }, [needRefresh]);

  if (!showPrompt) return null;

  return (
    <div className="pwa-update-toast">
      <div className="pwa-update-toast__content">
        <RefreshCw size={18} className="pwa-update-toast__icon" />
        <span className="pwa-update-toast__text">
          A new version is available
        </span>
      </div>
      <div className="pwa-update-toast__actions">
        <button
          className="pwa-update-toast__btn pwa-update-toast__btn--update"
          onClick={() => updateServiceWorker(true)}
        >
          Update
        </button>
        <button
          className="pwa-update-toast__btn pwa-update-toast__btn--dismiss"
          onClick={() => setShowPrompt(false)}
        >
          Later
        </button>
      </div>
    </div>
  );
}
