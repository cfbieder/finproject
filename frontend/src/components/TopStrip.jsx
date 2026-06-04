/**
 * TopStrip — CR026 P1 utility bar shown above page content in the sidebar
 * layout. Holds the breadcrumb trail (left) and utility actions (right):
 * Install (PWA) + version/env badge. The ⌘K command palette and theme toggle
 * slots land here in later phases (P3 / P2) — omitted now to avoid dead UI.
 */
import Breadcrumbs from "./Breadcrumbs";
import useInstallPrompt from "../hooks/useInstallPrompt";
import { Download } from "lucide-react";
import "./TopStrip.css";

const isDev = import.meta.env.DEV || import.meta.env.VITE_APP_MODE === "dev";
const version = import.meta.env.VITE_APP_VERSION || "2.0.0";

export default function TopStrip() {
  const { canInstall, install } = useInstallPrompt();

  return (
    <header className="topstrip">
      <div className="topstrip__crumbs">
        <Breadcrumbs />
      </div>
      <div className="topstrip__actions">
        {canInstall && (
          <button
            type="button"
            className="btn btn--outline btn--sm"
            onClick={install}
            aria-label="Install app"
          >
            <Download size={15} />
            <span>Install</span>
          </button>
        )}
        <span className={`topstrip__badge${isDev ? " topstrip__badge--dev" : ""}`}>
          v{version}
          {isDev ? " DEV" : ""}
        </span>
      </div>
    </header>
  );
}
