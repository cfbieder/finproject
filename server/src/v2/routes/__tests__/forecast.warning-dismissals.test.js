'use strict';
/**
 * CR074 — dismissing a cash-health warning.
 *
 * The warnings themselves are a pure CLIENT-side derivation, so the only thing on this side is
 * which of them the owner has accepted. What these tests pin is the part that can go wrong
 * silently:
 *
 *   - dismissals are SCOPED to a scenario, so accepting a finding on Base cannot quietly
 *     silence the same finding on Upside, where the module may carry different numbers;
 *   - re-dismissing an id REPLACES its fingerprint rather than erroring or keeping the stale
 *     one, which is what makes "I accept the new version too" expressible;
 *   - a dismissal with no fingerprint is REFUSED, because it could never expire — the one
 *     behaviour this feature must not have (CR045 §1: a quiet panel must never be mistakable
 *     for a healthy plan);
 *   - deleting a scenario takes its dismissals with it.
 *
 * DB-backed (skip with SKIP_DB_TESTS=1); self-seeding, cleans up by unique name.
 */

const { makeApp, request } = require('./_httpApp');
const router = require('../forecast');
const db = require('../../db');

const dbDescribe = process.env.SKIP_DB_TESTS ? describe.skip : describe;
const app = makeApp('/forecast', router);
const req = (m, p, b) => request(app, m, `/forecast${p}`, b);

dbDescribe('CR074 — cash-health warning dismissals (DB)', () => {
  const A = 'CR074DismissScenarioA';
  const B = 'CR074DismissScenarioB';
  const WARNING = 'disposal-no-gain-CR074 Test Module';
  const q = encodeURIComponent;

  async function cleanup() {
    await db.query('DELETE FROM forecast_scenarios WHERE name = ANY($1)', [[A, B]]);
  }

  beforeAll(async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    await cleanup();
    await db.query('INSERT INTO forecast_scenarios (name) VALUES ($1), ($2)', [A, B]);
  });

  afterAll(async () => {
    await cleanup();
    await db.close();
  });

  test('a scenario with nothing dismissed returns an empty map, not an error', async () => {
    const r = await req('GET', `/warnings/dismissals?scenario=${q(A)}`);
    expect(r.status).toBe(200);
    expect(r.body.data).toEqual({});
  });

  test('a dismissal round-trips as { warningId: fingerprint }', async () => {
    const post = await req('POST', '/warnings/dismissals', {
      scenario: A,
      items: [{ warningId: WARNING, fingerprint: 'abc12345' }],
    });
    expect(post.status).toBe(200);
    expect(post.body.data.dismissed).toBe(1);

    const r = await req('GET', `/warnings/dismissals?scenario=${q(A)}`);
    expect(r.body.data).toEqual({ [WARNING]: 'abc12345' });
  });

  test('dismissals are SCOPED — scenario B is untouched by scenario A', async () => {
    // The warning ids embed a module NAME, and the same module exists in every scenario with
    // different numbers. Accepting a finding on Base must not silence it on Upside.
    const r = await req('GET', `/warnings/dismissals?scenario=${q(B)}`);
    expect(r.body.data).toEqual({});
  });

  test('re-dismissing the same id REPLACES the fingerprint instead of failing', async () => {
    // The warning came back because its figures moved, and the owner accepted the new version.
    const post = await req('POST', '/warnings/dismissals', {
      scenario: A,
      items: [{ warningId: WARNING, fingerprint: 'deadbeef' }],
    });
    expect(post.status).toBe(200);

    const r = await req('GET', `/warnings/dismissals?scenario=${q(A)}`);
    expect(r.body.data[WARNING]).toBe('deadbeef');
    // Still ONE row — an upsert, not an accumulating log.
    const rows = (await db.query(
      `SELECT count(*)::int AS n FROM forecast_warning_dismissals d
       JOIN forecast_scenarios s ON s.id = d.scenario_id WHERE s.name = $1`, [A]
    )).rows[0].n;
    expect(rows).toBe(1);
  });

  test('"dismiss all" is ONE request carrying many items', async () => {
    // Not N racing writes against the same unique index.
    const items = ['w-one', 'w-two', 'w-three'].map((id) => ({ warningId: id, fingerprint: 'f' + id }));
    const post = await req('POST', '/warnings/dismissals', { scenario: B, items });
    expect(post.status).toBe(200);
    expect(post.body.data.dismissed).toBe(3);
    const r = await req('GET', `/warnings/dismissals?scenario=${q(B)}`);
    expect(Object.keys(r.body.data).sort()).toEqual(['w-one', 'w-three', 'w-two']);
  });

  test('a dismissal with no fingerprint is REFUSED — it could never expire', async () => {
    const r = await req('POST', '/warnings/dismissals', {
      scenario: A,
      items: [{ warningId: 'w-no-fingerprint' }],
    });
    expect(r.status).toBe(400);
    expect(String(r.body.error)).toMatch(/fingerprint/i);
    const after = await req('GET', `/warnings/dismissals?scenario=${q(A)}`);
    expect(after.body.data['w-no-fingerprint']).toBeUndefined();
  });

  test('an empty items array is refused rather than silently doing nothing', async () => {
    const r = await req('POST', '/warnings/dismissals', { scenario: A, items: [] });
    expect(r.status).toBe(400);
  });

  test('restoring ONE leaves the others dismissed', async () => {
    const r = await req('DELETE', `/warnings/dismissals?scenario=${q(B)}&warningId=${q('w-two')}`);
    expect(r.status).toBe(200);
    expect(r.body.data.restored).toBe(1);
    const after = await req('GET', `/warnings/dismissals?scenario=${q(B)}`);
    expect(Object.keys(after.body.data).sort()).toEqual(['w-one', 'w-three']);
  });

  test('restoring with no warningId clears the whole scenario — the undo for "dismiss all"', async () => {
    const r = await req('DELETE', `/warnings/dismissals?scenario=${q(B)}`);
    expect(r.status).toBe(200);
    expect(r.body.data.restored).toBe(2);
    const after = await req('GET', `/warnings/dismissals?scenario=${q(B)}`);
    expect(after.body.data).toEqual({});
    // …and only B. Scoping holds on the delete path too, which is the one that could wipe
    // another scenario's judgements irrecoverably.
    const stillA = await req('GET', `/warnings/dismissals?scenario=${q(A)}`);
    expect(stillA.body.data[WARNING]).toBe('deadbeef');
  });

  test('an unknown scenario is a 404, and a missing one a 400', async () => {
    expect((await req('GET', '/warnings/dismissals?scenario=NoSuchScenarioCR074')).status).toBe(404);
    expect((await req('GET', '/warnings/dismissals')).status).toBe(400);
  });

  test('deleting a scenario takes its dismissals with it', async () => {
    const id = (await db.query('SELECT id FROM forecast_scenarios WHERE name = $1', [B])).rows[0].id;
    await db.query('DELETE FROM forecast_scenarios WHERE name = $1', [B]);
    const orphans = (await db.query(
      'SELECT count(*)::int AS n FROM forecast_warning_dismissals WHERE scenario_id = $1', [id]
    )).rows[0].n;
    expect(orphans).toBe(0);
  });
});
