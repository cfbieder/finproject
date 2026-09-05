/**
 * investmentHistory.js — CR090 P3. Pure shaping for the account history chart.
 *
 * Its own module because `AccountHistoryChart.jsx` must export components only
 * (Fast Refresh; `Scripts/check-lint-debt.sh` ratchets it). Keeping the shaping
 * pure also makes the one rule that matters testable without rendering: the two
 * sources never share a field, so nothing can join them.
 */

export const DAY = 86400000;

/** `2016-03-31` → epoch ms at UTC midnight, so the axis spaces points by real time. */
const toTs = (iso) => Date.UTC(...iso.split("-").map((n, i) => (i === 1 ? Number(n) - 1 : Number(n))));

export const fmtDate = (ts) =>
  new Date(ts).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });

/**
 * One row per observation, with the two series in SEPARATE fields so recharts
 * cannot connect across them even if a future edit added a line to the wrong one.
 */
export function toSeries(rows) {
  return (rows || []).map((r) => {
    const ts = toTs(r.observed_on);
    const v = Number(r.sum_market_value);
    const isStatement = r.source === "statement";
    return {
      ts,
      statement: isStatement ? v : null,
      feed: isStatement ? null : v,
      source: r.source,
      observed_on: r.observed_on,
      polled_on: r.polled_on,
      valued_on: r.valued_on,
      positions_count: r.positions_count,
    };
  });
}

