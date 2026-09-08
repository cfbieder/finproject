/**
 * InvestmentRisk.jsx — CR093 P2. What the portfolio is CONCENTRATED in.
 *
 * ⚠️ THE LIMIT IS THE FIRST THING ON THE PAGE, not a footnote. This is
 * concentration by HOLDING and by ISSUER, never by underlying company: CR093 §1
 * decision 2 bought fund look-through at the level of sector weights, not
 * constituents, so the same mega-caps sitting inside four funds cannot be
 * netted into a single-name figure. A page that ranked "largest positions" while
 * silently omitting that would answer a different question from the one it
 * appears to answer.
 *
 * ⚠️ And concentration is not risk by itself — a single Treasury at 40% is a
 * different proposition from a single small-cap at 40%. This ranks and measures;
 * it does not score.
 */

import { useEffect, useState } from "react";
import Rest from "../js/rest.js";
import EmptyState from "../components/EmptyState.jsx";
import LoadingSpinner from "../components/LoadingSpinner.jsx";
import { money } from "../features/Investments/investmentFormat.js";
import "./PageLayout.css";
import "./Investments.css";

const pct = (n) => `${(Number(n) * 100).toFixed(1)}%`;

export default function InvestmentRisk() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let live = true;
    Rest.fetchJson("/api/v2/investments/risk")
      .then((res) => { if (live) { setData(Rest.unwrap(res)); setError(null); } })
      .catch((e) => live && setError(e.message || String(e)));
    return () => { live = false; };
  }, []);

  if (error) {
    return <div className="page-shell"><EmptyState message={`Could not load risk — ${error}`} /></div>;
  }
  if (!data) return <LoadingSpinner />;

  const { concentration: c, fdic } = data;

  return (
    <div className="page-shell inv-page">
      <header className="page-accent__header">
        <h1>Investment Risk</h1>
        <p className="page-accent__sub">
          How much rests on one thing — {data.holdings_count} holdings,{" "}
          {money(data.total_market_value, "USD")}.
        </p>
      </header>

      {/* 🔴 The only place in this whole feature where a real LIMIT exists to be
          measured against, rather than a distribution to be described. It leads. */}
      <section className="panel inv-account">
        <h2>FDIC insurance</h2>
        <p className="inv-history__caveat">
          {fdic.over_limit_count > 0 ? (
            <>
              🔴 <strong>{money(fdic.total_uninsured, "USD")} is above the FDIC limit</strong> at{" "}
              {fdic.over_limit_count === 1 ? "one bank" : `${fdic.over_limit_count} banks`}. Insurance
              is <strong>{money(fdic.limit, "USD")} per depositor, per bank</strong>, so several CDs
              at one bank are added together — each can be under the limit while the total is over.
            </>
          ) : (
            <>Every bank is within the {money(fdic.limit, "USD")} per-depositor limit.</>
          )}
        </p>
        <table className="inv-exposure">
          <thead>
            <tr>
              <th scope="col">Bank</th>
              <th scope="col" className="inv-num">Deposits</th>
              <th scope="col" className="inv-num">Insured</th>
              <th scope="col" className="inv-num">Uninsured</th>
              <th scope="col" className="inv-num">Headroom</th>
            </tr>
          </thead>
          <tbody>
            {fdic.banks.map((b) => (
              <tr key={b.bank}>
                <th scope="row">
                  <span className="inv-name" title={b.holdings.map((h) => h.name).join(" · ")}>
                    {b.over_limit && "🔴 "}{b.bank}
                  </span>
                  {/* The grouping is derived from custodian names, so what was
                      grouped is shown rather than asserted. */}
                  <span className="inv-detail__note">
                    {b.count === 1 ? "1 deposit" : `${b.count} deposits`}
                  </span>
                </th>
                <td className="inv-num">{money(b.market_value, "USD")}</td>
                <td className="inv-num">{money(b.insured, "USD")}</td>
                <td className="inv-num">
                  {Number(b.uninsured) > 0
                    ? <strong className="inv-warn">{money(b.uninsured, "USD")}</strong>
                    : <span className="inv-muted">—</span>}
                </td>
                <td className="inv-num">
                  {Number(b.headroom) > 0 ? money(b.headroom, "USD") : <span className="inv-muted">—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <p className="inv-history__caveat">
          {/* 🔴 Two things get called "cash" and only one of them is insured. */}
          ⚠️ <strong>{money(fdic.money_market_value, "USD")} of money-market funds is NOT
          FDIC-insured</strong> ({fdic.money_market.map((m) => m.ticker || m.name).join(", ")}).
          They sit beside the deposits in a core account and both get called cash; a money-market
          fund is a security, not a deposit.
          {Number(fdic.unattributed_value) > 0 && (
            <>
              {" "}🔴 And <strong>{money(fdic.unattributed_value, "USD")} cannot be checked at all</strong> —
              held at par under a name that identifies no bank
              ({fdic.unattributed.map((u) => u.name).join(", ")}). That is the feed-rename defect,
              not a property of the money.
            </>
          )}
          {" "}⚠️ The limit is also per <em>ownership category</em>, and fin cannot see accounts you
          hold at these banks directly — so this is a floor on what is uninsured, not a ceiling.
        </p>
      </section>

      <section className="panel inv-account">
        <h2>Largest holdings</h2>
        <p className="inv-history__caveat">
          The top holding is <strong>{pct(c.top_1)}</strong> of the portfolio; the top five are{" "}
          <strong>{pct(c.top_5)}</strong> and the top ten <strong>{pct(c.top_10)}</strong>.{" "}
          {/* ⚠️ The limit that makes this page honest. */}
          ⚠️ This ranks <strong>holdings</strong>, not companies. Funds are not seen through to their
          constituents, so a company held inside several funds is counted in each of them and never
          added up — true overlap cannot be computed from anything fin has.
        </p>
        <table className="inv-exposure">
          <thead>
            <tr>
              <th scope="col">Holding</th>
              <th scope="col" aria-label="share" />
              <th scope="col" className="inv-num">Value</th>
              <th scope="col" className="inv-num">of portfolio</th>
            </tr>
          </thead>
          <tbody>
            {data.by_holding.slice(0, 15).map((h) => (
              <tr key={h.security_id}>
                <th scope="row">
                  <span className="inv-name" title={h.name}>{h.ticker || h.name}</span>
                  {h.is_fund && <span className="inv-detail__note">fund — not seen through</span>}
                </th>
                <td className="inv-exposure__bar">
                  <div className="inv-bar" aria-hidden="true">
                    <div className={`inv-bar__fill${h.is_fund ? " inv-bar__fill--muted" : ""}`}
                      style={{ width: `${Math.max(Number(h.share) * 100, 0.8)}%` }} />
                  </div>
                </td>
                <td className="inv-num">{money(h.market_value, "USD")}</td>
                <td className="inv-num inv-exposure__pct">{pct(h.share)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="panel inv-account">
        <h2>By issuer</h2>
        <p className="inv-history__caveat">
          What one borrower owes you, across every instrument of theirs you hold — the question a
          per-holding list cannot answer. The issuer is <strong>derived from the name the custodian
          prints</strong>, so hover a row to see exactly which holdings were grouped into it.{" "}
          ⚠️ Corporate families are deliberately <em>not</em> merged: two entities of one group stay
          apart, which understates concentration rather than inventing it.{" "}
          ⚠️ Funds are excluded ({money(data.issuer_coverage.excluded_funds_value, "USD")}) — the
          issuer of an index fund is its sponsor, but its risk is its constituents.{" "}
          {/* 🔴 A fund we have not classified has nothing marking it as one, so it
              lands here as though it were a company. Naming that is better than a
              name-shaped guess at what is and is not a fund. */}
          🔴 A fund <em>we have not classified yet</em> carries no flag saying so, and appears below
          as if it were a single company — the two closed-end funds on the Exposure page are exactly
          that. Classifying them there removes them from here too.
          {Number(data.issuer_coverage.no_issuer_value) > 0 && (
            <>
              {" "}{money(data.issuer_coverage.no_issuer_value, "USD")} carries no readable name
              ({data.issuer_coverage.no_issuer.length} holdings named only by an identifier), so it
              has no issuer here.
            </>
          )}
        </p>
        <table className="inv-exposure">
          <thead>
            <tr>
              <th scope="col">Issuer</th>
              <th scope="col" className="inv-num">Holdings</th>
              <th scope="col" className="inv-num">Value</th>
              <th scope="col" className="inv-num">of portfolio</th>
            </tr>
          </thead>
          <tbody>
            {data.by_issuer.slice(0, 15).map((g) => (
              <tr key={g.issuer}>
                <th scope="row">
                  <span className="inv-name" title={g.holdings.map((h) => h.name).join(" · ")}>
                    {g.issuer}
                  </span>
                </th>
                <td className="inv-num">{g.count}</td>
                <td className="inv-num">{money(g.market_value, "USD")}</td>
                <td className="inv-num inv-exposure__pct">{pct(g.share)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
