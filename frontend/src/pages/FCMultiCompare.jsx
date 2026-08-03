/**
 * Forecast Multi-Compare (CR067) — one base scenario against several of its variants.
 *
 * The Compare page answers "how do these TWO scenarios differ?" in detail, and is two-scenario
 * by construction. This answers the other question — "how does the fan of my variants sit
 * against the base?" — and answers only that: one chart, no delta grid, no KPI cards, no
 * commentary. Seeing five variants today otherwise means opening Compare four times.
 *
 * It is cheap because `buildScenarioMatrix` was already pure and single-scenario; the pairwise
 * layer on top of it (`compareMatrices`) is simply not called. What that layer DID own, and
 * this page therefore has to own, is aligning scenarios onto the union of their years — see
 * `fcMultiCompareUtils.alignSeries`, and the comment there about why keying by year rather
 * than by array position is not a style choice.
 */
import { useEffect, useMemo, useState } from "react";
import FCTrajectoryChart from "../features/Forecast/FCTrajectoryChart.jsx";
import { useScenarios } from "../features/Forecast/hooks/useScenarios.js";
import { useScenarioSeries } from "../features/Forecast/hooks/useScenarioSeries.js";
import { useFCLineStructure } from "../features/Forecast/hooks/useFCLineStructure.js";
import { useBalanceSheetAccounts } from "../features/Forecast/hooks/useBalanceSheetAccounts.js";
import { scenarioOptions } from "../features/Forecast/utils/scenarioOptions.js";
import { alignSeries, colorIndexFor } from "../features/Forecast/utils/fcMultiCompareUtils.js";
import { seriesColors, MAX_SERIES } from "../features/Forecast/utils/fcSeriesPalette.js";
import useTheme from "../hooks/useTheme.js";
import "./PageLayout.css";
import "./FCCompare.css";
import "./FCMultiCompare.css";

const STORAGE_KEY = "forecast_multi_compare_selection";
/** Base + variants. The base always holds a slot, so this many variants can be ticked. */
const MAX_VARIANTS = MAX_SERIES - 1;

const BASE_WEIGHT = 3;
const VARIANT_WEIGHT = 1.75;

function readSelection() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (!raw || typeof raw !== "object") return null;
    return {
      base: typeof raw.base === "string" ? raw.base : "",
      variants: Array.isArray(raw.variants) ? raw.variants.filter((v) => typeof v === "string") : [],
    };
  } catch {
    return null;
  }
}

