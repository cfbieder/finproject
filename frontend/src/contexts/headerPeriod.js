/**
 * CR105 S2 — one period for every report (the Workbench header's month picker).
 * The provider is in HeaderPeriodContext.jsx (a component-only file for fast refresh).
 *
 * Only the Workbench layout mounts the provider. Outside it useHeaderPeriod()
 * returns null and pages keep their own defaults, so the classic layout is
 * unchanged.
 *
 * A page reads the period in two places:
 *   - its useState initialisers: `hp ? fromHeader(hp) : ownDefault`, so the
 *     first load already uses the header month (no load-then-reload);
 *   - useOnHeaderPeriodChange(cb): re-applies the month when the header changes.
 * The page's own controls stay live, as a local override until the next change.
 *
 * Kept in sessionStorage: a new visit starts on the current month again, so a
 * month picked last week never silently dates today's figures.
 */
import { createContext, useContext, useEffect, useRef, useState } from "react";

export const KEY = "wbPeriod";
export const HeaderPeriodContext = createContext(null);

export const pad = (n) => String(n).padStart(2, "0");

function todayParts() {
  const d = new Date();
  return { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() };
}

/** Everything a page needs to translate the header month into its own controls. */
export function describePeriod(year, month, today = todayParts()) {
  const last = new Date(year, month, 0).getDate();
  const mm = pad(month);
  const isCurrent = year === today.year && month === today.month;
  const monthEnd = `${year}-${mm}-${pad(last)}`;
  return {
    key: `${year}-${mm}`,
    year,
    month,
    mm,
    isCurrent,
    monthStart: `${year}-${mm}-01`,
    monthEnd,
    // An as-of date never lies in the future: the current month reads as of today.
    asOf: isCurrent ? `${year}-${mm}-${pad(today.day)}` : monthEnd,
    yearStart: `${year}-01-01`,
  };
}

export function readStored() {
  try {
    const m = /^(\d{4})-(\d{2})$/.exec(sessionStorage.getItem(KEY) || "");
    if (m) {
      const t = todayParts();
      const y = Number(m[1]);
      const mo = Number(m[2]);
      const inRange = y >= t.year - 5 && (y < t.year || (y === t.year && mo <= t.month));
      if (inRange) return { year: y, month: mo };
    }
  } catch {
    /* storage blocked */
  }
  const t = todayParts();
  return { year: t.year, month: t.month };
}

/** The header period, or null outside the Workbench layout. */
export function useHeaderPeriod() {
  return useContext(HeaderPeriodContext);
}

/**
 * Calls `cb(period)` each time the header month changes — not on mount (the
 * page's initialisers already read it). No-op outside the Workbench layout.
 */
export function useOnHeaderPeriodChange(cb) {
  const hp = useContext(HeaderPeriodContext);
  const key = hp?.key;
  const prev = useRef(key);
  const cbRef = useRef(cb);
  useEffect(() => {
    cbRef.current = cb;
  });
  useEffect(() => {
    if (!key || key === prev.current) return;
    prev.current = key;
    cbRef.current(hp);
  }, [key, hp]);
}

/**
 * For pages that load only on Generate: `apply(period)` sets the page's
 * controls, then `load()` runs on the NEXT render, once those values are state.
 * (Running it in the same effect pass would call the previous render's load,
 * which still closes over the old period.)
 */
export function useHeaderPeriodReload(apply, load) {
  const [tick, setTick] = useState(0);
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  });
  useOnHeaderPeriodChange((p) => {
    apply(p);
    setTick((t) => t + 1);
  });
  useEffect(() => {
    if (tick > 0) loadRef.current();
  }, [tick]);
}
