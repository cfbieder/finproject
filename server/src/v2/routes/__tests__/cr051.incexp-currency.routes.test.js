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

  // CR069 P2 — the line is a MODULE with a stream now, so the write goes through /modules.
  // The behaviour pinned is unchanged and is the point of the file: the USD twin is derived
  // server-side from the native amount at the scenario's base-year rate, and a currency the
  // scenario cannot convert is refused rather than silently booked as dollars.
  test('rejects a non-USD stream whose scenario has no usable FX rate (400, fail loud)', async () => {
    const r = await req('POST', '/modules', {
      Scenario: BARE_SCENARIO,
      Name: 'PLN Living Expenses',
      Currency: 'PLN',
      Streams: [{ Direction: 'expense', Mode: 'amount', Amount: 100000 }],
    });
    expect(r.status).toBe(400);
  });

  test('derives the USD twin from the native amount at the base-year rate', async () => {
    if (!usable) return; // no FX-bearing scenario in this database — see the file header
    const r = await req('POST', '/modules', {
      Scenario: usable.name,
      Name: 'CR051 PLN Stream Module',
      Currency: 'PLN',
      Streams: [{ Direction: 'expense', Mode: 'amount', Amount: 100000 }],
    });
    expect(r.status).toBe(201);
    const id = r.body?.data?.id;
    try {
      const row = (await db.query(
        `SELECT st.amount, st.amount_usd FROM forecast_streams st WHERE st.module_id = $1`, [id]
      )).rows[0];
      expect(Number(row.amount)).toBeCloseTo(100000, 2);
      expect(Number(row.amount_usd)).toBeCloseTo(100000 / usable.rate, 2);
      expect(Number(row.amount_usd)).not.toBeCloseTo(100000, 0);   // NOT counted as dollars
    } finally {
      if (id) await db.query('DELETE FROM forecast_modules WHERE id = $1', [id]);
    }
  });
});
