/**
 * FC Compare Utility Functions (CR040)
 *
 * Pure functions that pivot one scenario's flat forecast entries into the
 * same per-row / per-year values the Review page shows, then align two
 * scenarios' matrices into a delta structure (B − A) for the Compare page.
 *
 * The per-scenario computation is a transcription of FCReview.jsx's memoized
 * pipeline (entryMaps → getCellValue → balanceDisplayValues → totals) so that
 * Compare's A and B columns reconcile with the Review page for the same
 * scenario. Compare covers forecast years only; the base-year data
 * (LastActualYear balance actuals + BaseYear budget P&L) is used solely to
 * seed the Bank Accounts running balance, exactly as Review does.
 */

const toNum = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Aggregates flat forecast entries into cash / balance lookup maps.
 * Mirrors FCReview's `entryMaps` memo.
 */
export function aggregateEntries(
  entries,
  cashAccountMap,
  balanceAccountMap,
  balanceLevel1Labels,
  balanceLevel2Labels
) {
  const cashByLabel = new Map();
  const cashLevel1Totals = new Map();
  const balanceByLabel = new Map();
  const balanceLevel1Totals = new Map();

  for (const entry of entries) {
    const account = entry?.Account;
    const year = Number(entry?.Year);
    const amount = Number(entry?.Amount ?? 0);
    if (!account || Number.isNaN(year) || Number.isNaN(amount)) continue;

    const cashMapping = cashAccountMap.get(account);
    const cashTarget = cashMapping?.level2 || account;
    const cashYearMap = cashByLabel.get(cashTarget) || new Map();
    cashYearMap.set(year, (cashYearMap.get(year) || 0) + amount);
    cashByLabel.set(cashTarget, cashYearMap);

    if (cashMapping?.level1) {
      const l1YearMap = cashLevel1Totals.get(cashMapping.level1) || new Map();
      l1YearMap.set(year, (l1YearMap.get(year) || 0) + amount);
      cashLevel1Totals.set(cashMapping.level1, l1YearMap);
    }

    const balMapping = balanceAccountMap.get(account);
    const balL1 =
      balMapping?.level1 ||
      (balanceLevel1Labels.has(account) ? account : undefined);
    const balL2 =
      balMapping?.level2 ||
      (balanceLevel2Labels.has(account) ? account : undefined);
    const balTarget = balL2 || account;
    const balYearMap = balanceByLabel.get(balTarget) || new Map();
    balYearMap.set(year, (balYearMap.get(year) || 0) + amount);
    balanceByLabel.set(balTarget, balYearMap);

    if (balL1) {
      const l1YearMap = balanceLevel1Totals.get(balL1) || new Map();
      l1YearMap.set(year, (l1YearMap.get(year) || 0) + amount);
      balanceLevel1Totals.set(balL1, l1YearMap);
    }
  }

  return {
    cash: { byLabel: cashByLabel, level1Totals: cashLevel1Totals },
    balance: { byLabel: balanceByLabel, level1Totals: balanceLevel1Totals },
  };
}

/**
 * Builds the per-year value matrix for one scenario over its forecast years.
 *
 * @param {Object} input
 * @param {Array} input.entries - Flat forecast entries { Year, Account, Amount }
 * @param {Array} input.years - Scenario forecast years
 * @param {number|string} [input.periodStart] - Scenario PeriodStart
 * @param {Object} [input.baseYearValues] - BaseYear budget P&L by FC Line name
 * @param {Object} [input.lastActualBalance] - { level1, level2, level3 } Maps of
 *   LastActualYear BS actuals (from useBaseYearBalanceSheet's per-year value)
 * @param {Map} input.cashAccountMap - FC Line name -> { level1, level2 }
 * @param {Map} input.balanceAccountMap - account -> { level1, level2 }
 * @param {Array} input.balanceRows - [{ label, level }] BS display rows
 * @returns {Object} matrix (see below)
 */
