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
    ExpenseFcLineId: null,
    IncomeFcLineId: null,
    ExpenseGrowthMethod: 'inflation',
    Matched: true,
    BaseDate: '2025-12-31',
    Comment: '',
    SetupStatus: 'new',
    IncomeStartDate: null,
    IncomeEndDate: null,
    ExpenseStartDate: null,
    ExpenseEndDate: null,
    CashSweepPriority: null,
    ExpenseAmount: 0,
    IncomeAmount: 0,
    BaseValue: 100,
    MarketValue: 150,
    BaseValueUSD: 100,
    MarketValueUSD: 150,
    Growth: 0,
    TaxRateOverride: null,
    IncomeTaxRateOverride: 0, // 0 is a real rate, not "unset" (CR047)
    Invest: [],
    Dispose: [],
    IncomePct: [],
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
      const r = await req('PUT', `/modules/${moduleId}`, { IncomeTaxRateOverride: 3 });
      expect(r.status).toBe(200);
      const row = await db.query(
        'SELECT income_tax_rate_override FROM forecast_modules WHERE id = $1', [moduleId]
      );
      expect(Number(row.rows[0].income_tax_rate_override)).toBe(3);
    });

    test('rejects a non-numeric value for a numeric field', async () => {
      const r = await req('PUT', `/modules/${moduleId}`, { Growth: 'fast' });
      expect(r.status).toBe(400);
    });
  });

  describe('income/expense items', () => {
    let itemId;

    test('accepts the payload FCAddFromLinesModal sends', async () => {
      const r = await req('POST', '/incomeexpense', {
        Scenario: SCENARIO,
        Name: 'N10 Item',
        Type: 'expense',
        Currency: 'USD',
        BaseDate: '2026-01-01',
        BaseValue: 10,
        BaseValueUSD: 10,
        Growth: 1,
        Matched: true,
        FcLineId: null,
        BudgetSourceYear: 2026,
        Comment: 'N10',
      });
      expect([200, 201]).toContain(r.status);
      itemId = r.body?.data?.id ?? r.body?.id;
      expect(itemId).toBeTruthy();
    });

    test('rejects an unknown field', async () => {
      const r = await req('PUT', `/incomeexpense/${itemId}`, { Bogus: 1 });
      expect(r.status).toBe(400);
      expect(String(r.body.error)).toMatch(/Bogus/);
    });

    test('still accepts a Changes-only PUT (what FCReview sends)', async () => {
      const r = await req('PUT', `/incomeexpense/${itemId}`, { Changes: [] });
      expect(r.status).toBe(200);
    });
  });
});
