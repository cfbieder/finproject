'use strict';
/**
 * forecast.routes.test.js — CR043 Phase 1.2.
 *
 * Characterization tests that pin the HTTP contract of the forecast router
 * (status codes + response envelopes) BEFORE the Phase 2.1 route→service
 * extraction, so the split can't silently change behavior. DB-backed (skip with
 * SKIP_DB_TESTS=1); self-seeding — creates a throwaway scenario, exercises the
 * real router + real dev/CI Postgres, and cleans up by unique name (never
 * relies on any pre-existing scenario, so it passes on CI's fresh DB too).
 */

const { makeApp, request } = require('./_httpApp');
const router = require('../forecast');
const db = require('../../db');

const dbDescribe = process.env.SKIP_DB_TESTS ? describe.skip : describe;
const app = makeApp('/forecast', router);
const req = (m, p, b) => request(app, m, `/forecast${p}`, b);

dbDescribe('forecast router contract (DB)', () => {
  const SCENARIO = 'CR043RouteTestScenario';
  let scenarioId;
  let accountName;

  async function cleanup() {
    await db.query('DELETE FROM forecast_scenarios WHERE name = $1', [SCENARIO]);
  }

  beforeAll(async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    await cleanup();
    scenarioId = (await db.query(
      'INSERT INTO forecast_scenarios (name) VALUES ($1) RETURNING id', [SCENARIO]
    )).rows[0].id;
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

  describe('read envelopes', () => {
    test('GET /scenarios → 200 { data: [...] } including the seeded scenario', async () => {
      const r = await req('GET', '/scenarios');
      expect(r.status).toBe(200);
      expect(Array.isArray(r.body.data)).toBe(true);
      expect(r.body.data.some((s) => s.name === SCENARIO)).toBe(true);
    });

    test('GET /modules?scenario=<seeded> → 200 bare array (NB: not enveloped — N8)', async () => {
      const r = await req('GET', `/modules?scenario=${encodeURIComponent(SCENARIO)}`);
      expect(r.status).toBe(200);
      // Current contract: this endpoint returns a bare array, unlike GET
      // /scenarios which returns { data }. Pinned deliberately (envelope
      // inconsistency is CR043 N8 — this test guards the shape during extraction).
      expect(Array.isArray(r.body)).toBe(true);
    });

    test('GET /entries?scenario=<seeded> → 200 { entries: [] }', async () => {
      const r = await req('GET', `/entries?scenario=${encodeURIComponent(SCENARIO)}`);
      expect(r.status).toBe(200);
      expect(Array.isArray(r.body.entries)).toBe(true);
    });

    test('GET /scenarios/years/<unknown> → 200 { years: [] }', async () => {
      const r = await req('GET', '/scenarios/years/CR043NoSuchXYZ');
      expect(r.status).toBe(200);
      expect(r.body.years).toEqual([]);
    });

    test('GET /incomeexpense with no scenario → 200 { entries: [] }', async () => {
      const r = await req('GET', '/incomeexpense');
      expect(r.status).toBe(200);
      expect(r.body.entries).toEqual([]);
    });
  });

  describe('validation & not-found', () => {
    test('POST /modules with no Scenario → 400', async () => {
      const r = await req('POST', '/modules', {});
      expect(r.status).toBe(400);
      expect(r.body.error).toMatch(/Scenario is required/);
    });

    test('POST /modules with unknown scenario → 404', async () => {
      const r = await req('POST', '/modules', { Scenario: 'CR043NoSuchXYZ' });
      expect(r.status).toBe(404);
      expect(r.body.error).toMatch(/Scenario not found/);
    });

    test('POST /scenarios/byname/:name/copy with no newScenarioName → 400', async () => {
      const r = await req('POST', `/scenarios/byname/${encodeURIComponent(SCENARIO)}/copy`, {});
      expect(r.status).toBe(400);
      expect(r.body.error).toMatch(/New scenario name is required/);
    });

    test('DELETE /scenarios/byname/<unknown> → 404', async () => {
      const r = await req('DELETE', '/scenarios/byname/CR043NoSuchXYZ');
      expect(r.status).toBe(404);
    });

    test('PUT /scenarios/<huge id> → 404', async () => {
      const r = await req('PUT', '/scenarios/999999999', { description: 'x' });
      expect(r.status).toBe(404);
    });

    test('PUT /scenarios/:id with an unknown field → 400 (CR043 N10 whitelist)', async () => {
      const r = await req('PUT', `/scenarios/${scenarioId}`, { cash_sweep_lo: 5000 });
      expect(r.status).toBe(400);
      expect(r.body.error).toMatch(/unknown field/i);
    });

    test('PUT /scenarios/:id with a non-numeric sweep value → 400', async () => {
      const r = await req('PUT', `/scenarios/${scenarioId}`, { cash_sweep_low: 'abc' });
      expect(r.status).toBe(400);
      expect(r.body.error).toMatch(/finite number/i);
    });

    test('PUT /scenarios/:id with a valid sweep band → 200 { data }', async () => {
      const r = await req('PUT', `/scenarios/${scenarioId}`, { cash_sweep_low: 5000, cash_sweep_high: 50000 });
      expect(r.status).toBe(200);
      expect(Number(r.body.data.cash_sweep_low)).toBe(5000);
    });

    test('GET /modules/<huge id> → 404', async () => {
      const r = await req('GET', '/modules/999999999');
      expect(r.status).toBe(404);
    });

    test('DELETE /modules/<non-numeric> → 400 Invalid ID', async () => {
      const r = await req('DELETE', '/modules/notanumber');
      expect(r.status).toBe(400);
      expect(r.body.error).toMatch(/Invalid ID/);
    });

    test('unknown path → 404 via the app 404 handler', async () => {
      const r = await req('GET', '/no-such-endpoint');
      expect(r.status).toBe(404);
    });
  });

  describe('module CRUD round-trip via the API', () => {
    test('POST → GET list → GET one → DELETE → GET 404', async () => {
      const create = await req('POST', '/modules', {
        Scenario: SCENARIO,
        Account: accountName,
        Name: 'CR043 Route Module',
        Type: 'asset',
        Currency: 'USD',
        BaseValue: 1000,
        MarketValue: 1000,
      });
      expect(create.status).toBe(201);
      expect(create.body.data).toBeDefined();
      const id = create.body.data.id;
      expect(id).toBeGreaterThan(0);

      const list = await req('GET', `/modules?scenario=${encodeURIComponent(SCENARIO)}`);
      expect(list.body.some((m) => m.id === id)).toBe(true); // bare array (see N8 note above)

      const one = await req('GET', `/modules/${id}`);
      expect(one.status).toBe(200);
      expect(one.body.data.Name).toBe('CR043 Route Module');

      const del = await req('DELETE', `/modules/${id}`);
      expect(del.status).toBe(200);
      expect(del.body.success).toBe(true);

      const gone = await req('GET', `/modules/${id}`);
      expect(gone.status).toBe(404);
    });
  });
});
