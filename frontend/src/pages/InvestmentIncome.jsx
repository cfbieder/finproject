/**
 * InvestmentIncome.jsx — CR093 P3. What the portfolio pays, and when.
 *
 * ⚠️ SCHEDULED AND ESTIMATED ARE NOT ONE NUMBER, and the page leads with the
 * distinction rather than footnoting it.
 *
 *   scheduled  a bond's coupon. CONTRACTUAL and DATED — the issuer owes it and
 *              we know the day. Derived from the custodian's own terms, and
 *              validated against Fidelity's printed Estimated Annual Income on
 *              all 27 bonds of the 2026-06 statement.
 *   estimated  a distribution. A PROJECTION from the last twelve months that
 *              nobody owes and that can be cut.
 *
 * A single "income" figure would tell the owner a fund's distribution is as
 * reliable as a Treasury coupon.
 */

import { useEffect, useState } from "react";
import {
  ComposedChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import Rest from "../js/rest.js";
import EmptyState from "../components/EmptyState.jsx";
import LoadingSpinner from "../components/LoadingSpinner.jsx";
import useTheme from "../hooks/useTheme.js";
import { chartChrome, seriesColors, tooltipStyle } from "../features/Forecast/utils/fcSeriesPalette.js";
import { money } from "../features/Investments/investmentFormat.js";
import "./PageLayout.css";
import "./Investments.css";

const pct = (n) => `${(Number(n) * 100).toFixed(2)}%`;

export default function InvestmentIncome() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const { theme } = useTheme();
  const chrome = chartChrome(theme);
  const colors = seriesColors(theme);

  useEffect(() => {
    let live = true;
    Rest.fetchJson("/api/v2/investments/income")
      .then((res) => { if (live) { setData(Rest.unwrap(res)); setError(null); } })
      .catch((e) => live && setError(e.message || String(e)));
    return () => { live = false; };
  }, []);

  if (error) {
    return (
      <div className="page-shell">
        <EmptyState message={`Could not load income — ${error}`} />
      </div>
    );
  }
  if (!data) return <LoadingSpinner />;

  const s = data.scheduled;
  const e = data.estimated;

  return (
    <div className="page-shell inv-page">
      <header className="page-accent__header">
        <h1>Investment Income</h1>
        <p className="page-accent__sub">
          What the portfolio pays over the next twelve months —{" "}
          {data.window.from} to {data.window.to}.
        </p>
      </header>

      <section className="panel inv-account">
        <h2>The next twelve months</h2>
        {/* ⚠️ The two halves are stated apart BEFORE the total, because they are
            not equally reliable and the combined figure hides that. */}
        <div className="inv-income__heads">
          <div>
            <span className="inv-income__label">Scheduled — bond coupons</span>
            <span className="inv-income__figure">{money(s.total, "USD")}</span>
            <span className="inv-income__note">
              Contractual and dated. {s.holdings.length} bonds and CDs, from the coupon,
              frequency and maturity the custodian prints.
            </span>
          </div>
          <div>
            <span className="inv-income__label">Estimated — distributions</span>
            <span className="inv-income__figure">{money(e.total, "USD")}</span>
            <span className="inv-income__note">
              A projection from what {e.holdings.length} holdings actually paid over the last
              twelve months. Nobody owes it, and a distribution can be cut.
            </span>
          </div>
          <div>
            <span className="inv-income__label">Together</span>
            <span className="inv-income__figure">{money(data.total, "USD")}</span>
            <span className="inv-income__note">
              {pct(data.yield_on_portfolio)} on the whole portfolio — not on the
              income-producing part, which would read much higher.
            </span>
          </div>
        </div>

        {(Number(s.callable_total) > 0 || Number(s.maturing_total) > 0) && (
          <p className="inv-history__caveat">
            {/* A called bond simply stops paying, and a call cannot be predicted —
                so the schedule runs to maturity and the exposure is named. */}
            {Number(s.callable_total) > 0 && (
              <>⚠️ <strong>{money(s.callable_total, "USD")}</strong> of the scheduled income comes
                from bonds the issuer may <strong>call</strong> before the window ends — a called
                bond stops paying, and a call cannot be predicted, so it is counted here and
                flagged rather than discounted. </>
            )}
            {Number(s.maturing_total) > 0 && (
              <><strong>{money(s.maturing_total, "USD")}</strong> comes from bonds that
                <strong> mature</strong> inside the window and stop paying after that.</>
            )}
          </p>
        )}
      </section>

      <section className="panel inv-account">
        <h2>Month by month</h2>
        <p className="inv-history__caveat">
          Coupons sit on the months they are actually due. Distributions are spread evenly,
          because we know what was <em>paid</em> over the last year, not when the next ones land —
          projecting last year's dates forward would assert a calendar nobody published.
          The first and last months are partial.
        </p>
        <div className="inv-chart">
          <ResponsiveContainer width="100%" height={260}>
            <ComposedChart data={data.by_month} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid stroke={chrome.grid} strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="month" stroke={chrome.axis} tick={{ fontSize: 11 }} />
              <YAxis stroke={chrome.axis} tick={{ fontSize: 11 }} width={70}
                tickFormatter={(v) => money(v, "USD")} />
              <Tooltip contentStyle={tooltipStyle} formatter={(v, n) => [money(v, "USD"), n]} />
              <Legend wrapperStyle={{ fontSize: "0.78rem" }} />
              {/* Stacked, but never merged into one bar: the split is the point. */}
              <Bar dataKey="scheduled" name="Scheduled (coupons)" stackId="i" fill={colors[0]} isAnimationActive={false} />
              <Bar dataKey="estimated" name="Estimated (distributions)" stackId="i" fill={colors[3]} isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section className="panel inv-account">
        <h2>Where the scheduled income comes from</h2>
        <table className="inv-exposure">
          <thead>
            <tr>
              <th scope="col">Bond</th>
              <th scope="col" className="inv-num">Face</th>
              <th scope="col" className="inv-num">Coupon</th>
              <th scope="col" className="inv-num">Payments</th>
              <th scope="col" className="inv-num">12-month income</th>
            </tr>
          </thead>
          <tbody>
            {s.holdings.map((h) => (
              <tr key={h.security_id}>
                <th scope="row">
                  <span className="inv-name" title={h.name}>{h.name}</span>
                  {h.matures_in_window && <span className="inv-detail__note">matures {h.maturity_date} — stops paying</span>}
                  {!h.matures_in_window && h.callable_before && (
                    <span className="inv-detail__note">callable from {h.callable_before}</span>
                  )}
                </th>
                <td className="inv-num">{money(h.face, "USD")}</td>
                <td className="inv-num">{h.coupon_rate}%</td>
                <td className="inv-num">{h.payments} × {money(h.per_payment, "USD")}</td>
                <td className="inv-num">{money(h.total, "USD")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="panel inv-account">
        <h2>What this cannot say</h2>
        <p className="inv-history__caveat">
          <strong>{money(data.no_answer_value, "USD")}</strong> of the portfolio states no income
          here, for four different reasons — and only one of them is a gap in our data.
        </p>
        {data.no_answer.map((g) => (
          <div key={g.key} className="inv-income__gap">
            <p className="inv-history__caveat">
              <strong>{money(g.value, "USD")}</strong> — {g.label} ({g.holdings.length}).{" "}
              {g.key === "rate_unknown" ? <strong>{g.note}</strong> : g.note}
            </p>
          </div>
        ))}
      </section>
    </div>
  );
}
