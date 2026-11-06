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
 *   estimated  a distribution, or the rate cash is currently at. A PROJECTION —
 *              from the last twelve months' payments, or from a floating rate —
 *              that nobody owes and that can change next week.
 *
 * A single "income" figure would tell the owner a fund's distribution is as
 * reliable as a Treasury coupon.
 */

import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  ComposedChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import Rest from "../js/rest.js";
import EmptyState from "../components/EmptyState.jsx";
import LoadingSpinner from "../components/LoadingSpinner.jsx";
import useTheme from "../hooks/useTheme.js";
import { chartChrome, seriesColors, tooltipStyle } from "../features/Forecast/utils/fcSeriesPalette.js";
import { money } from "../features/Investments/investmentFormat.js";
import IncomeBudgetYear from "../features/Investments/IncomeBudgetYear.jsx";
import "../components/ReportTabs/ReportTabs.css";
import "./PageLayout.css";
import "./Investments.css";

const pct = (n) => `${(Number(n) * 100).toFixed(2)}%`;
const STALE_DAYS = 35;

export default function InvestmentIncome() {
  const { accountId } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  // UTC, as the server validates the year in UTC.
  const [year, setYear] = useState(() => new Date().getUTCFullYear() + 1);
  const [rateInput, setRateInput] = useState("");
  const [rate, setRate] = useState("");
  const [rateError, setRateError] = useState(null);
  const { theme } = useTheme();
  const chrome = chartChrome(theme);
  const colors = seriesColors(theme);

  useEffect(() => {
    let live = true;
    const q = new URLSearchParams({ year: String(year) });
    if (rate !== "") q.set("reinvestRate", rate);
    Rest.fetchJson(`/api/v2/investments/income?${q}`)
      .then((res) => { if (live) { setData(Rest.unwrap(res)); setError(null); } })
      .catch((e) => live && setError(e.message || String(e)));
    return () => { live = false; };
  }, [year, rate]);
  const applyRate = () => {
    const v = rateInput.trim();
    if (v === "" || (/^\d+(\.\d+)?$/.test(v) && Number(v) <= 20)) { setRate(v); setRateError(null); return; }
    setRateError(`"${v}" is not a rate from 0 to 20 — still using ${rate === "" ? "each account's yield" : `${rate}%`}`);
  };

  if (error) {
    return (
      <div className="page-shell">
        <EmptyState message={`Could not load income — ${error}`} />
      </div>
    );
  }
  if (!data) return <LoadingSpinner />;

  // CR103: the tab picks the view; All is the merged portfolio, exactly as before.
  const view = accountId ? data.accounts.find((a) => String(a.account_id) === String(accountId)) : data;
  const baseYear = Number(String(data.window.from).slice(0, 4));
  const years = [baseYear, baseYear + 1, baseYear + 2];
  // Links, not buttons: each account has a URL, as on the positions page.
  const tabs = (
    <nav className="report-tabs" aria-label="Income by account">
      <Link to="/investments/income" className={`report-tab${!accountId ? " report-tab--active" : ""}`}
        aria-current={!accountId ? "page" : undefined}>All accounts</Link>
      {data.accounts.map((a) => {
        const on = String(a.account_id) === String(accountId);
        return (
          <Link key={a.account_id} to={`/investments/income/${a.account_id}`}
            className={`report-tab${on ? " report-tab--active" : ""}`} aria-current={on ? "page" : undefined}>
            {a.account_name}
          </Link>
        );
      })}
    </nav>
  );
  if (!view) {
    return (
      <div className="page-shell inv-page">
        {tabs}
        <EmptyState message="No investment positions for that account." />
      </div>
    );
  }
  const s = view.scheduled;
  const e = view.estimated;
  const ageDays = data.dividends_age_days ?? null;

  return (
    <div className="page-shell inv-page">
      <header className="page-accent__header">
        <h1>Investment Income</h1>
        <p className="page-accent__sub">
          What {accountId ? view.account_name : "the portfolio"} pays over the next twelve months —{" "}
          {data.window.from} to {data.window.to}.
        </p>
      </header>

      {tabs}

      {ageDays !== null && (
        <p className="inv-history__caveat">
          {ageDays > STALE_DAYS ? (
            <>⚠️ <strong>Dividend history is {ageDays} days old</strong> (loaded {data.dividends_as_of}). Reload it
              (<code>Scripts/load-dividends.js --apply</code>) before copying to the budget.</>
          ) : <>Dividend history loaded {data.dividends_as_of}.</>}
        </p>
      )}

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
            <span className="inv-income__label">Estimated — distributions &amp; cash</span>
            <span className="inv-income__figure">{money(e.total, "USD")}</span>
            <span className="inv-income__note">
              {/* ⚠️ TWO kinds of estimate now, and the caption has to cover both:
                  what a holding PAID over the last year, and the rate cash is AT.
                  Neither is owed; both can change next week. */}
              A projection — from what {e.holdings.filter((h) => h.basis !== "cash_rate").length}{" "}
              holdings paid over the last twelve months, and from the current rate on{" "}
              {e.holdings.filter((h) => h.basis === "cash_rate").length} cash and money-market
              holdings. Nobody owes either, and both can change.
            </span>
          </div>
          <div>
            <span className="inv-income__label">Together</span>
            <span className="inv-income__figure">{money(view.total, "USD")}</span>
            <span className="inv-income__note">
              {pct(view.yield_on_portfolio)} on {accountId ? "the whole account" : "the whole portfolio"} — not on the
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
          Coupons sit on the months they are actually due. Distributions and cash interest are
          spread evenly — we know what was <em>paid</em> over the last year and what rate cash is
          at, not when the next payments land, and projecting last year's dates forward would
          assert a calendar nobody published. The first and last months are partial.
        </p>
        <div className="inv-chart">
          <ResponsiveContainer width="100%" height={260}>
            <ComposedChart data={view.by_month} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid stroke={chrome.grid} strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="month" stroke={chrome.axis} tick={{ fontSize: 11 }} />
              <YAxis stroke={chrome.axis} tick={{ fontSize: 11 }} width={70}
                tickFormatter={(v) => money(v, "USD")} />
              <Tooltip contentStyle={tooltipStyle} formatter={(v, n) => [money(v, "USD"), n]} />
              <Legend wrapperStyle={{ fontSize: "0.78rem" }} />
              {/* Stacked, but never merged into one bar: the split is the point. */}
              <Bar dataKey="scheduled" name="Scheduled (coupons)" stackId="i" fill={colors[0]} isAnimationActive={false} />
              <Bar dataKey="estimated" name="Estimated (distributions + cash)" stackId="i" fill={colors[3]} isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </section>

      {data.budget && (
        // Keyed so a copy box or "Copied" note never survives a change of tab, year or rate.
        <IncomeBudgetYear key={`${accountId ?? "all"}-${data.budget.year}-${rate}`}
          budget={data.budget} accountId={accountId} years={years} year={year} onYear={setYear}
          rateInput={rateInput} onRateInput={setRateInput} onRateApply={applyRate} rateError={rateError} />
      )}

      {s.holdings.length > 0 && (
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
      )}

      {e.holdings.some((h) => h.basis === "cash_rate") && (
        <section className="panel inv-account">
          <h2>What cash is earning</h2>
          <p className="inv-history__caveat">
            {/* ⚠️ The rate's own date matters here more than anywhere else on the
                page: money-market yields track policy, and this corpus runs from
                0.06% in 2016 to 5.30% in 2023. A stale one is not a rounding
                error, so every row carries when it was printed. */}
            A money-market <strong>7-day yield</strong> is annualised from the last week's income;
            an FDIC sweep's <strong>interest rate</strong> is what the bank is paying. Both float,
            so these are estimates — and each is as of the statement that printed it, which can be
            a quarter old or more.
          </p>
          <table className="inv-exposure">
            <thead>
              <tr>
                <th scope="col">Holding</th>
                <th scope="col" className="inv-num">Balance</th>
                <th scope="col" className="inv-num">Rate</th>
                <th scope="col" className="inv-num">As of</th>
                <th scope="col" className="inv-num">12-month income</th>
              </tr>
            </thead>
            <tbody>
              {e.holdings.filter((h) => h.basis === "cash_rate").map((h) => (
                <tr key={h.security_id}>
                  <th scope="row">
                    <span className="inv-name" title={h.name}>{h.ticker || h.name}</span>
                    <span className="inv-detail__note">
                      {h.rate_kind === "seven_day_yield" ? "7-day yield" : "interest rate"}
                    </span>
                  </th>
                  <td className="inv-num">{money(h.market_value, "USD")}</td>
                  <td className="inv-num">{h.rate}%</td>
                  <td className="inv-num">{h.rate_as_of}</td>
                  <td className="inv-num">{money(h.total, "USD")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {view.no_answer.length > 0 && (
      <section className="panel inv-account">
        <h2>What this cannot say</h2>
        <p className="inv-history__caveat">
          <strong>{money(view.no_answer_value, "USD")}</strong> of {accountId ? "the account" : "the portfolio"} states no income
          here, for four different reasons — and only one of them is a gap in our data.
        </p>
        {view.no_answer.map((g) => (
          <div key={g.key} className="inv-income__gap">
            <p className="inv-history__caveat">
              <strong>{money(g.value, "USD")}</strong> — {g.label} ({g.holdings.length}).{" "}
              {g.key === "rate_unknown" ? <strong>{g.note}</strong> : g.note}
            </p>
          </div>
        ))}
      </section>
      )}
    </div>
  );
}
