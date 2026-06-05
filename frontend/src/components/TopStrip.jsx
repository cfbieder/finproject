/**
 * TopStrip — CR026 utility bar shown above page content in the sidebar layout.
 * Breadcrumb trail (left) + a ⌘K search pill and utility actions (right):
 * Help, Install (PWA), theme toggle, version/env badge.
 */
import Breadcrumbs from "./Breadcrumbs";
import useInstallPrompt from "../hooks/useInstallPrompt";
import useTheme from "../hooks/useTheme";
import { Download, Moon, Sun, Search, HelpCircle } from "lucide-react";
import "./TopStrip.css";

const isDev = import.meta.env.DEV || import.meta.env.VITE_APP_MODE === "dev";
const version = import.meta.env.VITE_APP_VERSION || "2.0.0";

export default function TopStrip({ onOpenPalette, onOpenHelp }) {
  const { canInstall, install } = useInstallPrompt();
  const { theme, toggle } = useTheme();
  const isDark = theme === "dark";

  return (
    <header className="topstrip">
      <div className="topstrip__crumbs">
        <Breadcrumbs />
      </div>
      <div className="topstrip__actions">
        <button
          type="button"
          className="topstrip__cmd"
          onClick={onOpenPalette}
          aria-label="Open command palette"
        >
          <Search size={14} />
          <span className="topstrip__cmd-label">Search or jump to…</span>
          <kbd className="topstrip__kbd">⌘K</kbd>
        </button>
        <button
          type="button"
          className="topstrip__tool"
          onClick={onOpenHelp}
          aria-label="Open help"
          title="Help"
        >
          <HelpCircle size={18} />
        </button>
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
        <button
          type="button"
          className="topstrip__tool"
          onClick={toggle}
          aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
          title={isDark ? "Light theme" : "Dark theme"}
        >
          {isDark ? <Sun size={18} /> : <Moon size={18} />}
        </button>
        <span className={`topstrip__badge${isDev ? " topstrip__badge--dev" : ""}`}>
          v{version}
          {isDev ? " DEV" : ""}
        </span>
      </div>
    </header>
  );
}
