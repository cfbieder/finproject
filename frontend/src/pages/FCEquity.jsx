import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import Rest from "../js/rest.js";
import { useScenarios } from "../features/Forecast/hooks/useScenarios.js";
import { scenarioOptions, scenarioOptionTitle } from "../features/Forecast/utils/scenarioOptions.js";
import "./PageLayout.css";
import "./FCEquity.css";

/**
 * FCEquity — CR062 P2: what the assets are worth NET of the debt secured on them.
 *
 * The forecast has always shown gross value: a 1.5M house reads as 1.5M whether it
 * carries an 800K mortgage or nothing. This page subtracts the debt actually
 * secured against each asset and shows the equity build, plus what the asset earns
 * net of what its debt costs.
 *
 * TWO BOTTOM LINES, deliberately. Principal repayment is a TRANSFER, not an
 * expense: folding it into "net income" would misstate the P&L, and leaving it out
 * would misstate the cash. So both are shown, separated — the same discipline
 * CR056 settled on rather than inventing a single number that is wrong for one of
 * the two questions.
 *
 * USD by construction: every forecast entry is already USD, so a EUR asset with a
 * EUR loan reports in USD. (CR054's USD ⇄ original toggle is the precedent if that
 * is ever wanted.)
 */

const VALUE_ROWS = [
  { key: "assetValue", label: "Asset value" },
  { key: "debt", label: "Less: loan balance" },
  { key: "equity", label: "Equity", emphasis: true },
];

const FLOW_ROWS = [
  { key: "assetIncome", label: "Asset income" },
  { key: "assetExpense", label: "Asset expense" },
  { key: "loanInterest", label: "Loan interest" },
  { key: "netIncome", label: "Net income", emphasis: true },
  { key: "principal", label: "Principal (and draw)", spaced: true },
  { key: "netCash", label: "Net cash after debt service", emphasis: true },
];

const fmt = (n) => {
  const v = Number(n) || 0;
  if (Math.abs(v) < 0.5) return "—";
  const body = Math.abs(v).toLocaleString(undefined, { maximumFractionDigits: 0 });
  return v < 0 ? `(${body})` : body;
};

