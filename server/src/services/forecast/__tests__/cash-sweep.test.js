/**
 * Cash Sweep Tests — Pure computation functions
 *
 * Tests:
 * 1. Excess cash swept into target module
 * 2. Shortfall withdrawn from target module
 * 3. Partial withdrawal when sweep module has insufficient funds
 * 4. No sweep module — falls back to old deposit behavior
 * 5. Mixed years (some excess, some shortfall)
 * 6. Pass 2 yield calculation on swept funds
 * 7. Tax deferral on sweep yield
 */

const { computeCashSweep, computeSweepYield } = require("../cash-sweep");

beforeEach(() => {
  jest.spyOn(console, "log").mockImplementation(() => {});
});

const sweepModule = {
  name: "Fixed Income",
  account_name: "Fixed Income Account",
  market_value_usd: 100000,
};

describe("computeCashSweep — Pass 1", () => {
  test("sweeps excess cash into target module", () => {
    const { rebalanceValues, sweepLog } = computeCashSweep({
      years: [2027, 2028, 2029],
      targetCash: 50000,
      cashByYear: { 2027: 80000, 2028: 90000, 2029: 70000 },
      sweepModule,
      sweepModuleBalanceByYear: { 2027: 100000, 2028: 105000, 2029: 110000 },
    });

    // Year 2027: excess = 80000 - 50000 = 30000
    const yr2027 = rebalanceValues.filter(e => e.year === 2027);
    expect(yr2027).toHaveLength(2);
    expect(yr2027[0]).toMatchObject({ account: "Transfer - Bank", amount: -30000 });
    expect(yr2027[1]).toMatchObject({ account: "Fixed Income Account", amount: 30000 });

    const log2027 = sweepLog.find(l => l.year === 2027);
    expect(log2027.action).toBe("sweep_in");
    expect(log2027.amount).toBe(30000);
    expect(log2027.cashAfter).toBe(50000);
  });

  test("withdraws from sweep module on shortfall", () => {
    const { rebalanceValues, sweepLog } = computeCashSweep({
      years: [2027],
      targetCash: 50000,
      cashByYear: { 2027: 30000 },
      sweepModule,
      sweepModuleBalanceByYear: { 2027: 100000 },
    });

    // Shortfall = 20000, sweep module has 100000 → full withdrawal
    const entries = rebalanceValues.filter(e => e.year === 2027);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({ account: "Fixed Income Account", amount: -20000 });
    expect(entries[1]).toMatchObject({ account: "Transfer - Bank", amount: 20000 });

    expect(sweepLog[0].action).toBe("sweep_out");
    expect(sweepLog[0].amount).toBe(-20000);
  });

  test("partial withdrawal when sweep module has insufficient funds", () => {
    const { rebalanceValues, sweepLog } = computeCashSweep({
      years: [2027],
      targetCash: 50000,
      cashByYear: { 2027: 10000 },
      sweepModule,
      sweepModuleBalanceByYear: { 2027: 25000 }, // Only 25000 available but need 40000
    });

    // Shortfall = 40000, available = 25000 → withdraw 25000, shortfall 15000
    const sweepEntries = rebalanceValues.filter(e => e.account === "Transfer - Bank");
    expect(sweepEntries[0].amount).toBe(25000);

    const shortfallEntries = rebalanceValues.filter(e => e.account === "Cash Shortfall");
    expect(shortfallEntries).toHaveLength(1);
    expect(shortfallEntries[0].amount).toBe(-15000);

    expect(sweepLog[0].action).toBe("sweep_out");
    expect(sweepLog[0].shortfall).toBe(15000);
  });

  test("no sweep module — falls back to deposit behavior", () => {
    const { rebalanceValues, sweepLog } = computeCashSweep({
      years: [2027],
      targetCash: 50000,
      cashByYear: { 2027: 80000 },
      sweepModule: null,
      sweepModuleBalanceByYear: {},
    });

    expect(rebalanceValues).toHaveLength(2);
    expect(rebalanceValues[0]).toMatchObject({ account: "Transfer - Bank", amount: -30000, module: "_rebalance" });
    expect(rebalanceValues[1]).toMatchObject({ account: "Cash Rebalance - Deposits", amount: 30000, module: "_rebalance" });
    expect(sweepLog[0].action).toBe("deposit");
  });

  test("no sweep module, shortfall — flags shortfall", () => {
    const { rebalanceValues, sweepLog } = computeCashSweep({
      years: [2027],
      targetCash: 50000,
      cashByYear: { 2027: 30000 },
      sweepModule: null,
      sweepModuleBalanceByYear: {},
    });

    expect(rebalanceValues).toHaveLength(1);
    expect(rebalanceValues[0]).toMatchObject({ account: "Cash Shortfall", amount: -20000, module: "_rebalance" });
    expect(sweepLog[0].action).toBe("shortfall");
    expect(sweepLog[0].shortfall).toBe(20000);
  });

  test("mixed years — sweep in then sweep out", () => {
    const { sweepLog } = computeCashSweep({
      years: [2027, 2028, 2029],
      targetCash: 50000,
      cashByYear: { 2027: 80000, 2028: 30000, 2029: 60000 },
      sweepModule,
      sweepModuleBalanceByYear: { 2027: 100000, 2028: 105000, 2029: 110000 },
    });

    expect(sweepLog[0].action).toBe("sweep_in");  // 2027: excess 30000
    expect(sweepLog[0].amount).toBe(30000);

    // 2028: projected = 30000 + (-30000 adj from 2027) = 0, shortfall = 50000
    expect(sweepLog[1].action).toBe("sweep_out");

    // 2029: depends on cumulative adjustments
    expect(sweepLog[2]).toBeDefined();
  });

  test("cash at target — no action", () => {
    const { rebalanceValues, sweepLog } = computeCashSweep({
      years: [2027],
      targetCash: 50000,
      cashByYear: { 2027: 50000 },
      sweepModule,
      sweepModuleBalanceByYear: { 2027: 100000 },
    });

    expect(rebalanceValues).toHaveLength(0);
    expect(sweepLog[0].action).toBe("none");
  });
});

