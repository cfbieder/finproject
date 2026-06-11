// Shared MTM booking-date control + period-end helpers, used by both the feed
// (BalanceReconciliation) and manual (ManualReconciliation) recon tables.
//
// The Unrealized-G/L (MTM) entry is dated on this date and marked against the
// balance as of this date — so it can be aligned to a quarter or year end.
// Calibrate rows ignore it. Sent to the reconcile endpoint as `bookDate`.

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

export default function MtmDateControl({ value, onChange }) {
  return (
    <div className="bfd-mtm-date">
      <span className="bfd-muted">Book MTM entry as of</span>
      <input type="date" value={value} onChange={(e) => onChange(e.target.value)} />
      {PRESETS.map(([lbl, fn]) => (
        <button key={lbl} type="button" className="bfd-mtm-chip" onClick={() => onChange(fn())}>
          {lbl}
        </button>
      ))}
      <span className="bfd-muted bfd-mtm-hint">
        — dates the Unrealized-G/L entry &amp; the balance it marks against (calibrate rows ignore it)
      </span>
    </div>
  );
}
