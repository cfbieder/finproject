/**
 * CR085 P1 — /forecast-sensitivity. Which assumption is load-bearing.
 *
 * A NEW PAGE rather than a mode on Compare, for the reason CR067 decision 1 gave for
 * Multi-Compare: Compare's KPI row, delta grid and commentary are pairwise BY CONSTRUCTION, so a
 * sensitivity mode would switch all of them off — a different page wearing the same route.
 *
 * No `step` in the route and no `ForecastProvider`, following `FCMultiCompare` and `FCEquity`.
 */
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import FCTornadoChart from "../features/Forecast/FCTornadoChart.jsx";
import FCSensitivityTrajectoryModal from "../features/Forecast/FCSensitivityTrajectoryModal.jsx";
import useSensitivityRun from "../features/Forecast/hooks/useSensitivityRun.js";
import { useScenarios } from "../features/Forecast/hooks/useScenarios.js";
import { useFCLineStructure } from "../features/Forecast/hooks/useFCLineStructure.js";
import { useBalanceSheetAccounts } from "../features/Forecast/hooks/useBalanceSheetAccounts.js";
import { scenarioOptions } from "../features/Forecast/utils/scenarioOptions.js";
import { aggregateBalanceReport } from "../features/Forecast/utils/fcBalanceAggregate.js";
import {
  BAND_PRESETS, MAX_BUILDS, METRICS, bandChoices, bandLabel, bandMismatch, bandUnit, bandUnitLong,
  buildSeconds,
  combinationsFor, interactionSummary, plannedBuilds, rankKnobs, storedDrift, validateBand,
} from "../features/Forecast/utils/fcSensitivityUtils.js";
import Rest from "../js/rest.js";
import "./PageLayout.css";
import "./FCCompare.css";
import "./FCSensitivity.css";

const MAX_KNOBS = 8;

/** Balance sheet first, then the flows — the order a plan is read in. */
const GROUP_ORDER = [
  { key: "asset", label: "Assets" },
  { key: "liability", label: "Liabilities" },
  { key: "income", label: "Income" },
  { key: "expense", label: "Expenses" },
  { key: "other", label: "Other" },
];

/**
 * A knob's current value, readable. The raw column value ran straight into the field label
 * ("Market value3918992.00") and a 15-digit numeric is not a thing anyone reads — the point of
 * showing it is "is this the field I mean", which wants a shape, not every cent.
 */
function formatCurrent(k) {
  if (k.current == null) return "—";
  if (k.kind === "timing") return String(k.current).slice(0, 10);
  const n = Number(k.current);
  if (!Number.isFinite(n)) return String(k.current);
  if (k.kind === "rate") return `${n}%`;
  if (k.kind === "multiplier") return `${n}×`;
  return Math.abs(n) >= 1000 ? n.toLocaleString(undefined, { maximumFractionDigits: 0 }) : String(n);
}
const STORAGE_KEY = "forecast_sensitivity_selection";

