'use strict';
/**
 * forecastAutoAdjust.test.js — CR053 auto-adjust spend-reduction solver.
 *
 * Pure-logic + input-validation coverage (no DB — the DB path is verified end-to-end against a
 * live scenario; see docs/cr/cr-053). Validation checks all run BEFORE any repo/db call, so they
 * throw without a database.
 */

const svc = require('../forecastAutoAdjust');
const { round2, fundedTolerance, scaleStreamAmounts } = svc._internals;

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

  // CR069 P2 — one knob where there were two. A stream amount is a MAGNITUDE (migration 057
  // CHECKs it >= 0), so a retain in (0,1] scales it without ever touching a sign; the old
  // per-type helper existed only because a module stored an expense positive and an item
  // stored it negative.
  test('scaleStreamAmounts scales native and USD together', () => {
    expect(scaleStreamAmounts({ amount: 20000, amount_usd: 20000 }, 0.98))
      .toMatchObject({ amount: 19600, amount_usd: 19600 });
    // 170130.6 × 0.98 = 166727.988, rounded to the cent the column stores.
    expect(scaleStreamAmounts({ amount: 170130.6, amount_usd: 170130.6 }, 0.98))
      .toMatchObject({ amount: 166727.99, amount_usd: 166727.99 });
  });

  test('a null USD twin stays null rather than becoming 0', () => {
    expect(scaleStreamAmounts({ amount: 1000, amount_usd: null }, 0.5))
      .toMatchObject({ amount: 500, amount_usd: null });
  });

  test('every other field on the stream rides through untouched', () => {
    const row = { direction: 'expense', mode: 'amount', amount: 100, amount_usd: 100,
                  fc_line_id: 7, growth_mult: 0.5, changes: [{ flag: 'Fixed $' }] };
    const out = scaleStreamAmounts(row, 0.5);
    expect(out.fc_line_id).toBe(7);
    expect(out.growth_mult).toBe(0.5);
    expect(out.changes).toEqual([{ flag: 'Fixed $' }]);
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