export default function FCEquity() {
  const { scenarios, selectedScenario, setSelectedScenario } = useScenarios();
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async (scenario) => {
    if (!scenario) return;
    setLoading(true);
    setError("");
    try {
      const res = await Rest.fetchJson(
        `/api/v2/forecast/equity?scenario=${encodeURIComponent(scenario)}`
      );
      setReport(Rest.unwrap(res));
    } catch (err) {
      setError(err.message || "Failed to load the equity report");
      setReport(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(selectedScenario);
  }, [selectedScenario, load]);

  // Memoized so the `shownYears` memo below has a stable dependency — a fresh []
  // on every render would recompute it forever.
  const years = useMemo(() => report?.years || [], [report]);
  const assets = report?.assets || [];

  // Every fifth year keeps a 36-year horizon readable; the ends always show, so
  // the first and last columns are never the ones dropped.
  const shownYears = useMemo(() => {
    if (years.length <= 12) return years;
    return years.filter((y, i) => i === 0 || i === years.length - 1 || y % 5 === 0);
  }, [years]);

  return (
    <main className="page-main balance-grid balance-grid--single fc-equity">
      <header className="fc-equity__header">
        <h1 className="fc-equity__title">Forecast Equity</h1>
        <p className="fc-equity__subtitle">
          Each asset that carries debt, gross and net of the loans secured against
          it — and what it earns after what that debt costs. USD.
        </p>
      </header>

      <section className="panel fc-equity__toolbar">
        <label className="fc-equity__field">
          <span className="fc-equity__label">Scenario</span>
          <select
            id="fc-equity-scenario"
            className="fc-equity__input"
            value={selectedScenario}
            onChange={(e) => setSelectedScenario(e.target.value)}
          >
            {scenarioOptions(scenarios).map((option) => (
              <option key={option.name} value={option.name} title={scenarioOptionTitle(option)}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </section>

      {error && <section className="panel fc-equity__error">{error}</section>}

      {!error && !loading && assets.length === 0 && (
        <section className="panel fc-equity__empty">
          <h2>No asset carries debt in this scenario</h2>
          <p>
            An asset appears here once a <strong>Loan</strong> module is secured
            against it. Open the loan on <em>3. Forecast Modules</em> and pick the
            asset under <strong>Secured Against</strong>, then regenerate.
          </p>
          <p className="fc-equity__empty-note">
            Only assets that actually carry debt are listed — equity on an
            unencumbered asset is just its value, and showing those would bury the
            ones that matter.
          </p>
        </section>
      )}

      {assets.map((asset) => {
        const chartData = years.map((year, i) => ({
          year,
          equity: asset.rows.equity[i],
          debt: -asset.rows.debt[i], // stored negative; plot the magnitude
          value: asset.rows.assetValue[i],
        }));

        return (
          <section key={asset.assetId} className="panel fc-equity__asset">
            <header className="fc-equity__asset-header">
              <h2 className="fc-equity__asset-name">{asset.assetName}</h2>
              <span className="fc-equity__asset-meta">
                secured by {asset.loans.map((l) => l.name).join(", ")}
              </span>
            </header>

            <div className="fc-equity__chart">
              <ResponsiveContainer width="100%" height={280}>
                <ComposedChart data={chartData} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="year" stroke="var(--muted)" fontSize={12} />
                  <YAxis
                    stroke="var(--muted)"
                    fontSize={12}
                    tickFormatter={(v) => `${Math.round(v / 1000)}K`}
                    width={64}
                    /* Pad both ends by 8%. Without it the gross-value line lands
                       exactly on the top gridline and disappears into the plot
                       border — which is the one series the report is named for. */
                    domain={[
                      (min) => (min < 0 ? min * 1.08 : 0),
                      (max) => max * 1.08,
                    ]}
                  />
                  <Tooltip
                    formatter={(v, name) => [fmt(v), name]}
                    contentStyle={{
                      background: "var(--surface)",
                      border: "1px solid var(--border)",
                      borderRadius: "8px",
                      color: "var(--ink)",
                    }}
                  />
                  <Legend />
                  {/*
                    Gross as a line, equity as a filled area from zero, and the GAP
                    between them is the debt. Deliberately NOT a stacked area:
                    stacking equity + debt reads beautifully while equity is
                    positive and falls apart the moment it is not — and negative
                    equity is a normal state here, not an edge case. The Sarasota
                    plan draws its mortgage in 2027 and buys the house in 2028, so
                    2027 is −800K of equity; stacked, that rendered the debt band
                    below the axis and the "value = equity + debt" reading silently
                    stopped being true. Unstacked, a negative year just draws below
                    zero and means what it looks like.
                  */}
                  <Area
                    type="monotone"
                    dataKey="equity"
                    name="Equity (net of debt)"
                    stroke="var(--primary)"
                    fill="var(--primary)"
                    fillOpacity={0.3}
                    strokeWidth={2}
                  />
                  <Line
                    type="monotone"
                    dataKey="value"
                    name="Asset value (gross)"
                    stroke="var(--ink)"
                    strokeWidth={2}
                    dot={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="debt"
                    name="Debt outstanding"
                    stroke="var(--danger)"
                    strokeWidth={1.5}
                    strokeDasharray="4 3"
                    dot={false}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>

            <div className="fc-equity__table-scroll">
              <table className="fc-equity__table">
                <thead>
                  <tr>
                    <th className="fc-equity__row-label">&nbsp;</th>
                    {shownYears.map((y) => (
                      <th key={y}>{y}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[...VALUE_ROWS, ...FLOW_ROWS].map((row, idx) => (
                    <tr
                      key={row.key}
                      className={[
                        row.emphasis ? "fc-equity__row--emphasis" : "",
                        row.spaced ? "fc-equity__row--spaced" : "",
                        idx === VALUE_ROWS.length ? "fc-equity__row--block-start" : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                    >
                      <th scope="row" className="fc-equity__row-label">
                        {row.label}
                      </th>
                      {shownYears.map((y) => {
                        const i = years.indexOf(y);
                        const v = asset.rows[row.key][i];
                        return (
                          <td key={y} className={v < 0 ? "fc-equity__neg" : ""}>
                            {fmt(v)}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}
    </main>
  );
}
