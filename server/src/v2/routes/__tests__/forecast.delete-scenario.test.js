'use strict';
/**
 * Deleting a scenario removes its entries from the shared assumptions document.
 *
 * The document (`forecast_assumptions`: scenarios / inflation / FX / Tax Rate) is keyed by
 * scenario NAME. The route used to delete only the `forecast_scenarios` row and leave the prune to
 * the browser, which drops the entries from unsaved local state — so prod came to carry an orphan
 * "ZZ SRQ financed" in all four keys (found 2026-09-28, CR064 §15).
 *
 * DB-backed (skip with SKIP_DB_TESTS=1); self-seeding, cleans up by unique name.
 */

const { makeApp, request } = require('./_httpApp');
const router = require('../forecast');
const db = require('../../db');

const dbDescribe = process.env.SKIP_DB_TESTS ? describe.skip : describe;
const app = makeApp('/forecast', router);

const NAME = 'CRdel Orphan Test Scenario';
const KEYS = { scenarios: 'Name', inflation: 'Scenario', FX: 'Scenario', 'Tax Rate': 'Scenario' };

async function entriesFor(name) {
  const res = await db.query(
    `SELECT a.key, count(*)::int AS n
       FROM forecast_assumptions a, jsonb_array_elements(a.value::jsonb) e
      WHERE a.key = ANY($1) AND jsonb_typeof(a.value::jsonb) = 'array'
        AND (e->>'Name' = $2 OR e->>'Scenario' = $2)
      GROUP BY a.key`,
    [Object.keys(KEYS), name]
  );
  return Object.fromEntries(res.rows.map((r) => [r.key, r.n]));
}

async function totalEntries() {
  const res = await db.query(
    `SELECT COALESCE(sum(jsonb_array_length(value::jsonb)), 0)::int AS n
       FROM forecast_assumptions WHERE key = ANY($1) AND jsonb_typeof(value::jsonb) = 'array'`,
    [Object.keys(KEYS)]
  );
  return res.rows[0].n;
}

dbDescribe('DELETE /forecast/scenarios/byname/:name (DB)', () => {
  async function cleanup() {
    await db.query('DELETE FROM forecast_scenarios WHERE name = $1', [NAME]);
    for (const [key, field] of Object.entries(KEYS)) {
      await db.query(
        `UPDATE forecast_assumptions
            SET value = COALESCE((SELECT jsonb_agg(e) FROM jsonb_array_elements(value::jsonb) e
                                   WHERE e->>$3 IS DISTINCT FROM $2), '[]'::jsonb)
          WHERE key = $1 AND jsonb_typeof(value::jsonb) = 'array'`,
        [key, NAME, field]
      );
    }
  }

  beforeAll(async () => {
    await cleanup();
    await db.query(`INSERT INTO forecast_scenarios (name, description, is_active) VALUES ($1, 'delete fixture', TRUE)`, [NAME]);
    for (const [key, field] of Object.entries(KEYS)) {
      await db.query(
        `UPDATE forecast_assumptions
            SET value = (value::jsonb || jsonb_build_array(jsonb_build_object($2::text, $3::text)))
          WHERE key = $1 AND jsonb_typeof(value::jsonb) = 'array'`,
        [key, field, NAME]
      );
    }
  });

  afterAll(cleanup);

  test('the scenario row and all four of its assumption entries go together', async () => {
    expect(await entriesFor(NAME)).toEqual({ scenarios: 1, inflation: 1, FX: 1, 'Tax Rate': 1 });
    const before = await totalEntries();

    const res = await request(app, 'DELETE', `/forecast/scenarios/byname/${encodeURIComponent(NAME)}`);
    expect(res.status).toBe(200);

    const row = await db.query('SELECT 1 FROM forecast_scenarios WHERE name = $1', [NAME]);
    expect(row.rowCount).toBe(0);
    expect(await entriesFor(NAME)).toEqual({});
    // Only this scenario's four entries left — nobody else's.
    expect(await totalEntries()).toBe(before - 4);
  });
});
