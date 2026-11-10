import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import Rest from "../js/rest.js";
import { formatMoney } from "../components/Money/formatMoney.js";
import { useScenarios } from "../features/Forecast/hooks/useScenarios.js";
import { useForecastData } from "../features/Forecast/hooks/useForecastData.js";
import { useFCLineStructure } from "../features/Forecast/hooks/useFCLineStructure.js";
import { useBalanceSheetAccounts } from "../features/Forecast/hooks/useBalanceSheetAccounts.js";
import { useBaseYearBalanceSheet } from "../features/Forecast/hooks/useBaseYearBalanceSheet.js";
import { aggregateBalanceReport } from "../features/Forecast/utils/fcBalanceAggregate.js";
import { buildForecastBalanceForYear } from "../features/Forecast/utils/fcBalanceAtYear.js";
import { scenarioOptions } from "../features/Forecast/utils/scenarioOptions.js";
import "../components/ReportTable.css";
import "./BalanceV2.css";

/**
 * Balances → Forecast: today's actual balance sheet against a scenario's forecast balance sheet
 * for the year-end of the same year, in the Forecast Review's rows (Assets / Liabilities and their
 * level-2 groups). The forecast column is the Review's column for that year — it comes from
 * `buildForecastBalanceForYear`, which reproduces the Review, so the two pages cannot disagree.
 */

