'use strict';
/**
 * The module LIST and DETAIL projections must agree.
 *
 * They were two hand-kept PascalCase lists of ~35 keys each and drifted THREE times in three
 * days — every time the same way round, with DETAIL missing something LIST had, and every time
 * surfacing as the module editor guessing at state it should have been told:
 *
 *   v3.14.2  `HasValuation`   — the form could not tell whether a module has a balance sheet
 *   v3.15.0  the sweep fields — `buildModulePayload` had to guess the sweep rank
 *   v3.16.0  `fc_line_name`   — the Actual field read "no line set" on every module that had one
 *
 * Both reviewers of CR072 asked for this to stop being a matter of remembering. The projections
 * now share `moduleCommonFields`; this test is what makes that shape stick, because a future
 * author can still add a key to one endpoint by hand.
 *
 * The assertion is deliberately about the RESPONSES, not about the helper: a test that only
 * checked the helper would pass while one endpoint quietly stopped spreading it.
 *
 * DB-backed (skip with SKIP_DB_TESTS=1); self-seeding, cleans up by unique name.
 */

const { makeApp, request } = require('./_httpApp');
const router = require('../forecast');
const db = require('../../db');

const dbDescribe = process.env.SKIP_DB_TESTS ? describe.skip : describe;
const app = makeApp('/forecast', router);
const req = (m, p, b) => request(app, m, `/forecast${p}`, b);

dbDescribe('module LIST and DETAIL projections agree (DB)', () => {
  const SCENARIO = 'ProjectionParityScenario';
  const LINE = 'Projection Parity Line';
  let accountName;
  let fcLineId;
  let moduleId;

  async function cleanup() {
    await db.query('DELETE FROM forecast_scenarios WHERE name = $1', [SCENARIO]);
    await db.query('DELETE FROM fc_lines WHERE name = $1', [LINE]);
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
    fcLineId = (await db.query(
      `INSERT INTO fc_lines (name, line_type) VALUES ($1, 'bs_module_expense') RETURNING id`, [LINE]
    )).rows[0].id;

    // A module carrying the fields that actually drifted: a balance sheet, a sweep rank, and a
    // stream on a named line.
    const created = await req('POST', '/modules', {
      Scenario: SCENARIO,
      Account: accountName,
      Name: 'Parity Module',
      Type: 'real estate',
      Currency: 'USD',
      Matched: true,
      BaseDate: '2025-12-31',
      Comment: 'parity',
      SetupStatus: 'complete',
      BaseValue: 100000,
      MarketValue: 150000,
      BaseValueUSD: 100000,
      MarketValueUSD: 150000,
      Growth: 1.5,
      CashSweepTarget: true,
      CashSweepPriority: 3,
      Streams: [{ Direction: 'expense', Mode: 'amount', FcLineId: fcLineId, Amount: 2500, Changes: [] }],
    });
    expect(created.status).toBe(201);
    moduleId = created.body.data.id;
  });

  afterAll(async () => {
    await cleanup();
    await db.close();
  });

  test('every shared key is present in BOTH responses, with the same value', async () => {
    const list = await req('GET', `/modules?scenario=${encodeURIComponent(SCENARIO)}`);
    const detail = await req('GET', `/modules/${moduleId}`);
    expect(list.status).toBe(200);
    expect(detail.status).toBe(200);

    const fromList = list.body.data.find((m) => m.id === moduleId);
    const fromDetail = detail.body.data;
    expect(fromList).toBeTruthy();

    const missingFromList = [];
    const missingFromDetail = [];
    const disagreed = [];
    for (const key of router.MODULE_COMMON_KEYS) {
      if (!(key in fromList)) missingFromList.push(key);
      if (!(key in fromDetail)) missingFromDetail.push(key);
      if (JSON.stringify(fromList[key]) !== JSON.stringify(fromDetail[key])) disagreed.push(key);
    }
    expect({ missingFromList, missingFromDetail, disagreed })
      .toEqual({ missingFromList: [], missingFromDetail: [], disagreed: [] });
  });

  test('the three fields that actually drifted are on both', async () => {
    // Named individually because a shared-key loop would pass if someone removed them from the
    // shared projection as well as from one endpoint.
    const list = await req('GET', `/modules?scenario=${encodeURIComponent(SCENARIO)}`);
    const detail = await req('GET', `/modules/${moduleId}`);
    const fromList = list.body.data.find((m) => m.id === moduleId);
    const fromDetail = detail.body.data;

    expect(fromList.HasValuation).toBe(true);          // v3.14.2
    expect(fromDetail.HasValuation).toBe(true);
    expect(fromList.CashSweepPriority).toBe(3);        // v3.15.0
    expect(fromDetail.CashSweepPriority).toBe(3);
    expect(fromList.CashSweepTarget).toBe(true);
    expect(fromDetail.CashSweepTarget).toBe(true);
  });

  test('a stream carries fc_line_name on BOTH — the v3.16.0 drift', async () => {
    // The LIST built it in SQL with a join; the DETAIL came through `loadModuleStreams`, which
    // did a bare `SELECT *` and had no join at all. The editor loads from DETAIL, so it read
    // "no line set" on every module that had one.
    const list = await req('GET', `/modules?scenario=${encodeURIComponent(SCENARIO)}`);
    const detail = await req('GET', `/modules/${moduleId}`);
    const listStream = list.body.data.find((m) => m.id === moduleId).Streams[0];
    const detailStream = detail.body.data.Streams[0];

    expect(listStream.fc_line_name).toBe(LINE);
    expect(detailStream.fc_line_name).toBe(LINE);
    expect(Number(detailStream.fc_line_id)).toBe(fcLineId);
  });

  test('the two are allowed to differ where they genuinely do', async () => {
    // Pinned so the parity test cannot be "fixed" one day by flattening a real difference:
    // Type is capitalised for display on the list and raw for the editor's select on the detail,
    // and only the detail carries the Invest/Dispose rows.
    const list = await req('GET', `/modules?scenario=${encodeURIComponent(SCENARIO)}`);
    const detail = await req('GET', `/modules/${moduleId}`);
    const fromList = list.body.data.find((m) => m.id === moduleId);
    const fromDetail = detail.body.data;

    expect(fromList.Type).toBe('Real estate');
    expect(fromDetail.Type).toBe('real estate');
    expect(Array.isArray(fromDetail.Dispose)).toBe(true);
    expect(fromList.Dispose).toBeUndefined();
    expect(fromList.DisposeCount).toBe(0);
    expect(fromDetail.DisposeCount).toBeUndefined();
  });
});
