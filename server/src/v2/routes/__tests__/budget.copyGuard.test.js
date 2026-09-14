'use strict';
/**
 * POST /budget/versions/:id/copy refuses a year that already has a version.
 *
 * Every aggregate reader of budget_entries filters on budget_year and ignores version_id,
 * so a second version in one year silently doubles every budget figure — including the
 * CR075 forecast base year, which rides all 36 modelled years. DB-backed (skip with
 * SKIP_DB_TESTS=1); self-seeding in far-future years, cleaned up by name.
 */

const { makeApp, request } = require('./_httpApp');
const router = require('../budget');
const db = require('../../db');

const dbDescribe = process.env.SKIP_DB_TESTS ? describe.skip : describe;
const app = makeApp('/budget', router);
const req = (m, p, b) => request(app, m, `/budget${p}`, b);

dbDescribe('budget version copy guard (DB)', () => {
  const VERSION_NAME = 'Copy Guard Test Budget';

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

  test('a copy into the SAME year → 409, and no second version is created', async () => {
    const create = await req('POST', '/versions', { budget_year: 2097, version_name: VERSION_NAME });
    expect(create.status).toBe(201);

    const copy = await req('POST', `/versions/${create.body.data.id}/copy`, {
      budget_year: 2097, version_name: VERSION_NAME,
    });
    expect(copy.status).toBe(409);
    expect(copy.body.error).toMatch(/already has a version/);

    const { rows } = await db.query('SELECT COUNT(*)::int AS n FROM budget_versions WHERE budget_year = 2097');
    expect(rows[0].n).toBe(1);
  });

  test('a copy into an EMPTY year still works → 201', async () => {
    const create = await req('POST', '/versions', { budget_year: 2096, version_name: VERSION_NAME });
    const copy = await req('POST', `/versions/${create.body.data.id}/copy`, {
      budget_year: 2095, version_name: VERSION_NAME,
    });
    expect(copy.status).toBe(201);
    expect(copy.body.data.budget_year).toBe(2095);
  });
});
