/**
 * AccountPicker — typeahead combobox over the chart of accounts. Replaces a
 * native <select> for account-mapping panels (type-to-filter, breadcrumb
 * labels, section tags, 100-result cap). Extracted from QuickenImport (CR019)
 * so CR022's bank-feed mapping panel can reuse it.
 *
 * Props:
 *   value            selected account id (or "" / null for none)
 *   options          rows from buildHierarchyOptions() (carry ancestorPath,
 *                    searchHaystack, section, is_transfer)
 *   onChange(id)     called with the chosen id, or "" when cleared
 *   onCreateRequest  optional; when set, renders a "+ Create new…" footer that
 *                    bubbles up the typed query
 *   placeholder, autoFocus
 */

import { useEffect, useMemo, useRef, useState } from "react";
import "./AccountPicker.css";

export function formatAccountLabel(a) {
  // Transfer accounts live under "Transfers" with section=profit_loss; label them
  // [Transfer] (not [P&L]) so they're not mistaken for income/expense accounts.
  const prefix = a.is_transfer
    ? "[Transfer]"
    : `[${a.section === "balance_sheet" ? "BS" : "P&L"}]`;
  const breadcrumb = a.ancestorPath && a.ancestorPath.length > 0
    ? `${a.ancestorPath.join(" / ")} / `
    : "";
  return `${prefix} ${breadcrumb}${a.name}`;
}

// Walk parent_id chain to enrich each row with its full breadcrumb path
// (ancestor names from root, excluding the leaf itself) and a sortable key.
// Also flags whether a row is a leaf (no other row has it as parent_id) so the
// mapping picker can restrict to leaves only — transactions must land on a
// terminal asset/liability/income/expense, not an organizational container.
export function buildHierarchyOptions(rows) {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const parentIds = new Set(rows.map((r) => r.parent_id).filter(Boolean));
  const cache = new Map();
  const ancestorPath = (id) => {
    if (cache.has(id)) return cache.get(id);
    const r = byId.get(id);
    if (!r) return [];
    const path = r.parent_id ? [...ancestorPath(r.parent_id), byId.get(r.parent_id)?.name].filter(Boolean) : [];
    cache.set(id, path);
    return path;
  };
  return rows
    .map((r) => {
      const ap = ancestorPath(r.id);
      return {
        ...r,
        ancestorPath: ap,
        isLeaf: !parentIds.has(r.id),
        sortKey: [...ap, r.name].join("/").toLowerCase(),
        searchHaystack: [...ap, r.name].join(" ").toLowerCase(),
      };
    })
    .sort((a, b) => a.sortKey.localeCompare(b.sortKey));
}

export function AccountPicker({ value, options, onChange, onCreateRequest, placeholder, autoFocus }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  useEffect(() => {
    if (autoFocus && inputRef.current) inputRef.current.focus();
  }, [autoFocus]);

  const selected = useMemo(() => options.find((a) => a.id === value), [options, value]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((a) => {
      const haystack = a.searchHaystack || a.name.toLowerCase();
      return haystack.includes(q);
    });
  }, [options, query]);

  const displayValue = open
    ? query
    : selected
      ? formatAccountLabel(selected)
      : "";

  return (
    <div className="account-picker" ref={containerRef}>
      <input
        ref={inputRef}
        type="text"
        className="account-picker-input"
        placeholder={placeholder || "Search COA…"}
        value={displayValue}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => {
          setQuery("");
          setOpen(true);
        }}
      />
      {selected && !open && (
        <button
          type="button"
          className="account-picker-clear"
          onClick={() => onChange("")}
          title="Clear selection"
        >
          ×
        </button>
      )}
      {open && (
        <div className="account-picker-dropdown">
          {filtered.length === 0 ? (
            <div className="account-picker-empty">No matches for "{query}"</div>
          ) : (
            filtered.slice(0, 100).map((a) => (
              <button
                key={a.id}
                type="button"
                className={`account-picker-option ${a.id === value ? "is-selected" : ""}`}
                onClick={() => {
                  onChange(a.id);
                  setOpen(false);
                  setQuery("");
                }}
              >
                <span className="account-picker-section">
                  [{a.is_transfer ? "Transfer" : a.section === "balance_sheet" ? "BS" : "P&L"}]
                </span>{" "}
                {a.ancestorPath && a.ancestorPath.length > 0 && (
                  <span className="account-picker-breadcrumb">
                    {a.ancestorPath.join(" / ")} /{" "}
                  </span>
                )}
                <span className="account-picker-leaf">{a.name}</span>
              </button>
            ))
          )}
          {filtered.length > 100 && (
            <div className="account-picker-truncated">
              Showing 100 of {filtered.length} — refine your search.
            </div>
          )}
          {onCreateRequest && (
            <button
              type="button"
              className="account-picker-create"
              onClick={() => {
                setOpen(false);
                onCreateRequest(query.trim());
                setQuery("");
              }}
            >
              + Create new COA entry{query.trim() ? ` "${query.trim()}"` : ""}…
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default AccountPicker;
