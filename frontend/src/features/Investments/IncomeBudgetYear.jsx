/**
 * CR103 P1 — investment income for a calendar year, by account × basis × month, split into the
 * budget's two lines (Interest / Dividend), with copy buttons whose rows paste into the budget
 * builder's itemised modal (CR103 P0: item · currency · Jan–Dec, tab-separated).
 *
 * The rows come from the server already rounded so each row's twelve months sum to its total.
 * Categories follow how the ledger BOOKS each kind (D7): money-market income, reinvestment and every
 * distribution are Dividend; coupons and FDIC deposits are Interest.
 */
import { useState } from "react";
import { money } from "./investmentFormat.js";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const whole = (v) => (v ? Number(v).toLocaleString(undefined, { maximumFractionDigits: 0 }) : "–");
const SECTIONS = [
  { key: "interest", title: "Interest Income", button: "Copy Interest rows" },
  { key: "dividend", title: "Financial Income - Dividend", button: "Copy Dividend rows" },
];

/** The P0 paste format: description, currency, Jan…Dec — positive, two decimals, no separators. */
function toTsv(rows) {
  return rows.map((r) => [r.description, "USD", ...r.months.map((v) => Number(v).toFixed(2))].join("\t")).join("\n");
}

export default function IncomeBudgetYear({ budget, accountId, years, year, onYear, rateInput, onRateInput, onRateApply, rateError }) {
  const [fallback, setFallback] = useState(null);
  const [copied, setCopied] = useState(null);
  const rows = budget.rows.filter((r) => !accountId || String(r.account_id) === String(accountId));
  // While a new year loads, the rows on screen are still the old year's: say so and don't copy them.
  const loading = budget.year !== year;
  const rates = budget.reinvest_rates.filter((r) => !accountId || String(r.account_id) === String(accountId));
  const noData = budget.no_data.filter((n) => !accountId || String(n.account_id) === String(accountId))
    .reduce((a, n) => a + n.value, 0);

  const copy = async (section) => {
    const text = toTsv(rows.filter((r) => r.category === section.key));
    setCopied(null);
    // navigator.clipboard needs a secure context; dev is plain HTTP, so show the text to copy by hand.
    try {
      if (!window.isSecureContext || !navigator.clipboard) throw new Error("no clipboard");
      await navigator.clipboard.writeText(text);
      setFallback(null);
      setCopied(section.key);
    } catch {
      setFallback({ title: section.button, text });
    }
  };

  return (
    <section className="panel inv-account">
      <h2>Budget year {budget.year} — by account and month{loading ? ` (loading ${year}…)` : ""}</h2>
      <p className="inv-history__caveat">
        Calendar {budget.year} from <strong>today&apos;s holdings</strong>. Coupons on their due months; dividends in the months
        they were paid last year (a shape, not announced dates); cash at today&apos;s rate, spread evenly. Bonds maturing
        before year-end are reinvested from the month after at the rate shown. Rows are split the way the ledger books
        them, so each block pastes into one budget line.
      </p>
      <div className="inv-income-budget__controls">
        <label>Year{" "}
          <select value={year} onChange={(e) => onYear(Number(e.target.value))}>
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </label>
        <label>Reinvestment rate %{" "}
          <input type="text" inputMode="decimal" className="inv-income-budget__rate" value={rateInput}
            placeholder="account yield"
            onChange={(e) => onRateInput(e.target.value)} onBlur={onRateApply}
            onKeyDown={(e) => { if (e.key === "Enter") onRateApply(); }} />
        </label>
        <span className="inv-history__caveat">
          Blank uses each account&apos;s money-market 7-day yield
          {rates.length > 0 && <>: {rates.map((r) => `${r.account_name} ${r.rate}%${r.source && r.source !== "entered" ? ` (${r.source}${r.as_of ? `, ${r.as_of}` : ""})` : ""}`).join(" · ")}</>}.
        </span>
      </div>
      {rateError && <p className="inv-history__caveat" role="alert">⚠️ {rateError}</p>}

      {SECTIONS.map((section) => {
        const part = rows.filter((r) => r.category === section.key);
        if (!part.length) return null;
        const months = MONTHS.map((_, m) => part.reduce((a, r) => a + r.months[m], 0));
        const total = part.reduce((a, r) => a + r.total, 0);
        return (
          <div key={section.key} className="inv-income-budget__block">
            <h3>{section.title} <span className="inv-history__caveat">{money(total, "USD")}</span></h3>
            <div className="inv-income-budget__scroll">
              <table className="inv-exposure inv-income-budget__table">
                <thead>
                  <tr>
                    <th scope="col">Item</th>
                    {MONTHS.map((m) => <th key={m} scope="col" className="inv-num">{m}</th>)}
                    <th scope="col" className="inv-num">Year</th>
                  </tr>
                </thead>
                <tbody>
                  {part.map((r) => (
                    <tr key={`${r.account_id}-${r.basis}`}>
                      <th scope="row">{r.description}</th>
                      {r.months.map((v, m) => <td key={m} className="inv-num">{whole(v)}</td>)}
                      <td className="inv-num"><strong>{whole(r.total)}</strong></td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <th scope="row">Total</th>
                    {months.map((v, m) => <td key={m} className="inv-num"><strong>{whole(v)}</strong></td>)}
                    <td className="inv-num"><strong>{whole(total)}</strong></td>
                  </tr>
                </tfoot>
              </table>
            </div>
            <p className="inv-income-budget__actions">
              <button type="button" className="btn btn--secondary btn--sm" disabled={loading} onClick={() => copy(section)}>{section.button}</button>
              {copied === section.key && <span className="inv-history__caveat"> Copied {part.length} rows.</span>}
            </p>
          </div>
        );
      })}

      {fallback && (
        <div className="inv-income-budget__fallback">
          <p className="inv-history__caveat">{fallback.title}: the clipboard is not available here — press Ctrl+C.</p>
          <textarea readOnly rows={6} value={fallback.text} ref={(el) => el && el.select()} aria-label="Rows to copy" />
        </div>
      )}

      <p className="inv-history__caveat">
        Paste into the builder&apos;s itemised modal for the matching line. Each month&apos;s total is split across accounts
        by last year&apos;s shares, not by these rows. Interest outside these accounts (other banks) is not here — add it by hand.
        {noData > 0 && <> <strong>{money(noData, "USD")}</strong> of holdings here state no income (no terms or no history) and are not counted.</>}
      </p>
    </section>
  );
}
