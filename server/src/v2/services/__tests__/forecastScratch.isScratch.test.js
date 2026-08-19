'use strict';
/**
 * CR085 P0 — a throwaway copy must be INVISIBLE, and must be removable after the process that
 * made it has gone.
 *
 * Both halves failed before migration 073. `copyScenario` inserts `is_active = TRUE` and
 * `findAllScenarios` filtered on nothing else, so a scratch scenario appeared in every scenario
 * picker in the app for as long as it existed — and if the process died between the copy and the
 * teardown, forever. Recorded as open in CR084 §9.2.
 *
 * ⚠️ `sweepStaleScratch` is GLOBAL by design: it cannot tell one leaked scratch from another, only
 * old from new. The test calls it with a zero-minute threshold, which would also remove a scratch
 * belonging to a run happening at that moment. That is safe here because the backend suite is meant
 * to run against a throwaway database (`Scripts/test-fresh-db.sh`), not against dev.
 *
 * DB-backed (skip with SKIP_DB_TESTS=1); self-seeding and cleans up by unique name, per the
 * ambient-data rule (roadmap known issue #12).
 */

const db = require('../../db');
const repo = require('../../repositories').forecast;
const { sweepStaleScratch } = require('../forecastScratch');

const dbDescribe = process.env.SKIP_DB_TESTS ? describe.skip : describe;

const SRC = 'ZZScratchFlagSource';
const PLAIN = 'ZZScratchFlagPlainCopy';
const SCRATCH = '__scratch_ZZScratchFlagCopy';

dbDescribe('a scratch copy is flagged, hidden and sweepable (DB)', () => {
  let srcId;

  async function cleanup() {
    await db.query('DELETE FROM forecast_scenarios WHERE name = ANY($1)', [[SRC, PLAIN, SCRATCH]]);
  }

  const names = async (opts) => (await repo.findAllScenarios(opts)).map((s) => s.name);

  beforeAll(async () => {
    await cleanup();
    const r = await db.query(
      'INSERT INTO forecast_scenarios (name, is_active) VALUES ($1, TRUE) RETURNING id', [SRC]
    );
    srcId = r.rows[0].id;
  });

  afterAll(cleanup);

  it('an ordinary copy is NOT scratch and stays visible', async () => {
    const copy = await repo.copyScenario(srcId, PLAIN);
    const { rows } = await db.query('SELECT is_scratch FROM forecast_scenarios WHERE id = $1', [copy.id]);
    expect(rows[0].is_scratch).toBe(false);
    expect(await names()).toContain(PLAIN);
  });

  it('a scratch copy is flagged and hidden from EVERY listing', async () => {
    const copy = await repo.copyScenario(srcId, SCRATCH, { isScratch: true });
    const { rows } = await db.query('SELECT is_scratch FROM forecast_scenarios WHERE id = $1', [copy.id]);
    expect(rows[0].is_scratch).toBe(true);

    // Both branches of the listing, because `activeOnly: false` is the one a "show me everything"
    // caller would reach for and it is exactly where a leaked scratch would resurface.
    expect(await names()).not.toContain(SCRATCH);
    expect(await names({ activeOnly: false })).not.toContain(SCRATCH);
    // The guard against a filter that hides everything.
    expect(await names({ activeOnly: false })).toContain(SRC);
  });

  it('the stale sweep removes the scratch and leaves real scenarios alone', async () => {
    const before = await db.query('SELECT id FROM forecast_scenarios WHERE name = $1', [SCRATCH]);
    expect(before.rows).toHaveLength(1);

    await sweepStaleScratch(0);

    const after = await db.query('SELECT id FROM forecast_scenarios WHERE name = $1', [SCRATCH]);
    expect(after.rows).toHaveLength(0);
    expect(await names({ activeOnly: false })).toEqual(expect.arrayContaining([SRC, PLAIN]));
  });
});