export default function FCSensitivity() {
  const { scenarios, isLoading: scenariosLoading } = useScenarios();
  const { cashAccountMap } = useFCLineStructure();
  const { balanceAccounts, balanceAccountMap } = useBalanceSheetAccounts();

  const [chosenScenario, setChosenScenario] = useState(
    () => JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}")?.scenario || ""
  );
  const [selected, setSelected] = useState(() => {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    return Array.isArray(saved?.knobs) ? saved.knobs : [];
  });
  const [metricKey, setMetricKey] = useState(METRICS[0].key);
  const [openRow, setOpenRow] = useState(null);
  const [ranSignature, setRanSignature] = useState(null);
  const [query, setQuery] = useState("");
  const [composing, setComposing] = useState(false);
  /**
   * Which knob's band input is open, what is in it, and what was wrong with it — one at a time, so
   * there is only ever one place to look for the error. `{ id, text, error }`, or null for closed.
   */
  const [bandDraft, setBandDraft] = useState(null);

  const { start, state, result, error, startCombined, combined, combinedState } =
    useSensitivityRun();
  const options = useMemo(() => scenarioOptions(scenarios || []), [scenarios]);

  // ⚠️ DERIVED, not written by an effect. `react-hooks/set-state-in-effect` is a ratchet that may
  // only shrink, and CR067 P2 hit exactly this: restoring a selection through useEffect+setState
  // added two violations. Deriving is also how a scenario that has since been renamed or deleted
  // costs a dropdown default rather than the page.
  const scenario = useMemo(() => {
    if (chosenScenario && options.some((o) => o.name === chosenScenario)) return chosenScenario;
    return options[0]?.name || "";
  }, [chosenScenario, options]);

  // The knob catalogue. Only what can ACTUALLY be moved is offered — the server decides that with
  // the SAME rule its setter uses, so the picker cannot show a knob the run would then refuse.
  const catalogueQuery = useQuery({
    queryKey: ["fcSensitivityKnobs", scenario],
    queryFn: () => Rest.get(`/forecast/sensitivity/knobs/${encodeURIComponent(scenario)}`)
      .then((r) => r.data?.knobs || []),
    enabled: Boolean(scenario),
  });
  const catalogue = useMemo(() => catalogueQuery.data || [], [catalogueQuery.data]);
  const catalogueError = catalogueQuery.isError
    ? (catalogueQuery.error?.message || "Could not load the knobs")
    : null;

  // Everything `buildScenarioMatrix` needs EXCEPT the entries, which differ per point. All of it
  // is shared across a run — same scenario, same horizon, same base year — so it is fetched once.
  const meta = useMemo(
    () => (scenarios || []).find((s) => s.Name === scenario),
    [scenarios, scenario]
  );
  const lastActual = meta?.PeriodStart ? Number(meta.PeriodStart) - 2 : null;

  const baseYearQuery = useQuery({
    queryKey: ["fcBaseYearValues", scenario],
    queryFn: () => Rest.get(`/forecast/base-year-values?scenario=${encodeURIComponent(scenario)}`)
      .then((r) => r.data || {}),
    enabled: Boolean(scenario),
  });

  // Keyed on the year, which is also the dedupe: it shares cache with useReports/useOverview,
  // which ask for the same report under the same key.
  const balanceQuery = useQuery({
    queryKey: ["balanceReport", `${lastActual}-12-31`],
    queryFn: () => Rest.fetchBalanceReportV2(`${lastActual}-12-31`),
    enabled: lastActual != null && Boolean(balanceAccountMap),
  });

  const shared = useMemo(() => {
    if (!meta?.PeriodStart || !baseYearQuery.data || !balanceQuery.data) return null;
    if (!cashAccountMap || !balanceAccountMap || !balanceAccounts?.length) return null;
    return {
      periodStart: meta.PeriodStart,
      baseYearValues: baseYearQuery.data,
      lastActualBalance: aggregateBalanceReport(balanceQuery.data, balanceAccountMap),
      cashAccountMap,
      balanceAccountMap,
      balanceRows: balanceAccounts,
    };
  }, [meta, baseYearQuery.data, balanceQuery.data, cashAccountMap, balanceAccountMap, balanceAccounts]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ scenario, knobs: selected }));
  }, [scenario, selected]);

  const countSelected = (modules) =>
    modules.reduce(
      (n, [, ks]) => n + ks.filter((k) => selected.some((p) => keyOf(p) === keyOf(k))).length,
      0
    );

  const keyOf = (k) =>
    `${k.entity}|${k.module}|${k.target?.direction ?? k.target?.date ?? ""}|${k.field}`;

  const toggle = (k) => {
    setSelected((prev) => {
      const id = keyOf(k);
      const hit = prev.find((p) => keyOf(p) === id);
      if (hit) return prev.filter((p) => keyOf(p) !== id);
      if (prev.length >= MAX_KNOBS) return prev;
      return [...prev, { ...k, bands: [k.band] }];
    });
  };

  /**
   * Toggle one band on a knob. At least one always survives — a knob with no band is a knob that
   * would run zero builds and draw nothing.
   */
  const toggleBand = (k, band) => {
    const id = keyOf(k);
    const chosen = selected.find((p) => keyOf(p) === id);
    const have = chosen ? (chosen.bands || [chosen.band]) : [];
    // Ticking a band costs two more real builds, exactly like typing one.
    if (!have.includes(band) && plannedBuilds(selected) + 2 > MAX_BUILDS) return;
    setSelected((prev) => prev.map((p) => {
      if (keyOf(p) !== id) return p;
      const have = p.bands || [p.band];
      const next = have.includes(band) ? have.filter((x) => x !== band) : [...have, band];
      const bands = (next.length ? next : [band]).sort((a, b) => a - b);
      return { ...p, bands, band: bands[0] };
    }));
  };

  /**
   * A band the owner typed rather than one of the three on offer.
   *
   * ⚠️ THE PRESETS ARE A UI CONVENIENCE AND NEVER WERE A CONTRACT. The server's `bandsOf` takes any
   * finite band > 0 and the route validates none of them, so a typed band needs no API change —
   * only the three guards the fixed chips were incidentally providing (`validateBand`) and the
   * build cap, which a fourth band is the first thing in this page's history able to reach.
   *
   * Returns the message to show, or null when it went in.
   */
  const addBand = (k, raw) => {
    const check = validateBand(k.kind, raw);
    if (check.error) return check.error;
    const id = keyOf(k);
    const chosen = selected.find((p) => keyOf(p) === id);
    const have = chosen ? (chosen.bands || [chosen.band]) : [];
    if (have.includes(check.value)) return null;          // already ticked — nothing to add or say
    const after = plannedBuilds(selected) + 2;
    if (after > MAX_BUILDS) {
      return `That would be ${after} builds against a cap of ${MAX_BUILDS}. Drop a band or a knob.`;
    }
    setSelected((prev) => prev.map((p) => {
      if (keyOf(p) !== id) return p;
      const bands = [...(p.bands || [p.band]), check.value].sort((a, b) => a - b);
      return { ...p, bands, band: bands[0] };
    }));
    return null;
  };

  /**
   * Assets · Liabilities · Income · Expenses, then modules inside each.
   *
   * ⚠️ The group comes from the SERVER, which derives it from what the engine branches on
   * (`has_valuation`, the sign of the value, the presence of a loan, a stream's direction). It is
   * deliberately NOT derived here from `module_type`: that column is free text the owner edits —
   * prod carries both `Asset` and `Business` — and CR070 records the same rule for module
   * capabilities, for the same reason.
   */
  /**
   * ⚠️ THE TREE HAS ONE AXIS AND THE QUESTION HAS TWO.
   *
   * The catalogue is `group → module → field`, so the only way in is "which module holds this?".
   * But the natural questions are field-shaped — *are all my growth-vs-inflation assumptions
   * load-bearing?* — and there are ~10 field labels across 179 knobs with no way to ask about one
   * without opening thirty modules. A page whose whole claim is that it finds the assumption you
   * did not know was load-bearing should not require you to know where it lives.
   */
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return catalogue;
    return catalogue.filter(
      (k) => `${k.module} ${k.label}`.toLowerCase().includes(q)
    );
  }, [catalogue, query]);

  const grouped = useMemo(() => {
    const byGroup = new Map(GROUP_ORDER.map((g) => [g.key, new Map()]));
    for (const k of visible) {
      const g = byGroup.get(k.group) || byGroup.get("other");
      if (!g) continue;
      if (!g.has(k.module)) g.set(k.module, []);
      g.get(k.module).push(k);
    }
    return GROUP_ORDER
      .map((g) => ({ ...g, modules: [...(byGroup.get(g.key) || new Map()).entries()] }))
      .filter((g) => g.modules.length > 0);
  }, [visible]);

  /**
   * ⚠️ A RESULT BELONGS TO THE RUN THAT PRODUCED IT.
   *
   * Changing the scenario cleared the selection but NOT the result, while `shared` (period start,
   * base-year values, the opening balance sheet) rebuilt for the NEW scenario — so the old run's
   * entries were re-ranked against the new scenario's base year, and the drift banner named the
   * new scenario while quoting the old run's variance and telling the owner to regenerate it. A
   * number belonging to no scenario in the plan, asserted about a named one.
   */
  const wrongScenario = Boolean(result) && result.scenario !== scenario;

  /**
   * The selection has moved on, but the bars are still a true picture of the run that made them.
   *
   * The signature is recorded when the run is FIRED rather than reconstructed from the result —
   * the server's `knobId` and the picker's key are different strings, and matching them by
   * substring is the kind of comparison that works until a module is renamed.
   */
  const currentSignature = selected
    .map((k) => `${keyOf(k)}@${(k.bands || [k.band]).join(",")}`)
    .sort()
    .join(";");
  const staleSelection = Boolean(result) && !wrongScenario
    && ranSignature !== null && ranSignature !== currentSignature;

  const ranked = useMemo(() => {
    // Refuse to rank rather than rank a hybrid of two plans.
    if (!result || !shared || wrongScenario) return null;
    const metric = METRICS.find((m) => m.key === metricKey);
    return { metric, ...rankKnobs(result, metricKey, shared) };
  }, [result, metricKey, shared, wrongScenario]);

  const drift = useMemo(
    () => (result && shared ? storedDrift(result, shared) : null),
    [result, shared]
  );

  const interaction = useMemo(
    () => (ranked?.rows?.length && shared
      ? interactionSummary(ranked.rows, ranked.metric, combined, shared)
      : null),
    [ranked, combined, shared]
  );

  /**
   * ⚠️ THE PAGE HAS TWO MODES AND USED TO RENDER BOTH AT HALF WIDTH.
   *
   * *Compose* — which assumptions? — wants width: four type groups side by side and a search box
   * over 179 knobs. *Read* — what did they do? — wants width for a seven-column table and a
   * 1200px trajectory. A permanent 300px column served neither, and before the first run roughly
   * three quarters of the page was empty.
   *
   * Derived, not stored: composing while a result exists is an explicit choice, and the absence of
   * a result is composing by definition.
   */
  const mode = composing || !result || wrongScenario ? "compose" : "read";

  /**
   * ⚠️ A SELECTION RESTORED FROM localStorage HAS NOT BEEN THROUGH THE GUARDS. `addBand` and
   * `toggleBand` refuse to cross the cap, but a selection saved by an earlier build of this page —
   * or by a future one with a different cap — arrives already over it, and the only signal would be
   * a 409 after the run was fired.
   */
  const builds = plannedBuilds(selected);
  const bandCount = selected.reduce((n, k) => n + (k.bands || [k.band]).length, 0);
  const overBuildCap = builds > MAX_BUILDS;
  const mismatched = bandMismatch(selected);
  const canRun = scenario && selected.length > 0 && !overBuildCap && state.status !== "running";

  return (
    <div className="page-container fc-sensitivity">
      <header className="page-header">
        <h1>Sensitivity</h1>
        <p className="page-subtitle">
          Which assumption is the plan actually resting on. Every bar is a real forecast build,
          not an estimate — so the numbers are the engine&apos;s, and the run takes a few seconds.
        </p>
      </header>

      <section className="fc-sens-controls">
        <label>
          Scenario
          <select value={scenario} onChange={(e) => { setChosenScenario(e.target.value); setSelected([]); }}>
            {options.map((o) => (
              <option key={o.name} value={o.name}>{o.label}</option>
            ))}
          </select>
        </label>

        <div className="fc-sens-metric" role="group" aria-label="Metric">
          {METRICS.map((m) => (
            <button
              key={m.key}
              type="button"
              // ⚠️ The two metrics have OPPOSITE favourable directions, so reading the chart
              // against the wrong one inverts every bar. The selected state cannot rest on a
              // 1.06:1 background tint plus a font weight, and it must be announced.
              aria-pressed={metricKey === m.key}
              className={metricKey === m.key ? "is-active" : ""}
              onClick={() => setMetricKey(m.key)}
            >
              {m.label}
            </button>
          ))}
        </div>

        <button
          type="button"
          className="fc-sens-run"
          disabled={!canRun}
          onClick={() => {
            setRanSignature(currentSignature);
            setComposing(false);
            start(scenario, selected);
          }}
        >
          {state.status === "running"
            ? `Building ${state.done}/${state.total}…`
            : `Run ${selected.length} knob${selected.length === 1 ? "" : "s"}`}
        </button>

        {/* ⚠️ The cost of a run was invisible because it could not vary much: three fixed chips
            capped the page at 49 builds against a cap of 50. A typed band makes the ceiling
            reachable, and a refusal that arrives as a 409 after the composing is finished is the
            wrong moment to learn the run is too big. */}
        {selected.length > 0 && (
          <p className={`fc-sens-cost${overBuildCap ? " is-over" : ""}`} aria-live="polite">
            {bandCount} band{bandCount === 1 ? "" : "s"} · {builds} builds
            {overBuildCap
              ? ` — over the cap of ${MAX_BUILDS}. Drop a band or a knob.`
              : ` ≈ ${buildSeconds(builds)}s`}
          </p>
        )}
      </section>

      {scenariosLoading && <p className="fc-sens-note">Loading scenarios…</p>}
      {/* A run takes several seconds and every signal for it lived inside the button's own label,
          which a screen reader never revisits. */}
      {state.status === "running" && (
        <p className="fc-sens-note" role="status">
          Building {state.done}/{state.total} — each one is a real forecast build.
        </p>
      )}
      {/* Not an error and not a refusal — the run is valid, the READING of it is the thing at
          risk. See the ⚠️ on `bandMismatch`. */}
      {mode === "compose" && mismatched.length > 0 && (
        <p className="fc-sens-note" role="status">
          {mismatched.map((m) => (
            <span key={m.kind}>
              Knobs of the same kind are probed at{" "}
              {m.bands.map((b) => bandLabel({ kind: m.kind, band: b })).join(" and ")}.{" "}
            </span>
          ))}
          Bars are ranked on the smallest band each knob carries, so those are not ranked like for
          like — each bar still prints its own band.
        </p>
      )}
      {catalogueError && <p className="fc-sens-error" role="alert">{catalogueError}</p>}
      {error && <p className="fc-sens-error" role="alert">{error}</p>}

      {/* READ MODE — the composition collapses to one strip so the results get the full width. */}
      {mode === "read" && (
        <div className="fc-sens-strip">
          <button type="button" className="fc-sens-change" onClick={() => setComposing(true)}>
            Change assumptions ({selected.length})
          </button>
          <ul className="fc-sens-strip-list">
            {selected.map((k) => (
              <li key={keyOf(k)}>
                {k.module} · {k.label}{" "}
                <span>
                  {(k.bands || [k.band]).map((b) => bandLabel({ kind: k.kind, band: b })).join(" · ")}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className={`fc-sens-body fc-sens-body--${mode}`}>
        {mode === "compose" && (
        <aside className="fc-sens-picker">
          <h2>
            Knobs <span>{selected.length}/{MAX_KNOBS}</span>
          </h2>

          <label className="fc-sens-search">
            <span className="sr-only">Search assumptions</span>
            <input
              type="search"
              value={query}
              placeholder="Search 179 assumptions…"
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>

          {/* ⚠️ WHAT IS SELECTED HAS TO BE VISIBLE WITHOUT HUNTING FOR IT.
              The picker is a long scrolled list of collapsed groups, and a selection three modules
              down is invisible — the count said "3/8" and nothing said WHICH three, so the only way
              to reset was to remember. It also survives a reload via localStorage, which made the
              problem worse: the boxes were ticked somewhere off-screen with no trace on open. */}
          {selected.length > 0 && (
            <div className="fc-sens-selected">
              <div className="fc-sens-selected-head">
                <span>Selected</span>
                <button type="button" className="fc-sens-clear" onClick={() => setSelected([])}>
                  Clear all
                </button>
              </div>
              <ul>
                {selected.map((k) => (
                  <li key={keyOf(k)}>
                    <span className="fc-sens-chip-name">{k.module} · {k.label}</span>
                    <span className="fc-sens-chip-band">
                      {(k.bands || [k.band]).map((b) => bandLabel({ kind: k.kind, band: b })).join(" · ")}
                    </span>
                    <button
                      type="button"
                      className="fc-sens-chip-drop"
                      aria-label={`Remove ${k.module} ${k.label}`}
                      onClick={() => toggle(k)}
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {/* The cap is a BATCH SIZE, not a limit on the question: runs on an unchanged scenario
              share an anchor, so a second run's bars are comparable to this one's. */}
          {selected.length >= MAX_KNOBS && (
            <p className="fc-sens-note">
              Eight at a time keeps the run under ten seconds. Run another set afterwards — as long
              as you don&apos;t edit the scenario in between, the bars are comparable.
            </p>
          )}
          <div className="fc-sens-groups">
          {grouped.map((group) => (
            <details key={group.key} className="fc-sens-group" open>
              <summary>
                {group.label}
                <span className="fc-sens-group-count">
                  {/* The selected count leads, because that is what a reader is looking for when
                      they scroll back to change something. */}
                  {countSelected(group.modules) > 0 && (
                    <strong className="fc-sens-group-picked">{countSelected(group.modules)} picked</strong>
                  )}
                  {group.modules.reduce((n, [, ks]) => n + ks.length, 0)}
                </span>
              </summary>
              {group.modules.map(([module, ks]) => {
                const picked = ks.filter((k) => selected.some((p) => keyOf(p) === keyOf(k))).length;
                return (
            // `open` is DERIVED from whether this module holds a selection, so a restored
            // selection is visible on load instead of hidden inside a closed group.
            <details key={module} open={picked > 0}>
              <summary>
                {module}
                {picked > 0 && <span className="fc-sens-module-picked">{picked}</span>}
              </summary>
              {ks.map((k) => {
                const id = keyOf(k);
                const chosen = selected.find((p) => keyOf(p) === id);
                return (
                  <div key={id} className="fc-sens-knob">
                    <label>
                      <input
                        type="checkbox"
                        checked={Boolean(chosen)}
                        // The module lives in an ancestor <summary>, which carries no grouping
                        // semantics to a screen reader — so a forms list read "Amount 31,694",
                        // "Amount 127,372" dozens of times with nothing to tell them apart.
                        aria-label={`${module} — ${k.label}, currently ${formatCurrent(k)}`}
                        // At the cap an unchecked box was a silent no-op. Disabled is both the
                        // programmatic answer and the visible one.
                        disabled={!chosen && selected.length >= MAX_KNOBS}
                        onChange={() => toggle(k)}
                      />
                      <span className="fc-sens-knob-label">{k.label}</span>
                      <em>{formatCurrent(k)}</em>
                    </label>
                    {chosen && (
                      <span className="fc-sens-band" role="group"
                        aria-label={`Bands for ${module} ${k.label}, in ${bandUnitLong(k.kind)}`}>
                        {bandChoices(k.kind, chosen.bands || [chosen.band]).map((b) => {
                          const on = (chosen.bands || [chosen.band]).includes(b);
                          // A typed band looks different from an offered one, or the three chips
                          // that came with the page and the one you asked for read as the same
                          // kind of thing — and only one of them disappears when you untick it.
                          const custom = !(BAND_PRESETS[k.kind] || []).includes(b);
                          return (
                            <button
                              key={b}
                              type="button"
                              aria-pressed={on}
                              className={`${on ? "is-active" : ""}${custom ? " is-custom" : ""}`}
                              title={custom ? "Yours — untick to remove it" : undefined}
                              // The dashed edge is a sighted-only signal, and the asymmetry it
                              // marks is real: unticking a typed band REMOVES it, unticking a
                              // preset leaves the chip in place.
                              aria-label={custom
                                ? `${bandLabel({ kind: k.kind, band: b })} — your own band`
                                : undefined}
                              onClick={() => toggleBand(k, b)}
                            >
                              {bandLabel({ kind: k.kind, band: b })}
                            </button>
                          );
                        })}
                        {bandDraft?.id === id ? (
                          <span className="fc-sens-band-draft">
                            <input
                              type="number"
                              autoFocus
                              min="0"
                              step={k.kind === "timing" ? 1 : "any"}
                              value={bandDraft.text}
                              aria-label={`Custom band for ${module} ${k.label}, in ${bandUnitLong(k.kind)}`}
                              aria-invalid={Boolean(bandDraft.error)}
                              onChange={(e) => setBandDraft({ id, text: e.target.value, error: null })}
                              onKeyDown={(e) => {
                                if (e.key === "Escape") setBandDraft(null);
                                if (e.key !== "Enter") return;
                                e.preventDefault();
                                const err = addBand(k, bandDraft.text);
                                setBandDraft(err ? { ...bandDraft, error: err } : null);
                              }}
                            />
                            <span aria-hidden="true">{bandUnit(k.kind)}</span>
                            <button
                              type="button"
                              onClick={() => {
                                const err = addBand(k, bandDraft.text);
                                setBandDraft(err ? { ...bandDraft, error: err } : null);
                              }}
                            >
                              Add
                            </button>
                            <button type="button" aria-label="Cancel" onClick={() => setBandDraft(null)}>
                              ×
                            </button>
                          </span>
                        ) : (
                          <button
                            type="button"
                            className="fc-sens-band-open"
                            aria-label={`Add your own band to ${module} ${k.label}`}
                            onClick={() => setBandDraft({ id, text: "", error: null })}
                          >
                            +
                          </button>
                        )}
                        {bandDraft?.id === id && bandDraft.error && (
                          <span className="fc-sens-band-error" role="alert">{bandDraft.error}</span>
                        )}
                      </span>
                    )}
                  </div>
                );
              })}
            </details>
                );
              })}
            </details>
          ))}

          </div>

          {grouped.length === 0 && (
            <p className="fc-sens-note">Nothing matches “{query}”.</p>
          )}
        </aside>
        )}

        <main className="fc-sens-result">
          {wrongScenario && state.status !== "running" && (
            <p className="fc-sens-stale">
              These bars are from a run on <strong>{result.scenario}</strong>. Pick knobs and run
              again to rank <strong>{scenario}</strong>.
            </p>
          )}

          {staleSelection && state.status !== "running" && (
            <p className="fc-sens-stale">
              The selection has changed since this run. The bars still describe the
              {" "}{result.knobs?.length} knob{result.knobs?.length === 1 ? "" : "s"} that were
              actually built — run again to rank what is selected now.
            </p>
          )}

          {!result && state.status !== "running" && (
            <p className="fc-sens-note">
              Pick the assumptions you are least sure about, then run. Each one is moved down and
              up on its own, everything else held still.
            </p>
          )}

          {drift && (
            /* §6 layer 2 — free, and it never blocks a ranking. */
            <p className="fc-sens-drift">
              The saved forecast for <strong>{result?.scenario}</strong> is out of step with a fresh build
              by {Math.round(drift.delta).toLocaleString()}. These bars use the fresh build;
              regenerate the scenario to see the same numbers on Review.
            </p>
          )}

          {/* ⚠️ EVERY knob unrankable is not the same as "no result". The page showed a heading,
              one grey line, and 700px of nothing — after an eight-second wait. Say what happened
              and what to do about it. */}
          {ranked && ranked.rows.length === 0 && ranked.incomparable.length > 0
            && state.status !== "running" && (
            <p className="fc-sens-stale">
              Nothing to rank: {ranked.incomparable.length === 1 ? "that knob" : "none of those knobs"}
              {" "}moved the plan. The run was real — the engine simply does not read
              {" "}{ranked.incomparable.length === 1 ? "that field" : "those fields"} on the
              {" "}{ranked.incomparable.length === 1 ? "module" : "modules"} you picked. Pick a
              different assumption and run again.
            </p>
          )}

          {ranked?.rows?.length > 0 && (
            <FCTornadoChart
              rows={ranked.rows}
              metric={ranked.metric}
              anchor={ranked.anchor}
              onSelect={setOpenRow}
              combineLabel={`See all ${ranked.rows.length} together →`}
              onCombine={() => {
                setOpenRow("__combined__");
                startCombined(scenario, combinationsFor(ranked.rows, ranked.metric));
              }}
            />
          )}

          <FCSensitivityTrajectoryModal
            open={Boolean(openRow)}
            onClose={() => setOpenRow(null)}
            result={result}
            row={openRow}
            shared={shared}
            combined={combined}
            combinedState={combinedState}
            interaction={interaction}
            metric={ranked?.metric}
          />

          {ranked?.incomparable?.length > 0 && (
            /* Surfaced, never dropped: a knob missing from a ranking reads as one that does not
               matter, which is the one thing this chart must not say by omission. */
            <div className="fc-sens-incomparable">
              <h3>Not ranked</h3>
              <ul>
                {ranked.incomparable.map((x) => (
                  <li key={x.knob.knobId}>
                    {/* The LABEL, not the column name: "growth_mult" is not what the picker
                        offered and not what the owner ticked. */}
                    {x.knob.module} · {x.knob.label ?? x.knob.field} — {x.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
