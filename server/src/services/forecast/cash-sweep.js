/**
 * Cash Sweep — Iterative year-by-year transfer between cash and a designated module.
 *
 * The sweep is purely a transfer mechanism — no yield or tax calculations.
 * Interest on the module (including swept funds) is handled by the module builder.
 *
 * After normal forecast generation completes, this runs sequentially:
 *   1. Compute actual cash balance for the year
 *   2. If cash > high band → sweep excess into the primary (priority-1) module
 *   3. If cash < low band → withdraw: primary's swept balance, then primary's own
 *      balance, then cascade into each backup module (priority 2, 3, …) in order
 *   4. Move to next year
 *
 * Multi-module priority (CR017): the primary module (sweepModule) is the sole
 * deposit target and the first source drained on shortfall. backupModules is an
 * ordered list (priority 2 onward) drained, own-balance only, once the primary is
 * exhausted. Backups never receive deposits, so they carry no swept balance.
 */

/**
 * @param {Object} params
 * @param {number[]} params.years - Forecast period years
 * @param {number} params.cashSweepLow - Low band (withdraw when below)
 * @param {number} params.cashSweepHigh - High band (sweep when above)
 * @param {Object} params.cashDeltaByYear - { year: netCashDelta } from Bank Accounts entries
 * @param {number} params.startingCash - Actual ledger cash balance at LastActualYear
 * @param {Object|null} params.sweepModule - primary module { name, account_name }
 * @param {Object} params.moduleBalanceByYear - { year: absoluteMarketValue } for the primary module
 * @param {Array} [params.backupModules] - ordered lower-priority modules
 *        [{ name, account_name, balanceByYear: { year: mv } }] drained after the primary
 * @returns {{ entries: Array, sweepLog: Array }}
 */