export function buildScenarioMatrix({
  entries,
  years,
  periodStart,
  baseYearValues,
  lastActualBalance,
  cashAccountMap,
  balanceAccountMap,
  balanceRows,
}) {
  // The years endpoint includes the BaseYear (PeriodStart − 1), whose P&L the
  // Review page sources from budget, not engine entries. Compare covers true
  // forecast years only; base-year data enters solely via the bank seed.
  const startYear = periodStart ? Number(periodStart) : -Infinity;
  const forecastYears = [...new Set((years || []).map(Number))]
    .filter((y) => Number.isFinite(y) && y >= startYear)
    .sort((a, b) => a - b);

  const balanceLevel1Labels = new Set(
    balanceRows.filter((r) => r.level === 1).map((r) => r.label)
  );
  const balanceLevel2Labels = new Set(
    balanceRows.filter((r) => r.level === 2).map((r) => r.label)
  );

  const maps = aggregateEntries(
    entries,
    cashAccountMap,
    balanceAccountMap,
    balanceLevel1Labels,
    balanceLevel2Labels
  );

  const bankAccountLabels = new Set(
    Array.from(balanceAccountMap.entries())
      .filter(([, mapping]) => mapping?.level2 === "Bank Accounts")
      .map(([label]) => label)
  );
  bankAccountLabels.add("Bank Accounts");

  const transfersAt = (year) =>
    maps.cash.byLabel.get("Transfers")?.get(year) ||
    maps.cash.level1Totals.get("Transfers")?.get(year) ||
    0;

  // Net Cash Flow per forecast year (Income + Expense + Transfers L1),
  // matching FCReview's isNet cell.
  const netCashFlow = forecastYears.map((year) => {
    const income = maps.cash.level1Totals.get("Income")?.get(year) || 0;
    const expense = maps.cash.level1Totals.get("Expense")?.get(year) || 0;
    const transfers = maps.cash.level1Totals.get("Transfers")?.get(year) || 0;
    return income + expense + transfers;
  });

  // Cash section values by label.
  const cash = new Map();
  const cashHasYear = (label, year) => {
    if (label === "Income" || label === "Expense") {
      return maps.cash.level1Totals.get(label)?.has(year) ?? false;
    }
    return maps.cash.byLabel.get(label)?.has(year) ?? false;
  };

  const cashLabels = new Set([
    "Income",
    "Expense",
    ...maps.cash.byLabel.keys(),
  ]);
  for (const label of cashLabels) {
    cash.set(
      label,
      forecastYears.map((year) => {
        if (label === "Income") {
          return maps.cash.level1Totals.get("Income")?.get(year) ?? null;
        }
        if (label === "Expense") {
          const base = maps.cash.level1Totals.get("Expense")?.get(year) ?? null;
          // Review shows Expense net of Transfers (they roll up under Expense L1)
          return base == null ? null : base - transfersAt(year);
        }
        return maps.cash.byLabel.get(label)?.get(year) ?? null;
      })
    );
  }

  // Derived cash rows (match FCReview's isCashFlow / isNet cells).
  cash.set(
    "Cash Flow",
    forecastYears.map((year) => {
      const hasAny =
        cashHasYear("Income", year) ||
        (maps.cash.level1Totals.get("Expense")?.has(year) ?? false) ||
        maps.cash.byLabel.get("Transfers")?.has(year);
      if (!hasAny) return null;
      const income = maps.cash.level1Totals.get("Income")?.get(year) || 0;
      const expense = maps.cash.level1Totals.get("Expense")?.get(year) || 0;
      return income + (expense - transfersAt(year));
    })
  );
  cash.set(
    "Net Cash Flow",
    forecastYears.map((year, i) => {
      const hasAny =
        cashHasYear("Income", year) ||
        (maps.cash.level1Totals.get("Expense")?.has(year) ?? false) ||
        (maps.cash.level1Totals.get("Transfers")?.has(year) ?? false);
      return hasAny ? netCashFlow[i] : null;
    })
  );

  // Bank Accounts running balance seed:
  //   LastActualYear actual balance + BaseYear NCF (budget P&L + engine transfers),
  // then cumulative NCF across forecast years — same recurrence as Review's
  // balanceDisplayValues.
  const baseYear = periodStart ? Number(periodStart) - 1 : null;
  let baseYearNcf = 0;
  if (baseYear != null) {
    let plTotal = 0;
    if (baseYearValues && typeof baseYearValues === "object") {
      for (const amt of Object.values(baseYearValues)) plTotal += toNum(amt);
    }
    baseYearNcf = plTotal + transfersAt(baseYear);
  }

  const bankSeedFor = (label, level) => {
    if (!lastActualBalance) return 0;
    if (level === 1) return toNum(lastActualBalance.level1?.get(label));
    if (level === 2) return toNum(lastActualBalance.level2?.get(label));
    return toNum(lastActualBalance.level3?.get(label));
  };

  // Balance section values by label.
  const balance = new Map();
  for (const row of balanceRows) {
    const { label, level } = row;
    if (bankAccountLabels.has(label)) {
      let running = bankSeedFor(label, level) + baseYearNcf;
      balance.set(
        label,
        forecastYears.map((_, i) => {
          running += netCashFlow[i] ?? 0;
          return running;
        })
      );
      continue;
    }
    balance.set(
      label,
      forecastYears.map((year) => {
        if (level === 1) {
          return maps.balance.level1Totals.get(label)?.get(year) ?? null;
        }
        return maps.balance.byLabel.get(label)?.get(year) ?? null;
      })
    );
  }

  // Totals from level-2 display values (matches Review's totalAssets/Liabilities).
  const sumLevel2 = (level1Name) => {
    const totals = forecastYears.map(() => 0);
    for (const row of balanceRows) {
      if (row.level !== 2) continue;
      const mapping = balanceAccountMap.get(row.label);
      if (mapping?.level1 !== level1Name) continue;
      const values = balance.get(row.label);
      if (!values) continue;
      values.forEach((v, i) => {
        if (Number.isFinite(Number(v))) totals[i] += Number(v);
      });
    }
    return totals;
  };

  const totalAssets = sumLevel2("Assets");
  const totalLiabilities = sumLevel2("Liabilities");
  const netAssets = forecastYears.map(
    (_, i) => (totalAssets[i] || 0) - (totalLiabilities[i] || 0)
  );

  // Labels that actually carry engine entries (structural-diff detection).
  const labelsWithData = new Set([
    ...maps.cash.byLabel.keys(),
    ...maps.balance.byLabel.keys(),
  ]);

  return {
    years: forecastYears,
    cash,
    balance,
    netCashFlow,
    totalAssets,
    totalLiabilities,
    netAssets,
    labelsWithData,
  };
}

