/**
 * fcEquityBridge.js — the Review page's "Change in Net Assets" bridge, as data.
 *
 * Lifted out of FCReviewTable's EquityBridgeRows so the Excel export computes the same
 * rows the table renders — one rule, no second copy to drift (see the reasoning on
 * EquityBridgeRows for what the rows mean and why they reconcile).
 *
 *   ΔNet Assets = Operating Cash Flow + Σ Unrealized G/L (per balance-sheet line)
 *
 * Pure: every input is already computed by the page. Index 0 (the actuals year) has no
 * prior year to bridge from, so every series is null there.
 *
 * @returns {{ operating, totalChange, unrealTotal, lineRows: Array<{label, values}>, residual }}
 */
export function computeEquityBridge({
  sortedYears,
  resolveCashValue,
  transferDetailRows,
  netAssetsByYear,
  balanceDisplayValues,
  balanceAccountMap,
  bankAccountLabels,
  balanceAccounts,
}) {
  const zeros = () => sortedYears.map(() => 0);

  // Operating Cash Flow = Income + Expense (excludes Transfers), via resolveCashValue so it
  // matches the Income / Expense rows of the cash-flow section.
  const operating = sortedYears.map((y, yi) => {
    if (yi === 0) return null;
    const inc = Number(resolveCashValue({ label: "Income", level: 1 }, y)) || 0;
    const exp = Number(resolveCashValue({ label: "Expense", level: 1 }, y)) || 0;
    return inc + exp;
  });

  const totalChange = sortedYears.map((_, yi) =>
    yi === 0 ? null : (netAssetsByYear?.[yi] || 0) - (netAssetsByYear?.[yi - 1] || 0)
  );

  // Roll the per-module transfer rows up to their level-2 balance-sheet line.
  const transfersByLine = new Map();
  for (const detail of (transferDetailRows || [])) {
    const line = balanceAccountMap?.get(detail.module)?.level2 || detail.module;
    if (bankAccountLabels?.has(line)) continue; // bank side is captured by Operating CF
    const arr = transfersByLine.get(line) || zeros();
    (detail.values || []).forEach((v, yi) => { arr[yi] += Number(v) || 0; });
    transfersByLine.set(line, arr);
  }

  // Per-line Unrealized G/L = Δ(signed balance) + line transfers, over every non-bank
  // level-2 line. CR064 P12 — the balance is ALREADY signed (liabilities negative).
  const lineRows = [];
  for (const row of (balanceAccounts || [])) {
    if (row.level !== 2) continue;
    const label = row.label;
    if (bankAccountLabels?.has(label)) continue;
    const balances = balanceDisplayValues?.get(label);
    if (!balances) continue;
    const lineTransfers = transfersByLine.get(label) || zeros();
    const values = sortedYears.map((_, yi) => {
      if (yi === 0) return null;
      const cur = Number(balances[yi]) || 0;
      const prev = Number(balances[yi - 1]) || 0;
      return (cur - prev) + (lineTransfers[yi] || 0);
    });
    if (values.some((v) => v != null && Math.abs(v) > 0.5)) {
      lineRows.push({ label, values });
    }
  }

  // The total is authoritative (derived from the net-asset change) so the headline always
  // reconciles; the per-line rows explain it and "Other" absorbs any gap.
  const unrealTotal = sortedYears.map((_, yi) =>
    yi === 0 ? null : (totalChange[yi] || 0) - (operating[yi] || 0)
  );
  const residual = sortedYears.map((_, yi) => {
    if (yi === 0) return null;
    const lineSum = lineRows.reduce((s, r) => s + (r.values[yi] || 0), 0);
    return (unrealTotal[yi] || 0) - lineSum;
  });

  return { operating, totalChange, unrealTotal, lineRows, residual };
}

/** True when the bridge has an unattributed remainder worth a row of its own. */
export const bridgeHasResidual = (bridge) =>
  bridge.residual.some((v) => v != null && Math.abs(v) > 0.5);
