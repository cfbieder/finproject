/**
 * fcWarnings.js — CR045 Phase 1.
 *
 * Derives cash-health warnings for a generated forecast scenario.
 *
 * Why this exists: the engine already knew. When a scenario has no ranked sweep
 * module the sweep cannot fund a shortfall, so it writes a `Cash Shortfall` entry
 * and lets the bank balance run negative — and until now nothing in the UI said so.
 * A scenario that was $20M wrong looked exactly like one that was right (CR045 §1).
 *
 * Pure: every input is already loaded by FCReview. No fetch, no engine change.
 */

/** Below this (in dollars) a balance counts as zero — engine amounts carry cents. */
const EPSILON = 1;

const SHORTFALL_ACCOUNT = "Cash Shortfall";

/**
 * @param {Object} params
 * @param {Array<number|string>} params.years - forecast years, in display order
 * @param {Array<number>} params.bankBalanceByYear - running Bank Accounts balance, aligned to `years`
 * @param {Array<Object>} params.entries - raw engine entries { Year, Account, Amount, Module }
 * @param {Array<Object>} params.modules - scenario modules { Name, Account, CashSweepPriority }
 * @param {number|null} params.cashSweepLow - the scenario's low band, or null if unknown
 * @returns {Array<Object>} warnings, most severe first
 *   { id, severity: 'error'|'warning', title, detail, years: number[], amount: number|null }
 */
