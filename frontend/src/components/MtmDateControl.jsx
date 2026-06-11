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

export default function MtmDateControl({ value, onChange }) {
  const presets = [
    ["month-end", lastMonthEndISO],
    ["quarter-end", lastQuarterEndISO],
    ["year-end", lastYearEndISO],
  ];
  return (
    <span
      className="bfd-muted"
      title="Date the Unrealized-G/L (MTM) entry is booked, and the balance it marks against. Aligns to a quarter/year-end. Calibrate rows ignore this."
    >
      Book MTM as of{" "}
      <input type="date" value={value} onChange={(e) => onChange(e.target.value)} />{" "}
      {presets.map(([lbl, fn], i) => (
        <span key={lbl}>
          {i === 0 ? "(" : " · "}
          <button
            type="button"
            onClick={() => onChange(fn())}
            style={{ background: "none", border: "none", padding: 0, cursor: "pointer", color: "inherit", textDecoration: "underline" }}
          >
            {lbl}
          </button>
          {i === presets.length - 1 ? ")" : ""}
        </span>
      ))}
    </span>
  );
}
