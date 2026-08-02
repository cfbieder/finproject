/**
 * fcModuleFx.js — local currency → USD for a forecast module (CR064 P0).
 *
 * Extracted from FCModulesEdit because the failure it fixes was silent and reached
 * the engine. The editor read the FX assumptions under keys that do not exist in the
 * live document (`Rates.USDPLN` / `Rates.USDEUR` instead of `Rates.PLN` / `Rates.EUR`),
 * found nothing, and fell back to a rate of 1 — then multiplied by it, when the
 * engine's rate is native units *per USD* and divides. A €390,000 property entered
 * unmatched posted $390,000 to the balance sheet, and `fcbuilder-module.js` derived
 * the module's own FX from the ratio it stored, so the implied rate was 1.0 too.
 *
 * The engine (`fcbuilder-setup.js`) and FCExpSetup both already read `PLN ?? USDPLN`.
 * This module is the third reader, and now agrees with them.
 */

/**
 * The rate for `currency` on one FX assumption row, in native units per USD
 * (PLN 3.9, EUR 0.86), or null when the row does not carry a usable one.
 *
 * Zero is reported as absent: it would divide to Infinity here, exactly as it fails
 * loud in the engine (CR051 F1). "Missing" and "zero" are the same thing to a caller
 * that has to convert.
 *
 * @param {{Rates?: Object}} row  one entry of the `FX` assumptions document
 * @param {string} currency       "PLN" | "EUR" (anything else has no rate)
 * @returns {number|null}
 */
export function fxRateOnRow(row, currency) {
  const rates = row?.Rates;
  if (!rates) return null;
  const raw =
    currency === "PLN"
      ? rates.PLN ?? rates.USDPLN
      : currency === "EUR"
      ? rates.EUR ?? rates.USDEUR
      : null;
  const num = Number(raw);
  return Number.isFinite(num) && num !== 0 ? num : null;
}

/**
 * Native units per USD for `currency` in `year`, taking the latest scenario row at or
 * before that year. USD is always 1. Returns null when the scenario defines no usable
 * rate — which the caller must treat as "cannot convert", never as 1.
 *
 * @param {Object}  params
 * @param {Array}   params.fxRows    the `FX` assumptions document
 * @param {string}  params.scenario  scenario name the rows are keyed by
 * @param {string}  params.currency  module currency
 * @param {number|string} params.year
 * @returns {number|null}
 */
export function resolveFxRate({ fxRows, scenario, currency, year }) {
  if (!currency || currency === "USD") return 1;
  const relevant = (Array.isArray(fxRows) ? fxRows : [])
    .filter((row) => row?.Scenario === scenario)
    .sort((a, b) => Number(a?.Year) - Number(b?.Year));

  let rate = null;
  for (const row of relevant) {
    if (Number(row?.Year) <= Number(year)) {
      const candidate = fxRateOnRow(row, currency);
      if (candidate !== null) rate = candidate;
    }
  }
  // No row at or before `year` (a base year earlier than every assumption row):
  // fall back to the earliest rate the scenario does define, rather than none.
  if (rate === null) {
    for (const row of relevant) {
      const candidate = fxRateOnRow(row, currency);
      if (candidate !== null) return candidate;
    }
  }
  return rate;
}

/**
 * Convert a module's local-currency amount to USD.
 *
 * Two rates, two directions, and getting them the same way round is the whole point
 * of this function — the code it replaces multiplied by both:
 *   - `accountValueRatio` is USD **per unit**, read off the balance sheet for a
 *     matched module, so it multiplies.
 *   - `fxRate` is native units **per USD**, the engine's convention, so it divides.
 *
 * @returns {""|number|undefined}
 *   `""` when there is no amount to convert; a number when it converts;
 *   `undefined` when there is an amount but no rate for it — the caller must then
 *   leave any stored USD value untouched rather than invent one.
 */
export function localToUsd({ localNumber, isMatched, accountValueRatio, fxRate }) {
  if (localNumber === null || localNumber === undefined || localNumber === "") return "";
  if (isMatched && accountValueRatio !== null && accountValueRatio !== undefined) {
    return localNumber * accountValueRatio;
  }
  if (fxRate === null || fxRate === undefined) return undefined;
  return localNumber / fxRate;
}
