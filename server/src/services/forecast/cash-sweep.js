/**
 * Cash Sweep — Pure computation functions for two-pass cash sweep logic.
 *
 * Pass 1: Determine sweep amounts (excess → sweep module, shortfall → withdraw)
 * Pass 2: Calculate additional yield on swept funds
 */

const { CATEGORIES } = require("./constants");

/**
 * Computes cash sweep entries (Pass 1) and audit log.
 *
 * @param {Object} params
 * @param {number[]} params.years - Forecast period years
 * @param {number} params.targetCash - Cash target amount
 * @param {Object} params.cashByYear - { year: cumulativeCash } from Bank Accounts entries
 * @param {Object|null} params.sweepModule - { name, account_name, market_value_usd } or null
 * @param {Object} params.sweepModuleBalanceByYear - { year: cumulativeBalance } for sweep module
 * @returns {{ rebalanceValues: Array, sweepLog: Array, sweepCumulativeAdj: number }}
 */
function computeCashSweep({ years, targetCash, cashByYear, sweepModule, sweepModuleBalanceByYear }) {
  const sweepLog = [];
  const rebalanceValues = [];
  let sweepCumulativeAdj = 0;

  for (const year of years) {
    const projectedCash = (cashByYear[year] || 0) + sweepCumulativeAdj;
    const gap = projectedCash - targetCash;

    if (Math.abs(gap) < 0.01) {
      sweepLog.push({ year, action: 'none', amount: 0, cashBefore: projectedCash, cashAfter: projectedCash, sweepBalance: (sweepModuleBalanceByYear[year] || 0) + sweepCumulativeAdj });
      continue;
    }

    if (gap > 0 && sweepModule) {
      const sweepAmount = gap;
      rebalanceValues.push(
        { year, account: 'Transfer - Bank', amount: -sweepAmount, module: '_cash_sweep', comment: `Cash sweep to ${sweepModule.name}` },
        { year, account: sweepModule.account_name, amount: sweepAmount, module: '_cash_sweep', comment: 'Cash sweep deposit' }
      );
      sweepCumulativeAdj -= sweepAmount;
      sweepLog.push({
        year, action: 'sweep_in', amount: sweepAmount,
        cashBefore: projectedCash, cashAfter: projectedCash - sweepAmount,
        sweepBalance: (sweepModuleBalanceByYear[year] || 0) + sweepCumulativeAdj + sweepAmount,
      });
    } else if (gap < 0 && sweepModule) {
      const shortfall = Math.abs(gap);
      const availableBalance = Math.max(0, (sweepModuleBalanceByYear[year] || 0) + sweepCumulativeAdj);
      const withdrawAmount = Math.min(shortfall, availableBalance);
      const remainingShortfall = shortfall - withdrawAmount;

      if (withdrawAmount > 0.01) {
        rebalanceValues.push(
          { year, account: sweepModule.account_name, amount: -withdrawAmount, module: '_cash_sweep', comment: 'Cash sweep withdrawal' },
          { year, account: 'Transfer - Bank', amount: withdrawAmount, module: '_cash_sweep', comment: `Cash sweep from ${sweepModule.name}` }
        );
        sweepCumulativeAdj += withdrawAmount;
      }

      if (remainingShortfall > 0.01) {
        rebalanceValues.push(
          { year, account: 'Cash Shortfall', amount: -remainingShortfall, module: '_cash_sweep', comment: 'Cash below target after sweep' }
        );
      }

      sweepLog.push({
        year, action: withdrawAmount > 0.01 ? 'sweep_out' : 'shortfall',
        amount: -withdrawAmount, shortfall: remainingShortfall > 0.01 ? remainingShortfall : 0,
        cashBefore: projectedCash, cashAfter: projectedCash + withdrawAmount,
        sweepBalance: (sweepModuleBalanceByYear[year] || 0) + sweepCumulativeAdj,
      });
    } else if (gap > 0 && !sweepModule) {
      rebalanceValues.push(
        { year, account: 'Transfer - Bank', amount: -gap, module: '_rebalance', comment: 'Cash target rebalance' },
        { year, account: 'Cash Rebalance - Deposits', amount: gap, module: '_rebalance', comment: 'Excess cash to deposits' }
      );
      sweepCumulativeAdj -= gap;
      sweepLog.push({ year, action: 'deposit', amount: gap, cashBefore: projectedCash, cashAfter: projectedCash - gap, sweepBalance: 0 });
    } else {
      rebalanceValues.push(
        { year, account: 'Cash Shortfall', amount: gap, module: '_rebalance', comment: 'Cash below target' }
      );
      sweepLog.push({ year, action: 'shortfall', amount: 0, shortfall: Math.abs(gap), cashBefore: projectedCash, cashAfter: projectedCash, sweepBalance: 0 });
    }
  }

  return { rebalanceValues, sweepLog, sweepCumulativeAdj };
}

/**
 * Computes Pass 2 yield entries on swept funds.
 *
 * @param {Object} params
 * @param {number[]} params.years - Forecast period years
 * @param {Array} params.sweepLog - Sweep log from Pass 1
 * @param {Object} params.yieldByYear - { year: yieldPct }
 * @param {string|null} params.incomeCategory - FC Line name for income
 * @param {number} params.taxRate - Tax rate (e.g. 25 for 25%)
 * @param {Object} params.sweepModule - { name, account_name }
 * @returns {{ pass2Entries: Array, updatedSweepLog: Array }}
 */
function computeSweepYield({ years, sweepLog, yieldByYear, incomeCategory, taxRate, sweepModule }) {
  let cumulativeSweepBalance = 0;
  const pass2Entries = [];

  for (let i = 0; i < years.length; i++) {
    const year = years[i];

    // Income on accumulated sweep balance from prior years
    if (cumulativeSweepBalance !== 0 && yieldByYear[year] > 0 && incomeCategory) {
      const additionalIncome = cumulativeSweepBalance * (yieldByYear[year] / 100);
      if (Math.abs(additionalIncome) > 0.01) {
        pass2Entries.push(
          { year, account: incomeCategory, amount: additionalIncome, module: '_cash_sweep', comment: 'Yield on swept funds' }
        );

        if (taxRate > 0) {
          const tax = -additionalIncome * (taxRate / 100);
          const taxYear = (i + 1 < years.length) ? years[i + 1] : year;
          pass2Entries.push(
            { year: taxYear, account: CATEGORIES.TAXES, amount: tax, module: '_cash_sweep', comment: 'Tax on sweep yield' }
          );
        }

        const logEntry = sweepLog.find(l => l.year === year);
        if (logEntry) logEntry.yieldIncome = additionalIncome;
      }
    }

    // Update cumulative sweep balance
    const logEntry = sweepLog.find(l => l.year === year);
    if (logEntry) {
      if (logEntry.action === 'sweep_in') cumulativeSweepBalance += logEntry.amount;
      else if (logEntry.action === 'sweep_out') cumulativeSweepBalance += logEntry.amount; // negative
    }
  }

  return { pass2Entries, updatedSweepLog: sweepLog };
}

module.exports = { computeCashSweep, computeSweepYield };
