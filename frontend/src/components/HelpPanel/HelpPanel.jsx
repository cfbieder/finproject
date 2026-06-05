/**
 * HelpPanel — CR026 P3 slide-in help drawer (top-strip "?").
 *
 * Two sections: keyboard shortcuts and a glossary of the app's non-obvious
 * finance terms (the jargon a new/commercial user wouldn't know). Closes on
 * Esc / scrim click. Mounted in the sidebar layout; prod-dormant.
 */
import { useEffect } from "react";
import { X, Command, Moon, PanelLeftClose, HelpCircle } from "lucide-react";
import "./HelpPanel.css";

const SHORTCUTS = [
  { keys: ["⌘", "K"], label: "Open the command palette (jump to any page or action)" },
  { keys: ["↑", "↓"], label: "Move through palette results; Enter opens" },
  { keys: ["Esc"], label: "Close the palette, this panel, or any dialog" },
];

const GLOSSARY = [
  ["FC Lines", "Forecast income/expense lines — the mapping layer between budget categories and the forecast engine. Each budget category is assigned to exactly one FC Line."],
  ["Neutralize", "Create an offsetting entry for a brokerage security trade (cash-for-shares), so the trade is net-worth-neutral and not counted as income/expense."],
  ["Calibration", "Back-calculating an account's opening balance from a known recent closing balance so the balance sheet ties out (opening_balance + Σ transactions)."],
  ["Cash Sweep", "Auto-balancing a forecast by moving surplus/shortfall cash into (or out of) a designated module within a target band."],
  ["Transfer matching", "Pairing the debit and credit sides of a money movement between your own accounts so it nets to zero and isn't double-counted."],
  ["Cutover / promote_from_date", "The date a bank feed takes over an account from PocketSmith — rows before it come from PS, rows on/after come from the feed (no double-count)."],
  ["Unrealized G/L", "Change in an asset's market value you still hold (not yet sold) — separated from operating cash flow in the Forecast Review bridge."],
];

export default function HelpPanel({ open, onClose }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="help-scrim" onMouseDown={onClose} role="presentation">
      <aside
        className="help-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Help"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="help-panel__head">
          <span className="help-panel__title"><HelpCircle size={18} /> Help</span>
          <button type="button" className="help-panel__close" onClick={onClose} aria-label="Close help">
            <X size={18} />
          </button>
        </header>

        <div className="help-panel__body">
          <section className="help-panel__section">
            <h3 className="help-panel__h">Keyboard shortcuts</h3>
            <ul className="help-panel__shortcuts">
              {SHORTCUTS.map((s) => (
                <li key={s.label}>
                  <span className="help-panel__keys">
                    {s.keys.map((k) => (
                      <kbd key={k} className="help-panel__kbd">{k}</kbd>
                    ))}
                  </span>
                  <span>{s.label}</span>
                </li>
              ))}
            </ul>
          </section>

          <section className="help-panel__section">
            <h3 className="help-panel__h">Getting around</h3>
            <p className="help-panel__p">
              Use the <Command size={13} /> command palette (<kbd className="help-panel__kbd">⌘K</kbd>) to
              jump straight to any page or run a quick action. Toggle <Moon size={13} /> light/dark and
              collapse the sidebar (<PanelLeftClose size={13} />) from its footer.
            </p>
          </section>

          <section className="help-panel__section">
            <h3 className="help-panel__h">Glossary</h3>
            <dl className="help-panel__glossary">
              {GLOSSARY.map(([term, def]) => (
                <div key={term} className="help-panel__term">
                  <dt>{term}</dt>
                  <dd>{def}</dd>
                </div>
              ))}
            </dl>
          </section>
        </div>
      </aside>
    </div>
  );
}
