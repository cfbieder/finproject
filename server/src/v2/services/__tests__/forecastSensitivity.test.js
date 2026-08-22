'use strict';
/**
 * CR085 P1 — the parts of a sensitivity run that can be proved without an engine build.
 *
 * ⚠️ WHAT THIS FILE DOES AND DOES NOT COVER. A full run needs `generateForecast`, which needs a
 * budget, an assumptions document, fc_lines and a coherent COA — a fixture large enough that it
 * would be testing the fixture. So the build-dependent half (four knob kinds each moving the plan,
 * the anchor, the build counter, teardown after a real run) is verified against REAL data on dev
 * and recorded in the CR; everything reachable without a build is pinned here, in CI, on a
 * from-scratch database.
 *
 * DB-backed (skip with SKIP_DB_TESTS=1); self-seeding and cleans up by unique name, per the
 * ambient-data rule (roadmap known issue #12).
 */

const db = require('../../db');
const repo = require('../../repositories').forecast;
const knobs = require('../sensitivityKnobs');
const sens = require('../forecastSensitivity');

const dbDescribe = process.env.SKIP_DB_TESTS ? describe.skip : describe;

const SRC = 'ZZSensSource';
const COPY = '__scratch_ZZSensCopy';
const ASSET = 'ZZ Sens House';
const DEBT = 'ZZ Sens Mortgage';
const GONE = 'ZZ Sens Excluded';

