/**
 * FixedIncomePanels.jsx — CR093 P1, the fixed-income half of the X-ray.
 *
 * 58% of this portfolio is fixed income, and until now the register could say
 * nothing about any of it beyond a market value. Every field here is printed on
 * the custodian's own statements, so no vendor is called and none can contradict
 * it — but a statement is quarterly, so its date is shown rather than implied.
 *
 * ⚠️ FETCHES SEPARATELY, on purpose. If this slice fails the sector panels above
 * it still render: a failure in one view of the portfolio must not take down the
 * others.
 *
 * ⚠️ FOUR REASONS A HOLDING HAS NO RATING, kept apart on the page because they
 * mean opposite things. A brokered CD is FDIC-INSURED, not unrated; a bond fund
 * holds hundreds of issues and has no single rating; a bond bought since the last
 * quarter-end simply has no statement yet. Only the last is work to do, and it
 * closes by itself.
 */

import { useEffect, useState } from "react";
import Rest from "../../js/rest.js";
import { money } from "./investmentFormat.js";

const CREDIT_LABEL = {
  aaa: "AAA / Aaa",
  aa: "AA / Aa",
  a: "A",
  bbb: "BBB / Baa",
  bb: "BB / Ba",
  b: "B",
  ccc_or_below: "CCC and below",
  fdic_insured: "FDIC-insured CDs",
  fund: "Bond funds",
  not_rated: "No rating printed",
  no_terms: "No statement yet",
};

// The buckets that are not a credit grade. Drawn in a second tone so the credit
// distribution reads as a distribution rather than as one bar among eleven.
const NOT_A_GRADE = new Set(["fdic_insured", "fund", "not_rated", "no_terms"]);

const pct = (n) => `${(Number(n) * 100).toFixed(1)}%`;

function Rows({ rows, labels, tone }) {
  return (
    <table className="inv-exposure">
      <thead>
        <tr>
          <th scope="col">Band</th>
          <th scope="col" aria-label="share" />
          <th scope="col" className="inv-num">Value</th>
          <th scope="col" className="inv-num">of fixed income</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.bucket}>
            <th scope="row">{labels[r.bucket] || r.bucket}</th>
            <td className="inv-exposure__bar">
              <div className="inv-bar" aria-hidden="true">
                <div
                  className={`inv-bar__fill${tone && tone(r.bucket) ? " inv-bar__fill--muted" : ""}`}
                  /* The RAW share, on the same scale as the asset-class and sector
                     panels above. Normalising to the largest band here would make a
                     31% bucket fill the track while a 58% one above it sits at
                     half — three tables on one page that cannot be compared. */
                  style={{ width: `${Math.max(Number(r.share) * 100, 0.8)}%` }}
                />
              </div>
            </td>
            <td className="inv-num">{money(r.market_value, "USD")}</td>
            <td className="inv-num inv-exposure__pct">{pct(r.share)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function FixedIncomePanels() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let live = true;
    Rest.fetchJson("/api/v2/investments/fixed-income")
      .then((res) => { if (live) { setData(Rest.unwrap(res)); setError(null); } })
      .catch((e) => live && setError(e.message || String(e)));
    return () => { live = false; };
  }, []);

  if (error) {
    return (
      <section className="panel inv-account">
        <h2>Fixed income</h2>
        <p className="inv-history__caveat">Could not load the fixed-income X-ray — {error}</p>
      </section>
    );
  }
  if (!data) return null;
  if (!data.by_credit.length) {
    return (
      <section className="panel inv-account">
        <h2>Fixed income</h2>
        <p className="inv-history__caveat">No fixed-income holdings in the latest snapshot.</p>
      </section>
    );
  }

  const cov = data.credit_coverage;
  const asOf = data.terms_as_of.latest;
  // ⚠️ Three ways to be absent, named separately. "No single maturity" is true
  // of a fund forever; "no statement yet" is a bond bought since the last
  // quarter-end and closes itself. One label for both would describe a third of
  // the band as something it is not.
  const ABSENT_LABEL = {
    fund: "Bond funds — no single value",
    no_terms: "No statement yet",
    not_stated: "Not printed on the statement",
  };
  const maturityLabels = Object.fromEntries([
    ...data.bands.maturity.map((b) => [b.key, b.label]),
    ...Object.entries(ABSENT_LABEL),
  ]);
  const couponLabels = Object.fromEntries([
    ...data.bands.coupon.map((b) => [b.key, b.label]),
    ...Object.entries(ABSENT_LABEL),
  ]);
  const isAbsent = (b) => b in ABSENT_LABEL;

  return (
    <>
      <section className="panel inv-account">
        <h2>Fixed income by credit</h2>
        <p className="inv-history__caveat">
          <strong>{money(data.fixed_income_value, "USD")}</strong> — {pct(data.share_of_portfolio)} of
          the portfolio. Ratings, coupons and maturities are as printed on the custodian
          statements{asOf ? `, latest ${asOf}` : ""}, so they can be up to a quarter old.
          {/* ⚠️ A split rating rounds DOWN, and saying so matters: the same bond can
              sit one grade apart depending on which agency is quoted. */}
          {" "}Where the two agencies disagree, the lower grade is used.
        </p>
        <p className="inv-history__caveat">
          <strong>{money(cov.rated_value, "USD")}</strong> carries an agency rating
          ({pct(cov.share_rated)} of fixed income), and {pct(cov.investment_grade_share_of_rated)} of
          that is investment grade. The rest is not unrated —{" "}
          <strong>{money(cov.fdic_insured_value, "USD")}</strong> is FDIC-insured CDs
          ({cov.fdic_insured.length}), <strong>{money(cov.fund_value, "USD")}</strong> is bond
          funds holding hundreds of issues each ({cov.fund.length}), and{" "}
          <strong>{money(cov.no_terms_value, "USD")}</strong> has no statement yet
          ({cov.no_terms.length}) — bought since the last quarter-end, and it closes itself.
        </p>
        <Rows rows={data.by_credit} labels={CREDIT_LABEL} tone={(b) => NOT_A_GRADE.has(b)} />
      </section>

      <section className="panel inv-account">
        <h2>Maturity ladder</h2>
        <p className="inv-history__caveat">
          When the money comes back, by years from today. Bond funds have no single maturity
          and are shown as their own band rather than spread across the others.
        </p>
        <Rows rows={data.by_maturity} labels={maturityLabels} tone={isAbsent} />
      </section>

      <section className="panel inv-account">
        <h2>By coupon</h2>
        <p className="inv-history__caveat">
          {/* 🔴 CR093 §4: coupon is the STRUCTURAL field and estimated annual income is
              a forward estimate that decays as a bond runs off. Calling either
              "yield" without saying which is how a maturing bond looks like a
              yield cut. */}
          {data.weighted_average_coupon !== null && (
            <>
              Weighted average coupon <strong>{data.weighted_average_coupon.toFixed(2)}%</strong> across
              the {money(data.weighted_average_coupon_base, "USD")} that carries one, weighted by
              market value.{" "}
            </>
          )}
          This is the rate the bonds pay on their face, not a yield — it says nothing about what
          was paid for them.
        </p>
        <Rows rows={data.by_coupon} labels={couponLabels} tone={isAbsent} />
      </section>
    </>
  );
}
