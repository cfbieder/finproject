import { useCallback, useEffect, useState } from "react";
import Rest from "../js/rest";
import DataTable from "../components/DataTable/DataTable";
import Modal from "../components/Modal/Modal";
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
 *    replacing it is naming the mandated source, not correcting a big number.
 *
 *    The warning box deliberately carries only the two facts that PREVENT an
 *    error -- which date, which direction -- and not the reasoning behind them.
 *    An earlier draft also recounted the TY2024 return using Treasury's 31-March
 *    rate (3.982 rather than 4.108, over-converting every PLN line by 3.2%);
 *    true, and the origin of the rule, but a warning that has to be read twice
 *    is a warning that gets skipped. The direction typo is caught by the guard
 *    on save regardless; the DATE is the one thing only the reader can get
 *    right, so it is the one thing emphasised.
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
  const [figureFor, setFigureFor] = useState(null);

  const load = useCallback(async (y) => {
    setLoading(true);
    setError("");
    try {
      const r = await Rest.fetchJson(`/api/v2/tax/fbar/${y}`);
      const data = r?.data || null;
      setReport(data);
      // Seed each rate box with the rate currently stored, so the field is an
      // EDIT of a real number rather than a blank you retype from scratch.
      // Safe only because "Set as Treasury" is disabled while the value is
      // unchanged — otherwise one click would stamp the ECB prefill 'treasury'.
      setRateDraft(
        Object.fromEntries(
          (data?.rates || []).map((x) => [x.currency.trim(), String(x.rate_to_usd)])
        )
      );
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
      await load(year); // reseeds every box from what is now stored
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
      // Prose does not belong in a money column. This used to render the reason
      // ("no fin account — type the figure") right-aligned under a $ heading,
      // which read as a garbled amount. The reason moved to Source, where the
      // row already had nothing to say.
      render: (l) => (l.max_usd === null ? "—" : money(l.max_usd)),
    },
    {
      key: "source",
      header: "Source",
      render: (l) => {
        if (l.source === "typed") return <span className="tfb-typed">typed</span>;
        if (l.source === "computed") return "computed";
        if (l.max_unknown) return <span className="tfb-need">value unknown (15a)</span>;
        return (
          <span className="tfb-need" title={l.needs_figure || ""}>
            {REASONS[l.needs_figure] || "needs a figure"}
          </span>
        );
      },
    },
    {
      key: "actions",
      header: "",
      render: (l) => (
        <button
          type="button"
          className="btn btn--secondary btn--xs"
          disabled={report?.filing_status === "filed"}
          title={
            report?.filing_status === "filed"
              ? "This year is filed — reopen or amend rather than editing."
              : "Type a maximum for this line"
          }
          onClick={() => setFigureFor(l)}
        >
          {l.source === "typed" ? "Edit figure" : "Type figure"}
        </button>
      ),
    },
  ];

  const nonTreasury = (report?.rates || []).filter(
    (r) => r.source !== "treasury" && r.currency.trim() !== "USD"
  );

  // Built from the same `report` object the table renders, so the file and the
  // page cannot disagree. Scripts/fbar-package.js produces the same sheet from
  // the same endpoint for the on-disk case; neither re-derives a figure.
  const exportCsv = () => {
    const q = (v) => {
      if (v === null || v === undefined) return "";
      const s = String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const head = [
      `# FinCEN Form 114 (FBAR) — tax year ${year} working papers`,
      `# Exported ${new Date().toISOString().slice(0, 10)} from fin. MAXIMUM = highest END-OF-DAY`,
      "#   balance across the whole calendar year, including the 1 January carry-in.",
      "#   Computed from the ledger — not an estimate. Blank is NOT zero.",
      `# ${report.lines.filter((l) => l.max_usd !== null).length} of ${report.lines.length}`
        + ` lines computed. Aggregate $${Number(report.aggregate_usd).toLocaleString("en-US")}`
        + `${report.aggregate_is_floor ? " — a FLOOR while any line is outstanding." : "."}`,
      "#",
      "# FX rates applied:",
      ...report.rates
        .filter((r) => r.currency.trim() !== "USD")
        .map((r) => `#   ${r.currency.trim()} ${r.rate_to_usd} USD per unit [${r.source}]`
          + (r.source === "treasury" ? "" : "  NOT the Treasury rate — replace before filing")),
      "#",
    ];
    const cols = ["Part", "Account", "Institution", "Country", "Currency", "Maximum (native)",
      "Peaked on", "FX rate", "FX source", "Maximum (USD)", "Source"];
    const body = report.lines.map((l) => [
      l.fbar_part, l.label, l.institution_name, l.institution_country, l.currency,
      l.max_native, l.max_on, l.rate_to_usd, l.rate_source, l.max_usd,
      l.max_usd === null
        ? (l.max_unknown ? "value unknown (15a)" : "NEEDS FIGURE — not zero")
        : l.source,
    ].map(q).join(","));

    const blob = new Blob([`${head.join("\n")}\n${cols.join(",")}\n${body.join("\n")}\n`],
      { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `fbar-${year}-working-papers.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

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
        <div className="tfb-header__tools">
          <label className="tfb-year">
            Tax year
            <input type="number" value={year} onChange={(e) => setYear(Number(e.target.value))} />
          </label>
          <button
            type="button"
            className="btn btn--secondary btn--sm"
            disabled={!report}
            onClick={exportCsv}
          >
            Export CSV
          </button>
          <button
            type="button"
            className="btn btn--secondary btn--sm"
            disabled={!report}
            onClick={() => window.print()}
            title="Prints the working papers; choose “Save as PDF” in the print dialog"
          >
            Print / PDF
          </button>
        </div>
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
                {nonTreasury.length} rate(s) are still the <strong>ECB prefill</strong>. FinCEN
                requires the Treasury <strong>31 December</strong> rate — that date, not an average
                and not the day the maximum occurred. Each box holds the rate stored now; edit it,
                then Set. Treasury publishes the reciprocal of this direction, and pasting it that
                way round is refused on save.
              </p>
              <ul className="tfb-rates__list">
                {report.rates
                  .filter((r) => r.currency.trim() !== "USD")
                  .map((r) => {
                    const ccy = r.currency.trim();
                    const draft = rateDraft[ccy] ?? "";
                    // Unchanged ⇒ nothing to assert. This is what makes the
                    // prefill safe: you cannot stamp the ECB number 'treasury'
                    // without first editing it into a different number.
                    const unchanged =
                      draft === "" ||
                      !Number.isFinite(Number(draft)) ||
                      Number(draft) === Number(r.rate_to_usd);
                    return (
                      <li key={ccy}>
                        <span className="tfb-rates__ccy">{ccy}</span>
                        <span
                          className={`tfb-rates__cur ${
                            r.source === "treasury" ? "" : "tfb-prefill"
                          }`}
                        >
                          <em>{r.source}</em>
                        </span>
                        <input
                          className="tfb-rates__in"
                          type="number"
                          step="0.000001"
                          aria-label={`${ccy} rate, USD per 1 ${ccy}`}
                          value={draft}
                          onChange={(e) => setRateDraft((d) => ({ ...d, [ccy]: e.target.value }))}
                        />
                        <span className="tfb-rates__unit">USD per 1 {ccy}</span>
                        <button
                          type="button"
                          className="btn btn--secondary btn--xs"
                          disabled={unchanged}
                          title={
                            unchanged
                              ? "Edit the rate first — an unchanged value has nothing to restamp."
                              : `Store ${draft} as the Treasury 31-Dec rate for ${ccy}`
                          }
                          onClick={() => saveRate(ccy)}
                        >
                          Set as Treasury
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

      {figureFor && (
        <FigureDialog
          line={figureFor}
          taxYear={year}
          onClose={() => setFigureFor(null)}
          onSaved={async () => {
            setFigureFor(null);
            await load(year);
          }}
        />
      )}
    </div>
  );
}

/**
 * Type a maximum for a line fin cannot compute — the Erste accounts, and every
 * Part IV line, where the figure comes off a statement rather than the ledger.
 *
 * Two things it is careful about:
 *
 *  - **Blank is not zero.** Clearing the box removes the typed figure and the
 *    line goes back to NEEDS FIGURE. It does not store 0, because 0 is the
 *    claim "this account held nothing all year" and an empty box is not that.
 *  - **15a exists for the case where the figure is genuinely unobtainable.**
 *    Form 114 has a "maximum account value unknown" checkbox, and it is the
 *    honest answer when a statement cannot be got — better than a guess that
 *    reads as a measurement. Ticking it clears the amount.
 */
function FigureDialog({ line, taxYear, onClose, onSaved }) {
  const [amount, setAmount] = useState(
    line.source === "typed" && line.max_native !== null ? String(line.max_native) : ""
  );
  const [reason, setReason] = useState("");
  const [unknown, setUnknown] = useState(line.max_unknown === true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const save = async () => {
    setSaving(true);
    setErr("");
    try {
      await Rest.fetchJson(`/api/v2/tax/fbar/${taxYear}/line/${line.designation_id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          manual_value_native: unknown || amount === "" ? null : Number(amount),
          manual_reason: reason || null,
          max_unknown: unknown,
        }),
      });
      await onSaved();
    } catch (e) {
      setErr(e?.message || "Save failed.");
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={line.label}
      description={`Maximum value during ${taxYear}, in ${line.currency || "the account currency"}.`}
      dismissable={!saving}
      footer={
        <>
          <button type="button" className="btn btn--secondary btn--sm" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn--primary btn--sm" onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save figure"}
          </button>
        </>
      }
    >
      <div className="tfb-figure">
        <label className="tfb-figure__row">
          <span>Maximum ({line.currency || "native"})</span>
          <input
            type="number"
            step="0.01"
            value={amount}
            disabled={unknown}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="highest balance at any point in the year"
          />
        </label>
        <p className="tfb-figure__hint">
          The highest balance the account reached at any point during {taxYear} — not the
          year-end balance, and not an average. Form 114 asks for nothing else.
          Leave it empty to clear a typed figure; empty means <strong>no figure</strong>,
          which is not the same as zero.
        </p>

        <label className="tfb-figure__check">
          <input type="checkbox" checked={unknown} onChange={(e) => setUnknown(e.target.checked)} />
          <span>
            Maximum value is unknown <em>(Form 114 item 15a)</em> — tick only if no statement
            can be obtained. This is the honest answer when the figure cannot be got; a guess
            that looks like a measurement is not.
          </span>
        </label>

        <label className="tfb-figure__row">
          <span>Where it came from</span>
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Erste statement, Dec 2025"
          />
        </label>

        {err && <p className="tfb-error">{err}</p>}
      </div>
    </Modal>
  );
}
