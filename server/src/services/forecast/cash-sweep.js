/**
 * Cash Sweep — Iterative year-by-year transfer between cash and a designated module.
 *
 * After normal forecast generation completes, this runs sequentially:
 *   1. Grow the balances the sweep itself is carrying (CR045 P2b, below)
 *   2. Pay any capital-gains tax deferred from last year's liquidation (CR045 P2a)
 *   3. Apply this year's natural cash delta
 *   4. If cash > high band → sweep excess into the primary (priority-1) module
 *   5. If cash < low band → withdraw: primary's swept balance, then primary's own
 *      balance, then cascade into each backup module (priority 2, 3, …) in order
 *   6. Move to next year
 *
 * Multi-module priority (CR017): the primary module (sweepModule) is the sole
 * deposit target and the first source drained on shortfall. backupModules is an
 * ordered list (priority 2 onward) drained, own-balance only, once the primary is
 * exhausted. Backups never receive deposits, so they carry no swept balance.
 *
 * Only *ranked* modules are ever touched. That is the liquidation opt-in: an asset
 * you cannot sell at will (a business, a house) is simply left unranked, and an
 * unfundable shortfall is reported to the user instead of being silently covered
 * by selling it (CR045 §5).
 *
 * ── CR045 Phase 2 — the sweep is no longer a bare transfer ──────────────────
 *
 * P2a — capital-gains tax. Draining a module's *own* balance is a sale. It now
 * realizes a gain against the module's proportional cost basis and pays tax on it,
 * mirroring a scheduled disposal in fcbuilder-module (same proportional-basis
 * formula, same +1y deferral, same per-module rate override). Previously a forced
 * liquidation was tax-free while a scheduled sale of the same shares was taxed, so
 * the cash need was understated by the tax on every forced sale.
 *
 * The +1y deferral is what keeps this a single forward pass: year Y's tax is paid
 * in Y+1, which the loop already knows by the time it gets there. No fixed point.
 * (Final-year tax has no next year to land in, so — as in the builder — it stays in
 * the final year, applied after that year's band check.)
 *
 * P2b — swept balances grow. Withdrawals used to be carried forward *flat* while
 * the module builder went on compounding the full pre-sweep balance: money sold in
 * 2050 kept appreciating inside the module forever, offset only by the original
 * amount. Both the swept-in balance and the cumulative withdrawal are now carried
 * at the module's own effective growth rate, so the withdrawal exactly cancels the
 * growth the builder applies to the sold funds. When growth is 0 (a deposit account
 * — the classic primary) the compounding is the identity and nothing changes.
 *
 * Yield is still not computed here: interest on the module, including on swept
 * funds, is the module builder's job (index.js's income-sweep convergence loop
 * recomputes it against the sweep-adjusted balance).
 */

/** Amounts below this are noise, not money. */
const EPSILON = 0.01;

/**
 * @param {Object} params
 * @param {number[]} params.years - Forecast period years
 * @param {number} params.cashSweepLow - Low band (withdraw when below)
 * @param {number} params.cashSweepHigh - High band (sweep when above)
 * @param {Object} params.cashDeltaByYear - { year: netCashDelta } from Bank Accounts entries
 * @param {number} params.startingCash - Opening cash: the LastActualYear ledger balance
 *        plus the BaseYear's net cash flow (the BaseYear is not a swept year — CR045 P1b)
 * @param {Object|null} params.sweepModule - primary module { name, account_name }
 * @param {Object} params.moduleBalanceByYear - { year: absoluteMarketValue } for the primary
 * @param {Object} [params.moduleBasisByYear] - { year: costBasis } for the primary (CR045 P2a)
 * @param {Object} [params.moduleGrowthByYear] - { year: effectiveGrowthPct } for the primary (P2b)
 * @param {number} [params.moduleTaxRate] - primary's capital-gains rate, in percent
 * @param {Array} [params.backupModules] - ordered lower-priority modules
 *        [{ name, account_name, balanceByYear, basisByYear, growthByYear, taxRate }]
 * @returns {{ entries: Array, sweepLog: Array }}
 */