const pickAt = (matrix, section, label, year) => {
  const idx = matrix.years.indexOf(year);
  if (idx === -1) return null;
  if (section === "assets") return matrix.totalAssets[idx] ?? null;
  if (section === "liabilities") return matrix.totalLiabilities[idx] ?? null;
  if (section === "netAssets") return matrix.netAssets[idx] ?? null;
  const values = matrix[section]?.get(label);
  const v = values ? values[idx] : null;
  return v === undefined ? null : v;
};

/**
 * Aligns two scenario matrices into compare rows over the union of years.
 * Delta is B − A; null when either side has no value for that year.
 *
 * @param {Object} matA - buildScenarioMatrix output for the baseline (A)
 * @param {Object} matB - buildScenarioMatrix output for the comparison (B)
 * @param {Object} rowSpec - { cashRows, balanceRows } display rows ({label, level})
 * @returns {Object} { years, rows, totals, structural }
 */
export function compareMatrices(matA, matB, { cashRows, balanceRows }) {
  const years = [...new Set([...matA.years, ...matB.years])].sort(
    (x, y) => x - y
  );

  const makeRow = (section, label, level, extra = {}) => {
    const a = years.map((y) => pickAt(matA, section, label, y));
    const b = years.map((y) => pickAt(matB, section, label, y));
    const delta = years.map((_, i) =>
      a[i] == null || b[i] == null ? null : b[i] - a[i]
    );
    const hasData = a.some((v) => v) || b.some((v) => v);
    return { section, label, level, a, b, delta, hasData, ...extra };
  };

  const rows = [];

  // Cash section: Review row order with Cash Flow / Net Cash Flow inserted
  // around Transfers (mirrors FCReview's cashRowsWithNet).
  for (const row of cashRows) {
    if (row.label === "Transfers") {
      rows.push(makeRow("cash", "Cash Flow", 1, { derived: true }));
      rows.push(makeRow("cash", "Transfers", row.level));
      rows.push(makeRow("cash", "Net Cash Flow", 1, { derived: true }));
    } else {
      rows.push(makeRow("cash", row.label, row.level));
    }
  }

  for (const row of balanceRows) {
    if (row.label === "Assets") {
      rows.push(makeRow("assets", "Assets", 1, { derived: true }));
      continue;
    }
    if (row.label === "Liabilities") {
      rows.push(makeRow("liabilities", "Liabilities", 1, { derived: true }));
      continue;
    }
    rows.push(makeRow("balance", row.label, row.level));
  }
  rows.push(makeRow("netAssets", "Net Assets", 1, { derived: true }));

  const totals = {
    income: makeRow("cash", "Income", 1),
    expense: makeRow("cash", "Expense", 1),
    netCashFlow: makeRow("cash", "Net Cash Flow", 1),
    totalAssets: makeRow("assets", "Assets", 1),
    netAssets: makeRow("netAssets", "Net Assets", 1),
  };

  const onlyInA = [...matA.labelsWithData].filter(
    (l) => !matB.labelsWithData.has(l)
  );
  const onlyInB = [...matB.labelsWithData].filter(
    (l) => !matA.labelsWithData.has(l)
  );

  return { years, rows, totals, structural: { onlyInA, onlyInB } };
}

