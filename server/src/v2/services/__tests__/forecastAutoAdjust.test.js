'use strict';
/**
 * forecastAutoAdjust.test.js — CR053 auto-adjust spend-reduction solver.
 *
 * Pure-logic + input-validation coverage (no DB — the DB path is verified end-to-end against a
 * live scenario; see docs/cr/cr-053). Validation checks all run BEFORE any repo/db call, so they
 * throw without a database.
 */

const svc = require('../forecastAutoAdjust');
const { round2, fundedTolerance, patchFor } = svc._internals;

describe('CR053 auto-adjust — pure helpers', () => {
  test('round2 rounds to cents', () => {
    expect(round2(100 * 0.98)).toBe(98);
    expect(round2(166727.4899)).toBe(166727.49);
    expect(round2(-170130.6 * 0.98)).toBe(-166727.99); // sign preserved
  });

  test('fundedTolerance = max($1000, 1% of band)', () => {
    expect(fundedTolerance(200000)).toBe(2000);
    expect(fundedTolerance(50000)).toBe(1000); // floor
    expect(fundedTolerance(0)).toBe(1000);
    expect(fundedTolerance(null)).toBe(1000);
  });

  test('patchFor(module) scales expense_amount, keeps positive sign', () => {
    expect(patchFor('module', { expense_amount: 20000 }, 0.98)).toEqual({ expense_amount: 19600 });
  });

  test('patchFor(incexp) scales native + USD together, keeps negative sign', () => {
    expect(patchFor('incexp', { base_value: -170130.6, base_value_usd: -170130.6 }, 0.98)).toEqual({
      base_value: -166727.99,
      base_value_usd: -166727.99,
    });
  });
});

describe('CR053 auto-adjust — input validation (throws before any DB call)', () => {
  test('solveSpendReduction rejects empty line set', async () => {
    await expect(svc.solveSpendReduction({ scenarioName: 'X', lines: [] })).rejects.toThrow(/expense line/);
  });

  test('solveSpendReduction rejects out-of-range minRetain', async () => {
    await expect(
      svc.solveSpendReduction({ scenarioName: 'X', lines: [{ type: 'module', id: 1 }], minRetain: 1 })
    ).rejects.toThrow(/minRetain/);
  });

  test('applySpendReduction rejects retain outside (0,1]', async () => {
    const lines = [{ type: 'module', id: 1 }];
    await expect(svc.applySpendReduction({ scenarioName: 'X', lines, retain: 0 })).rejects.toThrow(/retain/);
    await expect(svc.applySpendReduction({ scenarioName: 'X', lines, retain: 1.5 })).rejects.toThrow(/retain/);
  });
});

describe('CR053 auto-adjust — job registry', () => {
  test('getSolveJob returns null for an unknown id', () => {
    expect(svc.getSolveJob('nope')).toBeNull();
  });

  test('startSolveJob registers a running job that transitions to error on bad input', async () => {
    // Empty lines makes the underlying solve reject → the job ends in 'error', exercising the
    // registry lifecycle without a DB.
    const jobId = svc.startSolveJob({ scenarioName: 'X', lines: [] });
    expect(svc.getSolveJob(jobId).status).toBe('running');
    await new Promise((r) => setTimeout(r, 20));
    const done = svc.getSolveJob(jobId);
    expect(done.status).toBe('error');
    expect(done.error).toMatch(/expense line/);
  });
});
