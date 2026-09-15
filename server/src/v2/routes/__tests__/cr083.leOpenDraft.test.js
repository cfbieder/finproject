'use strict';
/**
 * CR083 — the current month's LE stays a draft all month (owner, 2026-09-15), and the
 * month-end order is finalise → FX recalculate → cut the next LE. So creating or
 * re-cutting an LE while one for the year is still a draft is refused (409, and the
 * sentence names it — the error handler sends no `code`); otherwise the older draft is silently never frozen,
 * which is how prod held two 2026 drafts. DB-backed; self-seeding in 1974.
 */

const { makeApp, request } = require('./_httpApp');
const router = require('../budget');
const leRepo = require('../../repositories/budgetLe');
const db = require('../../db');

const dbDescribe = process.env.SKIP_DB_TESTS ? describe.skip : describe;
const app = makeApp('/budget', router);
const req = (m, p, b) => request(app, m, `/budget${p}`, b);

const YEAR = 1974;

dbDescribe('CR083 one open draft per year (DB)', () => {
  const cleanup = () => db.query(`DELETE FROM budget_le WHERE budget_year = $1`, [YEAR]);

  beforeAll(async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    await cleanup();
  });

  afterAll(async () => {
    await cleanup();
    await db.close();
  });

  test('🔴 a second cut is refused while the first is a draft, and allowed once it is final', async () => {
    const march = await req('POST', '/le', { budgetYear: YEAR, actualThrough: `${YEAR}-03-31` });
    expect(march.status).toBe(201);
    const marchName = march.body.data.name;

    const refused = await req('POST', '/le', { budgetYear: YEAR, actualThrough: `${YEAR}-04-30` });
    expect(refused.status).toBe(409);
    expect(refused.body.error).toMatch(/still a draft/);
    expect(refused.body.error).toContain(marchName);
    expect((await leRepo.findAll({ budgetYear: YEAR })).length).toBe(1); // nothing was written

    expect((await req('POST', `/le/${march.body.data.id}/finalize`, {})).status).toBe(200);
    const april = await req('POST', '/le', { budgetYear: YEAR, actualThrough: `${YEAR}-04-30` });
    expect(april.status).toBe(201);
  });

  test('a re-cut is refused while another LE for the year is a draft; the final LE is untouched', async () => {
    const all = await leRepo.findAll({ budgetYear: YEAR });
    const final = all.find((le) => le.status === 'final');
    const draft = all.find((le) => le.status === 'draft');

    const r = await req('POST', `/le/${final.id}/recut`, {});
    expect(r.status).toBe(409);
    expect(r.body.error).toMatch(/still a draft/);
    expect(r.body.error).toContain(draft.name);
    expect((await leRepo.findById(final.id)).status).toBe('final');
  });
});
