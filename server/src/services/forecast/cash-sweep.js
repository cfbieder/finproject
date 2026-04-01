/**
 * Cash Sweep — Iterative year-by-year transfer between cash and a designated module.
 *
 * The sweep is purely a transfer mechanism — no yield or tax calculations.
 * Interest on the module (including swept funds) is handled by the module builder.
 *
 * After normal forecast generation completes, this runs sequentially:
 *   1. Compute actual cash balance for the year
 *   2. If cash > high band → sweep excess into designated module
 *   3. If cash < low band → withdraw from module (swept balance first, then module's own balance)
 *   4. Move to next year
 */

/**
 * @param {Object} params
 * @param {number[]} params.years - Forecast period years
 * @param {number} params.cashSweepLow - Low band (withdraw when below)
 * @param {number} params.cashSweepHigh - High band (sweep when above)
 * @param {Object} params.cashDeltaByYear - { year: netCashDelta } from Bank Accounts entries
 * @param {number} params.startingCash - Actual ledger cash balance at LastActualYear
 * @param {Object|null} params.sweepModule - { name, account_name }
 * @param {Object} params.moduleBalanceByYear - { year: absoluteMarketValue } for the sweep module
 * @returns {{ entries: Array, sweepLog: Array }}
 */
function computeCashSweepIterative({
  years, cashSweepLow, cashSweepHigh, cashDeltaByYear, startingCash,
  sweepModule, moduleBalanceByYear,
}) {
  const entries = [];
  const sweepLog = [];
  let runningCash = startingCash;
  let netSweptBalance = 0; // Funds deposited via sweep (tracked separately from module's own balance)

  for (const year of years) {
    // Step 1: Apply this year's natural cash delta
    runningCash += (cashDeltaByYear[year] || 0);

    // Step 2: Check cash against band and sweep
    const cashBeforeSweep = runningCash;
    let sweepAmount = 0;
    let action = 'none';
    let shortfall = 0;

    if (runningCash > cashSweepHigh && sweepModule) {
      // EXCESS: sweep into module
      sweepAmount = runningCash - cashSweepHigh;
      entries.push(
        { year, account: 'Transfer - Bank', amount: -sweepAmount, module: '_cash_sweep', comment: `Cash sweep to ${sweepModule.name}` }
      );
      runningCash -= sweepAmount;
      netSweptBalance += sweepAmount;
      action = 'sweep_in';

    } else if (runningCash < cashSweepLow && sweepModule) {
      // SHORTFALL: withdraw from swept balance first, then module's own balance
      const needed = cashSweepLow - runningCash;

      // First: draw from swept balance
      const fromSwept = Math.min(needed, Math.max(0, netSweptBalance));
      // Second: draw from module's own balance (emergency withdrawal)
      const stillNeeded = needed - fromSwept;
      const moduleOwnBalance = (moduleBalanceByYear[year] || 0);
      const fromModule = Math.min(stillNeeded, Math.max(0, moduleOwnBalance));
      const totalWithdraw = fromSwept + fromModule;
      const remainingShortfall = needed - totalWithdraw;

      if (totalWithdraw > 0.01) {
        entries.push(
          { year, account: 'Transfer - Bank', amount: totalWithdraw, module: '_cash_sweep', comment: `Cash sweep from ${sweepModule.name}` }
        );
        // Negative BS entry to reduce module balance for the module-own portion
        if (fromModule > 0.01) {
          entries.push(
            { year, account: sweepModule.account_name, amount: -fromModule, module: '_cash_sweep', comment: 'Emergency withdrawal from module' }
          );
        }
        runningCash += totalWithdraw;
        netSweptBalance -= fromSwept;
        sweepAmount = -totalWithdraw;
        action = 'sweep_out';
      }

      if (remainingShortfall > 0.01) {
        entries.push(
          { year, account: 'Cash Shortfall', amount: -remainingShortfall, module: '_cash_sweep', comment: 'Cash below target after sweep' }
        );
        shortfall = remainingShortfall;
        if (action === 'none') action = 'shortfall';
      }

    } else if (runningCash > cashSweepHigh && !sweepModule) {
      sweepAmount = runningCash - cashSweepHigh;
      entries.push(
        { year, account: 'Transfer - Bank', amount: -sweepAmount, module: '_rebalance', comment: 'Cash target rebalance' },
        { year, account: 'Cash Rebalance - Deposits', amount: sweepAmount, module: '_rebalance', comment: 'Excess cash to deposits' }
      );
      runningCash -= sweepAmount;
      action = 'deposit';

    } else if (runningCash < cashSweepLow && !sweepModule) {
      shortfall = cashSweepLow - runningCash;
      entries.push(
        { year, account: 'Cash Shortfall', amount: -shortfall, module: '_rebalance', comment: 'Cash below target' }
      );
      action = 'shortfall';
    }

    sweepLog.push({
      year, action, amount: sweepAmount, shortfall,
      yieldIncome: 0,
      cashBefore: cashBeforeSweep, cashAfter: runningCash,
      sweepBalance: netSweptBalance,
    });
  }

  // BS entries: write absolute netSweptBalance for each year where non-zero
  // Uses sweepBalance from the log (tracks only swept funds, not emergency withdrawals)
  if (sweepModule) {
    for (const logEntry of sweepLog) {
      if (Math.abs(logEntry.sweepBalance) > 0.01) {
        entries.push({
          year: logEntry.year,
          account: sweepModule.account_name,
          amount: logEntry.sweepBalance,
          module: '_cash_sweep',
          comment: 'Sweep balance',
        });
      }
    }
  }

  return { entries, sweepLog };
}

module.exports = { computeCashSweepIterative };