function computeCashSweepIterative({
  years, cashSweepLow, cashSweepHigh, cashDeltaByYear, startingCash,
  sweepModule, moduleBalanceByYear,
  moduleBasisByYear = {}, moduleGrowthByYear = {}, moduleTaxRate = 0,
  moduleReservedByYear = {},
  backupModules = [],
}) {
  const entries = [];
  const sweepLog = [];
  let runningCash = startingCash;

  const lastYear = years.length ? Number(years[years.length - 1]) : null;

  /**
   * One drainable source. `withdrawn` and `swept` are balances the sweep carries
   * itself, so they compound at the module's growth rate alongside the builder's
   * own market value; `basisSold` is the cost basis consumed by past sales.
   */
  const makeSource = (mod, balanceByYear, basisByYear, growthByYear, taxRate) => {
    const balances = balanceByYear || {};
    const growth = growthByYear || {};

    // G[year]: the module's cumulative growth factor, so a dollar withdrawn at Y is
    // worth G[t]/G[Y] at t — exactly the growth the builder goes on applying to it.
    const growthFactorByYear = {};
    let factor = 1;
    for (const rawYear of years) {
      factor *= 1 + (Number(growth[Number(rawYear)]) || 0) / 100;
      growthFactorByYear[Number(rawYear)] = factor;
    }

    // floorNorm[Y] = min over t ≥ Y of mv[t]/G[t] — the tightest solvency constraint
    // any future year imposes on a withdrawal made today. Built by a backward pass.
    const floorNormByYear = {};
    let runningMin = Infinity;
    for (let i = years.length - 1; i >= 0; i--) {
      const year = Number(years[i]);
      const normalized = (Number(balances[year]) || 0) / (growthFactorByYear[year] || 1);
      runningMin = Math.min(runningMin, normalized);
      floorNormByYear[year] = runningMin;
    }

    // The same backward pass for COST BASIS (CR048 A2). The builder's scheduled
    // disposals compute their gains against a basis that cannot see what the sweep
    // sold, so basis claimed by the sweep must never be basis a future scheduled sale
    // will claim again — otherwise the same basis offsets two sales and the tax is
    // understated. The sweep therefore gets only the basis that survives every future
    // year: basisFloor[Y] = min over t ≥ Y of basis[t]. Where they overlap, the
    // scheduled sale keeps its assumed basis (it was computed first, in the builder)
    // and the sweep's forced sale carries the higher gain — conservative by design.
    // Basis does not compound, so no growth normalization here.
    const basisSeries = basisByYear || {};
    const basisFloorByYear = {};
    let basisMin = Infinity;
    for (let i = years.length - 1; i >= 0; i--) {
      const year = Number(years[i]);
      const b = Number(basisSeries[year]);
      basisMin = Math.min(basisMin, Number.isFinite(b) ? b : 0);
      basisFloorByYear[year] = basisMin;
    }

    return {
      name: mod.name,
      account: mod.account_name,
      balanceByYear: balances,
      basisByYear: basisByYear || {},
      basisFloorByYear,
      growthFactorByYear,
      floorNormByYear,
      taxRate: Number(taxRate) || 0,
      sweptNorm: 0,    // funds the sweep parked here (primary only), growth-normalized
      usedNorm: 0,     // the module's OWN balance the sweep has sold, growth-normalized
      basisSold: 0,
      carryInByYear: {}, // net balance carried INTO each year (post-growth, pre-transfer)
    };
  };

  const primary = sweepModule
    ? makeSource(sweepModule, moduleBalanceByYear, moduleBasisByYear, moduleGrowthByYear, moduleTaxRate)
    : null;
  const backups = backupModules.map((bm) =>
    makeSource(bm, bm.balanceByYear, bm.basisByYear, bm.growthByYear, bm.taxRate)
  );
  const sources = primary ? [primary, ...backups] : backups;

  /**
   * Solvency capacity (CR045 P2c) — the sweep may never drive a module below zero
   * in ANY future year.
   *
   * A module can be both a sweep source and the subject of its own scheduled
   * disposals: prod's Fidelity Stocks is a sweep backup that *also* sells $50K/yr
   * from 2049 and $500K in 2052. The builder caps those disposals against the
   * module's PRE-sweep market value — it cannot see what the sweep already took — so
   * the same shares were sold twice and the module ended ~$950K in the hole.
   *
   * Owner's rule: the scheduled disposals are a deliberate plan and they win; the
   * sweep is the backstop and only gets what is left. The builder's market value
   * already has those disposals baked into it, so that rule needs no reserve
   * bookkeeping at all — it is exactly "never push the balance below zero, ever".
   *
   * Growth makes the arithmetic tidy. Normalize every balance by the module's
   * cumulative growth factor G: a withdrawal X at year Y permanently consumes
   * X/G[Y] of capacity, because it (and the growth it would have earned) is gone for
   * good. In normalized terms the module stays solvent iff
   *
   *     usedNorm  ≤  min over all t ≥ Y of  mv[t] / G[t]
   *
   * so this year's capacity is that running minimum, less what past withdrawals
   * already consumed, re-inflated to today. Money far in the future is funded by a
   * balance that has grown to meet it — the naive "reserve the nominal sum of future
   * sales" rule would freeze the whole module for decades over a distant commitment.
   *
   * A 'Full' disposal drives mv to 0, so the running minimum is 0 and the module
   * simply cannot be swept before that sale — which is correct: a sale of "whatever
   * is there" is a claim on the entire balance.
   */
  const availableFrom = (src, year) => {
    const capacityNorm = (src.floorNormByYear[year] ?? 0) - src.usedNorm;
    return Math.max(0, capacityNorm * (src.growthFactorByYear[year] ?? 1));
  };

  /** The module's own balance the sweep has permanently removed, valued at `year`. */
  const withdrawnAt = (src, year) => src.usedNorm * (src.growthFactorByYear[year] ?? 1);

  /** Swept-in funds still parked in the module, valued at `year`. */
  const sweptAt = (src, year) => src.sweptNorm * (src.growthFactorByYear[year] ?? 1);

  /** Tax owed next year, per source: { [sourceIndex]: amount (negative) }. */
  let pendingTax = [];

  /**
   * Sell `amount` of a module's own balance: consume cost basis proportionally,
   * realize the gain, and return the (negative) tax to defer — the same
   * proportional-basis formula fcbuilder-module uses for a scheduled disposal.
   */
  const realize = (src, year, amount) => {
    if (amount <= EPSILON || !src.taxRate) return 0;
    const mv = Math.max(0, (src.balanceByYear[year] || 0) - withdrawnAt(src, year));
    // Only basis that no future scheduled sale will claim is available here (CR048 A2).
    const basis = Math.max(0, (src.basisFloorByYear[year] ?? 0) - src.basisSold);
    // No basis recorded (or none left) ⇒ the whole withdrawal is gain.
    const basisRatio = mv > EPSILON ? Math.min(1, basis / mv) : 0;
    const basisSold = amount * basisRatio;
    src.basisSold += basisSold;
    const gain = amount - basisSold;
    if (gain <= EPSILON) return 0;
    return -(src.taxRate / 100) * gain;
  };

  for (const rawYear of years) {
    const year = Number(rawYear);

    // Step 1: value the balances the sweep carries at this year's growth (P2b). Swept
    // funds appreciate with the module; withdrawn funds keep cancelling the growth the
    // builder still applies to money that is gone. Recorded BEFORE this year's
    // transfers — that is what the carry-forward entry for this year must be.
    for (const src of sources) {
      src.carryInByYear[year] = sweptAt(src, year) - withdrawnAt(src, year);
    }

    // Step 2: pay tax deferred from last year's liquidation (P2a).
    let taxPaid = 0;
    for (const { srcIndex, amount } of pendingTax) {
      const src = sources[srcIndex];
      entries.push({
        year, account: 'Taxes', amount, module: '_cash_sweep',
        comment: `Capital gains tax on ${src.name} liquidation`,
      });
      runningCash += amount; // amount is negative
      taxPaid += amount;
    }
    pendingTax = [];

    // Step 3: apply this year's natural cash delta
    runningCash += (cashDeltaByYear[year] || 0);

    // Step 4/5: check cash against the band and sweep
    const cashBeforeSweep = runningCash;
    let sweepAmount = 0;
    let action = 'none';
    let shortfall = 0;
    const yearModules = new Set(); // source/destination module names touched this year (for audit)
    const taxDue = []; // realized this year, paid next year

    if (runningCash > cashSweepHigh && primary) {
      // EXCESS: sweep into the primary module only (deposit policy = priority-1)
      sweepAmount = runningCash - cashSweepHigh;
      entries.push(
        { year, account: 'Transfer - Bank', amount: -sweepAmount, module: '_cash_sweep', comment: `Cash sweep to ${primary.name}` },
        { year, account: primary.account, amount: sweepAmount, module: '_cash_sweep', comment: `Cash sweep from bank` }
      );
      runningCash -= sweepAmount;
      primary.sweptNorm += sweepAmount / (primary.growthFactorByYear[year] ?? 1);
      yearModules.add(primary.name);
      action = 'sweep_in';

    } else if (runningCash < cashSweepLow && primary) {
      // SHORTFALL: drain primary (swept balance, then own balance), then cascade into backups
      const needed = cashSweepLow - runningCash;

      // First: draw from swept balance. This is the sweep's own cash coming back —
      // it was never bought at a cost basis, so it realizes no gain.
      const fromSwept = Math.min(needed, Math.max(0, sweptAt(primary, year)));
      // Second: draw from the primary's own balance — that is a sale (taxable), and
      // only of what it can lose without going under in some later year (P2c).
      const stillNeeded = needed - fromSwept;
      const fromModule = Math.min(stillNeeded, availableFrom(primary, year));
      const primaryWithdraw = fromSwept + fromModule;
      let remainingShortfall = needed - primaryWithdraw;
      let totalWithdraw = primaryWithdraw;

      if (primaryWithdraw > EPSILON) {
        entries.push(
          { year, account: 'Transfer - Bank', amount: primaryWithdraw, module: '_cash_sweep', comment: `Cash sweep from ${primary.name}` },
          { year, account: primary.account, amount: -primaryWithdraw, module: '_cash_sweep', comment: `Cash sweep to bank` }
        );
        if (fromModule > EPSILON) {
          const tax = realize(primary, year, fromModule);
          if (tax < -EPSILON) taxDue.push({ srcIndex: 0, amount: tax });
          primary.usedNorm += fromModule / (primary.growthFactorByYear[year] ?? 1);
        }
        runningCash += primaryWithdraw;
        primary.sweptNorm -= fromSwept / (primary.growthFactorByYear[year] ?? 1);
        yearModules.add(primary.name);
        action = 'sweep_out';
      }

      // Cascade into backup modules in priority order until the band is restored or all are drained
      for (let i = 0; i < backups.length && remainingShortfall > EPSILON; i++) {
        const bm = backups[i];
        const draw = Math.min(remainingShortfall, availableFrom(bm, year));
        if (draw > EPSILON) {
          entries.push(
            { year, account: 'Transfer - Bank', amount: draw, module: '_cash_sweep', comment: `Cash sweep from ${bm.name}` },
            { year, account: bm.account, amount: -draw, module: '_cash_sweep', comment: `Cash sweep to bank` }
          );
          const tax = realize(bm, year, draw);
          if (tax < -EPSILON) taxDue.push({ srcIndex: sources.indexOf(bm), amount: tax });
          bm.usedNorm += draw / (bm.growthFactorByYear[year] ?? 1);
          runningCash += draw;
          remainingShortfall -= draw;
          totalWithdraw += draw;
          yearModules.add(bm.name);
          if (action === 'none') action = 'sweep_out';
        }
      }

      if (totalWithdraw > EPSILON) {
        sweepAmount = -totalWithdraw;
      }

      if (remainingShortfall > EPSILON) {
        entries.push(
          { year, account: 'Cash Shortfall', amount: -remainingShortfall, module: '_cash_sweep', comment: 'Cash below target after sweep' }
        );
        shortfall = remainingShortfall;
        if (action === 'none') action = 'shortfall';
      }

    } else if (runningCash > cashSweepHigh && !primary) {
      sweepAmount = runningCash - cashSweepHigh;
      entries.push(
        { year, account: 'Transfer - Bank', amount: -sweepAmount, module: '_rebalance', comment: 'Cash target rebalance' },
        { year, account: 'Cash Rebalance - Deposits', amount: sweepAmount, module: '_rebalance', comment: 'Excess cash to deposits' }
      );
      runningCash -= sweepAmount;
      action = 'deposit';

    } else if (runningCash < cashSweepLow && !primary) {
      shortfall = cashSweepLow - runningCash;
      entries.push(
        { year, account: 'Cash Shortfall', amount: -shortfall, module: '_rebalance', comment: 'Cash below target' }
      );
      action = 'shortfall';
    }

    // Tax realized this year is paid next year. The final year has no next year,
    // so — as in the builder — it stays put, landing after this year's band check
    // (it can push the final year under the band; the Review's warnings pane says so).
    if (taxDue.length > 0) {
      if (year === lastYear) {
        for (const { srcIndex, amount } of taxDue) {
          entries.push({
            year, account: 'Taxes', amount, module: '_cash_sweep',
            comment: `Capital gains tax on ${sources[srcIndex].name} liquidation`,
          });
          runningCash += amount;
          taxPaid += amount;
        }
      } else {
        pendingTax = taxDue;
      }
    }

    sweepLog.push({
      year, action, amount: sweepAmount, shortfall,
      yieldIncome: 0,
      tax: taxPaid,
      cashBefore: cashBeforeSweep, cashAfter: runningCash,
      sweepBalance: primary ? sweptAt(primary, year) : 0,
      moduleWithdrawal: primary ? withdrawnAt(primary, year) : 0,
      modules: Array.from(yearModules).join(' | '),
    });
  }

  // Prior-years carry-forward: each year needs the cumulative sweep effect from ALL
  // prior years, so the review table shows the correct adjusted MV (module builder MV
  // + prior carry-forward + this year's transfer). These balances have already been
  // compounded at the module's growth rate above, so the carry-forward cancels the
  // growth the builder applied to funds that are no longer in the module (P2b).
  for (const src of sources) {
    for (const rawYear of years) {
      const year = Number(rawYear);
      const carryIn = src.carryInByYear[year] || 0;
      if (Math.abs(carryIn) > EPSILON) {
        entries.push({
          year,
          account: src.account,
          amount: carryIn,
          module: '_sweep_bal',
          comment: 'Sweep balance (prior years)',
        });
      }
    }
  }

  return { entries, sweepLog };
}

module.exports = { computeCashSweepIterative };
