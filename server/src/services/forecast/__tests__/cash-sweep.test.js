/**
 * Cash Sweep Tests — Iterative transfers between cash and sweep module
 *
 * Tests:
 * 1. Excess cash swept into module (above high band)
 * 2. Shortfall withdrawn from swept balance, then module's own balance
 * 3. Cash within band — no action
 * 4. No sweep module — deposit/shortfall fallback
 * 5. Matching transfer pairs (bank + module sides)
 * 6. Prior-years carry-forward entries for correct MV adjustment
 */

const { computeCashSweepIterative } = require("../cash-sweep");

beforeEach(() => {
  jest.spyOn(console, "log").mockImplementation(() => {});
});

const sweepModule = {
  name: "Fixed Income",
  account_name: "Fixed Income Account",
};

describe("computeCashSweepIterative", () => {
  test("sweeps excess cash when above high band", () => {
    const { sweepLog } = computeCashSweepIterative({
      years: [2027],
      cashSweepLow: 50000, cashSweepHigh: 100000,
      cashDeltaByYear: { 2027: 100000 },
      startingCash: 200000,
      sweepModule, moduleBalanceByYear: {},
    });

    expect(sweepLog[0].action).toBe("sweep_in");
    expect(sweepLog[0].amount).toBe(200000);
    expect(sweepLog[0].cashAfter).toBe(100000);
  });

  test("withdraws from swept balance first, then module balance", () => {
    const { sweepLog } = computeCashSweepIterative({
      years: [2027, 2028],
      cashSweepLow: 100000, cashSweepHigh: 200000,
      cashDeltaByYear: { 2027: 100000, 2028: -400000 },
      startingCash: 200000,
      sweepModule, moduleBalanceByYear: { 2027: 500000, 2028: 520000 },
    });

    // 2027: 200k + 100k = 300k → sweep in 100k
    expect(sweepLog[0].action).toBe("sweep_in");
    expect(sweepLog[0].amount).toBe(100000);

    // 2028: 200k - 400k = -200k → need 300k to reach 100k low
    // Swept balance = 100k, module own = 520k → withdraw 100k + 200k = 300k
    expect(sweepLog[1].action).toBe("sweep_out");
    expect(sweepLog[1].cashAfter).toBe(100000);
  });

  test("emergency withdrawal from module when no swept balance", () => {
    const { entries, sweepLog } = computeCashSweepIterative({
      years: [2027],
      cashSweepLow: 100000, cashSweepHigh: 200000,
      cashDeltaByYear: { 2027: -200000 },
      startingCash: 150000, // 150k - 200k = -50k → need 150k
      sweepModule, moduleBalanceByYear: { 2027: 2000000 },
    });

    expect(sweepLog[0].action).toBe("sweep_out");
    expect(sweepLog[0].cashAfter).toBe(100000);

    // Module-side transfer entry should match the bank-side withdrawal
    const moduleTransfer = entries.find(e => e.account === "Fixed Income Account" && e.module === "_cash_sweep");
    expect(moduleTransfer).toBeDefined();
    expect(moduleTransfer.amount).toBe(-150000);
    expect(moduleTransfer.comment).toBe("Cash sweep to bank");
  });

  test("no action when cash within band", () => {
    const { sweepLog } = computeCashSweepIterative({
      years: [2027],
      cashSweepLow: 50000, cashSweepHigh: 200000,
      cashDeltaByYear: { 2027: -50000 },
      startingCash: 150000,
      sweepModule, moduleBalanceByYear: {},
    });

    expect(sweepLog[0].action).toBe("none");
  });

  test("no sweep module — excess goes to deposits", () => {
    const { entries } = computeCashSweepIterative({
      years: [2027],
      cashSweepLow: 50000, cashSweepHigh: 100000,
      cashDeltaByYear: { 2027: 100000 },
      startingCash: 100000,
      sweepModule: null, moduleBalanceByYear: {},
    });

    const deposit = entries.find(e => e.account === "Cash Rebalance - Deposits");
    expect(deposit.amount).toBe(100000);
  });

  test("no yield entries — sweep is transfers only", () => {
    const { entries } = computeCashSweepIterative({
      years: [2027, 2028],
      cashSweepLow: 50000, cashSweepHigh: 100000,
      cashDeltaByYear: { 2027: 200000, 2028: 0 },
      startingCash: 100000,
      sweepModule, moduleBalanceByYear: {},
    });

    const incomeEntries = entries.filter(e => e.account === "Interest Income" || e.account === "Taxes");
    expect(incomeEntries).toHaveLength(0);
  });

  test("creates matching transfer pairs for bank and module sides", () => {
    const { entries } = computeCashSweepIterative({
      years: [2027, 2028],
      cashSweepLow: 50000, cashSweepHigh: 100000,
      cashDeltaByYear: { 2027: 200000, 2028: -300000 },
      startingCash: 100000,
      sweepModule, moduleBalanceByYear: { 2028: 500000 },
    });

    // 2027: 100k + 200k = 300k → sweep in 200k
    const bankIn2027 = entries.find(e => e.year === 2027 && e.account === "Transfer - Bank" && e.module === "_cash_sweep");
    const moduleIn2027 = entries.find(e => e.year === 2027 && e.account === "Fixed Income Account" && e.module === "_cash_sweep");
    expect(bankIn2027.amount).toBe(-200000);
    expect(moduleIn2027.amount).toBe(200000);
    // Amounts are equal and opposite
    expect(bankIn2027.amount + moduleIn2027.amount).toBe(0);

    // 2028: 100k - 300k = -200k → need 250k to reach 50k low
    // fromSwept = 200k, fromModule = 50k → total withdraw 250k
    const bankOut2028 = entries.find(e => e.year === 2028 && e.account === "Transfer - Bank" && e.module === "_cash_sweep");
    const moduleOut2028 = entries.find(e => e.year === 2028 && e.account === "Fixed Income Account" && e.module === "_cash_sweep");
    expect(bankOut2028.amount).toBe(250000);
    expect(moduleOut2028.amount).toBe(-250000);
    expect(bankOut2028.amount + moduleOut2028.amount).toBe(0);
  });

  test("multi-module: drains primary fully before touching a backup (CR017)", () => {
    const backupModules = [
      { name: "Bond", account_name: "Bond Account", balanceByYear: { 2028: 300000 } },
    ];
    const { entries, sweepLog } = computeCashSweepIterative({
      years: [2027, 2028],
      cashSweepLow: 100000, cashSweepHigh: 200000,
      cashDeltaByYear: { 2027: 100000, 2028: -500000 },
      startingCash: 200000,
      sweepModule, moduleBalanceByYear: { 2027: 400000, 2028: 400000 },
      backupModules,
    });

    // 2027: 200k + 100k = 300k → sweep 100k into primary
    expect(sweepLog[0].action).toBe("sweep_in");
    expect(sweepLog[0].amount).toBe(100000);

    // 2028: 200k - 500k = -300k → need 400k to reach 100k low.
    // Primary: swept 100k + own 400k = 500k available → covers the full 400k.
    // Backup must NOT be touched (primary drained first, and it sufficed).
    const backupTransfer2028 = entries.find(
      (e) => e.year === 2028 && e.account === "Bond Account" && e.module === "_cash_sweep"
    );
    expect(backupTransfer2028).toBeUndefined();
    expect(sweepLog[1].cashAfter).toBe(100000);
  });

  test("multi-module: cascades into backup once primary is exhausted (CR017)", () => {
    const backupModules = [
      { name: "Bond", account_name: "Bond Account", balanceByYear: { 2027: 300000 } },
    ];
    const { entries, sweepLog } = computeCashSweepIterative({
      years: [2027],
      cashSweepLow: 100000, cashSweepHigh: 200000,
      cashDeltaByYear: { 2027: -250000 },
      startingCash: 150000, // 150k - 250k = -100k → need 200k to reach 100k
      sweepModule, moduleBalanceByYear: { 2027: 50000 }, // primary own balance only 50k
      backupModules,
    });

    // Primary supplies its 50k own balance, backup covers the remaining 150k.
    const primaryOut = entries.find(
      (e) => e.year === 2027 && e.account === "Fixed Income Account" && e.module === "_cash_sweep"
    );
    const backupOut = entries.find(
      (e) => e.year === 2027 && e.account === "Bond Account" && e.module === "_cash_sweep"
    );
    expect(primaryOut.amount).toBe(-50000);
    expect(backupOut.amount).toBe(-150000);
    expect(sweepLog[0].action).toBe("sweep_out");
    expect(sweepLog[0].cashAfter).toBe(100000);
    // No residual shortfall — band fully restored from primary + backup
    const shortfall = entries.find((e) => e.account === "Cash Shortfall");
    expect(shortfall).toBeUndefined();
    // Audit log records both modules touched this year
    expect(sweepLog[0].modules).toContain("Fixed Income");
    expect(sweepLog[0].modules).toContain("Bond");
  });

  test("prior-years carry-forward adjusts module MV correctly", () => {
    const { entries } = computeCashSweepIterative({
      years: [2027, 2028, 2029],
      cashSweepLow: 50000, cashSweepHigh: 100000,
      cashDeltaByYear: { 2027: 200000, 2028: 50000, 2029: -300000 },
      startingCash: 100000,
      sweepModule, moduleBalanceByYear: { 2029: 500000 },
    });

    // 2027: sweep in 200k → module-side transfer +200k, no carry-forward (first year)
    const carryFwd2027 = entries.filter(e => e.year === 2027 && e.module === "_sweep_bal");
    expect(carryFwd2027).toHaveLength(0);

    // 2028: sweep in 50k → module-side transfer +50k, carry-forward +200k (from 2027)
    const carryFwd2028 = entries.find(e => e.year === 2028 && e.module === "_sweep_bal");
    expect(carryFwd2028.amount).toBe(200000);

    // Total effect on module for 2028: +50k (this year) + 200k (carry-forward) = +250k ✓
    const moduleEntries2028 = entries.filter(e => e.year === 2028 && e.account === "Fixed Income Account");
    const totalEffect2028 = moduleEntries2028.reduce((sum, e) => sum + e.amount, 0);
    expect(totalEffect2028).toBe(250000);

    // 2029: withdraw 250k (all swept) → module-side transfer -250k, carry-forward +250k
    const carryFwd2029 = entries.find(e => e.year === 2029 && e.module === "_sweep_bal");
    expect(carryFwd2029.amount).toBe(250000);

    // Total effect on module for 2029: -250k + 250k = 0 (fully unwound)
    const moduleEntries2029 = entries.filter(e => e.year === 2029 && e.account === "Fixed Income Account");
    const totalEffect2029 = moduleEntries2029.reduce((sum, e) => sum + e.amount, 0);
    expect(totalEffect2029).toBe(0);
  });

  // ── CR045 Phase 2 ─────────────────────────────────────────────────────────
  // A forced liquidation is a sale: it realizes a gain and it removes the money
  // from the module for good. Neither used to be true.

  describe("capital-gains tax on forced liquidation (P2a)", () => {
    // A stock module: $1M market value against $600K of cost basis — 40% embedded gain.
    const stocks = { name: "Stocks", account_name: "Stock Account" };
    const stocksArgs = {
      years: [2027, 2028, 2029],
      cashSweepLow: 100000, cashSweepHigh: 200000,
      sweepModule: stocks,
      moduleBalanceByYear: { 2027: 1000000, 2028: 1000000, 2029: 1000000 },
      moduleBasisByYear: { 2027: 600000, 2028: 600000, 2029: 600000 },
      moduleTaxRate: 25,
    };

    test("realizes a proportional gain and defers the tax one year", () => {
      const { entries, sweepLog } = computeCashSweepIterative({
        ...stocksArgs,
        cashDeltaByYear: { 2027: -100000, 2028: 0, 2029: 0 },
        startingCash: 100000,
      });

      // 2027: cash 100k - 100k = 0, needs 100k → sold from the module's own balance.
      // Basis ratio 600k/1000k = 60%, so gain = 100k - 60k = 40k; tax = 25% of 40k = 10k.
      expect(sweepLog[0].action).toBe("sweep_out");
      expect(sweepLog[0].tax).toBe(0); // not this year — deferred

      const tax2028 = entries.filter((e) => e.year === 2028 && e.account === "Taxes");
      expect(tax2028).toHaveLength(1);
      expect(tax2028[0].amount).toBeCloseTo(-10000, 2);
      expect(tax2028[0].comment).toMatch(/Stocks/);

      // ...and it is paid in cash, not just booked: it comes straight off 2028's balance.
      expect(sweepLog[1].tax).toBeCloseTo(-10000, 2);
      expect(sweepLog[1].cashBefore).toBeCloseTo(100000 - 10000, 2);
    });

    test("charges no tax when there is no embedded gain (a deposit account)", () => {
      // Fixed income: basis == market value. Draining it realizes nothing.
      const { entries } = computeCashSweepIterative({
        ...stocksArgs,
        moduleBasisByYear: { 2027: 1000000, 2028: 1000000, 2029: 1000000 },
        cashDeltaByYear: { 2027: -100000, 2028: 0, 2029: 0 },
        startingCash: 100000,
      });
      expect(entries.filter((e) => e.account === "Taxes")).toHaveLength(0);
    });

    test("charges no tax on returning swept funds — that cash was never bought", () => {
      const { entries } = computeCashSweepIterative({
        ...stocksArgs,
        // 2027 sweeps 300k IN; 2028 needs it back. That is the sweep's own cash
        // coming home, not a sale of stock, so no gain is realized.
        cashDeltaByYear: { 2027: 400000, 2028: -400000, 2029: 0 },
        startingCash: 100000,
      });
      expect(entries.filter((e) => e.account === "Taxes")).toHaveLength(0);
    });

    test("taxes a backup module's liquidation at its own rate, not the primary's", () => {
      const { entries } = computeCashSweepIterative({
        years: [2027, 2028, 2029],
        cashSweepLow: 100000, cashSweepHigh: 200000,
        cashDeltaByYear: { 2027: -100000, 2028: 0, 2029: 0 },
        startingCash: 100000,
        sweepModule: { name: "Cash Mgt", account_name: "Cash Mgt Account" },
        moduleBalanceByYear: { 2027: 0, 2028: 0, 2029: 0 }, // primary already empty → cascade
        moduleTaxRate: 25,
        backupModules: [{
          name: "Stocks", account_name: "Stock Account",
          balanceByYear: { 2027: 1000000, 2028: 1000000, 2029: 1000000 },
          basisByYear: { 2027: 500000, 2028: 500000, 2029: 500000 },
          taxRate: 40, // its own override, higher than the primary's
        }],
      });

      // gain = 100k - 50k (50% basis) = 50k; tax at the BACKUP's 40% = 20k, not 25%.
      const tax2028 = entries.filter((e) => e.year === 2028 && e.account === "Taxes");
      expect(tax2028).toHaveLength(1);
      expect(tax2028[0].amount).toBeCloseTo(-20000, 2);
      expect(tax2028[0].comment).toMatch(/Stocks/);
    });

    test("paying the tax can itself force another sale — and that sale is taxed too", () => {
      const { entries } = computeCashSweepIterative({
        ...stocksArgs,
        cashDeltaByYear: { 2027: -100000, 2028: 0, 2029: 0 },
        startingCash: 100000,
      });

      // 2027 sale → 10k tax in 2028. Paying it drops 2028's cash under the band, which
      // forces a 10k top-up sale, whose own gain (40%) is taxed 1k in 2029. This chain
      // is why the tax has to run inside the sweep and not as a post-pass.
      //
      // 2029 carries two charges: the 1k deferred from 2028's sale, and 100 on the
      // top-up 2029 itself had to make — which stays in 2029 because it is the last year.
      const tax2029 = entries
        .filter((e) => e.year === 2029 && e.account === "Taxes")
        .map((e) => Math.round(e.amount));
      expect(tax2029).toEqual([-1000, -100]);
    });

    test("final-year tax has no next year to land in, so it stays put", () => {
      const { entries } = computeCashSweepIterative({
        ...stocksArgs,
        years: [2027],
        cashDeltaByYear: { 2027: -100000 },
        startingCash: 100000,
      });
      const tax = entries.filter((e) => e.account === "Taxes");
      expect(tax).toHaveLength(1);
      expect(tax[0].year).toBe(2027);
      expect(tax[0].amount).toBeCloseTo(-10000, 2);
    });
  });

  describe("swept funds stop growing once sold (P2b)", () => {
    test("a withdrawal is carried forward compounded at the module's growth rate", () => {
      // The builder keeps growing the module's full pre-sweep balance, so the sweep's
      // carry-forward has to grow too — otherwise money sold in 2027 goes on
      // compounding inside the module forever.
      const { entries } = computeCashSweepIterative({
        years: [2027, 2028, 2029],
        cashSweepLow: 100000, cashSweepHigh: 200000,
        cashDeltaByYear: { 2027: -100000, 2028: 0, 2029: 0 },
        startingCash: 100000,
        sweepModule: { name: "Stocks", account_name: "Stock Account" },
        moduleBalanceByYear: { 2027: 1000000, 2028: 1100000, 2029: 1210000 },
        moduleGrowthByYear: { 2027: 10, 2028: 10, 2029: 10 }, // 10%/yr, as the builder applies
        moduleTaxRate: 0,
      });

      // 100k withdrawn in 2027. Carried into 2028 it must be 110k, and into 2029 121k —
      // exactly cancelling the 10%/yr the builder compounds on the money that is gone.
      const carry2028 = entries.find((e) => e.year === 2028 && e.module === "_sweep_bal");
      const carry2029 = entries.find((e) => e.year === 2029 && e.module === "_sweep_bal");
      expect(carry2028.amount).toBeCloseTo(-110000, 2);
      expect(carry2029.amount).toBeCloseTo(-121000, 2);
    });

    test("zero growth is the identity — a deposit-account primary is unchanged", () => {
      const flat = {
        years: [2027, 2028, 2029],
        cashSweepLow: 100000, cashSweepHigh: 200000,
        cashDeltaByYear: { 2027: -100000, 2028: 0, 2029: 0 },
        startingCash: 100000,
        sweepModule: { name: "Fixed Income", account_name: "Fixed Income Account" },
        moduleBalanceByYear: { 2027: 1000000, 2028: 1000000, 2029: 1000000 },
      };
      const withoutGrowth = computeCashSweepIterative(flat);
      const withZeroGrowth = computeCashSweepIterative({
        ...flat,
        moduleGrowthByYear: { 2027: 0, 2028: 0, 2029: 0 },
      });
      expect(withZeroGrowth.entries).toEqual(withoutGrowth.entries);

      // and the carry-forward is the plain, uncompounded withdrawal
      const carry = withoutGrowth.entries.find((e) => e.module === "_sweep_bal");
      expect(carry.amount).toBeCloseTo(-100000, 2);
    });
  });
});
