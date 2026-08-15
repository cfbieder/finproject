import { useCallback, useEffect, useState } from "react";
import Rest from "../js/rest";
import DataTable from "../components/DataTable/DataTable";
import "./TaxFbar.css";

/**
 * TaxFbar — CR082 P2. The year's working papers: what goes on FinCEN Form 114.
 *
 * Three things this page refuses to do, each of which would produce a number
 * that looks like an answer:
 *
 *  - render a missing figure as 0. A zero says "this account held nothing",
 *    which is a claim. Absence of a figure is not that claim, so it renders as
 *    NEEDS FIGURE with the reason attached.
 *  - state the $10,000 verdict from a partial set. Over 10k is safe however many
 *    rows are outstanding — more money cannot take it back under — but UNDER 10k
 *    with rows missing is not "no filing required", and the page says so.
 *  - present the prefilled FX as the filing rate. FinCEN requires the TREASURY
 *    December-31 rate; `exchange_rates` is ECB. Measured against Treasury's own
 *    API the two agree closely (2024 PLN: 0.243019 vs 0.243427, 0.17%), so the
 *    prefill is a good approximation and NOT a good citation -- the point of
 *    replacing it is being able to name the mandated source, not correcting a
 *    material error. Getting the DATE wrong is the expensive mistake: the TY2024
 *    return used Treasury's 31-March rate (3.982) instead of 31-December
 *    (4.108) and over-converted every PLN line by 3.2%.
 */

const money = (n) =>
  n === null || n === undefined
    ? "—"
    : `$${Number(n).toLocaleString("en-US")}`;

const native = (n, ccy) =>
  n === null || n === undefined
    ? "—"
    : `${Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${ccy || ""}`;

const REASONS = {
  report_only_needs_typed_figure: "no fin account — type the figure",
  no_fx_rate_for_currency_year: "no FX rate stored for this currency",
  engine_refused: "engine refused",
  no_currency_on_designation: "no currency set",
};

