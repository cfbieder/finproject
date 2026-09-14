'use strict';
/**
 * CR083 P0b — the four LE lifecycle routes over HTTP: 404s, the `{ data }`
 * envelope, and the status each wrong-state call maps to (409, and 400 for a cut
 * the schema would refuse — never a raw Postgres 500). DB-backed; self-seeding in
 * 1978, which no database holds data for.
 */

const { makeApp, request } = require('./_httpApp');
const router = require('../budget');
const leRepo = require('../../repositories/budgetLe');
const db = require('../../db');

const dbDescribe = process.env.SKIP_DB_TESTS ? describe.skip : describe;
const app = makeApp('/budget', router);
const req = (m, p, b) => request(app, m, `/budget${p}`, b);

const YEAR = 1978;

dbDescribe('CR083 LE lifecycle routes (DB)', () => {
  const cleanup = () => db.query(`DELETE FROM budget_le WHERE budget_year = $1`, [YEAR]);

  beforeAll(async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    await cleanup();
  });

  afterAll(async () => {
    await cleanup();
    await db.close();
  });

  test('an unknown id is 404 on finalize, recut, drift and advisories', async () => {
    for (const [method, path] of [
      ['POST', '/le/999999999/finalize'],
      ['POST', '/le/999999999/recut'],
      ['GET', '/le/999999999/drift'],
      ['GET', '/le/999999999/advisories'],
    ]) {
      const r = await req(method, path, method === 'POST' ? {} : undefined);
      expect(r.status).toBe(404);
    }
  });

  test('envelopes and wrong-state mapping on a real LE', async () => {
    const le = await leRepo.create({ budgetYear: YEAR, actualThrough: `${YEAR}-03-31` });

    const adv = await req('GET', `/le/${le.id}/advisories`);
    expect(adv.status).toBe(200);
    expect(adv.body.data.advisories.map((a) => a.id)).toEqual(['L1', 'L4']);

    const drift = await req('GET', `/le/${le.id}/drift`);
    expect(drift.status).toBe(200);
    expect(Array.isArray(drift.body.data.months)).toBe(true);

    expect((await req('POST', `/le/${le.id}/recut`, {})).status).toBe(409); // a draft cannot be re-cut

    const fin = await req('POST', `/le/${le.id}/finalize`, {});
    expect(fin.status).toBe(200);
    expect(fin.body.data.status).toBe('final');
    expect((await req('POST', `/le/${le.id}/finalize`, {})).status).toBe(409);

    const badCut = await req('POST', `/le/${le.id}/recut`, { actualThrough: `${YEAR}-03-15` });
    expect(badCut.status).toBe(400);

    const del = await req('DELETE', `/le/${le.id}`);
    expect(del.status).toBe(200);
    expect(del.body.data).toEqual({ deleted: true, restored: null });
  });
});
