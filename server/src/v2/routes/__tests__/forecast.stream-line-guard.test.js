'use strict';
/**
 * Roadmap Known Issue #2 — an amount with no P&L line.
 *
 * `Sarasota House` carried an expense of 45,000 with `fc_line_id` NULL. The engine's stream loop
 * does `if (!line) continue` before posting to the P&L (`fcbuilder-module.js`), but the CASH path
 * below it takes every stream regardless. So the money left Bank Accounts and appeared on no
 * expense row: **−1,203,432 across 21 years on prod**, with Net Cash Flow and the Expenses metric
 * disagreeing by exactly that and nothing on screen able to explain it.
 *
 * CR062 closed this shape for loans (`assertLoanHasInterestLine`, V8) and nothing guarded it
 * anywhere else — an ASSET could do it freely. These tests pin the general guard.
 *
 * The line is keyed on the AMOUNT being non-zero, because that is what makes a stream produce a
 * flow at all. A 0-amount stream posts nothing in any mode, so leaving its line unset stays legal
 * — 15 such rows exist on prod and refusing them would block edits that are not the bug.
 *
 * DB-backed (skip with SKIP_DB_TESTS=1); self-seeding, cleans up by unique name.
 */

const { makeApp, request } = require('./_httpApp');
const router = require('../forecast');
const db = require('../../db');

const dbDescribe = process.env.SKIP_DB_TESTS ? describe.skip : describe;
const app = makeApp('/forecast', router);
const req = (m, p, b) => request(app, m, `/forecast${p}`, b);

dbDescribe('a stream with an amount needs a P&L line (Known Issue #2, DB)', () => {
  const SCENARIO = 'KI2StreamLineGuardScenario';
  const LINE = 'KI2 Guard Expense Line';
  let accountName;
  let fcLineId;

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
  });

  afterAll(async () => {
    await cleanup();
    await db.close();
  });

  const payload = (over = {}) => ({
    Scenario: SCENARIO,
    Account: accountName,
    Name: 'KI2 Module',
    Type: 'real estate',
    Currency: 'USD',
    Matched: false,
    BaseDate: '2025-12-31',
    Comment: '',
    SetupStatus: 'complete',
    BaseValue: 0,
    MarketValue: 0,
    BaseValueUSD: 0,
    MarketValueUSD: 0,
    Growth: 0,
    Streams: [],
    ...over,
  });

  const stream = (over = {}) => ({
    Direction: 'expense', Mode: 'amount', FcLineId: fcLineId, Amount: 0, Changes: [], ...over,
  });

  test('POST refuses an expense amount with no line — the Sarasota shape', async () => {
    const r = await req('POST', '/modules', payload({
      Name: 'KI2 NoLine',
      Streams: [stream({ FcLineId: null, Amount: 45000 })],
    }));
    expect(r.status).toBe(400);
    expect(String(r.body.error)).toMatch(/no P&L line/i);
  });

  test('POST refuses an INCOME amount with no line too — the guard is not expense-only', async () => {
    const r = await req('POST', '/modules', payload({
      Name: 'KI2 NoLineIncome',
      Streams: [stream({ Direction: 'income', FcLineId: null, Amount: 12000 })],
    }));
    expect(r.status).toBe(400);
    expect(String(r.body.error)).toMatch(/no P&L line/i);
  });

  test('a ZERO amount with no line is still allowed — 15 such rows exist on prod', async () => {
    // The stream posts nothing in any mode, so there is no money to lose track of. Refusing it
    // would block edits that are not the bug.
    const r = await req('POST', '/modules', payload({
      Name: 'KI2 ZeroNoLine',
      Streams: [stream({ FcLineId: null, Amount: 0 })],
    }));
    expect(r.status).toBe(201);
  });

  test('an amount WITH a line is accepted — the guard did not cost us the write', async () => {
    const r = await req('POST', '/modules', payload({
      Name: 'KI2 WithLine',
      Streams: [stream({ Amount: 45000 })],
    }));
    expect(r.status).toBe(201);
    const streams = (await db.query(
      `SELECT s.fc_line_id, s.amount FROM forecast_streams s
       JOIN forecast_modules m ON m.id = s.module_id WHERE m.name = 'KI2 WithLine'`
    )).rows;
    expect(streams).toHaveLength(1);
    expect(Number(streams[0].fc_line_id)).toBe(fcLineId);
    expect(Number(streams[0].amount)).toBe(45000);
  });

  test('PUT refuses the same shape — an existing module cannot be edited INTO it', async () => {
    const created = await req('POST', '/modules', payload({
      Name: 'KI2 EditInto',
      Streams: [stream({ Amount: 1000 })],
    }));
    expect(created.status).toBe(201);
    const id = created.body.data.id;

    const r = await req('PUT', `/modules/${id}`, payload({
      Name: 'KI2 EditInto',
      Streams: [stream({ FcLineId: null, Amount: 1000 })],
    }));
    expect(r.status).toBe(400);
    expect(String(r.body.error)).toMatch(/no P&L line/i);

    // And the stored stream is untouched — a refused write must not half-apply.
    const after = (await db.query(
      'SELECT fc_line_id FROM forecast_streams WHERE module_id = $1', [id]
    )).rows;
    expect(Number(after[0].fc_line_id)).toBe(fcLineId);
  });

  test('a PUT that never mentions streams is not refused on the strength of a stored row', async () => {
    const created = await req('POST', '/modules', payload({
      Name: 'KI2 UnrelatedEdit',
      Streams: [stream({ Amount: 1000 })],
    }));
    const id = created.body.data.id;
    const { Streams, ...noStreams } = payload({ Name: 'KI2 UnrelatedEdit', Comment: 'touched' });
    const r = await req('PUT', `/modules/${id}`, noStreams);
    expect(r.status).toBe(200);
  });
});