const fmtMoney = (v) => {
  if (!Number.isFinite(v)) return "-";
  const abs = Math.abs(v);
  let s;
  if (abs >= 1_000_000) s = `$${(abs / 1_000_000).toFixed(1)}M`;
  else if (abs >= 1_000) s = `$${(abs / 1_000).toFixed(0)}K`;
  else s = `$${abs.toFixed(0)}`;
  return v < 0 ? `-${s}` : s;
};

const cumDelta = (row) =>
  row.delta.reduce((s, d) => s + (d ?? 0), 0);

const lastDefined = (arr) => {
  for (let i = arr.length - 1; i >= 0; i--) {
    if (arr[i] != null) return { value: arr[i], index: i };
  }
  return { value: null, index: -1 };
};

/**
 * Deterministic "where they differ" commentary from a compareMatrices result.
 * Returns an array of { kind, text } items, most significant first.
 *
 * @param {Object} compare - compareMatrices output
 * @param {Object} names - { a, b } scenario names
 */
export function buildCommentary(compare, { a: nameA, b: nameB }) {
  const items = [];
  const { years, rows, totals, structural } = compare;
  if (!years.length) return items;

  // Year-range differences
  const aYears = years.filter((_, i) => totals.netAssets.a[i] != null);
  const bYears = years.filter((_, i) => totals.netAssets.b[i] != null);
  if (
    aYears.length &&
    bYears.length &&
    (aYears[0] !== bYears[0] ||
      aYears[aYears.length - 1] !== bYears[bYears.length - 1])
  ) {
    items.push({
      kind: "range",
      text: `The scenarios cover different periods: "${nameA}" runs ${aYears[0]}–${aYears[aYears.length - 1]}, "${nameB}" runs ${bYears[0]}–${bYears[bYears.length - 1]}. Deltas are only computed for overlapping years.`,
    });
  }

  // Headline: Net Assets at the last common year
  const na = totals.netAssets;
  const { value: endDelta, index: endIdx } = lastDefined(na.delta);
  if (endDelta != null) {
    const dir = endDelta > 0 ? "higher" : "lower";
    items.push({
      kind: "headline",
      text: `By ${years[endIdx]}, "${nameB}" ends with net assets of ${fmtMoney(na.b[endIdx])} versus ${fmtMoney(na.a[endIdx])} for "${nameA}" — ${fmtMoney(Math.abs(endDelta))} ${dir}.`,
    });
  }

  // First material divergence of Net Assets
  const materialAt = (i) => {
    const d = na.delta[i];
    if (d == null) return false;
    const base = Math.abs(na.a[i] ?? 0);
    return Math.abs(d) > Math.max(10_000, base * 0.01);
  };
  const firstIdx = na.delta.findIndex((_, i) => materialAt(i));
  if (firstIdx > 0) {
    items.push({
      kind: "divergence",
      text: `The scenarios track closely until ${years[firstIdx]}, when net assets first diverge materially (${fmtMoney(na.delta[firstIdx])}).`,
    });
  } else if (firstIdx === 0) {
    items.push({
      kind: "divergence",
      text: `The scenarios diverge from the first forecast year, ${years[0]} (${fmtMoney(na.delta[0])} net-asset difference).`,
    });
  } else if (endDelta != null && Math.abs(endDelta) <= 10_000) {
    items.push({
      kind: "divergence",
      text: `Net assets never diverge materially — the largest gap in any year is ${fmtMoney(
        na.delta.reduce(
          (m, d) => (d != null && Math.abs(d) > Math.abs(m) ? d : m),
          0
        )
      )}.`,
    });
  }

  // Crossovers: Net Assets delta changes sign
  const crossings = [];
  let prevSign = 0;
  na.delta.forEach((d, i) => {
    if (d == null || d === 0) return;
    const sign = d > 0 ? 1 : -1;
    if (prevSign !== 0 && sign !== prevSign) crossings.push(years[i]);
    prevSign = sign;
  });
  if (crossings.length) {
    items.push({
      kind: "crossover",
      text: `The net-asset advantage flips between scenarios in ${crossings.join(", ")}.`,
    });
  }

  // Top P&L movers by cumulative |Δ| (level-2 cash rows only)
  const plMovers = rows
    .filter(
      (r) => r.section === "cash" && r.level === 2 && !r.derived && r.hasData
    )
    .map((r) => ({ row: r, total: cumDelta(r) }))
    .filter((m) => Math.abs(m.total) > 0.5)
    .sort((x, y) => Math.abs(y.total) - Math.abs(x.total))
    .slice(0, 5);
  if (plMovers.length) {
    const parts = plMovers.map(({ row, total }) => {
      const dir = total > 0 ? "+" : "";
      return `${row.label} (${dir}${fmtMoney(total)} cumulative)`;
    });
    items.push({
      kind: "pl-movers",
      text: `Largest income/expense differences (${nameB} vs ${nameA}): ${parts.join("; ")}.`,
    });
  }

  // Top balance-sheet movers by final-year |Δ|
  const bsMovers = rows
    .filter((r) => r.section === "balance" && r.level === 2 && r.hasData)
    .map((r) => ({ row: r, last: lastDefined(r.delta) }))
    .filter((m) => m.last.value != null && Math.abs(m.last.value) > 0)
    .sort((x, y) => Math.abs(y.last.value) - Math.abs(x.last.value))
    .slice(0, 5);
  if (bsMovers.length) {
    const parts = bsMovers.map(
      ({ row, last }) =>
        `${row.label} (${last.value > 0 ? "+" : ""}${fmtMoney(last.value)} by ${years[last.index]})`
    );
    items.push({
      kind: "bs-movers",
      text: `Largest balance-sheet differences: ${parts.join("; ")}.`,
    });
  }

  // Structural differences
  if (structural.onlyInA.length) {
    items.push({
      kind: "structural",
      text: `Only in "${nameA}": ${structural.onlyInA.slice(0, 8).join(", ")}${structural.onlyInA.length > 8 ? "…" : ""}.`,
    });
  }
  if (structural.onlyInB.length) {
    items.push({
      kind: "structural",
      text: `Only in "${nameB}": ${structural.onlyInB.slice(0, 8).join(", ")}${structural.onlyInB.length > 8 ? "…" : ""}.`,
    });
  }

  return items;
}