describe("computeSweepYield — Pass 2", () => {
  test("computes yield on swept funds starting next year", () => {
    const sweepLog = [
      { year: 2027, action: "sweep_in", amount: 100000 },
      { year: 2028, action: "none", amount: 0 },
      { year: 2029, action: "none", amount: 0 },
    ];

    const { pass2Entries, updatedSweepLog } = computeSweepYield({
      years: [2027, 2028, 2029],
      sweepLog,
      yieldByYear: { 2027: 4, 2028: 4, 2029: 4 },
      incomeCategory: "Interest Income",
      taxRate: 25,
      sweepModule,
    });

    // 2027: sweep in 100k, no yield yet (swept at year-end)
    const yr2027Income = pass2Entries.filter(e => e.year === 2027 && e.account === "Interest Income");
    expect(yr2027Income).toHaveLength(0);

    // 2028: yield on 100k at 4% = 4000
    const yr2028Income = pass2Entries.filter(e => e.year === 2028 && e.account === "Interest Income");
    expect(yr2028Income).toHaveLength(1);
    expect(yr2028Income[0].amount).toBe(4000);

    // 2029: yield on same 100k = 4000
    const yr2029Income = pass2Entries.filter(e => e.year === 2029 && e.account === "Interest Income");
    expect(yr2029Income).toHaveLength(1);
    expect(yr2029Income[0].amount).toBe(4000);

    // Sweep log updated with yield income
    expect(updatedSweepLog[1].yieldIncome).toBe(4000);
    expect(updatedSweepLog[2].yieldIncome).toBe(4000);
  });

  test("defers tax on sweep yield to next year", () => {
    const sweepLog = [
      { year: 2027, action: "sweep_in", amount: 100000 },
      { year: 2028, action: "none", amount: 0 },
      { year: 2029, action: "none", amount: 0 },
    ];

    const { pass2Entries } = computeSweepYield({
      years: [2027, 2028, 2029],
      sweepLog,
      yieldByYear: { 2027: 4, 2028: 4, 2029: 4 },
      incomeCategory: "Interest Income",
      taxRate: 25,
      sweepModule,
    });

    // 2028 income = 4000 → tax = -1000, deferred to 2029
    // 2029 income = 4000 → tax = -1000, deferred to 2029 (last year, stays in same year)
    // Both taxes land in 2029
    const yr2029Tax = pass2Entries.filter(e => e.year === 2029 && e.account === "Taxes");
    expect(yr2029Tax).toHaveLength(2);
    expect(yr2029Tax[0].amount).toBeCloseTo(-1000);
    expect(yr2029Tax[1].amount).toBeCloseTo(-1000);

    const allTax = pass2Entries.filter(e => e.account === "Taxes");
    expect(allTax).toHaveLength(2);
  });

  test("no yield entries when incomeCategory is null", () => {
    const sweepLog = [
      { year: 2027, action: "sweep_in", amount: 100000 },
      { year: 2028, action: "none", amount: 0 },
    ];

    const { pass2Entries } = computeSweepYield({
      years: [2027, 2028],
      sweepLog,
      yieldByYear: { 2027: 4, 2028: 4 },
      incomeCategory: null,
      taxRate: 25,
      sweepModule,
    });

    expect(pass2Entries).toHaveLength(0);
  });

  test("no yield entries when yield is 0%", () => {
    const sweepLog = [
      { year: 2027, action: "sweep_in", amount: 100000 },
      { year: 2028, action: "none", amount: 0 },
    ];

    const { pass2Entries } = computeSweepYield({
      years: [2027, 2028],
      sweepLog,
      yieldByYear: { 2027: 0, 2028: 0 },
      incomeCategory: "Interest Income",
      taxRate: 25,
      sweepModule,
    });

    expect(pass2Entries).toHaveLength(0);
  });

  test("sweep out reduces cumulative balance for yield", () => {
    const sweepLog = [
      { year: 2027, action: "sweep_in", amount: 100000 },
      { year: 2028, action: "sweep_out", amount: -60000 },
      { year: 2029, action: "none", amount: 0 },
    ];

    const { pass2Entries } = computeSweepYield({
      years: [2027, 2028, 2029],
      sweepLog,
      yieldByYear: { 2027: 4, 2028: 4, 2029: 4 },
      incomeCategory: "Interest Income",
      taxRate: 0,
      sweepModule,
    });

    // 2028: yield on 100k = 4000
    const yr2028 = pass2Entries.filter(e => e.year === 2028 && e.account === "Interest Income");
    expect(yr2028[0].amount).toBe(4000);

    // 2029: yield on 40k (100k - 60k) = 1600
    const yr2029 = pass2Entries.filter(e => e.year === 2029 && e.account === "Interest Income");
    expect(yr2029[0].amount).toBe(1600);
  });
});
