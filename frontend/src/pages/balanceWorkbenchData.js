/** CR105 S3 — data helpers for BalanceWorkbench (kept out of the component file for fast refresh). */
import { describePeriod } from "../contexts/headerPeriod.js";

const SEP = " / ";

/** The 12 as-of dates ending at the header month (current month = today). */
export function trailingDates(year, month, count = 12) {
  const out = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    const d = new Date(year, month - 1 - i, 1);
    out.push(describePeriod(d.getFullYear(), d.getMonth() + 1).asOf);
  }
  return out;
}

/** path → totalUSD for every node of one report. */
export function valuesByPath(report) {
  const map = new Map();
  const walk = (nodes, prefix) => {
    for (const n of nodes || []) {
      const key = prefix ? prefix + SEP + n.name : n.name;
      map.set(key, Number(n.totalUSD) || 0);
      walk(n.children, key);
    }
  };
  walk(report, "");
  return map;
}

