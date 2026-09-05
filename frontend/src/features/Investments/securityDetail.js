/**
 * securityDetail.js — CR093 §5. The labelling rules the detail panel depends on.
 *
 * Its own module so they can be tested without rendering a dialog, and so
 * `SecurityChartModal.jsx` keeps exporting a component only (the Fast Refresh
 * rule `Scripts/check-lint-debt.sh` ratchets).
 */

/** The stored enums, in words. A raw `per_1_face` on screen is an internal
 *  value leaking into a document the owner reads. */
export const BASIS_LABEL = {
  per_share: "per share",
  per_1_face: "per $1 of face",
  per_100_face: "per $100 of face",
  par: "at par",
};

export const SECTOR_LABEL = {
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

/**
 * ⚠️ A bond, CD, deposit or money-market fund HAS no equity sector — permanent
 * and expected, never a gap in our data.
 *
 * 🔴 Without this the panel told the owner a brokered CD was "not classified
 * yet", which reads as outstanding work on something that can never carry an
 * equity sector. It is the same not-applicable / not-covered split the Exposure
 * page makes, and `price_basis === 'par'` is the structural tell for the three
 * FDIC deposits whose `asset_class` is `unknown` — exactly as
 * `services/exposure.js` reads them.
 */
export function noEquitySector(instrument) {
  return ["bond", "cash", "mmf"].includes(instrument.asset_class)
    || instrument.price_basis === "par";
}

/**
 * Why a holding shows no sector. THREE answers, not two — and only the last is
 * work to do.
 */
export function sectorAbsence(instrument) {
  if (noEquitySector(instrument)) return "none — not an equity instrument";
  return instrument.sector_asked ? "asked; none reported" : "not classified yet";
}

/**
 * A bond's rating, as printed.
 *
 * ⚠️ FDIC-INSURED IS NOT A RATING AND NOT THE ABSENCE OF ONE. A brokered CD
 * carries no agency rating because it does not need one; rendering it as "none
 * printed" beside a genuinely unrated corporate bond would say this holding
 * carries credit risk it does not carry. Both agencies are shown when both are
 * present, because a split rating is a fact about the bond.
 */
export function ratingLabel(terms) {
  if (!terms) return null;
  const parts = [
    terms.moodys_rating && `Moody's ${terms.moodys_rating}`,
    terms.sp_rating && `S&P ${terms.sp_rating}`,
  ].filter(Boolean);
  if (parts.length) return parts.join(" · ");
  return terms.fdic_insured ? "FDIC-insured" : null;
}

/** `+12.34%` / `-4.97%` / `—`. A sign is always shown, so a gain and a loss are
 *  distinguishable without reading the colour. */
export function signedPct(n) {
  if (n === null || n === undefined) return "—";
  return `${n >= 0 ? "+" : ""}${(n * 100).toFixed(2)}%`;
}

/** A per-SHARE distribution. Up to four decimals because a monthly bond-ETF
 *  distribution is sub-cent (FLDR pays $0.163), with trailing zeros trimmed so a
 *  quarterly $6.74 does not read as $6.7400. */
export function perShare(n) {
  return `$${Number(Number(n).toFixed(4))}/sh`;
}

/** A rate as a percentage, or a dash. Two decimals: a yield quoted to four
 *  implies a precision the trailing-twelve-month measurement does not have. */
export function ratePct(n) {
  return n === null || n === undefined ? "—" : `${(n * 100).toFixed(2)}%`;
}

/**
 * The yield row, and it says something DIFFERENT on each side of the portfolio —
 * which is why the owner asked for both.
 *
 * ⚠️ For a bond, coupon and current yield are not the same number. The coupon is
 * what it pays on its FACE and never moves; the current yield is that income
 * against what it costs TODAY, so it rises as the price falls. The IBM 4.75% of
 * 2031 is a 4.75% coupon and a 4.81% current yield at 98.60.
 *
 * ⚠️ And current yield is NOT yield to maturity — YTM adds the pull to par over
 * the remaining life. Calling this "yield" unqualified overstates a discount
 * bond, so the label carries the qualifier.
 *
 * ⚠️ For an equity it is a TRAILING TWELVE MONTH figure with capital-gains
 * distributions excluded, and "we never asked" is not "it pays nothing".
 */
export function yieldRows(y, terms) {
  if (!y) return [];
  if (y.kind === "coupon") {
    if (!y.covered) return [{ label: "Yield", value: y.reason, muted: true }];
    // The coupon's type and frequency belong ON the coupon row. Rendered
    // separately they became a SECOND "Coupon" line directly under this one,
    // reading as two different rates on the same bond.
    const detail = [terms && terms.coupon_type, terms && terms.payment_frequency]
      .filter(Boolean).join(" · ");
    return [
      { label: "Coupon", value: `${y.coupon_rate}% of face${detail ? ` · ${detail}` : ""}` },
      {
        label: "Current yield",
        value: y.current_yield === null
          ? "no price"
          : `${ratePct(y.current_yield)} at ${y.price}`,
        muted: y.current_yield === null,
        note: "income against today's price — not yield to maturity",
      },
    ];
  }
  if (!y.covered) return [{ label: "Yield", value: y.reason, muted: true }];
  if (y.pays_nothing) {
    // ⚠️ A measured zero. We asked, and this security pays no distribution —
    // which is a fact about it, not a hole in our data.
    return [{ label: "Dividend yield", value: "none — pays no distribution" }];
  }
  const rows = [{
    label: "Dividend yield",
    value: `${ratePct(y.dividend_yield)} · ${perShare(y.ttm_income)} over 12 months`,
    note: y.partial_year ? "less than a full year of history — this understates" : null,
  }];
  if (y.ttm_excluded > 0) {
    rows.push({
      label: "Also distributed",
      value: `${perShare(y.ttm_excluded)} of ${y.ttm_excluded_types.join("/")}`,
      note: "capital gains — real money, but not an income rate",
      muted: true,
    });
  }
  return rows;
}

/**
 * The dollars of face behind a bond position.
 *
 * ⚠️ A bond's `quantity` is units of PAR, not dollars: 1,000 units of a bond
 * priced `per $100 of face` is **$100,000** of face, and the coupon is paid on
 * that. Printed beside a coupon rate, the bare quantity invites an income figure
 * that is wrong by 100x. Verified against the custodian's own printed EAI:
 * 100,000 x 4.75% = $4,750, exactly what the statement shows.
 *
 * Null for anything not priced against par — a share count is already in the
 * unit the reader expects.
 */
const PAR_PER_UNIT = { per_100_face: 100, per_1_face: 1 };

export function faceValue(position, security) {
  const par = PAR_PER_UNIT[security && security.price_basis];
  if (!par || position.quantity === null || position.quantity === undefined) return null;
  return Number(position.quantity) * par;
}
