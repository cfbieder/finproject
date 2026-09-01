// Shared MTM booking-date control + period-end helpers, used by both the feed
// (BalanceReconciliation) and manual (ManualReconciliation) recon tables.
//
// The Unrealized-G/L (MTM) entry is dated on this date. Calibrate rows ignore
// it. Sent to the reconcile endpoint as `bookDate`.
//
// CR065 §11: the entry date and the OBSERVATION it marks against are two
// different questions. The feed labels a balance with the date it synced, and it
// syncs in the small hours, so the row dated D was taken before D traded —
// marking a Friday month-end against "Friday" pinned Fidelity Stocks 24,352.57
// below the custodian. `balanceDate` names the observation to mark against;
// leave it blank for the usual case, and the server refuses (with the candidate
// balances listed) rather than marking against one that cannot contain the day.

// --- local-date-safe helpers (no UTC shift) ---
const pad2 = (n) => String(n).padStart(2, "0");
const toISODate = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
// most recent COMPLETED month-end (day 0 of the current month = last day of prev month)
export const lastMonthEndISO = (t = new Date()) => toISODate(new Date(t.getFullYear(), t.getMonth(), 0));
// most recent completed quarter-end (day 0 of the current quarter's first month)
export const lastQuarterEndISO = (t = new Date()) =>
  toISODate(new Date(t.getFullYear(), Math.floor(t.getMonth() / 3) * 3, 0));
// most recent completed year-end (Dec 31 of last year)
export const lastYearEndISO = (t = new Date()) => toISODate(new Date(t.getFullYear() - 1, 12, 0));

const PRESETS = [
  ["Month-end", lastMonthEndISO],
  ["Quarter-end", lastQuarterEndISO],
  ["Year-end", lastYearEndISO],
];

export default function MtmDateControl({ value, onChange, balanceDate = "", onBalanceDateChange }) {
  return (
    <div className="bfd-mtm-date">
      <span className="bfd-muted">Book MTM entry as of</span>
      <input type="date" value={value} onChange={(e) => onChange(e.target.value)} />
      {PRESETS.map(([lbl, fn]) => (
        <button key={lbl} type="button" className="bfd-mtm-chip" onClick={() => onChange(fn())}>
          {lbl}
        </button>
      ))}
      {onBalanceDateChange && (
        <>
          <span className="bfd-muted">· mark against balance dated</span>
          <input
            type="date"
            value={balanceDate}
            onChange={(e) => onBalanceDateChange(e.target.value)}
            title={
              "Optional. Which feed OBSERVATION to measure against, when it is not the one " +
              "the engine would pick. The feed labels a balance with the date it synced, in " +
              "the small hours — so the row dated D was taken before D traded. Leave blank " +
              "unless the reconcile refuses and names the alternatives. Applies to MTM and " +
              "ACCRUAL rows; on accrual rows it selects the observation only — the entry is " +
              "still dated by the day that observation can speak for."
            }
          />
          {balanceDate && (
            <button type="button" className="bfd-mtm-chip" onClick={() => onBalanceDateChange("")}>
              clear
            </button>
          )}
        </>
      )}
      <span className="bfd-muted bfd-mtm-hint">
        — the date box dates the <strong>Unrealized-G/L</strong> entry on brokerage rows only;
        accrual rows date themselves from the observation they measure. The override picks the
        observation for <strong>both</strong>. Calibrate rows ignore the pair.
      </span>
    </div>
  );
}
