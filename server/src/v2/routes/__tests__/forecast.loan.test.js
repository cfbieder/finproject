'use strict';
/**
 * CR062 P1 — the loan module end to end through the API and the DB.
 *
 *   V6   base-year interest reaches getBaseYearValues (and so the sweep's opening cash)
 *   V8   a loan with no Interest Line is refused
 *   V14  a loan cannot be ranked as a cash-sweep source
 *   V15  a scenario COPY carries the loan columns and its amortization schedule
 *   V19  a variant-LOCAL loan survives a force-sync
 *   V20  an INHERITED loan re-materializes with its schedule intact
 *   V21  retype-to-Loan reports what it will destroy, then destroys it
 *
 * DB-backed (skip with SKIP_DB_TESTS=1); self-seeding, cleans up by unique name.
 */

const { makeApp, request } = require('./_httpApp');
const router = require('../forecast');
const db = require('../../db');
const crud = require('../../../services/forecast/crud');
const variants = require('../../services/forecastVariants');

const dbDescribe = process.env.SKIP_DB_TESTS ? describe.skip : describe;
const app = makeApp('/forecast', router);
const req = (m, p, b) => request(app, m, `/forecast${p}`, b);

dbDescribe('CR062 — forecast loan module (DB)', () => {
  const BASE = 'CR062LoanBaseScenario';
  const VARIANT = 'CR062LoanVariantScenario';
  const COPY = 'CR062LoanCopyScenario';
  let accountName;
  let fcLineId;

  async function cleanup() {
    // Variants first: parent_scenario_id is RESTRICT (CR050).
    await db.query('DELETE FROM forecast_scenarios WHERE name = ANY($1)', [[VARIANT, COPY]]);
    await db.query('DELETE FROM forecast_scenarios WHERE name = $1', [BASE]);
  }

  const loanPayload = (over = {}) => ({
    Scenario: BASE,
    Account: accountName,
    Name: 'CR062 Mortgage',
    Type: 'Loan',
    Currency: 'USD',
    ExpenseFcLineId: fcLineId,
    IncomeFcLineId: null,
    ExpenseGrowthMethod: 'inflation',
    Matched: false,
    BaseDate: '2025-12-31',
    Comment: '',
    SetupStatus: 'complete',
    ExpenseAmount: 0,
    IncomeAmount: 0,
    BaseValue: 0,
    MarketValue: 0,
    BaseValueUSD: 0,
    MarketValueUSD: 0,
    Growth: 0,
    LoanPrincipal: 400000,
    LoanStartDate: '2027-07-01',
    LoanEndDate: '2036-07-01',
    LoanInterestRate: 5,
    Invest: [],
    Dispose: [],
    IncomePct: [],
    Amortization: [
      { Date: '2028-07-01', Pct: 11.1111 },
      { Date: '2029-07-01', Pct: 11.1111 },
    ],
    ...over,
  });

  beforeAll(async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    await cleanup();
    await db.query('INSERT INTO forecast_scenarios (name) VALUES ($1)', [BASE]);
    accountName = (await db.query(
      `SELECT name FROM accounts
       WHERE parent_id IS NOT NULL AND name NOT IN ('Bank Accounts','Transfer - Bank','Taxes')
       ORDER BY id LIMIT 1`
    )).rows[0].name;
    fcLineId = (await db.query('SELECT id FROM fc_lines ORDER BY id LIMIT 1')).rows[0].id;
  });

  afterAll(async () => {
    await cleanup();
    await db.close();
  });

  // ── the four route guards ────────────────────────────────────────────────
  describe('guards', () => {
    test('V8 a loan with no Interest Line is refused', async () => {
      // Without one the interest still leaves Bank Accounts but lands on no P&L
      // row at all — cash vanishes from the plan with nothing to show for it.
      const r = await req('POST', '/modules', loanPayload({ ExpenseFcLineId: null, Name: 'CR062 NoLine' }));
      expect(r.status).toBe(400);
      expect(String(r.body.error)).toMatch(/Interest Line/i);
    });

    test('V14 a loan cannot be a cash-sweep source', async () => {
      // cash-sweep.js reads balances as ABSOLUTE, so a −400,000 loan would present
      // as 400,000 of sellable assets in CR045's liquidation cascade.
      const r = await req('POST', '/modules', loanPayload({ CashSweepPriority: 2, Name: 'CR062 Swept' }));
      expect(r.status).toBe(400);
      expect(String(r.body.error)).toMatch(/cash-sweep/i);
    });

    test('a non-empty Invest schedule is refused — the derivation owns it', async () => {
      const r = await req('POST', '/modules', loanPayload({
        Name: 'CR062 HandInvest',
        Invest: [{ Date: '2030-07-01', Amount: 1000, Flag: 'OneTime' }],
      }));
      expect(r.status).toBe(400);
      expect(String(r.body.error)).toMatch(/derived/i);
    });

    test('an EMPTY schedule is accepted — it is how a retype clears stale rows', async () => {
      const r = await req('POST', '/modules', loanPayload({ Name: 'CR062 EmptyOk' }));
      expect([200, 201]).toContain(r.status);
      await db.query('DELETE FROM forecast_modules WHERE name = $1', ['CR062 EmptyOk']);
    });

    test('a negative amortization percentage is refused (a silent re-draw)', async () => {
      const r = await req('POST', '/modules', loanPayload({
        Name: 'CR062 NegPct',
        Amortization: [{ Date: '2028-07-01', Pct: -5 }],
      }));
      expect(r.status).toBe(400);
    });

    test('Growth is COERCED to 0, not rejected', async () => {
      // buildModulePayload always emits Growth, so rejecting it would make a module
      // retyped Asset (Growth 1.0) → Loan unsaveable with no visible field to fix.
      const r = await req('POST', '/modules', loanPayload({ Name: 'CR062 GrowthCoerced', Growth: 1.5 }));
      expect([200, 201]).toContain(r.status);
      const id = r.body?.data?.id ?? r.body?.id;
      const row = await db.query('SELECT growth_rate FROM forecast_modules WHERE id = $1', [id]);
      expect(Number(row.rows[0].growth_rate)).toBe(0);
      await db.query('DELETE FROM forecast_modules WHERE id = $1', [id]);
    });
  });

  // ── round trip + the derived schedule ────────────────────────────────────
  describe('round trip', () => {
    let moduleId;

    test('a loan saves and reads back with its assumptions and schedule', async () => {
      const r = await req('POST', '/modules', loanPayload());
      expect([200, 201]).toContain(r.status);
      moduleId = r.body?.data?.id ?? r.body?.id;

      const got = await req('GET', `/modules/${moduleId}`);
      expect(got.status).toBe(200);
      const m = got.body.data;
      expect(Number(m.LoanPrincipal)).toBe(400000);
      expect(Number(m.LoanInterestRate)).toBe(5);
      expect(m.Amortization).toHaveLength(2);
      expect(Number(m.Amortization[0].Pct)).toBeCloseTo(11.1111, 4);
    });

    test('the amortization schedule replaces wholesale, never merges', async () => {
      const r = await req('PUT', `/modules/${moduleId}`, {
        Amortization: [{ Date: '2030-07-01', Pct: 25 }],
      });
      expect(r.status).toBe(200);
      const rows = await db.query(
        'SELECT effective_date, pct FROM forecast_module_amortization WHERE module_id = $1', [moduleId]
      );
      expect(rows.rows).toHaveLength(1);
      expect(Number(rows.rows[0].pct)).toBe(25);
    });

    test('V6 base-year interest reaches getBaseYearValues — and so the sweep', async () => {
      // The CR049 class: this figure is BOTH the Review's base-year column and the
      // cash sweep's opening cash. A derived interest charge that never lands here
      // leaves the sweep one year of interest rich for the whole horizon.
      const scenarioId = (await db.query('SELECT id FROM forecast_scenarios WHERE name = $1', [BASE])).rows[0].id;

      // POST /modules deliberately ignores SetupStatus — CR042 makes a new module
      // an unsaved DRAFT ('new'), and getBaseYearValues excludes new/exclude. Promote
      // it here so this test is about the loan branch and not about draft status.
      await db.query("UPDATE forecast_modules SET setup_status = 'complete' WHERE id = $1", [moduleId]);

      // Not yet drawn (MV 0) ⇒ nothing to charge.
      // getBaseYearValues returns { [fcLineLabel]: amount }, and BASE holds only
      // this loan — so the line's value IS the loan's base-year interest.
      const lineName = (await db.query('SELECT name FROM fc_lines WHERE id = $1', [fcLineId])).rows[0].name;
      const interestOf = (values) => Number(values?.values?.[lineName] ?? values?.[lineName] ?? 0);

      const before = await crud.getBaseYearValues(scenarioId, 2026);
      expect(interestOf(before)).toBeCloseTo(0, 6);

      // An EXISTING mortgage: 250,000 outstanding at 5% ⇒ 12,500 of base-year interest.
      await db.query('UPDATE forecast_modules SET market_value = -250000 WHERE id = $1', [moduleId]);
      const after = await crud.getBaseYearValues(scenarioId, 2026);
      expect(interestOf(after)).toBeCloseTo(-12500, 2);

      // Drawn IN the base year ⇒ half a year, the same July-1 convention.
      await db.query("UPDATE forecast_modules SET loan_start_date = '2026-07-01' WHERE id = $1", [moduleId]);
      const halved = await crud.getBaseYearValues(scenarioId, 2026);
      expect(interestOf(halved)).toBeCloseTo(-6250, 2);

      await db.query(
        "UPDATE forecast_modules SET market_value = 0, loan_start_date = '2027-07-01' WHERE id = $1",
        [moduleId]
      );
    });

    test('V21 retype-to-Loan reports what it will destroy, then destroys it', async () => {
      // Build a plain asset module carrying exactly what a loan cannot: a window
      // and all three schedules.
      const created = await req('POST', '/modules', {
        Scenario: BASE, Account: accountName, Name: 'CR062 Retype', Type: 'Real Estate',
        Currency: 'USD', ExpenseFcLineId: fcLineId, BaseDate: '2025-12-31',
        MarketValue: 500000, MarketValueUSD: 500000, ExpenseAmount: 1000,
        Invest: [{ Date: '2030-07-01', Amount: 100, Flag: 'OneTime' }],
        Dispose: [{ Date: '2031-07-01', Amount: 50, Flag: 'Full' }],
        IncomePct: [{ Date: '2030-07-01', Value: 2 }],
      });
      const id = created.body?.data?.id ?? created.body?.id;

      // The window goes on via PUT, not POST: `repo.createModule`'s INSERT column
      // list never included CR046's four window columns, so POST silently drops
      // them. Pre-existing and unrelated to loans — noted rather than fixed here.
      await req('PUT', `/modules/${id}`, {
        ExpenseStartDate: '2030-07-01', ExpenseEndDate: '2032-07-01',
      });

      // The preview must SEE it before anything is destroyed.
      const preview = await req('GET', `/modules/${id}/loan-retype-preview`);
      expect(preview.status).toBe(200);
      expect(preview.body.data).toMatchObject({ invest: 1, dispose: 1, income_pct: 1, windows: 1 });
      expect(preview.body.data.total).toBe(4);

      // ...and it is a PREVIEW: nothing has gone yet.
      const stillThere = await db.query(
        'SELECT COUNT(*)::int AS n FROM forecast_module_investments WHERE module_id = $1', [id]
      );
      expect(stillThere.rows[0].n).toBe(1);

      const saved = await req('PUT', `/modules/${id}`, {
        LoanPrincipal: 100000, LoanStartDate: '2027-07-01',
        LoanEndDate: '2035-07-01', LoanInterestRate: 4,
        ExpenseFcLineId: fcLineId,
        Invest: [], Dispose: [], IncomePct: [],
      });
      expect(saved.status).toBe(200);
      expect(saved.body.cleared).toMatchObject({ total: 4 });

      const after = await db.query(`
        SELECT
          (SELECT COUNT(*)::int FROM forecast_module_investments WHERE module_id = $1) AS invest,
          (SELECT COUNT(*)::int FROM forecast_module_disposals   WHERE module_id = $1) AS dispose,
          (SELECT COUNT(*)::int FROM forecast_module_income_pct  WHERE module_id = $1) AS income_pct,
          (SELECT expense_start_date FROM forecast_modules WHERE id = $1) AS win
      `, [id]);
      expect(after.rows[0]).toMatchObject({ invest: 0, dispose: 0, income_pct: 0, win: null });

      await db.query('DELETE FROM forecast_modules WHERE id = $1', [id]);
    });
  });

  // ── the copy path (the CR045 §1 / CR048 bug class) ───────────────────────
  test('V15 a scenario COPY carries the loan columns and the schedule', async () => {
    const sourceId = (await db.query('SELECT id FROM forecast_scenarios WHERE name = $1', [BASE])).rows[0].id;
    const repo = require('../../repositories').forecast;
    await repo.copyScenario(sourceId, COPY);

    // Assert on the COPY, never the source — asserting on the source proves nothing.
    const copied = await db.query(`
      SELECT m.loan_principal, m.loan_start_date, m.loan_end_date, m.loan_interest_rate,
             (SELECT COUNT(*)::int FROM forecast_module_amortization a WHERE a.module_id = m.id) AS sched
      FROM forecast_modules m
      JOIN forecast_scenarios s ON s.id = m.scenario_id
      WHERE s.name = $1 AND m.name = 'CR062 Mortgage'
    `, [COPY]);

    expect(copied.rows).toHaveLength(1);
    const row = copied.rows[0];
    expect(Number(row.loan_principal)).toBe(400000);
    expect(Number(row.loan_interest_rate)).toBe(5);
    expect(String(row.loan_start_date)).toContain('2027');
    expect(String(row.loan_end_date)).toContain('2036');
    expect(row.sched).toBe(1);   // the wholesale replace above left one row
  });

  // ── the CR050 variant paths — the driving scenario is a variant ──────────
  describe('variants', () => {
    let variantId;
    let baseId;

    beforeAll(async () => {
      baseId = (await db.query('SELECT id FROM forecast_scenarios WHERE name = $1', [BASE])).rows[0].id;
      const v = await db.query(
        'INSERT INTO forecast_scenarios (name, parent_scenario_id) VALUES ($1, $2) RETURNING id',
        [VARIANT, baseId]
      );
      variantId = v.rows[0].id;
    });

    test('V20 an INHERITED loan re-materializes with its schedule intact', async () => {
      // The dangerous case: miss the child table in SCHEDULE_TABLES and the variant's
      // loan arrives with NO repayments — a flat balance that looks deliberate rather
      // than an error anyone would notice.
      await variants.syncVariant(variantId, { force: true });

      const got = await db.query(`
        SELECT m.id, m.loan_principal, m.loan_interest_rate, m.origin_base_id,
               (SELECT COUNT(*)::int FROM forecast_module_amortization a WHERE a.module_id = m.id) AS sched
        FROM forecast_modules m WHERE m.scenario_id = $1 AND m.name = 'CR062 Mortgage'
      `, [variantId]);

      expect(got.rows).toHaveLength(1);
      expect(Number(got.rows[0].loan_principal)).toBe(400000);
      expect(Number(got.rows[0].loan_interest_rate)).toBe(5);
      expect(got.rows[0].origin_base_id).not.toBeNull();
      expect(got.rows[0].sched).toBe(1);
    });

    test('V19 a variant-LOCAL loan survives a force-sync untouched', async () => {
      // origin_base_id IS NULL ⇒ syncEntity does not touch it. generateForecast
      // force-syncs at Step 0 of EVERY build, so this runs constantly in the
      // owner's real scenario.
      const created = await req('POST', '/modules', loanPayload({
        Scenario: VARIANT, Name: 'CR062 Local Loan', LoanPrincipal: 123456,
        Amortization: [{ Date: '2028-07-01', Pct: 50 }],
      }));
      expect([200, 201]).toContain(created.status);
      const localId = created.body?.data?.id ?? created.body?.id;

      await variants.syncVariant(variantId, { force: true });

      const after = await db.query(`
        SELECT m.loan_principal, m.origin_base_id,
               (SELECT COUNT(*)::int FROM forecast_module_amortization a WHERE a.module_id = m.id) AS sched
        FROM forecast_modules m WHERE m.id = $1
      `, [localId]);

      expect(after.rows).toHaveLength(1);
      expect(after.rows[0].origin_base_id).toBeNull();
      expect(Number(after.rows[0].loan_principal)).toBe(123456);
      expect(after.rows[0].sched).toBe(1);
    });

    test('an OVERRIDDEN loan rate pins while the base keeps flowing through', async () => {
      const inherited = await db.query(
        "SELECT id FROM forecast_modules WHERE scenario_id = $1 AND name = 'CR062 Mortgage'", [variantId]
      );
      const inheritedId = inherited.rows[0].id;

      const r = await req('PUT', `/modules/${inheritedId}`, { LoanInterestRate: 9 });
      expect(r.status).toBe(200);

      // Change something else on the BASE, then sync: the override must survive and
      // the un-overridden field must still inherit.
      await db.query(
        "UPDATE forecast_modules SET loan_principal = 555000 WHERE scenario_id = $1 AND name = 'CR062 Mortgage'",
        [baseId]
      );
      await variants.syncVariant(variantId, { force: true });

      const after = await db.query(
        "SELECT loan_interest_rate, loan_principal FROM forecast_modules WHERE scenario_id = $1 AND name = 'CR062 Mortgage'",
        [variantId]
      );
      expect(Number(after.rows[0].loan_interest_rate)).toBe(9);       // pinned
      expect(Number(after.rows[0].loan_principal)).toBe(555000);      // inherited
    });
  });
});
