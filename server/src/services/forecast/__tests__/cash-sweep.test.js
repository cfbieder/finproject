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
});