const getToday = () => {
  const d = new Date();
  const pad = (v) => String(v).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

const money = (v) => formatMoney(v, { currency: "USD", decimals: 0 });
const isNeg = (v) => Number.isFinite(v) && v < 0;
const num = (v) => (Number.isFinite(Number(v)) && v !== null ? Number(v) : null);
const diff = (a, f) => (a == null && f == null ? null : (a ?? 0) - (f ?? 0));

/** A row with nothing on either side is structure, not information. */
const isEmptyRow = (a, f) => Math.abs(a ?? 0) < 0.5 && Math.abs(f ?? 0) < 0.5;

export default function BalanceForecast() {
  const { scenarios, selectedScenario, setSelectedScenario, isLoading: scenariosLoading, loadError } =
    useScenarios();
  const [asOfDate, setAsOfDate] = useState(getToday);

  const scenarioObj = useMemo(
    () => scenarios.find((s) => s.Name === selectedScenario),
    [scenarios, selectedScenario]
  );
  const periodStart = scenarioObj?.PeriodStart;
  const year = Number(asOfDate.slice(0, 4));

  const { years, entries, yearsLoading, entriesLoading, yearsError, entriesError } =
    useForecastData(selectedScenario);
  const { cashAccountMap, loading: linesLoading, error: linesError } = useFCLineStructure();
  const { balanceAccounts, balanceAccountMap, loading: coaLoading, error: coaError } =
    useBalanceSheetAccounts();
  const lastActual = useBaseYearBalanceSheet(periodStart, balanceAccountMap);

  // Results are stored WITH the key they were fetched for, so a stale one reads as "not loaded"
  // without resetting state inside the effect.
  const [byvResult, setByvResult] = useState({ scenario: null, data: null });
  useEffect(() => {
    if (!selectedScenario) return;
    let live = true;
    Rest.get(`/forecast/base-year-values?scenario=${encodeURIComponent(selectedScenario)}`)
      .then((res) => live && setByvResult({ scenario: selectedScenario, data: res.data || {} }))
      .catch(() => live && setByvResult({ scenario: selectedScenario, data: {} }));
    return () => {
      live = false;
    };
  }, [selectedScenario]);
  const baseYearValues = byvResult.scenario === selectedScenario ? byvResult.data : null;

  const [actualResult, setActualResult] = useState({ date: null, report: null, error: "" });
  useEffect(() => {
    let live = true;
    Rest.fetchBalanceReportV2(asOfDate)
      .then((r) => live && setActualResult({ date: asOfDate, report: r || [], error: "" }))
      .catch((e) =>
        live && setActualResult({ date: asOfDate, report: null, error: e.message || "Failed to load balance sheet" })
      );
    return () => {
      live = false;
    };
  }, [asOfDate]);
  const current = actualResult.date === asOfDate;
  const actualReport = current ? actualResult.report : null;
  const actualError = current ? actualResult.error : "";

  const loading =
    scenariosLoading ||
    yearsLoading ||
    entriesLoading ||
    linesLoading ||
    coaLoading ||
    lastActual.loading ||
    baseYearValues === null ||
    (actualReport === null && !actualError);
  const error =
    loadError || yearsError || entriesError || linesError || coaError || lastActual.error || actualError;

  const forecast = useMemo(() => {
    if (loading || !periodStart || !balanceAccounts.length) return null;
    return buildForecastBalanceForYear({
      entries,
      years,
      periodStart,
      baseYearValues,
      lastActualBalance: lastActual.baseBalanceTotalsByYear.get(Number(periodStart) - 2) || null,
      cashAccountMap,
      balanceAccountMap,
      balanceRows: balanceAccounts,
      year,
    });
  }, [loading, periodStart, entries, years, baseYearValues, lastActual, cashAccountMap, balanceAccountMap, balanceAccounts, year]);

  const actual = useMemo(
    () => (actualReport && balanceAccountMap.size ? aggregateBalanceReport(actualReport, balanceAccountMap) : null),
    [actualReport, balanceAccountMap]
  );

  // Rows in the Review's shape. Actual totals are the ledger's own Assets / Liabilities; anything
  // the forecast structure does not name lands in an "Other" row so the groups still add up.
  const rows = useMemo(() => {
    if (!forecast || !actual) return [];
    const out = [];
    let section = null;
    let shown = 0;
    const closeSection = () => {
      if (!section) return;
      const other = (actual.level1.get(section) ?? 0) - shown;
      if (Math.abs(other) >= 0.5) {
        out.push({ label: "Other (not in forecast structure)", level: 2, a: other, f: null });
      }
    };
    for (const { label, level } of balanceAccounts) {
      if (level === 1) {
        closeSection();
        section = label;
        shown = 0;
        const f =
          label === "Assets" ? forecast.totalAssets : label === "Liabilities" ? forecast.totalLiabilities : num(forecast.balance.get(label));
        out.push({ label, level, a: actual.level1.get(label) ?? 0, f });
      } else {
        const a = num(actual.level2.get(label));
        const f = num(forecast.balance.get(label));
        shown += a ?? 0;
        if (!isEmptyRow(a, f)) out.push({ label, level, a, f });
      }
    }
    closeSection();
    return out;
  }, [forecast, actual, balanceAccounts]);

  const netActual = actual ? (actual.level1.get("Assets") ?? 0) + (actual.level1.get("Liabilities") ?? 0) : null;
  const netForecast = forecast?.netAssets ?? null;
  const netVariance = diff(netActual, netForecast);

  const startYear = periodStart ? Number(periodStart) - 1 : null;
  const outOfRange = !loading && !error && periodStart && !forecast;

  const cell = (v) => (
    <td className={`balance-report-table__value${isNeg(v) ? " balance-report-table__value--negative" : ""}`}>
      {money(v)}
    </td>
  );

  return (
    <div className="balv2">
      <div className="report-toolbar-header">
        <div className="report-toolbar-header__text">
          <h1 className="report-toolbar-header__title">Forecast Balance Sheet</h1>
          <p className="report-toolbar-header__description">
            Actual balances on a date against the scenario's year-end forecast (as last
            generated) for that year. Variance = Actual − Forecast.
          </p>
        </div>
      </div>

      {!loading && forecast && (
        <div className="balv2-kpis">
          <div className="balv2-kpi balv2-kpi--highlight">
            <span className="balv2-kpi__label">Net Assets — actual</span>
            <span className={`balv2-kpi__value${isNeg(netActual) ? " balv2-kpi__value--negative" : ""}`}>
              {money(netActual)}
            </span>
          </div>
          <div className="balv2-kpi">
            <span className="balv2-kpi__label">Forecast YE {year}</span>
            <span className={`balv2-kpi__value${isNeg(netForecast) ? " balv2-kpi__value--negative" : ""}`}>
              {money(netForecast)}
            </span>
          </div>
          <div className="balv2-kpi">
            <span className="balv2-kpi__label">Variance</span>
            <span className={`balv2-kpi__value${isNeg(netVariance) ? " balv2-kpi__value--negative" : ""}`}>
              {money(netVariance)}
            </span>
          </div>
        </div>
      )}

      <div className="balv2-toolbar">
        <div className="balv2-periods">
          <div className="balv2-period-count">
            <span className="balv2-period-count__label">Scenario</span>
            <select
              className="balv2-period-count__select"
              value={selectedScenario}
              onChange={(e) => setSelectedScenario(e.target.value)}
            >
              {scenarioOptions(scenarios).map((o) => (
                <option key={o.name} value={o.name}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div className="balv2-period-count">
            <span className="balv2-period-count__label">Actual as of</span>
            <input
              type="date"
              className="balv2-date-input"
              value={asOfDate}
              onChange={(e) => e.target.value && setAsOfDate(e.target.value)}
            />
          </div>
        </div>
      </div>

      <div className="balv2-report-wrap">
        {loading && !error && (
          <div className="balv2-state">
            <Loader2 size={28} className="balv2-state__icon" />
            <span className="balv2-state__text">Loading…</span>
          </div>
        )}

        {error && (
          <div className="balv2-state">
            <AlertTriangle size={28} className="balv2-state__icon" />
            <span className="balv2-state__text balv2-state__text--error">{error}</span>
          </div>
        )}

        {outOfRange && (
          <div className="balv2-state">
            <AlertTriangle size={28} className="balv2-state__icon" />
            <span className="balv2-state__text">
              {selectedScenario} has no forecast balance sheet for {year} — it covers {startYear}–
              {scenarioObj?.PeriodEnd}, or it has not been generated.
            </span>
          </div>
        )}

        {!loading && !error && forecast && (
          <div className="balv2-report-scroll">
            <section className="balance-content">
              <div className="balance-report report-table">
                <div className="balance-report__table-wrapper">
                  <table className="balance-report-table">
                    <caption className="report-table__caption">
                      {selectedScenario} · forecast as last generated · Variance = Actual − Forecast
                    </caption>
                    <colgroup>
                      <col style={{ width: "260px" }} />
                      <col />
                      <col />
                      <col />
                    </colgroup>
                    <thead className="balance-report-table__head">
                      <tr>
                        <th className="balance-report-table__category">Account</th>
                        <th>Actual {asOfDate}</th>
                        <th>Forecast YE {year}</th>
                        <th>Variance</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => (
                        <tr key={`${r.level}-${r.label}`} data-level={r.level === 1 ? 0 : 2}>
                          <td
                            className="balance-report-table__name"
                            // Inline: the shared `tbody td` padding outranks `--report-indent-level`.
                            style={{ paddingLeft: r.level === 1 ? "0.5rem" : "1.6rem" }}
                          >
                            {r.label}
                          </td>
                          {cell(r.a)}
                          {cell(r.f)}
                          {cell(diff(r.a, r.f))}
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="balance-report-table__net-worth">
                        <td className="balance-report-table__name">Net Assets</td>
                        {cell(netActual)}
                        {cell(netForecast)}
                        {cell(netVariance)}
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
