/**
 * useTheme — CR026 P2 light/dark theme store (no provider needed).
 *
 * Applies `data-theme` to <html> and persists the choice. Defaults to LIGHT
 * (we ignore the OS dark preference for now) because page CSS is still being
 * migrated off hardcoded hex — forcing dark on unmigrated pages would look
 * broken. Once P0 token-hardening is complete, switch getInitial() to honor
 * `prefers-color-scheme`.
 *
 * Module-level store + useSyncExternalStore keeps multiple toggles (sidebar
 * footer + top strip) in sync without a context.
 */
import { useSyncExternalStore } from "react";

const KEY = "theme";

function getInitial() {
  if (typeof localStorage !== "undefined") {
    const saved = localStorage.getItem(KEY);
    if (saved === "light" || saved === "dark") return saved;
  }
  return "light"; // default light until P0 token migration completes
}

let current = getInitial();
const listeners = new Set();

function apply(theme) {
  if (typeof document !== "undefined") {
    document.documentElement.setAttribute("data-theme", theme);
  }
}

// Apply as soon as this module is first imported (Layout/Sidebar render path).
apply(current);

export function setTheme(theme) {
  if (theme !== "light" && theme !== "dark") return;
  current = theme;
  if (typeof localStorage !== "undefined") localStorage.setItem(KEY, theme);
  apply(theme);
  listeners.forEach((l) => l());
}

export function toggleTheme() {
  setTheme(current === "dark" ? "light" : "dark");
}

function subscribe(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export default function useTheme() {
  const theme = useSyncExternalStore(
    subscribe,
    () => current,
    () => current
  );
  return { theme, setTheme, toggle: toggleTheme };
}
