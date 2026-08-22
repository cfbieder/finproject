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
  METRICS, bandLabel, combinationsFor, interactionSummary, rankKnobs, storedDrift,
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

  const keyOf = (k) =>
    `${k.entity}|${k.module}|${k.target?.direction ?? k.target?.date ?? ""}|${k.field}`;

  const toggle = (k) => {
    setSelected((prev) => {
      const id = keyOf(k);
      const hit = prev.find((p) => keyOf(p) === id);
      if (hit) return prev.filter((p) => keyOf(p) !== id);
      if (prev.length >= MAX_KNOBS) return prev;
      return [...prev, { ...k }];
    });
  };

  const setBand = (k, band) => {
    const id = keyOf(k);
    setSelected((prev) => prev.map((p) => (keyOf(p) === id ? { ...p, band: Number(band) } : p)));
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
  const grouped = useMemo(() => {
    const byGroup = new Map(GROUP_ORDER.map((g) => [g.key, new Map()]));
    for (const k of catalogue) {
      const g = byGroup.get(k.group) || byGroup.get("other");
      if (!g) continue;
      if (!g.has(k.module)) g.set(k.module, []);
      g.get(k.module).push(k);
    }
    return GROUP_ORDER
      .map((g) => ({ ...g, modules: [...(byGroup.get(g.key) || new Map()).entries()] }))
      .filter((g) => g.modules.length > 0);
  }, [catalogue]);

  const ranked = useMemo(() => {
    if (!result || !shared) return null;
    const metric = METRICS.find((m) => m.key === metricKey);
    return { metric, ...rankKnobs(result, metricKey, shared) };
  }, [result, metricKey, shared]);

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

  const canRun = scenario && selected.length > 0 && state.status !== "running";

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
              className={metricKey === m.key ? "is-active" : ""}
              onClick={() => setMetricKey(m.key)}
            >
              {m.label}
            </button>
          ))}
        </div>

        <button type="button" className="fc-sens-run" disabled={!canRun} onClick={() => start(scenario, selected)}>
          {state.status === "running"
            ? `Building ${state.done}/${state.total}…`
            : `Run ${selected.length} knob${selected.length === 1 ? "" : "s"}`}
        </button>
      </section>

      {scenariosLoading && <p className="fc-sens-note">Loading scenarios…</p>}
      {catalogueError && <p className="fc-sens-error">{catalogueError}</p>}
      {error && <p className="fc-sens-error">{error}</p>}

      <div className="fc-sens-body">
        <aside className="fc-sens-picker">
          <h2>
            Knobs <span>{selected.length}/{MAX_KNOBS}</span>
          </h2>
          {/* The cap is a BATCH SIZE, not a limit on the question: runs on an unchanged scenario
              share an anchor, so a second run's bars are comparable to this one's. */}
          {selected.length >= MAX_KNOBS && (
            <p className="fc-sens-note">
              Eight at a time keeps the run under ten seconds. Run another set afterwards — as long
              as you don&apos;t edit the scenario in between, the bars are comparable.
            </p>
          )}
          {grouped.map((group) => (
            <details key={group.key} className="fc-sens-group" open>
              <summary>
                {group.label}
                <span className="fc-sens-group-count">
                  {group.modules.reduce((n, [, ks]) => n + ks.length, 0)}
                </span>
              </summary>
              {group.modules.map(([module, ks]) => (
            <details key={module}>
              <summary>{module}</summary>
              {ks.map((k) => {
                const id = keyOf(k);
                const chosen = selected.find((p) => keyOf(p) === id);
                return (
                  <div key={id} className="fc-sens-knob">
                    <label>
                      <input
                        type="checkbox"
                        checked={Boolean(chosen)}
                        onChange={() => toggle(k)}
                      />
                      <span className="fc-sens-knob-label">{k.label}</span>
                      <em>{formatCurrent(k)}</em>
                    </label>
                    {chosen && (
                      <span className="fc-sens-band">
                        <input
                          type="number"
                          step="0.05"
                          value={chosen.band}
                          onChange={(e) => setBand(k, e.target.value)}
                          aria-label={`Band for ${k.label}`}
                        />
                        {bandLabel({ ...chosen, band: chosen.band })}
                      </span>
                    )}
                  </div>
                );
              })}
            </details>
              ))}
            </details>
          ))}
        </aside>

        <main className="fc-sens-result">
          {!result && state.status !== "running" && (
            <p className="fc-sens-note">
              Pick the assumptions you are least sure about, then run. Each one is moved down and
              up on its own, everything else held still.
            </p>
          )}

          {drift && (
            /* §6 layer 2 — free, and it never blocks a ranking. */
            <p className="fc-sens-drift">
              The saved forecast for <strong>{scenario}</strong> is out of step with a fresh build
              by {Math.round(drift.delta).toLocaleString()}. These bars use the fresh build;
              regenerate the scenario to see the same numbers on Review.
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
          />

          {ranked?.incomparable?.length > 0 && (
            /* Surfaced, never dropped: a knob missing from a ranking reads as one that does not
               matter, which is the one thing this chart must not say by omission. */
            <div className="fc-sens-incomparable">
              <h3>Not ranked</h3>
              <ul>
                {ranked.incomparable.map((x) => (
                  <li key={x.knob.knobId}>{x.knob.module} · {x.knob.field} — {x.reason}</li>
                ))}
              </ul>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
