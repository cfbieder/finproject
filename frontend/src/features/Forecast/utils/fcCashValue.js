/**
 * fcCashValue.js — the P&L value of a Forecast Review row for ONE year, including the
 * two pre-forecast columns.
 *
 * The Review table spans three different bases:
 *
 *   LastActualYear (PeriodStart − 2) → the ledger's cash-flow report
 *   BaseYear       (PeriodStart − 1) → budget_entries
 *   PeriodStart …                    → the forecast engine's entries
 *
 * `FCReview.getCellValue` only knows the third one — it returns null for cash rows in the
 * first two years and leaves the overlay to whoever is displaying them. That was fine while
 * the table was the only consumer, but the graph's stacked breakdown reads the same rows
 * and got zeros, so Income/Expense bar charts started at PeriodStart with two empty columns
 * in front of them. This is that overlay, lifted out of FCReviewTable so the table and the
 * breakdown builder resolve a cell exactly the same way.
 *
 * Pure: every input is already computed by the page.
 */

/**
 * @param {Object} row - { label, level } or a synthetic { isNet } / { isCashFlow } row
 * @param {number|string} year
 * @param {Object} ctx
 * @param {Function} ctx.getCellValue - (row, year, isCashSection) => number|null
 * @param {Set} ctx.baseYears - the budget year (PeriodStart − 1)
 * @param {Set} ctx.lastActualYears - the actuals year (PeriodStart − 2)
 * @param {Map} ctx.baseActualTotalsByYear - year → { level1, level2, leafTotals, net }
 * @param {Map} ctx.categoryToLineMap - COA leaf category → FC line (level 2)
 * @param {Object} ctx.baseYearBudget - FC line → budgeted amount
 * @param {Map} ctx.cashAccountMap - account → { level1, level2 }
 * @returns {number|null}
 */
export function resolveCashValue(row, year, ctx = {}) {
  const {
    getCellValue,
    baseYears,
    lastActualYears,
    baseActualTotalsByYear,
    categoryToLineMap,
    baseYearBudget,
    cashAccountMap,
  } = ctx;

  let value = getCellValue ? getCellValue(row, year, true) : null;
  const isBaseYear = baseYears?.has(Number(year));
  const isLastActualYear = lastActualYears?.has(Number(year));

  // LastActualYear P&L from actuals
  if (isLastActualYear && value == null && baseActualTotalsByYear?.size > 0) {
    const yearData = baseActualTotalsByYear.get(Number(year));
    if (yearData) {
      if (row.isNet || row.isCashFlow) {
        value = yearData.net ?? null;
      } else if (row.level === 1) {
        value = yearData.level1.get(row.label) ?? null;
      } else if (row.level === 2 && yearData.leafTotals && categoryToLineMap?.size > 0) {
        let total = 0; let found = false;
        for (const [catName, amt] of yearData.leafTotals.entries()) {
          if (categoryToLineMap.get(catName) === row.label) { total += amt; found = true; }
        }
        if (found) value = total;
      } else if (row.level === 2) {
        value = yearData.level2.get(row.label) ?? null;
      }
    }
  }

  // BaseYear P&L from budget
  const isBaseForBudget =
    isBaseYear && value == null && baseYearBudget && Object.keys(baseYearBudget).length > 0;
  if (isBaseForBudget) {
    if (row.isCashFlow) {
      let total = 0;
      for (const amt of Object.values(baseYearBudget)) total += amt;
      if (total !== 0) value = total;
    } else if (row.isNet) {
      let plTotal = 0;
      for (const amt of Object.values(baseYearBudget)) plTotal += amt;
      const transfers = getCellValue
        ? getCellValue({ label: "Transfers", level: 2 }, year, true) || 0
        : 0;
      const netTotal = plTotal + transfers;
      if (netTotal !== 0) value = netTotal;
    } else if (row.level === 2 && baseYearBudget[row.label] != null) {
      value = baseYearBudget[row.label];
    } else if (row.level === 1 && cashAccountMap?.size > 0) {
      let total = 0; let found = false;
      for (const [ln, mp] of cashAccountMap.entries()) {
        if (mp.level1 === row.label && baseYearBudget[ln] != null) {
          total += baseYearBudget[ln]; found = true;
        }
      }
      if (found) value = total;
    }
  }

  return value;
}
