import { useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";

const RECENT_KEY = "mobileCategoryRecents";
const RECENT_MAX = 5;

// Walk a P&L tree (Income / Expense / Transfers) and collect leaves grouped
// by their top-level parent.
function collectGroupedLeaves(plTree) {
  const groups = [];
  if (!Array.isArray(plTree)) return groups;
  for (const top of plTree) {
    const leaves = [];
    const walk = (node) => {
      const children = Array.isArray(node.children) ? node.children : [];
      if (children.length === 0) {
        if (node.name) leaves.push(node.name);
      } else {
        for (const c of children) walk(c);
      }
    };
    walk(top);
    if (leaves.length > 0) {
      groups.push({ name: top.name, items: leaves.sort() });
    }
  }
  return groups;
}

export function getRecentCategories() {
  try {
    const raw = window.localStorage.getItem(RECENT_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.slice(0, RECENT_MAX) : [];
  } catch {
    return [];
  }
}

export function pushRecentCategory(name) {
  if (!name) return;
  try {
    const current = getRecentCategories().filter((n) => n !== name);
    current.unshift(name);
    window.localStorage.setItem(
      RECENT_KEY,
      JSON.stringify(current.slice(0, RECENT_MAX))
    );
  } catch {
    // ignore
  }
}

export default function MobileCategoryPicker({
  open,
  plTree,
  currentCategory,
  onSelect,
  onClose,
  title = "Choose category",
}) {
  const [search, setSearch] = useState("");
  const inputRef = useRef(null);

  // Reset search and focus the input each time the picker opens
  useEffect(() => {
    if (!open) return;
    setSearch("");
    const t = setTimeout(() => {
      inputRef.current?.focus();
    }, 50);
    return () => clearTimeout(t);
  }, [open]);

  // Lock body scroll while picker is open
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  // Close on Escape (helpful for desktop testing)
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const groups = useMemo(() => collectGroupedLeaves(plTree), [plTree]);
  const recents = useMemo(() => (open ? getRecentCategories() : []), [open]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) {
      return { groups, recents };
    }
    const filterList = (items) =>
      items.filter((name) => name.toLowerCase().includes(q));
    return {
      groups: groups
        .map((g) => ({ ...g, items: filterList(g.items) }))
        .filter((g) => g.items.length > 0),
      recents: filterList(recents),
    };
  }, [search, groups, recents]);

  if (!open) return null;

  const handlePick = (name) => {
    onSelect?.(name);
  };

  const totalMatches =
    filtered.recents.length +
    filtered.groups.reduce((sum, g) => sum + g.items.length, 0);

  return (
    <div className="m-picker" role="dialog" aria-modal="true" aria-label={title}>
      <div className="m-picker__head">
        <button
          type="button"
          className="m-picker__close"
          onClick={onClose}
          aria-label="Close"
        >
          <X size={22} />
        </button>
        <span className="m-picker__title">{title}</span>
      </div>
      <div className="m-picker__search-wrap">
        <input
          ref={inputRef}
          type="text"
          className="m-picker__search"
          placeholder="Search categories…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
        />
      </div>
      <div className="m-picker__list">
        {totalMatches === 0 && (
          <div className="m-picker__empty">No matching categories</div>
        )}

        {filtered.recents.length > 0 && (
          <>
            <div className="m-picker__group-h">Recent</div>
            {filtered.recents.map((name) => (
              <button
                key={`r-${name}`}
                type="button"
                className={
                  "m-picker__item" +
                  (name === currentCategory ? " m-picker__item--current" : "")
                }
                onClick={() => handlePick(name)}
              >
                {name}
              </button>
            ))}
          </>
        )}

        {filtered.groups.map((group) => (
          <div key={group.name}>
            <div className="m-picker__group-h">{group.name}</div>
            {group.items.map((name) => (
              <button
                key={`${group.name}-${name}`}
                type="button"
                className={
                  "m-picker__item" +
                  (name === currentCategory ? " m-picker__item--current" : "")
                }
                onClick={() => handlePick(name)}
              >
                {name}
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
