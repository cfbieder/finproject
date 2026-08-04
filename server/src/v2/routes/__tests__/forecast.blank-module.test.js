'use strict';
/**
 * forecast.blank-module.test.js — CR064 §4.3.
 *
 * Prod carries two forecast modules with no name and no account, in `2026 Upside` and
 * `2026 Downside`. They were long attributed to Cancel — "creating a module opens its
 * editor, but the module already exists by then" — but CR042 made New Module a
 * client-side draft on 2026-07-13 (`11fc3b5`), and both rows were created on
 * 2026-07-14, the day after.
 *
 * What wrote them is **Generate**, which saves the draft before it builds: pressed on
 * an empty form it POSTs a blank module, and nothing refused it. The rows then sit in
 * the Modules table as blanks nobody can identify, and with `account_id` null their
 * `AccountType` resolves to '' — so they silently take the ASSET branch in the engine
 * (CR062 §1.1 counted them as "two modules with no account_id at all").
 *
 * The guard is "an Account OR a Name", never both: an account with no name and a name
 * with no account are each meaningful, and only the empty pair is refused.
 *
 * DB-backed (skip with SKIP_DB_TESTS=1); self-seeding, cleans up by unique name.
 */

const { makeApp, request } = require('./_httpApp');
const router = require('../forecast');
const db = require('../../db');

const dbDescribe = process.env.SKIP_DB_TESTS ? describe.skip : describe;
const app = makeApp('/forecast', router);
const req = (m, p, b) => request(app, m, `/forecast${p}`, b);

dbDescribe('CR064 — a module needs an account or a name (DB)', () => {
  const SCENARIO = 'CR064BlankModuleScenario';
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

  /** What the editor POSTs for a brand-new module nobody has filled in yet. */
  const emptyDraft = () => ({
    Scenario: SCENARIO,
    Account: '',
    Name: '',
    Type: 'asset',
    Currency: 'EUR',
    Matched: false,
    BaseDate: '2026-12-31',
    Comment: '',
    SetupStatus: 'new',
    BaseValue: 0,
    MarketValue: 0,
    BaseValueUSD: 0,
    MarketValueUSD: 0,
    Invest: [],
    Dispose: [],
    Streams: [],
  });

  test('refuses the empty draft that Generate used to write', async () => {
    const r = await req('POST', '/modules', emptyDraft());
    expect(r.status).toBe(400);
    expect(String(r.body.error)).toMatch(/Account or a Name/i);
  });

  test('whitespace is not a name', async () => {
    const r = await req('POST', '/modules', { ...emptyDraft(), Name: '   ' });
    expect(r.status).toBe(400);
  });

  test('nothing was written', async () => {
    const { rows } = await db.query(
      `SELECT COUNT(*)::int AS n FROM forecast_modules m
         JOIN forecast_scenarios s ON s.id = m.scenario_id
        WHERE s.name = $1`, [SCENARIO]
    );
    expect(rows[0].n).toBe(0);
  });

  test('an account with no name is fine — that is every matched module', async () => {
    const r = await req('POST', '/modules', { ...emptyDraft(), Account: accountName });
    expect([200, 201]).toContain(r.status);
  });

  test('a name with no account is fine too', async () => {
    const r = await req('POST', '/modules', { ...emptyDraft(), Name: 'CR064 Named No Account' });
    expect([200, 201]).toContain(r.status);
  });

  test('a partial PUT that mentions neither field is untouched by the guard', async () => {
    // The Modules table updates setup status inline with exactly this body. It must not
    // start 400ing because the guard cannot see a name it was never sent.
    const created = await req('POST', '/modules', {
      ...emptyDraft(), Name: 'CR064 Partial Put', Account: accountName,
    });
    const id = created.body?.data?.id ?? created.body?.id;
    const r = await req('PUT', `/modules/${id}`, { SetupStatus: 'complete' });
    expect(r.status).toBe(200);
  });

  test('a PUT may not blank an existing module either', async () => {
    const created = await req('POST', '/modules', {
      ...emptyDraft(), Name: 'CR064 Blank By Put', Account: accountName,
    });
    const id = created.body?.data?.id ?? created.body?.id;
    const r = await req('PUT', `/modules/${id}`, { Name: '', Account: '' });
    expect(r.status).toBe(400);
  });
});
