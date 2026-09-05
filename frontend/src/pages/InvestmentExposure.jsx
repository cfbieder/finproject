/**
 * InvestmentExposure.jsx — CR093 P1. What the portfolio is EXPOSED to.
 *
 * CR090's register answers "what do I own". This answers "what am I exposed to",
 * and they differ sharply here: 72% of the equity sleeve is funds, so grouping
 * holdings by their own ticker would describe about a tenth of the money while
 * appearing to describe half of it.
 *
 * ⚠️ COVERAGE IS SHOWN, NOT HIDDEN. Nothing unclassified is spread across the
 * sectors we do know — that would invent exposure never measured — and the two
 * kinds of "no sector" are kept apart on the page, because one is permanent and
 * expected while the other is work to do.
 */

import { useEffect, useState } from "react";
import Rest from "../js/rest.js";
import EmptyState from "../components/EmptyState.jsx";
import LoadingSpinner from "../components/LoadingSpinner.jsx";
import { money } from "../features/Investments/investmentFormat.js";
import SectorPicker from "../features/Investments/SectorPicker.jsx";
import "./PageLayout.css";
import "./Investments.css";

const SECTOR_LABEL = {
  technology: "Technology",
  financial_services: "Financial Services",
  healthcare: "Healthcare",
  consumer_cyclical: "Consumer Cyclical",
  consumer_defensive: "Consumer Defensive",
  industrials: "Industrials",
  energy: "Energy",
  utilities: "Utilities",
  realestate: "Real Estate",
  basic_materials: "Basic Materials",
  communication_services: "Communication Services",
};

const CLASS_LABEL = {
  bond: "Fixed income",
  equity: "Equity",
  mutual_fund: "Mutual funds",
  mmf: "Money market",
  cash: "Cash",
  unknown: "Unclassified",
};

const pct = (n) => `${(Number(n) * 100).toFixed(1)}%`;

function Bar({ share, tone }) {
  // A width, not a chart. The number beside it is the fact; this only makes the
  // ordering scannable.
  return (
    <div className="inv-bar" aria-hidden="true">
      <div className={`inv-bar__fill${tone ? ` inv-bar__fill--${tone}` : ""}`} style={{ width: `${Math.max(Number(share) * 100, 0.4)}%` }} />
    </div>
  );
}

export default function InvestmentExposure() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  // Bumped after a save to re-run the fetch. A classification changes the sector
  // table AND the coverage figures above it, so the whole page must re-read
  // rather than the row patch itself locally and drift from the totals.
  const [reloads, setReloads] = useState(0);

  useEffect(() => {
    let live = true;
    Rest.fetchJson("/api/v2/investments/exposure")
      .then((res) => { if (live) { setData(Rest.unwrap(res)); setError(null); } })
      .catch((e) => live && setError(e.message || String(e)))
      .finally(() => live && setLoading(false));
    return () => { live = false; };
  }, [reloads]);

  if (loading) return <LoadingSpinner />;
  if (error) {
    return (
      <div className="page-shell">
        <EmptyState message={`Could not load exposure — ${error}`} />
      </div>
    );
  }
  if (!data) return null;

  const cov = data.sector_coverage;
  const total = Number(data.total_market_value);

  return (
    <div className="page-shell inv-page">
      <header className="page-accent__header">
        <h1>Investment Exposure</h1>
        <p className="page-accent__sub">
          What the portfolio is exposed to, with funds seen through to their underlying
          sectors — {money(total, "USD")} across every tracked account.
        </p>
      </header>

      <section className="panel inv-account">
        <h2>By asset class</h2>
        <p className="inv-history__caveat">
          Funds are classified by what they hold, not by how they trade: four bond funds were
          previously counted as equity.
        </p>
        <table className="inv-exposure">
          <tbody>
            {data.by_asset_class.map((a) => (
              <tr key={a.asset_class}>
                <th scope="row">{CLASS_LABEL[a.asset_class] || a.asset_class}</th>
                <td className="inv-exposure__bar"><Bar share={a.share} /></td>
                <td className="inv-num">{money(a.market_value, "USD")}</td>
                <td className="inv-num inv-exposure__pct">{pct(a.share)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="panel inv-account">
        <h2>By sector</h2>
        {/* ⚠️ Both denominators, always. Share of the sectored sleeve is what a pie
            chart shows; share of the whole portfolio is what is actually held. Only
            the first would make an 11.7% technology position read as 32%. */}
        <p className="inv-history__caveat">
          Covers <strong>{money(cov.sectored_value, "USD")}</strong> — {pct(cov.share_sectored)} of
          the portfolio. Percentages are shown against both the sectored sleeve and the whole
          portfolio, because they are very different numbers.
        </p>
        <table className="inv-exposure">
          <thead>
            <tr>
              <th scope="col">Sector</th>
              <th scope="col" aria-label="share" />
              <th scope="col" className="inv-num">Exposure</th>
              <th scope="col" className="inv-num">of sleeve</th>
              <th scope="col" className="inv-num">of portfolio</th>
            </tr>
          </thead>
          <tbody>
            {data.by_sector.map((s) => (
              <tr key={s.sector}>
                <th scope="row">{SECTOR_LABEL[s.sector] || s.sector}</th>
                <td className="inv-exposure__bar"><Bar share={s.share_of_sectored} /></td>
                <td className="inv-num">{money(s.market_value, "USD")}</td>
                <td className="inv-num inv-exposure__pct">{pct(s.share_of_sectored)}</td>
                <td className="inv-num inv-exposure__pct">{pct(s.share_of_portfolio)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="panel inv-account">
        <h2>What has no sector</h2>
        {/* Two buckets, deliberately. One is permanent and expected; the other is
            work to do. A single "unclassified" bucket could not tell them apart. */}
        <p className="inv-history__caveat">
          <strong>{money(cov.not_applicable_value, "USD")}</strong> has no equity sector by
          nature — bonds, brokered CDs, deposits and money-market funds
          ({cov.not_applicable.length} holdings). That is expected and permanent, not a gap.
        </p>
        {Number(cov.not_covered_value) > 0 ? (
          <>
            <p className="inv-history__caveat">
              <strong>{money(cov.not_covered_value, "USD")}</strong> is equity we cannot sector
              yet ({cov.not_covered.length} holdings). Closed-end funds: both data providers
              report them as <em>financial services</em> — the sector their manager is
              registered in, not what they hold — so that answer is refused rather than shown.
            </p>
            {/* Each row is a button: this is the one place the owner can answer a
                question no provider will. Buttons, not links — it opens an editor
                rather than navigating. */}
            <ul className="inv-uncovered">
              {cov.not_covered.map((x) => (
                <li key={x.security_id}>
                  <button
                    type="button"
                    className="btn btn--ghost btn--block inv-uncovered__row"
                    onClick={() => setEditing(x)}
                  >
                    <span className="inv-uncovered__sym">{x.ticker || "—"}</span>
                    <span className="inv-uncovered__name">{x.name}</span>
                    <span className="inv-num">{money(x.market_value, "USD")}</span>
                    <span className="inv-uncovered__cta">Set sector</span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="inv-history__caveat">Every equity holding is sectored.</p>
        )}
      </section>

      {editing && (
        <SectorPicker
          holding={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); setReloads((n) => n + 1); }}
        />
      )}
    </div>
  );
}