export default function FCMultiCompare() {
  const { scenarios, isLoading: scenariosLoading, loadError: scenariosError } = useScenarios();
  const { theme } = useTheme();
  const palette = seriesColors(theme);

  // The last selection is restored by INITIALISING from localStorage and then DERIVING what is
  // still valid, rather than by an effect that setStates once the scenarios arrive. Same
  // behaviour, and it keeps `react-hooks/set-state-in-effect` — one of the six ratchets, which
  // may only shrink — where it was.
  const [wantBase, setWantBase] = useState(() => readSelection()?.base ?? "");
  const [wantVariants, setWantVariants] = useState(() => readSelection()?.variants ?? []);
  const [metric, setMetric] = useState("netAssets");

  const options = useMemo(() => scenarioOptions(scenarios), [scenarios]);
  const roots = useMemo(() => options.filter((o) => !o.isVariant), [options]);

  // A base that no longer exists — renamed, deleted, or simply not loaded yet — falls back to
  // the first root. A remembered variant that no longer exists costs you a checkbox, not a page.
  const base = useMemo(
    () => (roots.some((r) => r.name === wantBase) ? wantBase : roots[0]?.name ?? ""),
    [roots, wantBase]
  );
  const variantsOf = useMemo(
    () => options.filter((o) => o.isVariant && o.baseName === base).map((o) => o.name),
    [options, base]
  );
  const selected = useMemo(
    () => wantVariants.filter((n) => variantsOf.includes(n)).slice(0, MAX_VARIANTS),
    [wantVariants, variantsOf]
  );

  useEffect(() => {
    if (!base) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ base, variants: selected }));
  }, [base, selected]);

  const onBaseChange = (name) => {
    setWantBase(name);
    setWantVariants([]); // another base has other variants; carrying names across is nonsense
  };

  const atCap = selected.length >= MAX_VARIANTS;
  const toggleVariant = (name) => {
    setWantVariants((cur) =>
      cur.includes(name)
        ? cur.filter((n) => n !== name)
        : cur.length >= MAX_VARIANTS
        ? cur
        : [...cur, name]
    );
  };

  const scenarioObjs = useMemo(() => {
    const byName = new Map(scenarios.map((s) => [s.Name, s]));
    // Base first so it draws first and reads as the reference line.
    return [base, ...variantsOf.filter((v) => selected.includes(v))]
      .map((name) => byName.get(name))
      .filter(Boolean);
  }, [scenarios, base, variantsOf, selected]);

  const { cashAccountMap, loading: linesLoading, error: linesError } = useFCLineStructure();
  const {
    balanceAccounts,
    balanceAccountMap,
    loading: balanceLoading,
    error: balanceError,
  } = useBalanceSheetAccounts();

  const structure = useMemo(
    () => ({ cashAccountMap, balanceAccountMap, balanceAccounts }),
    [cashAccountMap, balanceAccountMap, balanceAccounts]
  );

  const { entries, isLoading: seriesLoading, errors } = useScenarioSeries(
    scenarioObjs,
    structure
  );

  const loading = scenariosLoading || linesLoading || balanceLoading || seriesLoading;
  const loadError = scenariosError || linesError || balanceError;

  const emptyScenarios = useMemo(
    () => entries.filter((e) => e.loaded && e.isEmpty).map((e) => e.name),
    [entries]
  );

  const { years, series } = useMemo(() => {
    const withColor = entries
      .filter((e) => e.matrix)
      .map((e) => ({ ...e, slot: colorIndexFor(e.name, base, variantsOf) }));
    const aligned = alignSeries(withColor, metric);
    return {
      years: aligned.years,
      series: aligned.series.map((s, i) => ({
        ...s,
        color: palette[withColor[i].slot],
        strokeWidth: withColor[i].name === base ? BASE_WEIGHT : VARIANT_WEIGHT,
      })),
    };
  }, [entries, metric, base, variantsOf, palette]);

  // Every selected scenario is listed with its colour AND its name. That is not decoration:
  // three of the light-mode hues sit below 3:1 against white, and the dataviz relief rule says
  // identity may not then rest on the hue alone.
  const swatchFor = (name) => palette[colorIndexFor(name, base, variantsOf)];

  return (
    <main className="page-main trans-budget-main">
      <div className="fc-multi-controls">
        <div className="fc-compare-picker">
          <label htmlFor="fc-multi-base">Base scenario</label>
          <select
            id="fc-multi-base"
            value={base}
            onChange={(e) => onBaseChange(e.target.value)}
            disabled={scenariosLoading}
          >
            {roots.map((option) => (
              <option key={option.name} value={option.name}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <fieldset className="fc-multi-variants">
          <legend>
            Compare against its variants
            {atCap && <span className="fc-multi-cap"> · {MAX_VARIANTS} at a time</span>}
          </legend>
          {variantsOf.length === 0 && (
            <p className="fc-multi-none">
              “{base}” has no variants. Create one from Forecast Scenarios, or pick another base.
            </p>
          )}
          {variantsOf.map((name) => {
            const checked = selected.includes(name);
            return (
              <label key={name} className="fc-multi-variant">
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={!checked && atCap}
                  onChange={() => toggleVariant(name)}
                />
                <span
                  className="fc-multi-swatch"
                  style={{ background: checked ? swatchFor(name) : "transparent" }}
                  aria-hidden="true"
                />
                {name}
                {emptyScenarios.includes(name) && (
                  <span className="fc-multi-badge"> never generated</span>
                )}
              </label>
            );
          })}
        </fieldset>
      </div>

      {loadError && <div className="fc-compare-error">{loadError}</div>}
      {errors.map((e) => (
        <div key={e.scenario || "balance"} className="fc-compare-error">
          {e.scenario ? `${e.scenario}: ${e.message}` : e.message}
        </div>
      ))}
      {!loading && emptyScenarios.length > 0 && (
        <div className="fc-compare-hint">
          Not drawn — no forecast has been generated yet:{" "}
          {emptyScenarios.map((n) => `“${n}”`).join(", ")}. Generate it on Forecast Review.
        </div>
      )}
      {loading && <div className="fc-compare-loading">Loading scenarios…</div>}

      {!loading && series.length > 0 && (
        <div className="fc-compare-charts">
          <FCTrajectoryChart
            title={`Trajectory — ${base} and ${series.length - 1 || "no"} variant${
              series.length === 2 ? "" : "s"
            }`}
            years={years}
            series={series}
            metric={metric}
            onMetricChange={setMetric}
            height={340}
          />
        </div>
      )}
    </main>
  );
}
