'use strict';
/**
 * CR051 — income/expense foreign-currency write path (routes, DB-backed).
 *
 * base_value_usd for a non-USD line is DERIVED server-side from the native base_value at the
 * scenario's base-year FX — never trusted from the client, so it can't rot. Two behaviors pinned:
 *   - a non-USD line whose scenario has no usable FX rate is REJECTED with 400 (fail loud, F1);
 *   - a non-USD line on a scenario that HAS an FX rate stores base_value_usd = base_value / rate.
 *
 * The second test self-skips when the dev DB has no FX-bearing scenario (keeps CI green without
 * depending on seeded assumptions). Skip the whole file with SKIP_DB_TESTS=1.
 */

const { makeApp, request } = require('./_httpApp');
const router = require('../forecast');
const db = require('../../db');
const { baseYearFxRate } = require('../../../services/forecast/fcbuilder-setup');

const dbDescribe = process.env.SKIP_DB_TESTS ? describe.skip : describe;
const app = makeApp('/forecast', router);
const req = (m, p, b) => request(app, m, `/forecast${p}`, b);

dbDescribe('CR051 income/expense currency (DB)', () => {
  const BARE_SCENARIO = 'CR051BareNoFxScenario';
  let usable = null; // { name, rate } for a scenario baseYearFxRate resolves for PLN

  beforeAll(async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    await db.query('DELETE FROM forecast_scenarios WHERE name = $1', [BARE_SCENARIO]);
    await db.query('INSERT INTO forecast_scenarios (name) VALUES ($1)', [BARE_SCENARIO]);

    // Find any existing scenario the engine can convert PLN for (has PeriodStart + a non-zero rate).
    const rows = (await db.query('SELECT name FROM forecast_scenarios ORDER BY id')).rows;
    for (const { name } of rows) {
      try {
        const rate = await baseYearFxRate(name, 'PLN');
        if (Number.isFinite(rate) && rate > 0) { usable = { name, rate }; break; }
      } catch { /* scenario not FX-convertible — keep looking */ }
    }
  });

  afterAll(async () => {
    await db.query('DELETE FROM forecast_scenarios WHERE name = $1', [BARE_SCENARIO]);
    await db.close();
  });

  test('rejects a non-USD line whose scenario has no usable FX rate (400, fail loud)', async () => {
    const r = await req('POST', '/incomeexpense', {
      Scenario: BARE_SCENARIO,
      Name: 'PLN Living Expenses',
      Type: 'Expense',
      Currency: 'PLN',
      BaseDate: '2025-12-31',
      BaseValue: -400,
      BaseValueUSD: -999, // client value must be ignored either way
      Growth: 1,
      Matched: false,
    });
    expect(r.status).toBe(400);
    // Rejected before it can mis-convert — either the FX rate is missing, or (as here) the bare
    // scenario has no assumptions entry to convert against. Either way: loud, not a silent 1:1.
    expect(String(r.body.error || '')).toMatch(/FX|scenario|assumptions/i);
  });

  test('derives base_value_usd = base_value / base-year FX for a convertible scenario', async () => {
    if (!usable) {
      console.warn('[CR051] no FX-convertible scenario in this DB — skipping derivation assertion');
      return;
    }
    const r = await req('POST', '/incomeexpense', {
      Scenario: usable.name,
      Name: 'CR051 PLN Test Line',
      Type: 'Expense',
      Currency: 'PLN',
      BaseDate: '2025-12-31',
      BaseValue: -400,
      BaseValueUSD: -12345, // deliberately wrong — server must derive, not trust this
      Growth: 1,
      Matched: false,
    });
    expect([200, 201]).toContain(r.status);
    const id = r.body?.data?.id;
    expect(id).toBeTruthy();
    try {
      const row = (await db.query(
        'SELECT currency, base_value, base_value_usd FROM forecast_income_expense WHERE id = $1', [id]
      )).rows[0];
      expect(row.currency).toBe('PLN');
      const expected = Math.round((-400 / usable.rate) * 100) / 100;
      expect(Number(row.base_value_usd)).toBeCloseTo(expected, 2);
      // and NOT the client-sent value
      expect(Number(row.base_value_usd)).not.toBe(-12345);
    } finally {
      await db.query('DELETE FROM forecast_income_expense WHERE id = $1', [id]);
    }
  });
});
