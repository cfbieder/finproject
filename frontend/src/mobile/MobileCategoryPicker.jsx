import { useMemo } from "react";
import MobilePickerSheet from "./MobilePickerSheet.jsx";
import { collectGroupedLeaves } from "./treeSections.js";

const RECENT_KEY = "mobileCategoryRecents";
const RECENT_MAX = 5;

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

/**
 * Single-select category picker — the Refresh-Feeds categorize flow.
 *
 * Thin wrapper over MobilePickerSheet (CR068 P1); the sheet owns the search,
 * scroll lock, focus and Escape handling. Props are unchanged from the original
 * component, which is what MobileRefreshFeeds passes.
 */
export default function MobileCategoryPicker({
  open,
  plTree,
  currentCategory,
  onSelect,
  onClose,
  title = "Choose category",
}) {
  const sections = useMemo(() => collectGroupedLeaves(plTree), [plTree]);
  const recents = useMemo(() => (open ? getRecentCategories() : []), [open]);

  return (
    <MobilePickerSheet
      open={open}
      sections={sections}
      recents={recents}
      current={currentCategory}
      onSelect={onSelect}
      onClose={onClose}
      title={title}
      searchPlaceholder="Search categories…"
      emptyText="No matching categories"
    />
  );
}
