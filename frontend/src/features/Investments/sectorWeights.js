/**
 * sectorWeights.js — CR093 P1. The sector vocabulary and the 100% rule.
 *
 * Its own module because `SectorPicker.jsx` must export components only (Fast
 * Refresh; `Scripts/check-lint-debt.sh` ratchets it) — and because the rule is
 * worth testing without rendering a dialog.
 *
 * ⚠️ These eleven must match the API's list and migration 077's CHECK exactly.
 * Drift would offer the owner a sector the database refuses, and the save would
 * fail at the constraint with nothing useful to say.
 */

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
export const SECTORS = Object.keys(SECTOR_LABEL);

/** Rounded to a tenth of a percent, which is the precision the inputs offer. */
export const sumPct = (rows) =>
  Math.round(rows.reduce((a, r) => a + (Number(r.pct) || 0), 0) * 10) / 10;

