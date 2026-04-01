/**
 * Cash Sweep Tests — Iterative transfers between cash and sweep module
 *
 * Tests:
 * 1. Excess cash swept into module (above high band)
 * 2. Shortfall withdrawn from swept balance, then module's own balance
 * 3. Cash within band — no action
 * 4. No sweep module — deposit/shortfall fallback
 * 5. BS entries are absolute swept balance per year
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

    // Should have emergency withdrawal BS entry
    const emergencyEntry = entries.find(e => e.comment === "Emergency withdrawal from module");
    expect(emergencyEntry).toBeDefined();
    expect(emergencyEntry.amount).toBe(-150000);
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

  test("BS entries are absolute swept balance", () => {
    const { entries } = computeCashSweepIterative({
      years: [2027, 2028, 2029],
      cashSweepLow: 50000, cashSweepHigh: 100000,
      cashDeltaByYear: { 2027: 200000, 2028: 50000, 2029: -300000 },
      startingCash: 100000,
      sweepModule, moduleBalanceByYear: { 2029: 500000 },
    });

    const bsEntries = entries.filter(e => e.account === "Fixed Income Account" && e.comment === "Sweep balance");
    expect(bsEntries.find(e => e.year === 2027).amount).toBe(200000);
    expect(bsEntries.find(e => e.year === 2028).amount).toBe(250000);
    // 2029: withdraw all swept (250k) + some from module → net swept = 0
    expect(bsEntries.find(e => e.year === 2029)).toBeUndefined();
  });
});
