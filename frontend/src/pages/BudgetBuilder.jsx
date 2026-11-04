import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import Rest from "../js/rest.js";
import Modal from "../components/Modal/Modal.jsx";
import BuildCompare from "../features/Budgets/BuildCompare.jsx";
import "./PageLayout.css";
import "./BudgetBuilder.css";

/**
 * CR098 — the budget builder.
 *
 * Next year's budget from this year's latest finalised Latest Estimate. Each line is a
 * (category, currency) of the LE; a remembered policy — Recurring (× inflation), One-off (0) or
 * Fixed (typed) — sets its annual figure, and the last twelve actual months split it across
 * accounts and months. Nothing touches the real budget until Publish, which previews what it
 * deletes and writes, replaces the year in one go, and can be undone. Every build is numbered
 * (2027 v1, v2 …) and can carry a name: a year can hold several drafts side by side, a new draft can
 * start from any build, and any published-before build can be restored.
 */

const POLICIES = [
  { value: "recurring", label: "Recurring" },
  { value: "one_off", label: "One-off" },
  { value: "fixed", label: "Fixed" },
];
const SPLIT_LABEL = { auto: "from actuals", even: "even", month: "one month", custom: "month weights" };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const fmt = (v, digits = 0) =>
  v == null || !Number.isFinite(Number(v))
    ? "—"
    : Number(v).toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
const commitOnEnter = (e) => { if (e.key === "Enter") e.currentTarget.blur(); };
// A focused number field changes under the mouse wheel — drop focus instead of the amount.
const blurOnWheel = (e) => e.currentTarget.blur();
const neg = (v) => (Number(v) < 0 ? "bb-neg" : undefined);
const STATUS = { draft: "draft", published: "live", superseded: "superseded", unpublished: "un-published" };
const buildLabel = (b) =>
  `${b.target_year ?? b.targetYear} v${b.build_no ?? b.buildNo} · ${STATUS[b.status] || b.status}` +
  `${b.note ? ` — ${b.note}` : ""}`;
// Where the page opens: the newest year's live build, else that year's newest (builds arrive newest first).
const defaultBuild = (builds) =>
  builds.find((b) => b.target_year === builds[0].target_year && b.status === "published") || builds[0];

function RateLine({ label, rate, targetYear, digits = 2, suffix = "" }) {
  if (!rate) return <span className="bb-rate">{label}: <strong>no rate</strong></span>;
  const carried = rate.fromYear != null && rate.fromYear < targetYear;
  return (
    <span className="bb-rate">
      {label} <strong>{fmt(rate.rate, digits)}{suffix}</strong>
      {rate.fromYear != null && (
        <span className="bb-muted"> · {carried ? `carried forward from ${rate.fromYear}` : `set for ${rate.fromYear}`}</span>
      )}
    </span>
  );
}

/**
 * A line's month weights, as percentages of its annual figure: blank is nothing that month. The
 * running total says what is left to place, and nothing saves until the months total 100%, when
 * focus leaves the row. The parent keys this on the saved weights, so a save or refusal resets it.
 */