export function computeForecastWarnings({
  years = [],
  bankBalanceByYear = [],
  entries = [],
  modules = [],
  cashSweepLow = null,
} = {}) {
  const warnings = [];
  if (!years.length) return warnings;

  const rankedModules = modules
    .filter((m) => m.CashSweepPriority != null && m.CashSweepPriority !== "")
    .map((m) => ({ ...m, rank: Number(m.CashSweepPriority) }))
    .sort((a, b) => a.rank - b.rank);

  // ---- W3: no sweep module configured -------------------------------------
  // The CR045 §1 root cause. Checked first: every other cash warning is
  // downstream of it, so naming it is what actually gets the user unstuck.
  if (modules.length > 0 && !rankedModules.some((m) => m.rank === 1)) {
    warnings.push({
      id: "no-sweep-module",
      severity: "error",
      title: "No cash-sweep module configured",
      detail:
        "No module in this scenario has sweep priority 1, so the forecast cannot move " +
        "cash in or out of your assets: excess cash is stranded and shortfalls are left " +
        "unfunded, driving the bank balance negative. Set a sweep priority on the Modules page.",
      years: [],
      amount: null,
    });
  }

  // ---- W2: unfunded shortfall ---------------------------------------------
  const shortfallByYear = new Map();
  for (const e of entries) {
    if (e.Account !== SHORTFALL_ACCOUNT) continue;
    const amt = Number(e.Amount) || 0;
    if (Math.abs(amt) <= EPSILON) continue;
    const year = Number(e.Year);
    shortfallByYear.set(year, (shortfallByYear.get(year) || 0) + amt);
  }
  if (shortfallByYear.size > 0) {
    const shortYears = [...shortfallByYear.keys()].sort((a, b) => a - b);
    const total = [...shortfallByYear.values()].reduce((s, v) => s + v, 0);
    warnings.push({
      id: "unfunded-shortfall",
      severity: "error",
      title: "Cash shortfall the forecast could not fund",
      detail:
        "The sweep ran out of assets to sell: it could not raise enough cash to hold the " +
        "low band. Rank another module for the sweep to draw on, or schedule a disposal.",
      years: shortYears,
      amount: total,
    });
  }

  // ---- W1: cash goes negative ---------------------------------------------
  const negativeYears = [];
  let worstNegative = 0;
  years.forEach((year, i) => {
    const bal = Number(bankBalanceByYear[i]);
    if (!Number.isFinite(bal) || bal >= -EPSILON) return;
    negativeYears.push(Number(year));
    if (bal < worstNegative) worstNegative = bal;
  });
  if (negativeYears.length > 0) {
    warnings.push({
      id: "negative-cash",
      severity: "error",
      title: "Bank balance goes below zero",
      detail:
        "A negative cash balance is not a real outcome — the money has to come from " +
        "somewhere. Treat these years as unfunded, not as a plan.",
      years: negativeYears,
      amount: worstNegative,
    });
  }

  // ---- W4: cash below the low band (breached but still positive) -----------
  if (Number.isFinite(Number(cashSweepLow)) && Number(cashSweepLow) > 0) {
    const low = Number(cashSweepLow);
    const negativeSet = new Set(negativeYears);
    const belowYears = [];
    years.forEach((year, i) => {
      const bal = Number(bankBalanceByYear[i]);
      if (!Number.isFinite(bal)) return;
      if (negativeSet.has(Number(year))) return; // already reported as negative
      if (bal < low - EPSILON) belowYears.push(Number(year));
    });
    if (belowYears.length > 0) {
      warnings.push({
        id: "below-low-band",
        severity: "warning",
        title: "Cash below the sweep low band",
        detail:
          `The bank balance drops under the ${formatMoney(low)} low band in these years. ` +
          "Cash is still positive, but the sweep could not top it back up to target.",
        years: belowYears,
        amount: low,
      });
    }
  }

  // ---- W5 / W6: sweep sources drained -------------------------------------
  // An account's balance in a year is the sum of every engine entry against it
  // (the module builder's market value, plus the sweep's withdrawals and the
  // prior-years carry-forward) — the same sum the balance sheet row displays.
  const balanceByAccountYear = new Map();
  for (const e of entries) {
    const account = e.Account;
    if (!account || account === SHORTFALL_ACCOUNT) continue;
    if (!balanceByAccountYear.has(account)) balanceByAccountYear.set(account, new Map());
    const byYear = balanceByAccountYear.get(account);
    const year = Number(e.Year);
    byYear.set(year, (byYear.get(year) || 0) + (Number(e.Amount) || 0));
  }

  const exhausted = [];
  const overDrained = [];
  for (const mod of rankedModules) {
    const byYear = balanceByAccountYear.get(mod.Account);
    if (!byYear) continue;

    let hadBalance = false;
    let firstEmptyYear = null;
    let mostNegative = 0;
    let firstNegativeYear = null;

    for (const year of years.map(Number)) {
      const bal = byYear.get(year);
      if (bal == null) continue;
      if (bal > EPSILON) {
        hadBalance = true;
        continue;
      }
      if (hadBalance && firstEmptyYear == null) firstEmptyYear = year;
      if (bal < -EPSILON) {
        if (firstNegativeYear == null) firstNegativeYear = year;
        if (bal < mostNegative) mostNegative = bal;
      }
    }

    if (firstEmptyYear != null) {
      exhausted.push({ name: mod.Name, rank: mod.rank, year: firstEmptyYear });
    }
    if (firstNegativeYear != null) {
      overDrained.push({ name: mod.Name, year: firstNegativeYear, amount: mostNegative });
    }
  }

  if (exhausted.length > 0) {
    warnings.push({
      id: "sweep-source-exhausted",
      severity: "warning",
      title: "Sweep source fully drained",
      detail:
        exhausted
          .map((m) => `${m.name} (priority ${m.rank}) is drained to zero by ${m.year}`)
          .join("; ") +
        ". Once every ranked module is empty the sweep has nothing left to sell.",
      years: exhausted.map((m) => m.year).sort((a, b) => a - b),
      amount: null,
    });
  }

  if (overDrained.length > 0) {
    warnings.push({
      id: "module-over-drained",
      severity: "warning",
      title: "Sweep drew a module below zero",
      detail:
        overDrained
          .map((m) => `${m.name} ends at ${formatMoney(m.amount)} from ${m.year}`)
          .join("; ") +
        ". The sweep withdrew more than the module was later worth — the balance shown is not real.",
      years: overDrained.map((m) => m.year).sort((a, b) => a - b),
      amount: overDrained.reduce((worst, m) => Math.min(worst, m.amount), 0),
    });
  }

  return warnings;
}

/** Compact money for warning copy: -3350000 → "($3.4M)". */
export function formatMoney(value) {
  if (value == null || value === "") return "—"; // Number(null) is 0, not NaN
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  let body;
  if (abs >= 1_000_000) body = `$${(abs / 1_000_000).toFixed(1)}M`;
  else if (abs >= 1_000) body = `$${(abs / 1_000).toFixed(0)}K`;
  else body = `$${abs.toFixed(0)}`;
  return n < 0 ? `(${body})` : body;
}

/** "2029, 2030, 2031" — or "2029–2031 (14 years)" once the list gets long. */
export function formatYearList(years = []) {
  if (!years.length) return "";
  const sorted = [...years].sort((a, b) => a - b);
  if (sorted.length <= 4) return sorted.join(", ");
  return `${sorted[0]}–${sorted[sorted.length - 1]} (${sorted.length} years)`;
}
