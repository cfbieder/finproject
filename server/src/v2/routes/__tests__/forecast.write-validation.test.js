'use strict';
/**
 * forecast.write-validation.test.js — CR043 N10.
 *
 * The module / income-expense write routes build their update object from an explicit
 * PascalCase whitelist, so a key the caller sends but the route does not read was
 * **silently dropped**: 200 OK, value gone. That is how CR046's window dates and CR047's
 * income tax override were lost (v3.0.86) — wired through the editor, the API, the engine
 * and the copy path, and thrown away at this layer.
 *
 * These tests pin the contract now that unknown fields 400 instead:
 *   - the payload the frontend actually sends is ACCEPTED (nothing that works today breaks);
 *   - a typo'd / unwired field is REJECTED loudly, not accepted-and-ignored;
 *   - a real field still round-trips (the guard didn't cost us the write).
 *
 * DB-backed (skip with SKIP_DB_TESTS=1); self-seeding, cleans up by unique name.
 */

const { makeApp, request } = require('./_httpApp');
const router = require('../forecast');
const db = require('../../db');

const dbDescribe = process.env.SKIP_DB_TESTS ? describe.skip : describe;
const app = makeApp('/forecast', router);
const req = (m, p, b) => request(app, m, `/forecast${p}`, b);

dbDescribe('forecast write validation (N10, DB)', () => {
  const SCENARIO = 'N10WriteValidationScenario';
  let accountName;

  async function cleanup() {
    await db.query('DELETE FROM forecast_scenarios WHERE name = $1', [SCENARIO]);
  }

  beforeAll(async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    await cleanup();
    await db.query('INSERT INTO forecast_scenarios (name) VALUES ($1)', [SCENARIO]);
    accountName = (await db.query(
      `SELECT name FROM accounts
       WHERE parent_id IS NOT NULL AND name NOT IN ('Bank Accounts','Transfer - Bank','Taxes')
       ORDER BY id LIMIT 1`
    )).rows[0].name;
  });

  afterAll(async () => {
    await cleanup();
    await db.close();
  });

  /** Exactly what frontend/src/features/Forecast/utils/fcModulePayload.js emits. */
  const frontendModulePayload = () => ({
    Scenario: SCENARIO,
    Account: accountName,
    Name: 'N10 Module',
    Type: 'Stocks',
    Currency: 'USD',
    Matched: true,
    BaseDate: '2025-12-31',
    Comment: '',
    SetupStatus: 'new',
    CashSweepPriority: null,
    BaseValue: 100,
    MarketValue: 150,
    BaseValueUSD: 100,
    MarketValueUSD: 150,
    Growth: 0,
    TaxRateOverride: null,
    // CR069 P3 — the editor sends streams, not per-direction columns.
    Streams: [],
    Invest: [],
    Dispose: [],
  });

  describe('modules', () => {
    let moduleId;

    test('accepts the exact payload the editor sends', async () => {
      const r = await req('POST', '/modules', frontendModulePayload());
      expect([200, 201]).toContain(r.status);
      moduleId = r.body?.data?.id ?? r.body?.id;
      expect(moduleId).toBeTruthy();
    });

    test('rejects an unknown field instead of silently dropping it', async () => {
      const r = await req('PUT', `/modules/${moduleId}`, {
        Name: 'N10 Module',
        IncomeTaxRateOverrid: 3, // typo — the CR047 field, one char short
      });
      expect(r.status).toBe(400);
      expect(String(r.body.error)).toMatch(/IncomeTaxRateOverrid/);
    });

    test('rejects a field that has no column (the AccountNumber class of dead key)', async () => {
      const r = await req('PUT', `/modules/${moduleId}`, { AccountNumber: '123' });
      expect(r.status).toBe(400);
    });

    test('still round-trips a real field (the guard did not cost us the write)', async () => {
      // CR069 P2 — the value LANDS ON THE STREAM now, not on the module column. The route
      // still ACCEPTS the legacy field (the editor sends it until P3) but deliberately no
      // longer writes the retired column: doing both would let a variant save turn it into an
      // override on a column the engine has stopped reading.
      // CR069 P3 — through the stream, which is the only shape the contract now accepts.
      const r = await req('PUT', `/modules/${moduleId}`, {
        Streams: [{ Direction: 'income', Mode: 'amount', Amount: 0, TaxRateOverride: 3, Changes: [] }],
      });
      expect(r.status).toBe(200);
      const row = await db.query(
        `SELECT tax_rate_override FROM forecast_streams
          WHERE module_id = $1 AND direction = 'income'`, [moduleId]
      );
      expect(Number(row.rows[0].tax_rate_override)).toBe(3);
    });

    // The create path had its OWN hand-written column list, separate from the
    // update path's allow-list, and it silently discarded five fields the route
    // had already mapped into moduleData: CR046's four window dates and CR047's
    // income tax override. No error, 201 Created, values gone — the exact failure
    // v3.0.86 fixed one layer up (fcModulePayload) and which simply moved one
    // layer down. Both paths now share one list, so they cannot diverge again.
    test('POST persists every field the route maps — not just the ones the INSERT listed', async () => {
      const r = await req('POST', '/modules', {
        ...frontendModulePayload(),
        Name: 'N10 Create Column Coverage',
        Streams: [
          { Direction: 'income', Mode: 'amount', Amount: 0, StartDate: '2030-07-01',
            EndDate: '2040-07-01', TaxRateOverride: 3, Changes: [] },
          { Direction: 'expense', Mode: 'amount', Amount: 0, StartDate: '2031-07-01',
            EndDate: '2041-07-01', Changes: [] },
        ],
      });
      expect([200, 201]).toContain(r.status);
      const id = r.body?.data?.id ?? r.body?.id;

      // CR069 P2 — the windows and the income tax override are STREAM properties now. The
      // failure this test was written for is unchanged in kind: a field the route maps must
      // actually persist, and "201 Created, values gone" is the thing to catch.
      const rows = (await db.query(
        `SELECT direction, start_date, end_date, tax_rate_override
           FROM forecast_streams WHERE module_id = $1`, [id]
      )).rows;
      const income = rows.find((x) => x.direction === 'income');
      const expense = rows.find((x) => x.direction === 'expense');

      expect(String(income.start_date)).toContain('2030');
      expect(String(income.end_date)).toContain('2040');
      expect(String(expense.start_date)).toContain('2031');
      expect(String(expense.end_date)).toContain('2041');
      expect(Number(income.tax_rate_override)).toBe(3);
    });

    // The guard that outlives this fix: a migration that adds a column and forgets
    // the repository is the CR045 §1 / CR048 class, and it fails SILENTLY. Reading
    // the live catalogue means the next such column trips a test instead of a
    // scenario quietly computing something else.
    test('every writable column on forecast_modules is reachable through the repository', async () => {
      const MANAGED = new Set(['id', 'scenario_id', 'created_at', 'updated_at', 'origin_base_id']);
      const cols = (await db.query(
        `SELECT column_name FROM information_schema.columns WHERE table_name = 'forecast_modules'`
      )).rows.map((r) => r.column_name).filter((c) => !MANAGED.has(c));

      const { MODULE_WRITABLE_COLUMNS } = require('../../repositories/forecast');
      const unreachable = cols.filter((c) => !MODULE_WRITABLE_COLUMNS.includes(c));
      expect(unreachable).toEqual([]);
    });

    test('rejects a non-numeric value for a numeric field', async () => {
      const r = await req('PUT', `/modules/${moduleId}`, { Growth: 'fast' });
      expect(r.status).toBe(400);
    });
  });

  describe('streams (CR069 P2 — what income/expense items became)', () => {
    let modId;

    test('accepts a module carrying a stream, the shape FCAddFromLinesModal now sends', async () => {
      const r = await req('POST', '/modules', {
        Scenario: SCENARIO,
        Name: 'N10 Stream Module',
        Comment: 'N10',
        Streams: [{ Direction: 'expense', Mode: 'amount', Amount: 1234, GrowthMult: 1 }],
      });
      expect([200, 201]).toContain(r.status);
      modId = r.body?.data?.id ?? r.body?.id;
      expect(modId).toBeTruthy();

      const st = (await db.query(
        'SELECT direction, mode, amount FROM forecast_streams WHERE module_id = $1', [modId]
      )).rows;
      expect(st).toHaveLength(1);
      expect(st[0].direction).toBe('expense');
      expect(Number(st[0].amount)).toBe(1234);
    });

    test('rejects an unknown field, so a typo fails loud instead of being dropped', async () => {
      const r = await req('POST', '/modules', {
        Scenario: SCENARIO, Name: 'N10 Bogus', Streamz: [],
      });
      expect(r.status).toBe(400);
    });

    // RETIRED by CR069 P3 — "the legacy per-direction fields still write a stream".
    // That bridge existed only while the editor still sent columns; it now sends `Streams`,
    // and the contract REFUSES the old names rather than translating them (an allow-list that
    // quietly accepts a shape nothing produces is how dead keys survive — CR043 N10).

    afterAll(async () => {
      if (modId) await db.query('DELETE FROM forecast_modules WHERE id = $1', [modId]);
    });
  });

});