function MonthWeights({ line, busy, onSave }) {
  const saved = MONTHS.map((_, i) => (line.splitWeights?.[i] ? String(line.splitWeights[i]) : ""));
  const [values, setValues] = useState(saved);
  const total = Math.round(values.reduce((s, v) => s + (Number(v) || 0), 0) * 100) / 100;
  const left = Math.round((100 - total) * 100) / 100;
  const dirty = values.some((v, i) => v.trim() !== saved[i]);
  return (
    <>
      <p className="bb-weights-status" role="status">
        <strong>{fmt(total, 2)}%</strong> allocated ·{" "}
        {left === 0 ? "complete" : left > 0 ? `${fmt(left, 2)}% left to allocate` : `${fmt(-left, 2)}% over`}
        {dirty && left !== 0 && <span className="bb-muted"> · not saved until the months total 100%</span>}
      </p>
      <table className="bb-months bb-weights">
        <thead><tr>{MONTHS.map((m) => <th key={m} className="num">{m}</th>)}</tr></thead>
        <tbody>
          <tr onBlur={(e) => {
            if (e.currentTarget.contains(e.relatedTarget)) return;
            if (dirty && left === 0) onSave(values.map((v) => v.trim()));
          }}>
            {MONTHS.map((m, i) => (
              <td key={m} className="num">
                <input type="number" min="0" step="0.01" className="bb-num-input" placeholder="0"
                  aria-label={`${line.category} percent for ${m}`} value={values[i]} disabled={busy}
                  onChange={(e) => setValues(values.map((v, j) => (j === i ? e.target.value : v)))}
                  onKeyDown={commitOnEnter} onWheel={blurOnWheel} />
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </>
  );
}

function BudgetBuilder() {
  const [sources, setSources] = useState({ les: [], scenarios: [], builds: [] });
  const [selectedId, setSelectedId] = useState(null);
  const [view, setView] = useState(null);
  const [split, setSplit] = useState(null);       // preview data, for the month rows
  const [openLine, setOpenLine] = useState(null);
  const [pendingCustom, setPendingCustom] = useState(null); // a line switching to month weights, not yet saved
  const [form, setForm] = useState({ leId: "", scenario: "", parentId: "", note: "" });
  const [dialog, setDialog] = useState(null);     // { kind: 'publish' | 'unpublish' | 'delete', preview? }
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [rev, setRev] = useState(0);              // remounts the number inputs after every save, kept or refused
  const [comparing, setComparing] = useState(false);

  const loadSources = useCallback(async () => {
    const data = Rest.unwrap(await Rest.get("/budget-builder"));
    setSources(data);
    return data;
  }, []);

  const loadBuild = useCallback(async (id) => {
    if (!id) return;
    const data = Rest.unwrap(await Rest.get(`/budget-builder/${id}`));
    setView(data);
    setSplit(null);
  }, []);

  useEffect(() => {
    let cancelled = false;
    loadSources()
      .then((data) => {
        if (cancelled) return;
        setForm((f) => ({ ...f, leId: f.leId || data.les[0]?.id || "", scenario: f.scenario || data.scenarios[0] || "" }));
        if (data.builds.length) setSelectedId(defaultBuild(data.builds).id);
      })
      .catch((e) => !cancelled && setError(e.message || "Could not load the builder"));
    return () => { cancelled = true; };
  }, [loadSources]);

  useEffect(() => {
    if (!selectedId) return undefined;
    let cancelled = false;
    Rest.get(`/budget-builder/${selectedId}`)
      .then((r) => { if (!cancelled) { setView(Rest.unwrap(r)); setSplit(null); } })
      .catch((e) => !cancelled && setError(e.message || "Could not load that build"));
    return () => { cancelled = true; };
  }, [selectedId]);

  const shown = view && view.build.id === selectedId ? view : null;
  const isDraft = shown?.build.status === "draft";
  const targetYear = shown?.build.targetYear;

  const run = async (fn, okMessage) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
      if (okMessage) setNotice(okMessage);
    } catch (e) {
      setError(e?.message || "That did not work");
    } finally {
      setBusy(false);
    }
  };

  const createDraft = () => run(async () => {
    const res = Rest.unwrap(await Rest.post("/budget-builder", {
      sourceLeId: Number(form.leId), scenarioName: form.scenario,
      parentBuildId: form.parentId ? Number(form.parentId) : null, note: form.note || null,
    }));
    await loadSources();
    setSelectedId(res.build.id);
    setForm((f) => ({ ...f, note: "", parentId: "" }));
    if (res.dropped?.length) {
      setNotice(`${res.dropped.length} line(s) of the build you started from are not in this LE and were not carried (they were not Fixed).`);
    }
  });

  // A copy of a build of the same year is a copy: it takes that build's estimate and scenario, so a
  // newer estimate in the form cannot silently change every line. A scenario that can no longer
  // price it stays as chosen; a build of another year seeds settings only.
  const chooseStartFrom = (value) => {
    const parent = sources.builds.find((b) => b.id === Number(value));
    const le = sources.les.find((l) => l.id === Number(form.leId));
    const sameYear = parent && le && parent.target_year === le.budget_year + 1;
    setForm({
      ...form,
      parentId: value,
      leId: sameYear && sources.les.some((l) => l.id === parent.source_le_id) ? parent.source_le_id : form.leId,
      scenario: sameYear && parent.has_rates && sources.scenarios.includes(parent.scenario_name)
        ? parent.scenario_name : form.scenario,
    });
  };

  const saveName = (note) => run(async () => {
    try {
      setView(Rest.unwrap(await Rest.patch(`/budget-builder/${selectedId}`, { note })));
      await loadSources();
    } finally {
      setRev((r) => r + 1);
    }
  });

  // The owner's own planning mark: saved straight away, changes no figure, and never closes a row.
  const toggleDone = (line) => run(async () => {
    setView(Rest.unwrap(await Rest.patch(`/budget-builder/${selectedId}/lines/${line.id}/done`, { done: !line.done })));
  });

  const patchLine = (lineId, patch) => run(async () => {
    try {
      const data = Rest.unwrap(await Rest.patch(`/budget-builder/${selectedId}/lines/${lineId}`, patch));
      setView(data);
      setSplit(null);
    } finally {
      setRev((r) => r + 1);
    }
  });

  const loadSplit = () => run(async () => {
    setSplit(Rest.unwrap(await Rest.get(`/budget-builder/${selectedId}/preview`)));
  });

  const openDialog = (kind) => run(async () => {
    const preview = kind === "publish" ? Rest.unwrap(await Rest.get(`/budget-builder/${selectedId}/preview`)) : null;
    setDialog({ kind, preview });
  });

  const confirmDialog = () => run(async () => {
    const { kind, preview } = dialog;
    if (kind === "publish") {
      const r = Rest.unwrap(await Rest.post(`/budget-builder/${selectedId}/publish`, { checksum: preview.checksum }));
      setNotice(`Published ${r.year} v${r.buildNo}: ${fmt(r.written)} budget rows written.`);
    } else if (kind === "unpublish") {
      const r = Rest.unwrap(await Rest.post(`/budget-builder/${selectedId}/unpublish`, {}));
      setNotice(`Un-published: the ${r.year} budget is back as it was (${fmt(r.restored)} rows)` +
        (r.live ? ` — ${r.year} v${r.live} is live again.` : " — before any build."));
    } else if (kind === "delete") {
      await Rest.del(`/budget-builder/${selectedId}`);
      setForm((f) => (Number(f.parentId) === selectedId ? { ...f, parentId: "" } : f));
      setSelectedId(null);
      setView(null);
    }
    setDialog(null);
    const data = await loadSources();
    if (kind !== "delete") await loadBuild(selectedId);
    else if (data.builds.length) setSelectedId(defaultBuild(data.builds).id);
  });

  const splitById = useMemo(() => new Map((split?.split || []).map((s) => [s.id, s])), [split]);
  const linesById = useMemo(() => new Map((view?.lines || []).map((l) => [l.id, l])), [view]);
  const hasPublished = (b) => b.status === "superseded" || b.status === "unpublished";
  const canPublish = shown && (isDraft || hasPublished(shown.build));
  const readersNote = (readers) =>
    readers?.length
      ? `${readers.join(", ")} use${readers.length === 1 ? "s" : ""} this year as its base year — regenerate after this.`
      : null;

  return (
    <main className="page-container">
      <div className="report-toolbar-header">
        <div className="report-toolbar-header__text">
          <h1 className="report-toolbar-header__title">Budget Builder</h1>
          <p className="report-toolbar-header__description">
            Next year&apos;s budget from this year&apos;s latest finalised estimate. Set each category to
            Recurring, One-off or Fixed; nothing changes the real budget until you publish.
          </p>
        </div>
      </div>

      <section className="bb-toolbar" aria-label="Builds">
        <label className="bb-field">
          <span className="bb-label">Build</span>
          <select value={selectedId ?? ""} onChange={(e) => setSelectedId(Number(e.target.value) || null)}
            disabled={!sources.builds.length || busy}>
            {!sources.builds.length && <option value="">none yet</option>}
            {sources.builds.map((b) => (
              <option key={b.id} value={b.id}>{buildLabel(b)} · {b.le_name}</option>
            ))}
          </select>
        </label>
        {shown && (
          <label className="bb-field">
            <span className="bb-label">Name</span>
            <input key={`n${shown.build.id}-${shown.build.note ?? ""}-${rev}`} type="text"
              defaultValue={shown.build.note ?? ""} placeholder="none" disabled={busy} onKeyDown={commitOnEnter}
              onBlur={(e) => {
                const v = e.target.value.trim();
                if (v !== (shown.build.note ?? "")) saveName(v);
              }} />
          </label>
        )}
        <div className="bb-actions">
          {canPublish && (
            <button type="button" className="btn btn--primary" onClick={() => openDialog("publish")} disabled={busy}>
              {isDraft ? "Publish…" : "Restore this build…"}
            </button>
          )}
          {shown?.build.status === "published" && (
            <button type="button" className="btn btn--outline" onClick={() => openDialog("unpublish")} disabled={busy}>
              Un-publish…
            </button>
          )}
          {isDraft && (
            <button type="button" className="btn btn--outline" onClick={() => openDialog("delete")} disabled={busy}>
              Delete draft
            </button>
          )}
          {shown && (
            <button type="button" className="btn btn--outline" aria-pressed={comparing}
              onClick={() => setComparing((c) => !c)}>
              {comparing ? "Hide comparison" : "Compare builds"}
            </button>
          )}
        </div>
      </section>

      <section className="bb-toolbar" aria-label="New draft">
        <label className="bb-field">
          <span className="bb-label">Estimate</span>
          <select value={form.leId} onChange={(e) => setForm({ ...form, leId: e.target.value })} disabled={busy}>
            {!sources.les.length && <option value="">no finalised estimate</option>}
            {sources.les.map((l) => (
              <option key={l.id} value={l.id}>{l.name} → {l.budget_year + 1} budget</option>
            ))}
          </select>
        </label>
        <label className="bb-field">
          <span className="bb-label">Rates from</span>
          <select value={form.scenario} onChange={(e) => setForm({ ...form, scenario: e.target.value })} disabled={busy}>
            {sources.scenarios.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label className="bb-field">
          <span className="bb-label">Start from</span>
          <select value={form.parentId} onChange={(e) => chooseStartFrom(e.target.value)} disabled={busy}>
            <option value="">remembered settings</option>
            {sources.builds.map((b) => <option key={b.id} value={b.id}>{buildLabel(b)}</option>)}
          </select>
        </label>
        <label className="bb-field">
          <span className="bb-label">Name</span>
          <input type="text" value={form.note} placeholder="optional"
            onChange={(e) => setForm({ ...form, note: e.target.value })} disabled={busy} />
        </label>
        <div className="bb-actions">
          <button type="button" className="btn btn--outline" onClick={createDraft}
            disabled={busy || !form.leId || !form.scenario}>
            New draft
          </button>
        </div>
      </section>

      {error && !dialog && <p className="bb-error" role="alert">{error}</p>}
      {notice && <p className="bb-notice" role="status">{notice}</p>}

      {!sources.builds.length && !error && (
        <p className="bb-muted">
          No build yet. Pick a finalised estimate and the scenario whose inflation and exchange rates to
          use, then <strong>New draft</strong>.
        </p>
      )}

      {shown && comparing && (
        <BuildCompare year={targetYear} current={shown} refreshKey={sources.builds} />
      )}

      {shown && (
        <>
          <section className="bb-rates" aria-label="Rates">
            <span>
              <strong>{targetYear} v{shown.build.buildNo}</strong>
              <span className="bb-muted"> · {STATUS[shown.build.status]} · from {shown.build.le.name} · rates from {shown.build.scenario}</span>
            </span>
            <RateLine label="Inflation" rate={shown.rates.inflation} targetYear={targetYear} digits={1} suffix="%" />
            <RateLine label="PLN per USD" rate={shown.rates.fx.PLN} targetYear={targetYear} />
            <RateLine label="EUR per USD" rate={shown.rates.fx.EUR} targetYear={targetYear} />
            <span className="bb-rate">
              <strong>{shown.lines.filter((l) => l.done).length}</strong> of {shown.lines.length} lines done
            </span>
            {isDraft && [shown.rates.inflation, shown.rates.fx.PLN, shown.rates.fx.EUR].some((r) => r && r.fromYear < targetYear) && (
              <span className="bb-muted">
                Rates for {targetYear} are not set in {shown.build.scenario}; set them on Forecast Scenarios
                first if these are not what you expect.
              </span>
            )}
            {isDraft && !shown.rates.inflation && (
              <span className="bb-flag">
                {shown.build.scenario} has no inflation rate, so Recurring lines have no figure and this draft
                cannot be published. Start a new draft from it with another scenario, or restore the rates.
              </span>
            )}
            <button type="button" className="btn btn--outline bb-push-right" onClick={loadSplit} disabled={busy}>
              {split ? "Refresh month split" : "Show month split"}
            </button>
          </section>

          <div className="bb-table-wrap">
            <table className="bb-table">
              <thead>
                <tr>
                  <th>Category</th>
                  <th>Cur</th>
                  <th className="num">{shown.build.le.name}</th>
                  <th>Policy</th>
                  <th className="num">Inflation %</th>
                  <th className="num">Fixed (local, signed)</th>
                  <th className="num">Budget {targetYear}</th>
                  <th className="num">In USD</th>
                  <th className="num">vs estimate</th>
                  <th className="num">Budget {shown.build.le.year}</th>
                  <th>Months</th>
                </tr>
              </thead>
              <tbody>
                {shown.rows.map((row, i) => {
                  if (row.kind === "group") {
                    return (
                      <tr key={`group-${row.categoryId ?? "other"}`} className={`bb-row--group bb-row--group-d${Math.min(row.depth, 2)}`}>
                        <td colSpan={7} style={{ paddingLeft: `${0.5 + row.depth * 1.1}rem` }}>{row.name}</td>
                        <td className={`num ${neg(row.usd) || ""}`}>{fmt(row.usd)}</td>
                        <td colSpan={3} />
                      </tr>
                    );
                  }
                  const l = linesById.get(row.lineId);
                  const s = splitById.get(l.id);
                  const signFlipped = l.policy === "fixed" && l.fixedAmount && Number(l.leFy) &&
                    Math.sign(l.fixedAmount) !== Math.sign(Number(l.leFy));
                  const rowClass = [i % 2 ? "bb-row--alt" : "", l.isParent && l.annual ? "bb-row--blocked" : ""]
                    .filter(Boolean).join(" ") || undefined;
                  return (
                    <Fragment key={l.id}>
                      <tr className={rowClass}>
                        <td style={{ paddingLeft: `${0.5 + row.depth * 1.1}rem` }}>
                          <button type="button" className="bb-done" aria-pressed={l.done} disabled={busy}
                            aria-label={`${l.category} (${l.currency}) ${l.done ? "done — mark not done" : "mark done"}`}
                            title={l.done ? "Done — click to unmark" : "Mark this line done"}
                            onClick={() => toggleDone(l)}>
                            {l.done ? "✓" : ""}
                          </button>
                          <button type="button" className="bb-linkish" onClick={() => setOpenLine(openLine === l.id ? null : l.id)}
                            aria-expanded={openLine === l.id}>
                            {l.category}
                          </button>
                          {l.isParent && <span className="bb-flag"> ⚠ parent — not in the forecast&apos;s base year</span>}
                          {!l.isParent && !l.onForecastLine && <span className="bb-muted"> · on no forecast line</span>}
                        </td>
                        <td>{l.currency}</td>
                        <td className={`num ${neg(l.leFy) || ""}`}>{fmt(l.leFy)}</td>
                        <td>
                          {isDraft ? (
                            <select value={l.policy} aria-label={`${l.category} policy`} disabled={busy}
                              onChange={(e) => patchLine(l.id, { policy: e.target.value })}>
                              {POLICIES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                            </select>
                          ) : POLICIES.find((p) => p.value === l.policy)?.label}
                        </td>
                        <td className="num">
                          {l.policy === "recurring" && isDraft ? (
                            <input key={`i${l.id}-${l.inflationPct}-${rev}`} type="number" step="0.1" className="bb-num-input"
                              aria-label={`${l.category} inflation override`} defaultValue={l.inflationPct ?? ""}
                              placeholder={fmt(shown.rates.inflation?.rate, 1)} disabled={busy}
                              onKeyDown={commitOnEnter} onWheel={blurOnWheel}
                              onBlur={(e) => {
                                const v = e.target.value === "" ? null : Number(e.target.value);
                                if (v !== l.inflationPct) patchLine(l.id, { inflationPct: v });
                              }} />
                          ) : l.policy === "recurring" ? fmt(l.effectiveInflationPct, 1) : ""}
                        </td>
                        <td className="num">
                          {l.policy === "fixed" && isDraft ? (
                            <input key={`f${l.id}-${l.fixedAmount}-${rev}`} type="number" step="1" className="bb-num-input"
                              aria-label={`${l.category} fixed amount, ${l.currency}, signed`} defaultValue={l.fixedAmount ?? ""}
                              disabled={busy} onKeyDown={commitOnEnter} onWheel={blurOnWheel}
                              onBlur={(e) => {
                                const v = e.target.value === "" ? null : Number(e.target.value);
                                if (v !== l.fixedAmount) patchLine(l.id, { fixedAmount: v });
                              }} />
                          ) : l.policy === "fixed" ? fmt(l.fixedAmount) : ""}
                          {signFlipped && <div className="bb-flag">⚠ opposite sign to the estimate</div>}
                        </td>
                        <td className={`num bb-strong ${neg(l.annual) || ""}`}>{fmt(l.annual)}</td>
                        <td className={`num ${neg(l.annualUsd) || ""}`}>{fmt(l.annualUsd)}</td>
                        <td className={`num ${neg(l.vsLe) || ""}`}>{fmt(l.vsLe)}</td>
                        <td className={`num ${neg(l.thisYearBudget) || ""}`}>{fmt(l.thisYearBudget)}</td>
                        <td>
                          {isDraft ? (
                            <span className="bb-split">
                              <select value={pendingCustom === l.id ? "custom" : l.splitMethod}
                                aria-label={`${l.category} month split`} disabled={busy}
                                onChange={(e) => {
                                  const method = e.target.value;
                                  setOpenLine(method === "custom" ? l.id : openLine === l.id ? null : openLine);
                                  // Month weights start blank and save only once they total 100%; until then
                                  // the line keeps the split it had.
                                  setPendingCustom(method === "custom" && l.splitMethod !== "custom" ? l.id : null);
                                  if (method === l.splitMethod) return;
                                  if (method === "custom") return;
                                  patchLine(l.id, method === "month" ? { splitMethod: "month", splitMonth: l.splitMonth || 1 }
                                    : { splitMethod: method });
                                }}>
                                <option value="auto">from actuals</option>
                                <option value="even">even</option>
                                <option value="month">one month</option>
                                <option value="custom">month weights</option>
                              </select>
                              {l.splitMethod === "month" && (
                                <select value={l.splitMonth || 1} aria-label={`${l.category} month`} disabled={busy}
                                  onChange={(e) => patchLine(l.id, { splitMethod: "month", splitMonth: Number(e.target.value) })}>
                                  {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
                                </select>
                              )}
                            </span>
                          ) : SPLIT_LABEL[l.splitMethod] || l.splitMethod}
                        </td>
                      </tr>
                      {openLine === l.id && (
                        <tr className="bb-months-row">
                          <td colSpan={11}>
                            {isDraft && (l.splitMethod === "custom" || pendingCustom === l.id) && (
                              <>
                                <span className="bb-muted">
                                  Month weights: the percentage of the annual figure in each month; blank is nothing that month.
                                </span>
                                <MonthWeights key={`w${l.id}-${(l.splitWeights || []).join()}-${rev}`} line={l} busy={busy}
                                  onSave={(values) => {
                                    setPendingCustom(null);
                                    patchLine(l.id, { splitMethod: "custom", splitWeights: values });
                                  }} />
                              </>
                            )}
                            {s ? (
                              <>
                                <table className="bb-months">
                                  <thead><tr>{MONTHS.map((m) => <th key={m} className="num">{m}</th>)}</tr></thead>
                                  <tbody><tr>{s.months.map((v, i) => <td key={i} className={`num ${neg(v) || ""}`}>{fmt(v)}</td>)}</tr></tbody>
                                </table>
                                <span className="bb-muted">
                                  {s.splitApplied.startsWith("lump")
                                    ? `An annual payment, all in ${MONTHS[Number(s.splitApplied.split(":")[1]) - 1]}`
                                    : { auto: "Spread like last year's months", even: "Spread evenly", month: "All in one month", custom: "By your month weights", stored: "As published" }[s.splitApplied] || s.splitApplied}
                                  {s.splitSource !== "stored" && (
                                    <> · {s.splitApplied === "custom" ? "accounts" : "pattern"} from {s.splitSource === "actuals" ? `actuals ${split.window?.from} – ${split.window?.to}` : s.splitSource === "budget" ? `the ${shown.build.le.year} budget` : s.splitApplied === "custom" ? "nothing (no account)" : "nothing (even months)"}</>
                                  )}
                                  {" "}· {s.accounts.length} account(s)
                                </span>
                              </>
                            ) : split ? (
                              <span className="bb-muted">No month split yet: {split.blockers.join(" ")}</span>
                            ) : (
                              <span className="bb-muted">Press <strong>Show month split</strong> to see this line by month.</span>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
              <tfoot>
                {Object.entries(shown.totals).map(([cur, total]) => (
                  <tr key={cur}>
                    <td colSpan={6}>Total {cur}</td>
                    <td className={`num bb-strong ${neg(total) || ""}`}>{fmt(total)}</td>
                    <td colSpan={4} />
                  </tr>
                ))}
                <tr>
                  <td colSpan={7}>Total in USD, at the rates above</td>
                  <td className={`num bb-strong ${neg(shown.usdTotal) || ""}`}>{fmt(shown.usdTotal)}</td>
                  <td colSpan={3} />
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}

      <Modal
        open={dialog != null}
        onClose={busy ? undefined : () => setDialog(null)}
        dismissable={!busy}
        size="wide"
        title={
          dialog?.kind === "publish" ? (isDraft ? `Publish ${targetYear} v${shown?.build.buildNo}?` : `Restore ${targetYear} v${shown?.build.buildNo}?`)
            : dialog?.kind === "unpublish" ? `Un-publish ${targetYear} v${shown?.build.buildNo}?`
            : `Delete ${targetYear} v${shown?.build.buildNo}?`
        }
        footer={dialog && (
          <>
            <button type="button" className="btn btn--outline" onClick={() => setDialog(null)} disabled={busy}>Cancel</button>
            <button type="button" className="btn btn--primary" onClick={confirmDialog}
              disabled={busy || (dialog.kind === "publish" && dialog.preview?.blockers.length > 0)}>
              {busy ? "Working…" : dialog.kind === "publish" ? (isDraft ? "Publish" : "Restore") : dialog.kind === "unpublish" ? "Un-publish" : "Delete"}
            </button>
          </>
        )}
      >
        {dialog && error && <p className="bb-error" role="alert">{error}</p>}
        {dialog?.kind === "publish" && dialog.preview && (
          <div className="bb-dialog">
            {dialog.preview.blockers.length > 0 && (
              <ul className="bb-blockers">
                {dialog.preview.blockers.map((b) => <li key={b}>⚠ {b}</li>)}
              </ul>
            )}
            <p>
              This <strong>replaces the whole {targetYear} budget</strong>: {fmt(dialog.preview.current.count)} row(s) now
              (USD {fmt(dialog.preview.current.usd)}) are removed and {fmt(dialog.preview.willWrite.count)} written
              (USD {fmt(dialog.preview.willWrite.usd)}). The {targetYear} budget exchange rates are set to the rates
              above. Un-publish puts everything back while nobody has edited the year.
            </p>
            {dialog.preview.offForecast?.count > 0 && (
              <p className="bb-flag">
                ⚠ USD {fmt(dialog.preview.offForecast.usd)} on {dialog.preview.offForecast.count} line(s) is published
                but on no forecast line, so the forecast will not see it: {dialog.preview.offForecast.categories.join(", ")}.
              </p>
            )}
            {dialog.preview.current.rows.length > 0 && (
              <table className="bb-table bb-table--compact">
                <thead><tr><th>Removed</th><th>Cur</th><th className="num">Rows</th><th className="num">Amount</th></tr></thead>
                <tbody>
                  {dialog.preview.current.rows.map((r) => (
                    <tr key={`${r.category}|${r.currency}`}>
                      <td>{r.category}</td><td>{r.currency}</td><td className="num">{r.count}</td>
                      <td className={`num ${neg(r.amount) || ""}`}>{fmt(r.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {readersNote(dialog.preview.readers) && <p className="bb-flag">⚠ {readersNote(dialog.preview.readers)}</p>}
          </div>
        )}
        {dialog?.kind === "unpublish" && (
          <p className="bb-dialog">
            The {targetYear} budget goes back to exactly what was there before this build was published, and
            the build that was live before it (if any) is live again. If the year was edited since, this is
            refused rather than losing those edits.
          </p>
        )}
        {dialog?.kind === "delete" && (
          <p className="bb-dialog">
            {targetYear} v{shown?.build.buildNo}{shown?.build.note ? ` (${shown.build.note})` : ""} and its lines are
            permanently deleted; this cannot be undone. A draft started from it keeps its own settings, and the
            live budget is not affected.
          </p>
        )}
      </Modal>
    </main>
  );
}

export default BudgetBuilder;
