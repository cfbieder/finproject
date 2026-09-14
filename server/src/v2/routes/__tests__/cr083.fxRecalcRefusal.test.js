'use strict';
/**
 * CR083 §5 — POST /budget/fx-rates/recalculate refuses while a DRAFT LE exists
 * for that year.
 *
 * A recalculate rewrites `base_amount` on budget_entries, and a draft LE's
 * estimate months are copies of those figures, so it would silently move half the
 * estimate window with no signal (L2 covers actual months only). DB-backed;
 * self-seeding in 1977, which no database holds data for.
 */

const { makeApp, request } = require('./_httpApp');
const router = require('../budget');
const leRepo = require('../../repositories/budgetLe');
const db = require('../../db');

const dbDescribe = process.env.SKIP_DB_TESTS ? describe.skip : describe;
const app = makeApp('/budget', router);
const req = (m, p, b) => request(app, m, `/budget${p}`, b);

const YEAR = 1977;

dbDescribe('FX recalculate vs a draft Latest Estimate (DB)', () => {
  const cleanup = () => db.query(`DELETE FROM budget_le WHERE budget_year = $1`, [YEAR]);

  beforeAll(async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    await cleanup();
  });

  afterAll(async () => {
    await cleanup();
    await db.close();
  });

  test('409 LE_DRAFT_EXISTS while a draft exists, before any rate is read or written', async () => {
    await leRepo.create({ budgetYear: YEAR, actualThrough: `${YEAR}-03-31` });
    const count = async () => (await db.query('SELECT COUNT(*)::int AS n FROM budget_fx_rates')).rows[0].n;
    const before = await count();
    const r = await req('POST', '/fx-rates/recalculate', { currency: 'EUR', year: YEAR, month: 3 });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('LE_DRAFT_EXISTS');
    expect(r.body.error).toMatch(/LE-04-77/);
    expect(await count()).toBe(before);
  });

  test('with no draft the refusal does not apply — the route reaches its own no-data answer', async () => {
    await cleanup();
    const r = await req('POST', '/fx-rates/recalculate', { currency: 'EUR', year: YEAR, month: 3 });
    // Not merely "not 409": a crash in the guard would also be not-409.
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/No actual exchange rate data/);
  });
});
