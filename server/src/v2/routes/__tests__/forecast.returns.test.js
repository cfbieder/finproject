'use strict';
/**
 * CR099 — a module's per-year return path through the API and the DB.
 *
 *   - the validator: refusals by rule (pure);
 *   - POST / PUT write it, GET reads it back in year order;
 *   - the API refuses a path on a loan, on a flow module, on the base year, at −100%;
 *   - a VARIANT stores it as an override, the base keeps its own, `[]` clears it, and the same
 *     path sent in another order is not an override (the comparison is positional).
 *
 * DB-backed (skip with SKIP_DB_TESTS=1); self-seeding, cleans up by unique name.
 */

const { makeApp, request } = require('./_httpApp');
const router = require('../forecast');
const db = require('../../db');
const variants = require('../../services/forecastVariants');
const { validateReturns } = require('../../utils/forecastReturns');

describe('CR099 — validateReturns', () => {
  const bad = (rows, ctx) => expect(() => validateReturns(rows, ctx)).toThrow();

  test('accepts a crash and recovery, and returns it sorted', () => {
    const rows = validateReturns([{ Year: 2028, Pct: 15 }, { Year: '2027', Pct: '-50' }], { baseYear: 2025, periodEnd: 2062 });
    expect(rows).toEqual([{ Year: 2027, Pct: -50 }, { Year: 2028, Pct: 15 }]);
  });

  test('refuses what the engine would ignore or misapply', () => {
    bad([{ Year: 2027, Pct: -100 }]);
    bad([{ Year: 2027, Pct: 1001 }]);
    bad([{ Year: 2027, Pct: 'x' }]);
    bad([{ Year: 2027, Pct: 1 }, { Year: 2027, Pct: 2 }]);
    bad([{ Year: 2025, Pct: 5 }], { baseYear: 2025 });
    bad([{ Year: 2063, Pct: 5 }], { periodEnd: 2062 });
    bad([{ Year: 2027, Pct: -50 }], { isLoan: true });
    bad([{ Year: 2027, Pct: -50 }], { hasValuation: false });
  });

  test('a blank percent or a missing year is refused, never stored as 0%', () => {
    bad([{ Year: 2027, Pct: null }]);
    bad([{ Year: 2027, Pct: '' }]);
    bad([{ Pct: 5 }]);
  });

  test('a row sent back unchanged is not re-judged against the bounds (a stale row must not block a save)', () => {
    const stored = [{ year: 2026, pct: '-50.0000' }];
    expect(validateReturns([{ Year: 2026, Pct: -50 }], { baseYear: 2026, stored })).toEqual([{ Year: 2026, Pct: -50 }]);
    bad([{ Year: 2026, Pct: -40 }], { baseYear: 2026, stored });   // changed: judged again
  });

  test('an empty path is always accepted — it is how a path is cleared', () => {
    expect(validateReturns([], { isLoan: true, hasValuation: false })).toEqual([]);
  });
});

const dbDescribe = process.env.SKIP_DB_TESTS ? describe.skip : describe;
const app = makeApp('/forecast', router);
const req = (m, p, b) => request(app, m, `/forecast${p}`, b);

