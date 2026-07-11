'use strict';
/**
 * budget.routes.test.js — CR043 Phase 1.2.
 *
 * Characterization tests pinning the budget router's HTTP contract (status
 * codes + envelopes + CR037 field validation) before the Phase 2.1 extraction.
 * DB-backed (skip with SKIP_DB_TESTS=1); self-seeding — creates a throwaway
 * budget version, exercises the real router + Postgres, cleans up by id. Passes
 * on CI's fresh DB (relies on no pre-existing data).
 */

const { makeApp, request } = require('./_httpApp');
const router = require('../budget');
const db = require('../../db');

const dbDescribe = process.env.SKIP_DB_TESTS ? describe.skip : describe;
const app = makeApp('/budget', router);
const req = (m, p, b) => request(app, m, `/budget${p}`, b);

dbDescribe('budget router contract (DB)', () => {
  const VERSION_NAME = 'CR043 Route Budget';
  const createdVersionIds = [];

  async function cleanup() {
    await db.query('DELETE FROM budget_versions WHERE version_name = $1', [VERSION_NAME]);
  }

  beforeAll(async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    await cleanup();
  });

  afterAll(async () => {
    await cleanup();
    await db.close();
  });

  describe('read envelopes', () => {
    test('GET /versions → 200 { data: [...] }', async () => {
      const r = await req('GET', '/versions');
      expect(r.status).toBe(200);
      expect(Array.isArray(r.body.data)).toBe(true);
    });

    test('GET /fx-rates?year=2026 → 200 { data: [...] }', async () => {
      const r = await req('GET', '/fx-rates?year=2026');
      expect(r.status).toBe(200);
      expect(Array.isArray(r.body.data)).toBe(true);
    });

    test('GET /fx-rates/rate-map?year=2026&month=3 → 200 { data: {...} }', async () => {
      const r = await req('GET', '/fx-rates/rate-map?year=2026&month=3');
      expect(r.status).toBe(200);
      expect(r.body).toHaveProperty('data');
    });
  });

  describe('validation & not-found', () => {
    test('GET /versions/<huge id> → 404 Budget version not found', async () => {
      const r = await req('GET', '/versions/999999999');
      expect(r.status).toBe(404);
      expect(r.body.error).toMatch(/not found/i);
    });

    test('PATCH /versions/<huge id> → 404', async () => {
      const r = await req('PATCH', '/versions/999999999', { description: 'x' });
      expect(r.status).toBe(404);
    });

    test('GET /entries/<huge id> → 404 Budget entry not found', async () => {
      const r = await req('GET', '/entries/999999999');
      expect(r.status).toBe(404);
      expect(r.body.error).toMatch(/not found/i);
    });

    test('POST /entries with an unknown field → 400 (CR037 field whitelist)', async () => {
      const r = await req('POST', '/entries', {
        entry_date: '2026-03-01', amount: 100, bogus_field: 'nope',
      });
      expect(r.status).toBe(400);
      expect(r.body.error).toMatch(/unknown field/i);
    });

    test('POST /entries with a non-object element → 400', async () => {
      const r = await req('POST', '/entries', ['not-an-object']);
      expect(r.status).toBe(400);
    });

    test('POST /entries missing required amount → 400', async () => {
      const r = await req('POST', '/entries', { entry_date: '2026-03-01' });
      expect(r.status).toBe(400);
      expect(r.body.error).toMatch(/amount/i);
    });

    test('unknown path → 404 via the app 404 handler', async () => {
      const r = await req('GET', '/no-such-endpoint');
      expect(r.status).toBe(404);
    });
  });

  describe('version create → read → patch round-trip', () => {
    test('POST /versions → 201, GET /versions/:id → 200, PATCH → 200', async () => {
      const create = await req('POST', '/versions', {
        budget_year: 2099, version_name: VERSION_NAME, description: 'route test',
      });
      expect(create.status).toBe(201);
      expect(create.body.data.version_name).toBe(VERSION_NAME);
      const id = create.body.data.id;
      createdVersionIds.push(id);

      const get = await req('GET', `/versions/${id}`);
      expect(get.status).toBe(200);
      expect(get.body.data.id).toBe(id);

      const patch = await req('PATCH', `/versions/${id}`, { description: 'updated' });
      expect(patch.status).toBe(200);
      expect(patch.body.data.description).toBe('updated');
    });
  });
});
