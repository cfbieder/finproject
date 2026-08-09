import { useMemo } from "react";
import "./FCModulesStreams.css";

/**
 * CR069 P3 — a module's P&L streams, as CARDS.
 *
 * This replaces the flat "Expenses" and "Income" field sections, and the difference is
 * structural rather than cosmetic. Those sections rendered COLUMNS: `ExpenseAmount`,
 * `IncomeFcLineId`, `IncomeGrowth`… all of which existed on every module whether or not it
 * had an expense, and all of which `fcModulePayload` sent on every save. Hiding one did not
 * clear it — which is exactly why CR064 §5 refused to gate the form on module type, and why a
 * stale `expense_amount` could go on charging the P&L invisibly (the CR062 P0 defect class).
 *
 * A stream is a ROW. A module with no expense has no expense card, because it has no expense
 * stream; removing the card removes the row. There is nothing left behind to go stale, so the
 * thing CR064 §5 could not safely do per-type is now free.
 *
 * The four modes and the four change flags are the engine's, not this component's — see
 * `server/src/services/forecast/fcbuilder-stream.js`. What this file owes them is honest
 * labels and refusing to offer a control the mode does not read.
 */

const MODES = [
  { value: "amount", label: "Amount", hint: "A base-year amount, grown each year." },
  { value: "yield", label: "Yield spread", hint: "A % of average market value, over inflation." },
  { value: "pct_of_value", label: "% of value", hint: "A rate derived from the base-year amount over market value." },
];

/** Which change flags a mode actually reads. Offering the others would be a lie. */
const FLAGS_FOR_MODE = {
  amount: [
    { value: "Fixed $", label: "Fixed $ — permanent level change, in that year's money" },
    { value: "One-Off $", label: "One-Off $ — this year only, in that year's money" },
    { value: "Percent %", label: "Percent % — override this year's growth" },
  ],
  yield: [{ value: "Spread %", label: "Spread % — yield over inflation, carries forward" }],
  pct_of_value: [],
  derived: [],
};

const emptyStream = (direction) => ({
  direction,
  mode: "amount",
  fc_line_id: null,
  amount: 0,
  growth_mult: null,
  start_date: null,
  end_date: null,
  tax_rate_override: null,
  changes: [],
});

const yearOf = (value) => (value ? String(value).slice(0, 4) : "");
const toJulyFirst = (year) => (year ? `${year}-07-01` : null);

