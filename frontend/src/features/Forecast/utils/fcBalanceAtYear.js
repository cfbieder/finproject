/**
 * One scenario's FORECAST balance sheet at the end of one year — the column the Forecast Review
 * shows for that year, as a single lookup (Balances → Forecast tab).
 *
 * Two cases, because the Review computes them differently:
 *
 * - a forecast year (`year >= PeriodStart`) is `buildScenarioMatrix`'s column, unchanged;
 * - the BASE year (`PeriodStart − 1`, the budget year — "this year" for `2026 Base`) is not in that
 *   matrix at all. The Review shows it from the engine's base-year balance entries, with Bank
 *   Accounts = last actual year-end balance + base-year net cash flow (budget P&L + engine
 *   transfers). That recurrence is the same seed `buildScenarioMatrix` starts its running balance
 *   from, so the two cases agree where they meet.
 *
 * Any other year (before the base year, or past the horizon) has no forecast → `null`.
 *
 * @returns {{year, balance: Map<string, number|null>, totalAssets, totalLiabilities, netAssets}|null}
 */
import { aggregateEntries, buildScenarioMatrix } from "./fcCompareUtils.js";

const toNum = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export function buildForecastBalanceForYear({
  entries,
  years,
  periodStart,
  baseYearValues,
  lastActualBalance,
  cashAccountMap,
  balanceAccountMap,
  balanceRows,
  year,
}) {
  const start = Number(periodStart);
  const target = Number(year);
  if (!Number.isFinite(start) || !Number.isFinite(target)) return null;

  if (target >= start) {
    const m = buildScenarioMatrix({
      entries,
      years,
      periodStart,
      baseYearValues,
      lastActualBalance,
      cashAccountMap,
      balanceAccountMap,
      balanceRows,
    });
    const i = m.years.indexOf(target);
    if (i === -1) return null;
    const balance = new Map();
    for (const [label, values] of m.balance) balance.set(label, values[i] ?? null);
    return {
      year: target,
      balance,
      totalAssets: m.totalAssets[i],
      totalLiabilities: m.totalLiabilities[i],
      netAssets: m.netAssets[i],
    };
  }

  if (target !== start - 1) return null;

  // ── Base year — Review's `balanceDisplayValues` column for PeriodStart − 1 ──
  const level1Labels = new Set(balanceRows.filter((r) => r.level === 1).map((r) => r.label));
  const level2Labels = new Set(balanceRows.filter((r) => r.level === 2).map((r) => r.label));
  const maps = aggregateEntries(
    entries,
    cashAccountMap,
    balanceAccountMap,
    level1Labels,
    level2Labels
  );

  const bankLabels = new Set(
    Array.from(balanceAccountMap.entries())
      .filter(([, mapping]) => mapping?.level2 === "Bank Accounts")
      .map(([label]) => label)
  );
  bankLabels.add("Bank Accounts");

  let plTotal = 0;
  if (baseYearValues && typeof baseYearValues === "object") {
    for (const amt of Object.values(baseYearValues)) plTotal += toNum(amt);
  }
  const transfers =
    maps.cash.byLabel.get("Transfers")?.get(target) ||
    maps.cash.level1Totals.get("Transfers")?.get(target) ||
    0;
  const baseYearNcf = plTotal + transfers;

  const seedFor = (label, level) => {
    if (!lastActualBalance) return 0;
    if (level === 1) return toNum(lastActualBalance.level1?.get(label));
    if (level === 2) return toNum(lastActualBalance.level2?.get(label));
    return toNum(lastActualBalance.level3?.get(label));
  };

  const balance = new Map();
  for (const { label, level } of balanceRows) {
    if (bankLabels.has(label)) {
      balance.set(label, seedFor(label, level) + baseYearNcf);
    } else if (level === 1) {
      balance.set(label, maps.balance.level1Totals.get(label)?.get(target) ?? null);
    } else {
      balance.set(label, maps.balance.byLabel.get(label)?.get(target) ?? null);
    }
  }

  const sumLevel2 = (level1Name) => {
    let total = 0;
    for (const row of balanceRows) {
      if (row.level !== 2) continue;
      if (balanceAccountMap.get(row.label)?.level1 !== level1Name) continue;
      total += toNum(balance.get(row.label));
    }
    return total;
  };
  const totalAssets = sumLevel2("Assets");
  const totalLiabilities = sumLevel2("Liabilities");

  return {
    year: target,
    balance,
    totalAssets,
    totalLiabilities,
    // CR064 P12 — liabilities are stored negative, so net assets is the SUM.
    netAssets: totalAssets + totalLiabilities,
  };
}
