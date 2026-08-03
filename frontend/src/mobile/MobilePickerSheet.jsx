import { useEffect, useMemo, useRef, useState } from "react";
import { Check, X } from "lucide-react";

/**
 * Full-screen searchable picker for a phone.
 *
 * Grew out of MobileCategoryPicker (CR026), which was single-select and knew
 * about the P&L tree. CR068 needs the same sheet for accounts and for
 * multi-select category filtering, so the tree-walking moved out to the callers
 * and this became a list renderer over `sections`.
 *
 * Two modes, deliberately distinct:
 *   - single (default): tapping an item calls onSelect and the caller closes.
 *     This is the Refresh-Feeds categorize flow — one tap, done.
 *   - multi: taps toggle, and nothing is emitted until Apply. A filter that
 *     refetched on every tap would fire a request per category.
 */
export default function MobilePickerSheet({
  open,
  sections = [],
  recents = [],
  multi = false,
  selected = [],
  current,
  onSelect,
  onApply,
  onClose,
  title = "Choose",
  searchPlaceholder = "Search…",
  emptyText = "No matches",
  recentsLabel = "Recent",
}) {
  const [search, setSearch] = useState("");
  const [checked, setChecked] = useState(() => new Set(selected));
  const inputRef = useRef(null);

  // Reset search + seed the checked set from the caller each time it opens, so
  // a cancelled sheet never leaks its edits into the next open.
  useEffect(() => {
    if (!open) return;
    setSearch("");
    setChecked(new Set(selected));
    const t = setTimeout(() => {
      inputRef.current?.focus();
    }, 50);
    return () => clearTimeout(t);
    // `selected` is read only at open time on purpose — see above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Lock body scroll while the sheet is open
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

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return { sections, recents };
    const filterList = (items) =>
      items.filter((name) => name.toLowerCase().includes(q));
    return {
      sections: sections
        .map((s) => ({ ...s, items: filterList(s.items ?? []) }))
        .filter((s) => s.items.length > 0),
      recents: filterList(recents),
    };
  }, [search, sections, recents]);

  if (!open) return null;

  const totalMatches =
    filtered.recents.length +
    filtered.sections.reduce((sum, s) => sum + s.items.length, 0);

  const toggle = (name) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const handlePick = (name) => {
    if (multi) toggle(name);
    else onSelect?.(name);
  };

  // Select-all acts on what is VISIBLE — with a search active that is the
  // filtered subset, which is what "select all" reads as on screen.
  const toggleSection = (items) => {
    const allOn = items.every((name) => checked.has(name));
    setChecked((prev) => {
      const next = new Set(prev);
      for (const name of items) {
        if (allOn) next.delete(name);
        else next.add(name);
      }
      return next;
    });
  };

  const renderItem = (name, keyPrefix) => {
    const isChecked = multi ? checked.has(name) : name === current;
    return (
      <button
        key={`${keyPrefix}-${name}`}
        type="button"
        className={
          "m-picker__item" + (isChecked ? " m-picker__item--current" : "")
        }
        aria-pressed={multi ? isChecked : undefined}
        onClick={() => handlePick(name)}
      >
        {name}
        {multi && isChecked && (
          <span className="m-picker__check">
            <Check size={17} strokeWidth={3} />
          </span>
        )}
      </button>
    );
  };

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
          placeholder={searchPlaceholder}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
        />
      </div>
      <div className="m-picker__list">
        {totalMatches === 0 && <div className="m-picker__empty">{emptyText}</div>}

        {filtered.recents.length > 0 && (
          <>
            <div className="m-picker__group-h">{recentsLabel}</div>
            {filtered.recents.map((name) => renderItem(name, "r"))}
          </>
        )}

        {filtered.sections.map((section) => (
          <div key={section.name}>
            <div className="m-picker__group-h">
              {section.name}
              {multi && section.items.length > 1 && (
                <button
                  type="button"
                  className="m-picker__group-all"
                  onClick={() => toggleSection(section.items)}
                >
                  {section.items.every((name) => checked.has(name))
                    ? "None"
                    : "All"}
                </button>
              )}
            </div>
            {section.items.map((name) => renderItem(name, section.name))}
          </div>
        ))}
      </div>

      {multi && (
        <div className="m-sheet__footer">
          <button
            type="button"
            className="m-btn"
            onClick={() => setChecked(new Set())}
            disabled={checked.size === 0}
          >
            Clear
          </button>
          <button
            type="button"
            className="m-btn m-btn--primary"
            onClick={() => onApply?.([...checked])}
          >
            {checked.size > 0 ? `Apply (${checked.size})` : "Apply"}
          </button>
        </div>
      )}
    </div>
  );
}