dbDescribe('sensitivity run internals (DB)', () => {
  let srcId;
  let assetId;

  async function cleanup() {
    await db.query('DELETE FROM forecast_scenarios WHERE name = ANY($1)', [[SRC, COPY]]);
  }

  beforeAll(async () => {
    await cleanup();
    const sc = await db.query(
      'INSERT INTO forecast_scenarios (name, is_active) VALUES ($1, TRUE) RETURNING id', [SRC]
    );
    srcId = sc.rows[0].id;

    const mk = async (name, extra) => (await db.query(
      `INSERT INTO forecast_modules
         (scenario_id, name, module_type, currency, base_date, base_value, base_value_usd,
          market_value, market_value_usd, growth_rate, setup_status, has_valuation, tax_rate_override)
       VALUES ($1, $2, 'Real Estate', 'USD', '2026-12-31', $3, $3, $4, $4, $5, $6, TRUE, $7)
       RETURNING id`,
      [srcId, name, extra.base, extra.market, extra.growth, extra.status, extra.tax]
    )).rows[0].id;

    assetId = await mk(ASSET, { base: 400000, market: 500000, growth: 1.0, status: 'complete', tax: null });
    // ⚠️ A liability, stored NEGATIVE — the shape that makes "+10%" mean "more debt".
    await mk(DEBT, { base: -300000, market: -300000, growth: 0, status: 'complete', tax: null });
    await mk(GONE, { base: 100000, market: 100000, growth: 1.0, status: 'exclude', tax: null });

    await db.query(
      `INSERT INTO forecast_module_disposals (module_id, disposal_date, amount, flag, disposal_cost_pct)
       VALUES ($1, '2040-07-01', 500000, 'Full', 7.0)`, [assetId]
    );
  });

  afterAll(cleanup);

  // -------------------------------------------------------------------------

  describe('resolution by name', () => {
    it('places a knob on the one module with that name', async () => {
      const r = await knobs.resolveTarget(db, srcId, 'module', { module: ASSET });
      expect(r.row.id).toBe(assetId);
    });

    it('aborts naming the count when nothing matches', async () => {
      await expect(knobs.resolveTarget(db, srcId, 'module', { module: 'ZZ Nope' }))
        .rejects.toThrow(/holds 0 modules/);
    });

    it('⚠️ aborts when a disposal is ambiguous — that table has NO unique constraint', async () => {
      // Exact duplicate disposal rows are LEGAL (CR050 §3), so (module, date) is a usable key only
      // because the live data happens to be clean. The guard is what makes relying on it safe.
      await db.query(
        `INSERT INTO forecast_module_disposals (module_id, disposal_date, amount, flag)
         VALUES ($1, '2044-01-01', 1, 'Full'), ($1, '2044-01-01', 1, 'Full')`, [assetId]
      );
      await expect(
        knobs.resolveTarget(db, srcId, 'disposal', { module: ASSET, date: '2044-01-01' })
      ).rejects.toThrow(/2 rows match/);
      await db.query(
        "DELETE FROM forecast_module_disposals WHERE module_id = $1 AND disposal_date = '2044-01-01'",
        [assetId]
      );
    });
  });

  describe('apply and restore', () => {
    const knob = (field, extra = {}) => ({ entity: 'module', target: { module: ASSET }, field, ...extra });

    it('restores the prior value EXACTLY, including both currency columns', async () => {
      const before = (await db.query(
        'SELECT market_value, market_value_usd FROM forecast_modules WHERE id = $1', [assetId]
      )).rows[0];

      const { restore } = await knobs.applyKnob(db, srcId, knob('market_value', { band: 10 }), 'high');
      const during = (await db.query(
        'SELECT market_value, market_value_usd FROM forecast_modules WHERE id = $1', [assetId]
      )).rows[0];
      expect(Number(during.market_value)).toBeCloseTo(550000, 2);
      expect(Number(during.market_value_usd)).toBeCloseTo(550000, 2);

      await restore();
      const after = (await db.query(
        'SELECT market_value, market_value_usd FROM forecast_modules WHERE id = $1', [assetId]
      )).rows[0];
      // String equality, not numeric: a restore that lands on 499999.99 would pass toBeCloseTo and
      // still poison every later point in the run.
      expect(String(after.market_value)).toBe(String(before.market_value));
      expect(String(after.market_value_usd)).toBe(String(before.market_value_usd));
    });

    it('⚠️ restores a NULL as NULL, not as 0', async () => {
      // `tax_rate_override` NULL means "use the scenario rate". Restoring it as 0 would silently
      // leave the module tax-free for every later point in the run.
      const { restore } = await knobs.applyKnob(
        db, srcId, knob('tax_rate_override', { band: 1 }), 'high', { scenarioRate: 23 }
      );
      const during = (await db.query(
        'SELECT tax_rate_override FROM forecast_modules WHERE id = $1', [assetId]
      )).rows[0];
      expect(Number(during.tax_rate_override)).toBe(24);

      await restore();
      const after = (await db.query(
        'SELECT tax_rate_override FROM forecast_modules WHERE id = $1', [assetId]
      )).rows[0];
      expect(after.tax_rate_override).toBeNull();
    });

    it('⚠️ refuses ANY knob under an excluded module, not just a module field', async () => {
      // Found on the first live run: a ±2y shift of an excluded module's disposal wrote fine,
      // built fine and moved NOTHING — a zero-length bar reading "this assumption does not
      // matter" when the truth was "this module is not in the plan". The first version of the
      // guard tested the module entity only and let both child entities through.
      await expect(
        knobs.applyKnob(db, srcId, { entity: 'module', target: { module: GONE }, field: 'growth_rate' }, 'high')
      ).rejects.toThrow(/not in the plan/);

      const goneId = (await db.query(
        'SELECT id FROM forecast_modules WHERE scenario_id = $1 AND name = $2', [srcId, GONE]
      )).rows[0].id;
      await db.query(
        `INSERT INTO forecast_module_disposals (module_id, disposal_date, amount, flag)
         VALUES ($1, '2041-07-01', 1000, 'Full')`, [goneId]
      );
      await expect(
        knobs.applyKnob(
          db, srcId,
          { entity: 'disposal', target: { module: GONE, date: '2041-07-01' }, field: 'disposal_date', band: 2 },
          'high'
        )
      ).rejects.toThrow(/not in the plan/);
    });
  });

  describe('the drift detector', () => {
    it('the fingerprint moves on a write and returns on the restore', async () => {
      const before = await sens.inputFingerprint(srcId);
      const { restore } = await knobs.applyKnob(
        db, srcId, { entity: 'module', target: { module: ASSET }, field: 'growth_rate', band: 0.25 }, 'high'
      );
      expect(await sens.inputFingerprint(srcId)).not.toBe(before);
      await restore();
      expect(await sens.inputFingerprint(srcId)).toBe(before);
    });
  });

  describe('the fidelity gate', () => {
    it('passes on a real copy', async () => {
      const copy = await repo.copyScenario(srcId, COPY, { isScratch: true });
      await expect(sens.assertCopyFidelity(srcId, copy.id)).resolves.toBeUndefined();
    });

    it('⚠️ fires when a copied value does not match its source', async () => {
      // This stands in for the real defect: `copyScenario` once dropped `disposal_cost_pct`, and a
      // scratch copy of `2026 SRQ House Purchase` read ~890K BETTER than the original with nothing
      // to show for it. The gate must stop the run rather than rank numbers off a plan that is not
      // the owner's.
      const copyId = (await db.query('SELECT id FROM forecast_scenarios WHERE name = $1', [COPY])).rows[0].id;
      await db.query(
        `UPDATE forecast_module_disposals d SET disposal_cost_pct = NULL
           FROM forecast_modules m
          WHERE m.id = d.module_id AND m.scenario_id = $1`, [copyId]
      );
      await expect(sens.assertCopyFidelity(srcId, copyId)).rejects.toThrow(/did not survive the copy/);
    });
  });

  describe('the caps', () => {
    it('refuses more knobs than the cap, and says runs compose', async () => {
      const many = Array.from({ length: sens.MAX_KNOBS + 1 }, () => ({
        entity: 'module', target: { module: ASSET }, field: 'growth_rate',
      }));
      await expect(sens.runSensitivity({ scenarioName: SRC, knobs: many }))
        .rejects.toThrow(/exceeds the cap/);
    });

    it('refuses an empty knob list rather than running a pointless build', async () => {
      await expect(sens.runSensitivity({ scenarioName: SRC, knobs: [] }))
        .rejects.toThrow(/at least one knob/);
    });
  });
});