export default function TaxFbar() {
  const [year, setYear] = useState(new Date().getFullYear() - 1);
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [rateDraft, setRateDraft] = useState({});
  const [rateMsg, setRateMsg] = useState(null);

  const load = useCallback(async (y) => {
    setLoading(true);
    setError("");
    try {
      const r = await Rest.fetchJson(`/api/v2/tax/fbar/${y}`);
      setReport(r?.data || null);
    } catch (e) {
      setError(e?.message || "Failed to load the report.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(year);
  }, [load, year]);

  const saveRate = async (currency) => {
    const value = rateDraft[currency];
    setRateMsg(null);
    try {
      await Rest.fetchJson(`/api/v2/tax/fx-rates/${year}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currency, rate_to_usd: Number(value), source: "treasury" }),
      });
      setRateDraft((d) => ({ ...d, [currency]: "" }));
      await load(year);
    } catch (e) {
      // The direction guard answers 409 with the reciprocal of what was typed —
      // which is almost always the number the user meant. Surface it verbatim.
      setRateMsg({ currency, text: e?.message || "Rate rejected." });
    }
  };

  const columns = [
    { key: "fbar_part", header: "Part", render: (l) => l.fbar_part || "—" },
    { key: "label", header: "Account" },
    { key: "institution_name", header: "Institution", render: (l) => l.institution_name || "—" },
    {
      key: "max_native",
      header: "Maximum (native)",
      numeric: true,
      render: (l) =>
        l.needs_figure ? <span className="tfb-need">NEEDS FIGURE</span> : native(l.max_native, l.currency),
    },
    { key: "max_on", header: "Peaked", render: (l) => l.max_on || "—" },
    {
      key: "rate_to_usd",
      header: "Rate",
      numeric: true,
      render: (l) =>
        l.rate_to_usd ? (
          <span className={l.rate_source === "treasury" ? "" : "tfb-prefill"}>
            {l.rate_to_usd}
          </span>
        ) : (
          "—"
        ),
    },
    {
      key: "max_usd",
      header: "Maximum (USD)",
      numeric: true,
      render: (l) =>
        l.max_usd === null ? (
          <span className="tfb-need" title={REASONS[l.needs_figure] || l.needs_figure}>
            {REASONS[l.needs_figure] || "needs a figure"}
          </span>
        ) : (
          money(l.max_usd)
        ),
    },
    {
      key: "source",
      header: "Source",
      render: (l) => (l.source === "typed" ? "typed" : l.source === "computed" ? "computed" : "—"),
    },
  ];

  const nonTreasury = (report?.rates || []).filter(
    (r) => r.source !== "treasury" && r.currency.trim() !== "USD"
  );

  return (
    <div className="tfb-page">
      <header className="tfb-header">
        <div>
          <h1>FinCEN Form 114 (FBAR)</h1>
          <p className="tfb-sub">
            Working papers, not a filable form. Form 114 asks one figure per account: the
            maximum value during the calendar year. Year-end is shown as supporting data —
            the form has no field for it.
          </p>
        </div>
        <label className="tfb-year">
          Tax year
          <input type="number" value={year} onChange={(e) => setYear(Number(e.target.value))} />
        </label>
      </header>

      {error && <p className="tfb-error">{error}</p>}
      {loading || !report ? (
        <p>Loading…</p>
      ) : (
        <>
          <section className="tfb-verdict">
            <div className="tfb-agg">
              <span className="tfb-agg__label">
                Aggregate maximum{report.aggregate_is_floor ? " (so far)" : ""}
              </span>
              <span className="tfb-agg__value">{money(report.aggregate_usd)}</span>
            </div>
            <div
              className={
                report.threshold_exceeded === true
                  ? "tfb-thresh tfb-thresh--yes"
                  : report.threshold_exceeded === false
                    ? "tfb-thresh tfb-thresh--no"
                    : "tfb-thresh tfb-thresh--unknown"
              }
            >
              {report.threshold_exceeded === true &&
                "Over $10,000 — every foreign account is reportable, including the zero ones."}
              {report.threshold_exceeded === false &&
                "Under $10,000 across a complete set — no FBAR required for this year."}
              {report.threshold_exceeded === null && (
                <>
                  <strong>No verdict yet.</strong> The aggregate is a floor —{" "}
                  {report.needs_attention.length} line(s) still have no figure, so
                  &ldquo;under $10,000&rdquo; cannot be concluded from it.
                </>
              )}
            </div>
            <div className="tfb-status">
              Filing status: <strong>{report.filing_status}</strong>
            </div>
          </section>

          {nonTreasury.length > 0 && (
            <section className="tfb-rates">
              <h2>Exchange rates</h2>
              <p className="tfb-rates__warn">
                {nonTreasury.length} rate(s) are still the <strong>ECB prefill</strong>, not the
                Treasury <strong>December&nbsp;31</strong> rate FinCEN requires. The two agree
                closely, so this is about citing the mandated source rather than fixing a big
                number — but the <em>date</em> matters: the TY2024 return used Treasury&apos;s
                31&nbsp;March rate and over-converted every PLN line by 3.2%. Enter this column as{" "}
                <strong>USD per 1 unit</strong>; Treasury publishes the reciprocal.
              </p>
              <ul className="tfb-rates__list">
                {report.rates
                  .filter((r) => r.currency.trim() !== "USD")
                  .map((r) => {
                    const ccy = r.currency.trim();
                    return (
                      <li key={ccy}>
                        <span className="tfb-rates__ccy">{ccy}</span>
                        <span className={r.source === "treasury" ? "" : "tfb-prefill"}>
                          {r.rate_to_usd} <em>({r.source})</em>
                        </span>
                        <input
                          type="number"
                          step="0.000001"
                          placeholder="Treasury rate"
                          value={rateDraft[ccy] ?? ""}
                          onChange={(e) => setRateDraft((d) => ({ ...d, [ccy]: e.target.value }))}
                        />
                        <button
                          type="button"
                          className="tfb-btn"
                          disabled={!rateDraft[ccy]}
                          onClick={() => saveRate(ccy)}
                        >
                          Set
                        </button>
                        {rateMsg?.currency === ccy && (
                          <p className="tfb-rates__reject">{rateMsg.text}</p>
                        )}
                      </li>
                    );
                  })}
              </ul>
            </section>
          )}

          <DataTable
            columns={columns}
            rows={report.lines}
            rowKey={(l) => l.designation_id}
            emptyMessage="No designations — start on the Foreign accounts page."
          />

          {report.needs_attention.length > 0 && (
            <section className="tfb-needs">
              <h2>{report.needs_attention.length} line(s) need a figure</h2>
              <p className="tfb-sub">
                None of these is zero. Each is either a report-only line whose figure comes
                from a statement, or an account fin cannot compute.
              </p>
              <ul>
                {report.needs_attention.map((n) => (
                  <li key={n.designation_id}>
                    <strong>{n.label}</strong> — {REASONS[n.reason] || n.reason}
                    {n.detail ? <span className="tfb-detail"> ({n.detail})</span> : null}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}
