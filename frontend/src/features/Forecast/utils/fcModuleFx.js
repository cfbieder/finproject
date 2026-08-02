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

/**
 * CR064 P7 — how much of an FC line's budget is left, in the module's own currency.
 *
 * The hint this replaces added up three different currencies and called the answer
 * "Remaining". `fcBudgetTotals` is `SUM(budget_entries.base_amount)` — always USD —
 * while `expense_amount` / `income_amount` are in each MODULE's currency (the engine
 * divides them by the FX series to reach USD). On a PLN module it therefore compared a
 * USD budget against a PLN input and reconciled to zero when the two matched as digits.
 *
 * That is not hypothetical: United Beverages' dividend budget is 690,000 PLN =
 * 192,266 USD, and the module holds **192,266** — the USD figure typed into a PLN
 * field, with the hint reporting "Remaining: -0" as though it balanced.
 *
 * Everything is summed in USD, the one unit every input can be converted to, and
 * returned in the module's currency. A row whose currency has no rate is EXCLUDED and
 * counted, never added in as though it were USD — that is the same bug one level down.
 *
 * @param {Object} params
 * @param {number} params.budgetUSD       the line's budget, USD
 * @param {string} params.moduleCurrency  the currency of the amount being edited
 * @param {Array<{amount:number, currency:string}>} params.others  the other modules on the line
 * @param {number} params.thisAmount      this module's amount, in `moduleCurrency`
 * @param {(ccy:string)=>number|null} params.rateFor  native units per USD, or null
 * @returns {{budget:number|null, others:number|null, remaining:number|null,
 *            budgetUSD:number, unconvertible:number, canConvert:boolean}}
 *          Amounts are in `moduleCurrency`; null when it cannot be converted.
 */
export function allocateBudget({ budgetUSD, moduleCurrency, others = [], thisAmount = 0, rateFor }) {
  const moduleFx = rateFor(moduleCurrency);
  let unconvertible = 0;

  const othersUSD = others.reduce((sum, row) => {
    const raw = Math.abs(Number(row?.amount) || 0);
    if (raw === 0) return sum;
    const rate = rateFor(row?.currency || "USD");
    if (!rate) { unconvertible += 1; return sum; }
    return sum + raw / rate;
  }, 0);

  const thisUSD = moduleFx ? Math.abs(Number(thisAmount) || 0) / moduleFx : 0;
  const remainingUSD = budgetUSD - othersUSD - thisUSD;
  const show = (usd) => (moduleFx === null || moduleFx === undefined ? null : usd * moduleFx);

  return {
    budget: show(budgetUSD),
    others: show(othersUSD),
    remaining: show(remainingUSD),
    budgetUSD,
    unconvertible,
    canConvert: moduleFx !== null && moduleFx !== undefined,
  };
}
