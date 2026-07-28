import { useEffect, useMemo, useRef, useState } from "react";
import "./SearchableSelect.css";

/**
 * SearchableSelect — type-to-filter dropdown over a flat list of strings.
 *
 * The gap it fills: AccountPicker is the app's typeahead, but it is
 * account-shaped (it renders [BS]/[P&L]/[Transfer] tags and breadcrumbs from
 * `section`/`ancestorPath`), and CategorySelector takes the whole COA tree.
 * Neither fits a filter whose options are a plain list of names derived from
 * the rows actually loaded — which is the point of that filter.
 *
 * A native <input list> + <datalist> would have been smaller, but its popup is
 * drawn by the browser and ignores our tokens: light popup in dark mode.
 *
 * Props:
 *   value            selected string, or "" for the all/none option
 *   options          string[]
 *   onChange(value)  called with the chosen string, or "" when cleared
 *   allLabel         label for the ""-value option (default "All")
 *   placeholder, id, className
 */
export default function SearchableSelect({
  value = "",
  options = [],
  onChange,
  allLabel = "All",
  placeholder = "Search…",
  id,
  className = "",
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const containerRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDocDown = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocDown);
    return () => document.removeEventListener("mousedown", onDocDown);
  }, [open]);

  // The all/none entry is part of the list so it filters and keyboard-navigates
  // like any other row.
  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    const all = [{ value: "", label: allLabel }, ...options.map((o) => ({ value: o, label: o }))];
    if (!q) return all;
    return all.filter((i) => i.label.toLowerCase().includes(q));
  }, [options, query, allLabel]);

  // The highlight is reset by whatever changed the list (typing, opening) rather
  // than by an effect on [query, open] — that would be a set-state-in-effect, an
  // extra render pass for something the handlers already know.
  const openMenu = () => { setOpen(true); setActive(0); };

  const pick = (item) => {
    onChange?.(item.value);
    setOpen(false);
    setQuery("");
    inputRef.current?.blur();
  };

  const onKeyDown = (e) => {
    if (e.key === "Escape") { setOpen(false); setQuery(""); return; }
    if (!open && (e.key === "ArrowDown" || e.key === "Enter")) { openMenu(); return; }
    if (!open) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((i) => Math.min(i + 1, items.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); if (items[active]) pick(items[active]); }
  };

  const display = open ? query : (value || allLabel);

  return (
    <div className={`ssel ${className}`} ref={containerRef}>
      <input
        ref={inputRef}
        id={id}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={id ? `${id}-listbox` : undefined}
        autoComplete="off"
        className="ssel__input"
        placeholder={placeholder}
        value={display}
        onChange={(e) => { setQuery(e.target.value); openMenu(); }}
        onFocus={() => { setQuery(""); openMenu(); }}
        onKeyDown={onKeyDown}
      />
      {value && !open && (
        <button type="button" className="ssel__clear" onClick={() => onChange?.("")} title="Clear">
          ×
        </button>
      )}
      <span className="ssel__caret" aria-hidden="true">▾</span>
      {open && (
        <div className="ssel__menu" role="listbox" id={id ? `${id}-listbox` : undefined}>
          {items.length === 0 ? (
            <div className="ssel__empty">No matches for &ldquo;{query}&rdquo;</div>
          ) : (
            items.map((item, i) => (
              <button
                key={item.value || "__all__"}
                type="button"
                role="option"
                aria-selected={item.value === value}
                className={
                  "ssel__option"
                  + (item.value === value ? " is-selected" : "")
                  + (i === active ? " is-active" : "")
                }
                onMouseEnter={() => setActive(i)}
                onClick={() => pick(item)}
              >
                {item.label}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