function computeCashSweepIterative({
  years, cashSweepLow, cashSweepHigh, cashDeltaByYear, startingCash,
  sweepModule, moduleBalanceByYear,
  backupModules = [],
}) {
  const entries = [];
  const sweepLog = [];
  let runningCash = startingCash;
  let netSweptBalance = 0; // Funds deposited via sweep (tracked separately from module's own balance)
  let cumulativeModuleWithdrawal = 0; // Running total withdrawn from module's own balance (absolute)
  // Per-backup state: cumulative own-balance withdrawal + per-year net effect (for carry-forward)
  const backupState = backupModules.map(() => ({ cumulativeWithdrawal: 0, netByYear: {} }));

  for (const year of years) {
    // Step 1: Apply this year's natural cash delta
    runningCash += (cashDeltaByYear[year] || 0);

    // Step 2: Check cash against band and sweep
    const cashBeforeSweep = runningCash;
    let sweepAmount = 0;
    let action = 'none';
    let shortfall = 0;
    const yearModules = new Set(); // source/destination module names touched this year (for audit)

    if (runningCash > cashSweepHigh && sweepModule) {
      // EXCESS: sweep into the primary module only (deposit policy = priority-1)
      sweepAmount = runningCash - cashSweepHigh;
      entries.push(
        { year, account: 'Transfer - Bank', amount: -sweepAmount, module: '_cash_sweep', comment: `Cash sweep to ${sweepModule.name}` },
        { year, account: sweepModule.account_name, amount: sweepAmount, module: '_cash_sweep', comment: `Cash sweep from bank` }
      );
      runningCash -= sweepAmount;
      netSweptBalance += sweepAmount;
      yearModules.add(sweepModule.name);
      action = 'sweep_in';

    } else if (runningCash < cashSweepLow && sweepModule) {
      // SHORTFALL: drain primary (swept balance, then own balance), then cascade into backups
      const needed = cashSweepLow - runningCash;

      // First: draw from swept balance
      const fromSwept = Math.min(needed, Math.max(0, netSweptBalance));
      // Second: draw from primary module's own balance (emergency withdrawal)
      const stillNeeded = needed - fromSwept;
      const moduleOwnBalance = Math.max(0, (moduleBalanceByYear[year] || 0) - cumulativeModuleWithdrawal);
      const fromModule = Math.min(stillNeeded, moduleOwnBalance);
      const primaryWithdraw = fromSwept + fromModule;
      let remainingShortfall = needed - primaryWithdraw;
      let totalWithdraw = primaryWithdraw;

      if (primaryWithdraw > 0.01) {
        entries.push(
          { year, account: 'Transfer - Bank', amount: primaryWithdraw, module: '_cash_sweep', comment: `Cash sweep from ${sweepModule.name}` },
          { year, account: sweepModule.account_name, amount: -primaryWithdraw, module: '_cash_sweep', comment: `Cash sweep to bank` }
        );
        if (fromModule > 0.01) {
          cumulativeModuleWithdrawal += fromModule;
        }
        runningCash += primaryWithdraw;
        netSweptBalance -= fromSwept;
        yearModules.add(sweepModule.name);
        action = 'sweep_out';
      }

      // Cascade into backup modules in priority order until the band is restored or all are drained
      for (let i = 0; i < backupModules.length && remainingShortfall > 0.01; i++) {
        const bm = backupModules[i];
        const st = backupState[i];
        const available = Math.max(0, (bm.balanceByYear?.[year] || 0) - st.cumulativeWithdrawal);
        const draw = Math.min(remainingShortfall, available);
        if (draw > 0.01) {
          entries.push(
            { year, account: 'Transfer - Bank', amount: draw, module: '_cash_sweep', comment: `Cash sweep from ${bm.name}` },
            { year, account: bm.account_name, amount: -draw, module: '_cash_sweep', comment: `Cash sweep to bank` }
          );
          st.cumulativeWithdrawal += draw;
          runningCash += draw;
          remainingShortfall -= draw;
          totalWithdraw += draw;
          yearModules.add(bm.name);
          if (action === 'none') action = 'sweep_out';
        }
      }

      if (totalWithdraw > 0.01) {
        sweepAmount = -totalWithdraw;
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

    // Record each backup's cumulative net effect for this year (for prior-years carry-forward)
    for (let i = 0; i < backupState.length; i++) {
      backupState[i].netByYear[year] = -backupState[i].cumulativeWithdrawal;
    }

    sweepLog.push({
      year, action, amount: sweepAmount, shortfall,
      yieldIncome: 0,
      cashBefore: cashBeforeSweep, cashAfter: runningCash,
      sweepBalance: netSweptBalance,
      moduleWithdrawal: cumulativeModuleWithdrawal,
      modules: Array.from(yearModules).join(' | '),
    });
  }

  // Prior-years carry-forward: each year needs the cumulative sweep effect from ALL prior years
  // so the review table shows the correct adjusted MV (module builder MV + prior carry-forward + this year's transfer)
  if (sweepModule) {
    let prevNetAdjustment = 0;
    for (const logEntry of sweepLog) {
      if (Math.abs(prevNetAdjustment) > 0.01) {
        entries.push({
          year: logEntry.year,
          account: sweepModule.account_name,
          amount: prevNetAdjustment,
          module: '_sweep_bal',
          comment: 'Sweep balance (prior years)',
        });
      }
      prevNetAdjustment = logEntry.sweepBalance - logEntry.moduleWithdrawal;
    }
  }

  // Backup modules: same prior-years carry-forward, but withdrawal-only (no swept balance)
  for (let i = 0; i < backupModules.length; i++) {
    const bm = backupModules[i];
    const st = backupState[i];
    let prevNet = 0;
    for (const year of years) {
      if (Math.abs(prevNet) > 0.01) {
        entries.push({
          year,
          account: bm.account_name,
          amount: prevNet,
          module: '_sweep_bal',
          comment: 'Sweep balance (prior years)',
        });
      }
      prevNet = st.netByYear[year] ?? prevNet;
    }
  }

  return { entries, sweepLog };
}

module.exports = { computeCashSweepIterative };
