import { useCallback, useEffect, useState } from "react";
import Rest from "../js/rest";
import DataTable from "../components/DataTable/DataTable";
import Modal from "../components/Modal/Modal";
import { exportFbarWorkbook, fbarExportBlockers } from "../utils/fbarWorkbook";
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

/**
 * A line that HAS a figure and should not be read as settled. Kept apart from
 * REASONS on purpose: those lines block the verdict, these do not.
 */
const WARNINGS = {
  unverified_carry_in: "carry-in only — confirm against a statement",
};

export default function TaxFbar() {
  const [year, setYear] = useState(new Date().getFullYear() - 1);
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [rateDraft, setRateDraft] = useState({});
  const [rateMsg, setRateMsg] = useState(null);
  const [figureFor, setFigureFor] = useState(null);
  const [freezing, setFreezing] = useState(false);
  const [diff, setDiff] = useState(null);
  const [fileMsg, setFileMsg] = useState("");
  const [filer, setFiler] = useState(null);
  const [editingFiler, setEditingFiler] = useState(false);

  const load = useCallback(async (y) => {
    setLoading(true);
    setError("");
    setFileMsg("");
    try {
      const r = await Rest.fetchJson(`/api/v2/tax/fbar/${y}`);
      const data = r?.data || null;
      setReport(data);

      // Filed years carry a diff worth seeing unprompted: `calibrate()` rewrites
      // opening_balance across all history with no audit row, so a filed figure
      // and the same figure recomputed today drift apart for reasons that leave
      // no trace in the ledger. Waiting for the user to ask would mean the drift
      // is only ever found by someone who already suspected it.
      const d = await Rest.fetchJson(`/api/v2/tax/fbar/${y}/diff`);
      setDiff(d?.data?.filed ? d.data : null);

      // Part I. Masked — the TIN and DOB come only from the reveal the form
      // calls when it opens.
      const f = await Rest.fetchJson("/api/v2/tax/filer");
      setFiler(f?.data || null);
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

  /**
   * Mark the year filed. This is the only thing that makes a filed figure
   * recoverable: `calibrate()` moves history with no audit row, so a year that
   * is merely "computed and then transcribed" cannot be reproduced afterwards.
   * The freeze COPIES every figure, number and institution name onto the filing
   * lines rather than joining to them.
   *
   * Refuses a year with lines still missing a figure — a filing frozen with
   * holes records a number nobody stands behind — and says so rather than
   * offering a force button here. Force exists on the API for the seeding case
   * (a historical year reconstructed from a paper return); it is not a thing to
   * click past on the year you are about to send.
   */
  const freeze = async () => {
    if (!window.confirm(
      `Mark tax year ${year} as FILED?\n\n`
      + `Every figure, account number and institution name is copied into the filing `
      + `as it stands right now, and the year stops accepting edits. This is what makes `
      + `the filed numbers survive a later calibrate() — but it is not reversible: a `
      + `correction is a second filing (an amendment), not an edit to this one.`
    )) return;
    setFreezing(true);
    setFileMsg("");
    try {
      const r = await Rest.fetchJson(`/api/v2/tax/fbar/${year}/freeze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filed_on: null, note: null }),
      });
      setFileMsg(`Filed — ${r?.data?.lines ?? 0} line(s) frozen.`);
      await load(year);
    } catch (e) {
      setFileMsg(e?.message || "Could not file the year.");
    } finally {
      setFreezing(false);
    }
  };

  const amend = async () => {
    if (!window.confirm(
      `Open an amendment for ${year}?\n\n`
      + `The filed figures stay exactly as they are and stay readable — this starts a `
      + `SECOND filing for the same year, which is what an amended FBAR is.`
    )) return;
    setFreezing(true);
    setFileMsg("");
    try {
      const r = await Rest.fetchJson(`/api/v2/tax/fbar/${year}/amend`, { method: "POST" });
      setFileMsg(`Amendment ${r?.data?.amendment_seq} opened — the year is editable again.`);
      await load(year);
    } catch (e) {
      setFileMsg(e?.message || "Could not open an amendment.");
    } finally {
      setFreezing(false);
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
    {
      key: "max_on",
      header: "Peaked",
      // §12b.14 — "carry-in" reads as a settled answer, and on an account that
      // did not exist yet it is a 1990-dated calibration plug projected
      // backwards. `PKO TFI` and `Revolut-PLN` both sat here looking ordinary.
      render: (l) =>
        l.warning === "unverified_carry_in" ? (
          <span className="tfb-warn" title={l.warning_detail || ""}>
            carry-in, no {year} activity
          </span>
        ) : (
          l.max_on || "—"
        ),
    },
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
      "Peaked on", "FX rate", "FX source", "Maximum (USD)", "Source", "Warning"];
    const body = report.lines.map((l) => [
      l.fbar_part, l.label, l.institution_name, l.institution_country, l.currency,
      l.max_native, l.max_on, l.rate_to_usd, l.rate_source, l.max_usd,
      l.max_usd === null
        ? (l.max_unknown ? "value unknown (15a)" : "NEEDS FIGURE — not zero")
        : l.source,
      // The warning travels with the sheet. A worksheet that shows a corroborated
      // and an uncorroborated figure identically is the "looks like an answer"
      // failure moved off the screen and onto paper.
      l.warning ? (WARNINGS[l.warning] || l.warning) : "",
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

  // The Excel worksheet is the one a preparer transcribes from, so unlike the CSV
  // it refuses while any reportable line has no figure — an empty cell in a money
  // column gets read as zero by whoever opens it next.
  const exportBlockers = report ? fbarExportBlockers(report) : [];

  const exportXlsx = () => {
    setFileMsg("");
    try {
      exportFbarWorkbook(report, year);
    } catch (e) {
      setFileMsg(e?.message || "Could not build the worksheet.");
    }
  };

  return (
    <div className="tfb-page">
      <header className="tfb-header">
        <div>
          <h1>FinCEN Form 114 (FBAR)</h1>
          {/* Print-only. The year is otherwise held in an <input> that print
              hides, which would leave the sheet not saying which year it is. */}
          <p className="tfb-printhead">
            <strong>Tax year {year}</strong> · working papers printed{" "}
            {new Date().toISOString().slice(0, 10)}
            {report ? ` · ${report.lines.length} accounts · filing status ${report.filing_status}` : ""}
          </p>
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
            title="The working dump — includes the outstanding lines, labelled"
          >
            Export CSV
          </button>
          <button
            type="button"
            className="btn btn--secondary btn--sm"
            disabled={!report || exportBlockers.length > 0}
            onClick={exportXlsx}
            title={
              exportBlockers.length > 0
                ? `Not ready: ${exportBlockers.length} line(s) still have no figure. `
                  + `A worksheet is transcribed from, so a hole in it becomes a hole in `
                  + `the filing.\n\n${exportBlockers.join("\n")}`
                : "The transcription worksheet: figures, provenance and the rate each used"
            }
          >
            Export Excel
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
              <span>
                Filing status: <strong>{report.filing_status}</strong>
              </span>
              {report.filing_status === "filed" ? (
                <button
                  type="button"
                  className="btn btn--secondary btn--sm"
                  disabled={freezing}
                  onClick={amend}
                  title="Start a second filing for this year. The filed one is never overwritten."
                >
                  Open an amendment
                </button>
              ) : (
                <button
                  type="button"
                  className="btn btn--primary btn--sm"
                  disabled={freezing || report.needs_attention.length > 0}
                  onClick={freeze}
                  title={
                    report.needs_attention.length > 0
                      ? `${report.needs_attention.length} line(s) still have no figure — a filing frozen with holes records a number nobody stands behind.`
                      : "Copy every figure into the filing and stop accepting edits"
                  }
                >
                  {freezing ? "Working…" : "Mark as filed"}
                </button>
              )}
              {fileMsg && <span className="tfb-filemsg">{fileMsg}</span>}
            </div>
          </section>

          {/* ── The point of the freeze, made visible (§6) ──
              A filed figure and the same figure recomputed today should be
              identical. When they are not, `calibrate()` has rewritten
              opening_balance across all history — with no audit row, which is
              why this panel can show WHAT moved and not WHY. */}
          {diff && (
            <section
              className={diff.moved_count ? "tfb-diff tfb-diff--moved" : "tfb-diff"}
            >
              <h2>Filed vs recomputed today</h2>
              <p className="tfb-sub">
                {/* "Nothing moved" and "nothing was checked" are different
                    answers, and a filing transcribed from paper produces the
                    second — its lines stand alone with no designation behind
                    them, so there is nothing to recompute them from. Saying
                    "nothing has moved" there would be the exact failure this
                    feature is written against. */}
                <strong>
                  {diff.comparable_count} of {diff.rows.length} filed line(s)
                </strong>{" "}
                can be recomputed from the ledger
                {diff.comparable_count < diff.rows.length && (
                  <> — the rest were filed with no fin account behind them and are a record
                  only</>
                )}
                .{" "}
                {diff.comparable_count === 0
                  ? "Nothing here has been checked against the ledger."
                  : diff.moved_count
                    ? `${diff.moved_count} no longer reproduce${diff.moved_count === 1 ? "s" : ""} the filed figure. That is expected — a single calibrate() rewrites opening_balance across every historical date and writes no audit row — and it is exactly why the filed figures were copied rather than left to be recomputed. The filed column is what was sent; nothing here changes it.`
                    : "Every one of them still recomputes to the filed figure."}
              </p>
              <ul className="tfb-diff__list">
                {diff.rows
                  .filter((r) => r.comparable && r.delta_native)
                  .map((r) => (
                    <li key={r.label}>
                      <strong>{r.label}</strong> — filed {native(r.filed_native, r.currency)},
                      now {native(r.recomputed_native, r.currency)}{" "}
                      <span className="tfb-detail">
                        ({r.delta_native > 0 ? "+" : ""}
                        {Number(r.delta_native).toLocaleString("en-US")})
                      </span>
                    </li>
                  ))}
              </ul>
            </section>
          )}

          {/* ── Part I ──
              The form's first page, and the one thing on it fin never held: the
              filer's own name, TIN, date of birth and address were retyped from
              somewhere else every year. Incomplete is the loud state, because a
              worksheet that is silent about Part I reads as one that does not
              need it. */}
          <section
            className={
              filer && filer.name_last && filer.has_tin && filer.has_dob
                ? "tfb-filer"
                : "tfb-filer tfb-filer--todo"
            }
          >
            <h2>Part I — the filer</h2>
            {filer && (filer.name_last || filer.has_tin) ? (
              <p className="tfb-filer__line">
                <strong>
                  {[filer.name_first, filer.name_middle, filer.name_last]
                    .filter(Boolean)
                    .join(" ") || "(no name)"}
                </strong>
                {" · "}
                {filer.tin_type || "TIN"} {filer.tin_masked || "—"}
                {" · born "}
                {filer.dob_masked || "—"}
                {filer.address_city ? ` · ${filer.address_city}` : ""}
                {filer.address_country ? `, ${filer.address_country}` : ""}
              </p>
            ) : (
              <p className="tfb-filer__line">
                Not entered. Form 114 will not accept a filing without it, and it is the
                one part of the form fin has never held — so it gets retyped from somewhere
                else every year, which is exactly what this section exists to stop.
              </p>
            )}
            <button
              type="button"
              className="btn btn--secondary btn--xs"
              onClick={() => setEditingFiler(true)}
            >
              {filer && filer.name_last ? "Edit" : "Enter the filer"}
            </button>
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

          {report.warnings?.length > 0 && (
            <section className="tfb-warns">
              <h2>{report.warnings.length} line(s) computed but not corroborated</h2>
              <p className="tfb-sub">
                Each of these has a figure and each is in the aggregate. What none of them
                has is a single {year} transaction — so the number is the balance carried in
                from {year - 1}, which is also exactly what an account opened <em>after</em>{" "}
                {year} reports. The ledger cannot tell those apart; a statement can.
              </p>
              <ul>
                {report.warnings.map((w) => (
                  <li key={w.designation_id}>
                    <strong>{w.label}</strong> — {WARNINGS[w.warning] || w.warning}
                    {w.detail ? <span className="tfb-detail"> ({w.detail})</span> : null}
                  </li>
                ))}
              </ul>
            </section>
          )}

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

      {editingFiler && (
        <FilerDialog
          masked={filer}
          onClose={() => setEditingFiler(false)}
          onSaved={async () => {
            setEditingFiler(false);
            await load(year);
          }}
        />
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
 * Part I — the filer block.
 *
 * The TIN and the DOB are fetched from the reveal endpoint when this opens, not
 * taken from the masked payload the page already holds. That matters for more
 * than display: saving a masked value back would write `•••-••-1234` into the
 * store, which is the shape of defect CR082 P0a had to unpick on the COA editor.
 * If the reveal fails, those two fields stay untouched on save rather than being
 * cleared — an absent key means "leave it alone" on the server.
 */
function FilerDialog({ masked, onClose, onSaved }) {
  const [form, setForm] = useState({ ...(masked || {}) });
  const [revealed, setRevealed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    let alive = true;
    Rest.fetchJson("/api/v2/tax/filer/reveal")
      .then((r) => {
        if (!alive) return;
        setForm((f) => ({ ...f, tin: r?.data?.tin ?? "", dob: r?.data?.dob ?? "" }));
        setRevealed(true);
      })
      .catch(() => alive && setRevealed(false));
    return () => { alive = false; };
  }, []);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const save = async () => {
    setSaving(true);
    setErr("");
    try {
      const body = {
        name_last: form.name_last || "", name_first: form.name_first || "",
        name_middle: form.name_middle || "", tin_type: form.tin_type || "SSN",
        address_street: form.address_street || "", address_city: form.address_city || "",
        address_region: form.address_region || "", address_postal: form.address_postal || "",
        address_country: form.address_country || "",
      };
      // Only sent when they were successfully revealed — see the note above.
      if (revealed) {
        body.tin = form.tin || "";
        body.dob = form.dob || "";
      }
      await Rest.fetchJson("/api/v2/tax/filer", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
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
      title="Part I — the filer"
      description="Form 114's first page: who is filing. Stored in Postgres and in no document."
      size="wide"
      dismissable={!saving}
      footer={
        <>
          <button type="button" className="btn btn--secondary btn--sm" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn--primary btn--sm" onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </button>
        </>
      }
    >
      <div className="tfb-filerform">
        <label><span>Last name</span>
          <input value={form.name_last || ""} onChange={set("name_last")} /></label>
        <label><span>First name</span>
          <input value={form.name_first || ""} onChange={set("name_first")} /></label>
        <label><span>Middle</span>
          <input value={form.name_middle || ""} onChange={set("name_middle")} /></label>

        <label><span>Identification type</span>
          <select value={form.tin_type || "SSN"} onChange={set("tin_type")}>
            <option value="SSN">SSN / ITIN</option>
            <option value="EIN">EIN</option>
            <option value="FOREIGN">Foreign identification</option>
          </select></label>
        <label><span>TIN</span>
          <input
            value={form.tin || ""}
            onChange={set("tin")}
            disabled={!revealed}
            placeholder={revealed ? "" : "could not be read — left unchanged on save"}
          /></label>
        <label><span>Date of birth</span>
          <input
            type="date"
            value={form.dob || ""}
            onChange={set("dob")}
            disabled={!revealed}
          /></label>

        <label className="tfb-filerform--wide"><span>Street</span>
          <input value={form.address_street || ""} onChange={set("address_street")} /></label>
        <label><span>City</span>
          <input value={form.address_city || ""} onChange={set("address_city")} /></label>
        <label><span>State / region</span>
          <input value={form.address_region || ""} onChange={set("address_region")} /></label>
        <label><span>Postal code</span>
          <input value={form.address_postal || ""} onChange={set("address_postal")} /></label>
        <label><span>Country (2-letter)</span>
          <input
            maxLength={2}
            value={form.address_country || ""}
            onChange={(e) =>
              setForm((f) => ({ ...f, address_country: e.target.value.toUpperCase() }))}
          /></label>

        <p className="tfb-filerform__note tfb-filerform--wide">
          The TIN and date of birth are held in Postgres only. They are masked everywhere
          else in the app, are omitted from the <code>/util/appdata</code> payload, and are
          never written to a file — <code>POST /util/appdata</code> refuses this key
          outright, because that handler persists to disk.
        </p>
        {err && <p className="tfb-error">{err}</p>}
      </div>
    </Modal>
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
  // Prefilled, because the PUT REPLACES the override row rather than patching it
  // (there is no unique key on (filing_id, designation) — see the route). Opening
  // this dialog to correct an amount and leaving the box blank therefore used to
  // erase the provenance. That is how the three TY2025 typed lines ended up with
  // no `manual_reason`: the sheet could not say which statement each came from.
  const [reason, setReason] = useState(
    line.source === "typed" ? (line.detail || "") : ""
  );
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