dbDescribe('CR099 — return path through the API (DB)', () => {
  const BASE = 'CR099ReturnsBaseScenario';
  const VARIANT = 'CR099ReturnsVariantScenario';
  const ACCOUNT = 'CR099R Stocks';
  let baseId;
  let moduleId;

  const asset = (over = {}) => ({
    Scenario: BASE, Account: ACCOUNT, Name: 'CR099 Stocks', Type: 'Stocks', Currency: 'USD',
    BaseDate: '2025-12-31', BaseValue: 100, MarketValue: 100, BaseValueUSD: 100, MarketValueUSD: 100,
    Growth: 1, SetupStatus: 'complete', Matched: false, Invest: [], Dispose: [], ...over,
  });
  const stored = async (id) => (await db.query(
    'SELECT year, pct::float AS pct FROM forecast_module_returns WHERE module_id = $1 ORDER BY year', [id]
  )).rows;

  async function cleanup() {
    await db.query('DELETE FROM forecast_scenarios WHERE name = $1', [VARIANT]);
    await db.query('DELETE FROM forecast_scenarios WHERE name = $1', [BASE]);
    await db.query('DELETE FROM accounts WHERE name = $1', [ACCOUNT]);
  }

  beforeAll(async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    await cleanup();
    baseId = (await db.query('INSERT INTO forecast_scenarios (name) VALUES ($1) RETURNING id', [BASE])).rows[0].id;
    await db.query(
      `INSERT INTO accounts (name, account_type, section, currency, opening_balance)
       VALUES ($1, 'asset', 'balance_sheet', 'USD', 0)`, [ACCOUNT]
    );
  });
  afterAll(async () => { await cleanup(); await db.close(); });

  test('POST writes it, GET reads it back in year order', async () => {
    const r = await req('POST', '/modules', asset({ Returns: [{ Year: 2028, Pct: 15 }, { Year: 2027, Pct: -50 }] }));
    expect([200, 201]).toContain(r.status);
    moduleId = r.body?.data?.id ?? r.body?.id;
    expect(await stored(moduleId)).toEqual([{ year: 2027, pct: -50 }, { year: 2028, pct: 15 }]);
    const got = await req('GET', `/modules/${moduleId}`);
    expect(got.body.data.Returns).toEqual([{ Year: 2027, Pct: -50 }, { Year: 2028, Pct: 15 }]);
  });

  test('the list carries it too (the PATH marker and the warnings read the list)', async () => {
    const list = await req('GET', `/modules?scenario=${BASE}`);
    const row = (list.body.data || list.body).find((m) => m.Name === 'CR099 Stocks');
    expect(row.Returns).toEqual([{ Year: 2027, Pct: -50 }, { Year: 2028, Pct: 15 }]);
  });

  test('PUT replaces it; a PUT that never mentions it leaves it alone', async () => {
    expect((await req('PUT', `/modules/${moduleId}`, { Returns: [{ Year: 2030, Pct: -20 }] })).status).toBe(200);
    expect(await stored(moduleId)).toEqual([{ year: 2030, pct: -20 }]);
    expect((await req('PUT', `/modules/${moduleId}`, { Comment: 'x' })).status).toBe(200);
    expect(await stored(moduleId)).toEqual([{ year: 2030, pct: -20 }]);
  });

  test.each([
    ['−100%, which would zero the value', { Returns: [{ Year: 2027, Pct: -100 }] }],
    ['the base year, which is observed', { Returns: [{ Year: 2025, Pct: -50 }] }],
    ['a flow module, which has no value', { HasValuation: false, Returns: [{ Year: 2027, Pct: -50 }] }],
  ])('refuses %s with a 400 and writes nothing', async (_why, body) => {
    const r = await req('PUT', `/modules/${moduleId}`, body);
    expect(r.status).toBe(400);
    expect(await stored(moduleId)).toEqual([{ year: 2030, pct: -20 }]);
  });

  test('a row the base date has moved past does not block an unrelated save', async () => {
    await db.query('UPDATE forecast_modules SET base_date = $2 WHERE id = $1', [moduleId, '2030-12-31']);
    const r = await req('PUT', `/modules/${moduleId}`, { Comment: 'y', Returns: [{ Year: 2030, Pct: -20 }] });
    expect(r.status).toBe(200);
    await db.query('UPDATE forecast_modules SET base_date = $2 WHERE id = $1', [moduleId, '2025-12-31']);
  });

  test('the save-time preview refuses with the same sentence, before any copy is built', async () => {
    const r = await req('POST', `/modules/${moduleId}/preview`, { patch: { Returns: [{ Year: 2027, Pct: -100 }] } });
    expect(r.status).toBe(400);
    expect(String(r.body.error)).toMatch(/above −100%/);
  });

  test('refuses a path on a new loan', async () => {
    const r = await req('POST', '/modules', asset({
      Name: 'CR099 Loan', LoanPrincipal: 1000, LoanStartDate: '2027-01-01', LoanEndDate: '2030-01-01',
      LoanInterestRate: 5, Returns: [{ Year: 2027, Pct: -50 }],
    }));
    expect(r.status).toBe(400);
    expect(String(r.body.error)).toMatch(/return path/i);
  });

  describe('on a variant', () => {
    let variantId;
    let inheritedId;

    beforeAll(async () => {
      variantId = (await db.query(
        'INSERT INTO forecast_scenarios (name, parent_scenario_id) VALUES ($1, $2) RETURNING id', [VARIANT, baseId]
      )).rows[0].id;
      await variants.syncVariant(variantId, { force: true });
      inheritedId = (await db.query(
        "SELECT id FROM forecast_modules WHERE scenario_id = $1 AND name = 'CR099 Stocks'", [variantId]
      )).rows[0].id;
    });

    const overridePatch = async () => (await db.query(
      `SELECT patch FROM forecast_scenario_overrides WHERE scenario_id = $1 AND entity_type = 'module'`, [variantId]
    )).rows[0]?.patch ?? null;

    test('an inherited module arrives with the base path', async () => {
      expect(await stored(inheritedId)).toEqual([{ year: 2030, pct: -20 }]);
    });

    test('a crash on the variant is an override; the base keeps its own and survives a sync', async () => {
      const r = await req('PUT', `/modules/${inheritedId}`, { Returns: [{ Year: 2028, Pct: 10 }, { Year: 2027, Pct: -50 }] });
      expect(r.status).toBe(200);
      expect((await overridePatch()).returns).toEqual([{ year: 2027, pct: -50 }, { year: 2028, pct: 10 }]);
      await variants.syncVariant(variantId, { force: true });
      expect(await stored(inheritedId)).toEqual([{ year: 2027, pct: -50 }, { year: 2028, pct: 10 }]);
      expect(await stored(moduleId)).toEqual([{ year: 2030, pct: -20 }]);
    });

    test('the base path sent in another order is not an override', async () => {
      // Inserted AFTER 2030, so the base's id order is not its year order — the case a
      // positional comparison in id order would get wrong.
      await db.query("INSERT INTO forecast_module_returns (module_id, year, pct) VALUES ($1, 2029, 5)", [moduleId]);
      const r = await req('PUT', `/modules/${inheritedId}`, { Returns: [{ Year: 2030, Pct: -20 }, { Year: 2029, Pct: 5 }] });
      expect(r.status).toBe(200);
      expect((await overridePatch())?.returns).toBeUndefined();
    });

    test('`[]` clears the variant path while the base keeps its own', async () => {
      const r = await req('PUT', `/modules/${inheritedId}`, { Returns: [] });
      expect(r.status).toBe(200);
      await variants.syncVariant(variantId, { force: true });
      expect(await stored(inheritedId)).toEqual([]);
      expect((await stored(moduleId)).length).toBe(2);
    });
  });
});