export default function FCModulesStreams({
  streams = [],
  onChange,
  fcLines = [],
  periodYears = [],
  currency,
  lineReference = {},
  lineReferenceLoading = false,
  sharedByLine = {},
  periodStart = null,
  startYear = null,
  onDrill,
}) {
  const linesByDirection = useMemo(() => ({
    income: fcLines.filter((l) => (l.line_type || "").includes("income")),
    expense: fcLines.filter((l) => !(l.line_type || "").includes("income")),
  }), [fcLines]);

  const update = (index, patch) =>
    onChange(streams.map((s, i) => (i === index ? { ...s, ...patch } : s)));

  const remove = (index) => onChange(streams.filter((_, i) => i !== index));

  const add = (direction) => onChange([...streams, emptyStream(direction)]);

  const updateChange = (streamIdx, changeIdx, patch) =>
    update(streamIdx, {
      changes: streams[streamIdx].changes.map((c, i) =>
        (i === changeIdx ? { ...c, ...patch } : c)),
    });

  const addChange = (streamIdx) => {
    const mode = streams[streamIdx].mode || "amount";
    const flags = FLAGS_FOR_MODE[mode] || [];
    if (!flags.length) return;
    update(streamIdx, {
      changes: [...streams[streamIdx].changes, {
        change_date: toJulyFirst(periodYears[0]), amount: 0, flag: flags[0].value,
      }],
    });
  };

  const removeChange = (streamIdx, changeIdx) =>
    update(streamIdx, { changes: streams[streamIdx].changes.filter((_, i) => i !== changeIdx) });

  const renderCard = (stream, index) => {
    const mode = stream.mode || "amount";
    const isDerived = mode === "derived";
    const flags = FLAGS_FOR_MODE[mode] || [];
    const lines = linesByDirection[stream.direction] || [];

    return (
      <div key={index} className="fc-stream-card" data-direction={stream.direction}>
        <div className="fc-stream-card__head">
          <span className="fc-stream-card__badge">
            {stream.direction === "income" ? "Income" : "Expense"}
          </span>
          {isDerived ? (
            // CR062 — a loan's interest is a function of its balance. The engine derives the
            // amount on every build, so there is no amount to type here; offering an input
            // would invite the owner to edit a number nothing reads.
            <span className="fc-stream-card__derived">
              Interest — derived from the loan balance each year
            </span>
          ) : null}
          <button
            type="button"
            className="fc-stream-card__remove"
            onClick={() => remove(index)}
            aria-label={`Remove this ${stream.direction} stream`}
          >
            Remove
          </button>
        </div>

        <div className="fc-stream-card__grid">
          <label className="fc-stream-card__field">
            <span>{stream.direction === "income" ? "Income line" : "Expense line"}</span>
            <select
              value={stream.fc_line_id ?? ""}
              onChange={(e) => update(index, {
                fc_line_id: e.target.value === "" ? null : Number(e.target.value),
              })}
            >
              <option value="">— none —</option>
              {lines.map((l) => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </select>
          </label>

          {!isDerived && (
            <label className="fc-stream-card__field">
              <span>Mode</span>
              <select
                value={mode}
                onChange={(e) => {
                  const next = e.target.value;
                  // A mode change strands change rows the new mode cannot read, so they go
                  // with it — the CR062 retype discipline, in miniature. Dropping them
                  // silently would leave rows the engine never reads but the form still shows.
                  const keep = (FLAGS_FOR_MODE[next] || []).map((f) => f.value);
                  update(index, {
                    mode: next,
                    changes: stream.changes.filter((c) => keep.includes(c.flag)),
                  });
                }}
              >
                {MODES.map((m) => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
              <small>{MODES.find((m) => m.value === mode)?.hint}</small>
            </label>
          )}

          {!isDerived && mode !== "yield" && (
            <label className="fc-stream-card__field">
              <span>Amount (base year{currency && currency !== "USD" ? `, ${currency}` : ""})</span>
              <input
                type="number"
                step="0.01"
                value={stream.amount ?? 0}
                onChange={(e) => update(index, { amount: e.target.value })}
              />
              <small>Entered positive — the direction carries the sign.</small>
            </label>
          )}

          {!isDerived && mode === "amount" && (
            <label className="fc-stream-card__field">
              <span>Growth (× inflation)</span>
              <input
                type="number"
                step="0.01"
                value={stream.growth_mult ?? ""}
                placeholder="1"
                onChange={(e) => update(index, {
                  growth_mult: e.target.value === "" ? null : e.target.value,
                })}
              />
              {/*
                CR076 §5 — this hint had its two clauses SWAPPED, and 70 of 110 amount streams
                carry an explicit multiplier chosen while reading it.

                The engine is `pct[i] = inflation × mult` compounded on the prior level
                (`fcbuilder-stream.js`). So mult = 1 tracks inflation and is what holds its value
                in today's money; mult = 0 freezes the CASH amount and therefore SHRINKS ~2.5%/yr
                in real terms. The old text promised the opposite of both.
              */}
              <small>
                Blank = 1 = keeps pace with inflation, so it holds its value in today&apos;s
                money. 0 = the same cash every year, which buys less each year. 0.5 = rises at
                half inflation, so it still shrinks in real terms.
              </small>
            </label>
          )}

          {!isDerived && (
            <>
              <label className="fc-stream-card__field">
                <span>Start year</span>
                <select
                  value={yearOf(stream.start_date)}
                  onChange={(e) => update(index, { start_date: toJulyFirst(e.target.value) })}
                >
                  {/* Blank does NOT mean "no start" — it means the stream runs from the module's
                      own first year, which the label now names. A flow module anchors at
                      PeriodStart, a valuation module at its base date (fcbuilder-module.js:131),
                      so the year differs by module type and saying "the base year" was wrong on
                      half of them.

                      Deliberately still the DEFAULT, against the request to default it to the
                      period start: a start date is stored as July 1 and `applyStreamWindow`
                      HALVES its first year. Picking 2027 here would silently turn a 34,717
                      expense into 17,358 in 2027 — the option is for a stream that genuinely
                      begins mid-plan, not for restating where the plan starts. */}
                  <option value="">
                    {startYear ? `— from ${startYear} —` : "— from the start —"}
                  </option>
                  {periodYears.map((y) => <option key={y} value={y}>{y}</option>)}
                </select>
                <small>
                  {startYear
                    ? `Blank runs from ${startYear}. Choosing a year starts it then — and that first year counts by half.`
                    : "Blank runs from the first forecast year. Choosing a year starts it then — and that first year counts by half."}
                </small>
              </label>
              <label className="fc-stream-card__field">
                <span>End year</span>
                <select
                  value={yearOf(stream.end_date)}
                  onChange={(e) => update(index, { end_date: toJulyFirst(e.target.value) })}
                >
                  <option value="">— to the horizon —</option>
                  {periodYears.map((y) => <option key={y} value={y}>{y}</option>)}
                </select>
              </label>
            </>
          )}

          {stream.direction === "income" && !isDerived && (
            <label className="fc-stream-card__field">
              <span>Income tax override (%)</span>
              <input
                type="number"
                step="0.001"
                value={stream.tax_rate_override ?? ""}
                placeholder="scenario rate"
                onChange={(e) => update(index, {
                  tax_rate_override: e.target.value === "" ? null : e.target.value,
                })}
              />
              <small>For income already taxed elsewhere. 0 is a real rate.</small>
            </label>
          )}
        </div>

        {/* What this line actually cost, beside the number that plans it. Three years anchored on
            the module's base year: last COMPLETE actual, this year's budget, this year to date.
            Shown only when there is something to show — a line with no history renders nothing
            rather than a row of dashes. */}
        {stream.fc_line_id != null && periodStart && (() => {
          const ref = lineReference?.[Number(stream.fc_line_id)] || {};
          const shared = sharedByLine?.[Number(stream.fc_line_id)] || 0;
          const lineName =
            (linesByDirection[stream.direction === "income" ? "income" : "expense"] || [])
              .find((l) => Number(l.id) === Number(stream.fc_line_id))?.name || "";
          const rows = [
            // Labelled from PeriodStart, the same anchor the fetch used — if these two ever
            // disagree the figures are right and the headings lie, which is the worse failure.
            ["priorActual", `Actual ${periodStart - 2}`, `${ref.priorActualCount ?? 0} txns · complete`, periodStart - 2, "actual"],
            ["thisBudget", `Budget ${periodStart - 1}`, "", periodStart - 1, "budget"],
            ["thisActual", `Actual ${periodStart - 1}`, `${ref.thisActualCount ?? 0} txns · year to date`, periodStart - 1, "actual"],
          ].filter(([k]) => ref[k] != null);
          if (lineReferenceLoading) {
            return <p className="fc-stream-card__reference-empty">Loading actuals…</p>;
          }
          if (!rows.length) return null;
          return (
            <div className="fc-stream-card__reference">
              <div className="fc-stream-card__reference-head">
                {lineName || "This line"}
                {/* The total is the LINE's, not this module's. Saying so is the whole point:
                    six modules feed Property Costs, so the figure is not a like-for-like. */}
                {shared > 1 && (
                  <span className="fc-stream-card__reference-warn">
                    {" "}— whole line, {shared} modules share it
                  </span>
                )}
              </div>
              {rows.map(([key, label, note, drillYear, kind]) => {
                // The drill opens a dialog, and this card sits three levels inside the module
                // editor's own dialog. So the row does not own the modal — it asks the PARENT
                // to open one, which renders it as a sibling of that editor. Nesting it here
                // was the earlier attempt, and it never appeared.
                const canDrill = drillYear != null && typeof onDrill === "function";
                return (
                  <div
                    key={key}
                    className={`fc-stream-card__reference-row${canDrill ? " fc-stream-card__reference-row--drillable" : ""}`}
                    /* Double-click, not single: these rows sit inside a form, and a stray click
                       while tabbing through it should not fire a query. */
                    onDoubleClick={canDrill
                      ? () => onDrill({
                        year: drillYear,
                        fcLineId: Number(stream.fc_line_id),
                        kind,
                        lineName: lineName || "This line",
                      })
                      : undefined}
                    title={canDrill
                      ? "Double-click to see the transactions behind this figure"
                      : undefined}
                  >
                    <span>{label}</span>
                    <strong>
                      {ref[key].toLocaleString(undefined, {
                        minimumFractionDigits: 0, maximumFractionDigits: 0,
                      })}
                    </strong>
                    <small>{note}{canDrill ? " · double-click" : ""}</small>
                  </div>
                );
              })}
            </div>
          );
        })()}

        {flags.length > 0 && (
          <div className="fc-stream-card__changes">
            <div className="fc-stream-card__changes-head">
              <span>Changes over time</span>
              <button type="button" onClick={() => addChange(index)}>+ Add change</button>
            </div>
            {stream.changes.length === 0 ? (
              <p className="fc-stream-card__empty">None — this stream just grows.</p>
            ) : (
              stream.changes.map((c, ci) => (
                <div key={ci} className="fc-stream-card__change">
                  <select
                    value={yearOf(c.change_date)}
                    onChange={(e) => updateChange(index, ci, {
                      change_date: `${e.target.value}-12-31`,
                    })}
                    aria-label="Year"
                  >
                    {periodYears.map((y) => <option key={y} value={y}>{y}</option>)}
                  </select>
                  <select
                    value={c.flag}
                    onChange={(e) => updateChange(index, ci, { flag: e.target.value })}
                    aria-label="Kind"
                  >
                    {flags.map((f) => (
                      <option key={f.value} value={f.value}>{f.label}</option>
                    ))}
                  </select>
                  <input
                    type="number"
                    step="0.01"
                    value={c.amount ?? 0}
                    onChange={(e) => updateChange(index, ci, { amount: e.target.value })}
                    aria-label="Amount"
                  />
                  <button type="button" onClick={() => removeChange(index, ci)} aria-label="Remove change">
                    ×
                  </button>
                </div>
              ))
            )}
            {/* The sign rule, said where it is typed rather than only in the migration. */}
            <p className="fc-stream-card__hint">
              A change is <b>more of this stream</b> when positive: on an expense,
              <b> −25,000</b> means the cost falls by 25,000. A <b>Percent %</b> is a rate —
              <b> −100</b> ends the stream.
            </p>
            {/*
              CR076 §7 — the money basis, said where the number is typed.

              The engine is `level[i] = prev × (1 + growth) + fixed[i]`: the escalation applies to
              the PREVIOUS level, and a Fixed $ is added RAW. So the amount enters at face value in
              its own year and keeps pace only from then on — it is NOT expressed in today's money.
              Verified against `Social Security`: 20,000 at 2035 → 25,602 at 2045, exactly
              20,000 × 1.025¹⁰.

              Worth saying on the form because the gap grows with the horizon and is invisible:
              `Retirement Home`'s 200,000 at 2052 is about 105,000 in 2026 money.
            */}
            <p className="fc-stream-card__hint">
              A <b>$</b> amount is in the money of <b>the year you date it</b>, not today&apos;s. It
              keeps pace with inflation from that year onward — so 200,000 dated 2052 is 200,000 of
              2052 dollars, worth roughly half that today. To mean today&apos;s money, enter the
              amount inflated to that year.
            </p>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="fc-stream-cards">
      {streams.length === 0 && (
        <p className="fc-stream-cards__empty">
          This module has no income or expense. Add a stream to give it one.
        </p>
      )}
      {streams.map(renderCard)}
      <div className="fc-stream-cards__add">
        <button type="button" onClick={() => add("income")}>+ Add income</button>
        <button type="button" onClick={() => add("expense")}>+ Add expense</button>
      </div>
    </div>
  );
}
