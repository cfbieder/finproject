/**
 * CommandPalette — CR026 P3 ⌘K/Ctrl-K fuzzy launcher.
 *
 * Driven by routes.jsx: every navigable route becomes a "Go to …" command,
 * plus a few quick actions (theme toggle, home). Substring-filtered, full
 * keyboard control (↑/↓ to move, Enter to run, Esc to close). Mounted in the
 * sidebar layout, which has been live in prod since v3.0.0 (CR026).
 *
 * Open/close state is owned by Layout; this component renders nothing when
 * `open` is false.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { routes } from "../../config/routes";
import { setTheme } from "../../hooks/useTheme";
import { Search, CornerDownLeft, Moon, Sun, Home } from "lucide-react";
import "./CommandPalette.css";

/** Build the static command list once (route nav + quick actions). */
function buildCommands(navigate) {
  const nav = routes
    .filter((r) => r.component && r.showInNav !== false)
    .map((r) => ({
      id: `nav:${r.path}`,
      label: r.label,
      hint: r.category || "Overview",
      group: "Navigate",
      Icon: r.icon,
      keywords: `${r.label} ${r.category || ""} ${r.description || ""}`.toLowerCase(),
      run: () => navigate(r.path),
    }));

  const actions = [
    {
      id: "act:home",
      label: "Go to Overview",
      hint: "Action",
      group: "Actions",
      Icon: Home,
      keywords: "home overview dashboard start",
      run: () => navigate("/"),
    },
    {
      id: "act:theme-dark",
      label: "Switch to dark theme",
      hint: "Action",
      group: "Actions",
      Icon: Moon,
      keywords: "dark theme mode night appearance",
      run: () => setTheme("dark"),
    },
    {
      id: "act:theme-light",
      label: "Switch to light theme",
      hint: "Action",
      group: "Actions",
      Icon: Sun,
      keywords: "light theme mode day appearance",
      run: () => setTheme("light"),
    },
  ];

  return [...actions, ...nav];
}

export default function CommandPalette({ open, onClose }) {
  const navigate = useNavigate();
  const commands = useMemo(() => buildCommands(navigate), [navigate]);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  // Reset query/selection each time it opens, and focus the input.
  useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
      // focus after paint
      const id = setTimeout(() => inputRef.current?.focus(), 20);
      return () => clearTimeout(id);
    }
  }, [open]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    const terms = q.split(/\s+/);
    return commands.filter((c) => terms.every((t) => c.keywords.includes(t)));
  }, [commands, query]);

  // Keep active index in range as results change.
  useEffect(() => {
    setActive((a) => Math.min(a, Math.max(0, results.length - 1)));
  }, [results.length]);

  // Scroll the active item into view.
  useEffect(() => {
    const el = listRef.current?.querySelector('[data-active="true"]');
    el?.scrollIntoView({ block: "nearest" });
  }, [active, results]);

  if (!open) return null;

  const runActive = () => {
    const cmd = results[active];
    if (cmd) {
      cmd.run();
      onClose();
    }
  };

  const onKeyDown = (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      runActive();
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <div className="cmdk-scrim" onMouseDown={onClose} role="presentation">
      <div
        className="cmdk"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <div className="cmdk__search">
          <Search size={18} className="cmdk__search-icon" />
          <input
            ref={inputRef}
            className="cmdk__input"
            placeholder="Search pages and actions…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <kbd className="cmdk__kbd">esc</kbd>
        </div>

        <div className="cmdk__list" ref={listRef}>
          {results.length === 0 && (
            <div className="cmdk__empty">No matches for “{query}”.</div>
          )}
          {results.map((cmd, i) => {
            const Icon = cmd.Icon;
            return (
              <button
                key={cmd.id}
                type="button"
                className={`cmdk__item${i === active ? " is-active" : ""}`}
                data-active={i === active}
                onMouseEnter={() => setActive(i)}
                onClick={runActive}
              >
                {Icon ? <Icon size={16} className="cmdk__item-icon" /> : <span className="cmdk__item-icon" />}
                <span className="cmdk__item-label">{cmd.label}</span>
                <span className="cmdk__item-hint">{cmd.hint}</span>
                {i === active && <CornerDownLeft size={14} className="cmdk__item-enter" />}
              </button>
            );
          })}
        </div>

        <div className="cmdk__footer">
          <span><kbd className="cmdk__kbd">↑</kbd><kbd className="cmdk__kbd">↓</kbd> navigate</span>
          <span><kbd className="cmdk__kbd">↵</kbd> open</span>
          <span><kbd className="cmdk__kbd">esc</kbd> close</span>
        </div>
      </div>
    </div>
  );
}
