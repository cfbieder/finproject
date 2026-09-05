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
