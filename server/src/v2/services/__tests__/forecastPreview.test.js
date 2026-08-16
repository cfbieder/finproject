'use strict';
/**
 * CR084 — the save-time consequence preview.
 *
 * Two properties are worth a DB-backed test, and neither can be asserted against a mock:
 *
 *  1. **The real scenario is untouched.** A preview that writes is not a preview.
 *  2. **BOTH sides are built.** The tempting shape — read stored entries as "before", build a
 *     scratch for "after" — attributes every un-regenerated edit since the last build to the one
 *     change being previewed. Stale entries beside fresh inputs is this system's NORMAL state
 *     (`guides/infrastructure.md`), so the test deliberately leaves the real scenario's stored
 *     entries WRONG and asserts the preview ignores them.
 *
 * Plus the blast radius, which CR081 got wrong by asserting a fixed number instead of computing it.
 */
const db = require('../../db');
const preview = require('../forecastPreview');
const repo = require('../../repositories').forecast;

const describeOrSkip = process.env.SKIP_DB_TESTS ? describe.skip : describe;
const TAG = '__cr084test_';

describeOrSkip('CR084 — preview a module change', () => {
  let baseId, variantId, overriddenVariantId, moduleId, accountId, fcLineId;

  /**
   * Register / unregister a scenario in the shared assumptions DOCUMENT.
   *
   * The engine reads `FCAssump.scenarios` for PeriodStart/PeriodEnd and fails loud without it
   * ("No scenarios available in FCAssump.scenarios"), so a scenario that exists only as a
   * `forecast_scenarios` row cannot be built. These four keys are single JSON rows shared by every
   * scenario, so the test appends and then filters itself back out — the same read-modify-write
   * `copyScenario` and the scratch teardown perform.
   */
  const assumptionsDoc = async (name, mode) => {
    const rows = {
      scenarios: { Name: name, Description: 'cr084 test', IsActive: true, PeriodStart: 2027, PeriodEnd: 2032 },
      inflation: { Scenario: name, Year: 2027, Rate: 2.5 },
      'Tax Rate': { Scenario: name, Rate: 30 },
      // `fcbuilder-setup.js:139` iterates `FCAssump.FX.length` unguarded, so an absent document is
      // a TypeError rather than the loud "missing assumption" the inflation path gives — which is
      // why this read as "Cannot read properties of undefined" instead of naming what was missing.
      // The scenario's own base date is 2025-12-31 and PeriodStart is 2027, so the base-year rate
      // (PeriodStart − 1) matters: seed both years rather than only the first in-period one.
      FX: { Scenario: name, Year: 2026, Rates: { PLN: 3.9, EUR: 0.86 } },
    };
    for (const [key, row] of Object.entries(rows)) {
      const field = key === 'scenarios' ? 'Name' : 'Scenario';
      const res = await db.query('SELECT value FROM forecast_assumptions WHERE key = $1', [key]);
      const raw = res.rows[0]?.value;
      const list = Array.isArray(raw) ? raw : (raw ? JSON.parse(raw) : []);
      const without = list.filter((e) => !e || e[field] !== name);
      const next = mode === 'add' ? [...without, row] : without;
      await db.query(
        `INSERT INTO forecast_assumptions (key, value, ord) VALUES ($1, $2, 0)
         ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
        [key, JSON.stringify(next)]
      );
    }
  };

  /**
   * The cash sweep's anchor account. `Cash sweep requires a COA account named "Bank Accounts"`
   * (CR043 N9) — and this suite's own assertions read `e.Account === 'Bank Accounts'`, so it is a
   * hard dependency of the test as well as of the engine. `ci-seed.sql` does not create it.
   *
   * Seeded by NAME because the engine looks it up by name; created only when absent and removed
   * only if this suite created it, since dev and prod own a real one with the whole ledger under it.
   */
  let seededBankAccounts = false;
  const ensureBankAccounts = async () => {
    const { rows } = await db.query(`SELECT id FROM accounts WHERE name = 'Bank Accounts'`);
    if (rows.length) return;
    await db.query(
      `INSERT INTO accounts (name, account_type, section, currency, is_active)
       VALUES ('Bank Accounts', 'asset', 'balance_sheet', 'USD', TRUE)`
    );
    seededBankAccounts = true;
  };

  /**
   * `FCAssump.category` is the engine's POSITIONAL column list for the assumptions frame —
   * `[Year, Inflation, PLN, EUR, Bank Accounts]`, read by index at `index.js:268-270` — and
   * `fcbuilder-setup.js:17` throws without it. Unlike the per-scenario keys above it is
   * install-wide, so it exists on dev and on prod and NOT on a from-scratch database:
   * `ci-seed.sql` writes no `forecast_assumptions` at all.
   *
   * Seeded only when ABSENT, and removed only if this suite created it. Deleting a real one would
   * break every forecast on the database the tests happen to be pointed at.
   */
  let seededCategoryDoc = false;
  const ensureCategoryDoc = async () => {
    const { rows } = await db.query(`SELECT value FROM forecast_assumptions WHERE key = 'category'`);
    if (rows.length) return;
    await db.query(
      `INSERT INTO forecast_assumptions (key, value, ord) VALUES ('category', $1, 0)`,
      [JSON.stringify(['Year', 'Inflation', 'PLN', 'EUR', 'Bank Accounts'])]
    );
    seededCategoryDoc = true;
  };

  beforeAll(async () => {
    await ensureCategoryDoc();
    await ensureBankAccounts();
    const mkScenario = async (name, parent = null) => {
      const { rows } = await db.query(
        `INSERT INTO forecast_scenarios (name, is_active, cash_sweep_low, cash_sweep_high, parent_scenario_id)
         VALUES ($1, TRUE, 100000, 200000, $2) RETURNING id`,
        [TAG + name, parent]
      );
      return rows[0].id;
    };
    baseId = await mkScenario('base');
    await assumptionsDoc(TAG + 'base', 'add');

    // The engine posts a module's BALANCE row under its ACCOUNT name, not the module name, so a
    // module with no account posts nowhere and the preview would compare two empty sets. Created
    // here rather than borrowed from the database — Known Issue #12 is the class where a test
    // names an ambient row and passes only where that row happens to exist.
    const acct = await db.query(
      `INSERT INTO accounts (name, account_type, section, currency)
       VALUES ($1, 'asset', 'balance_sheet', 'USD') RETURNING id`,
      [TAG + 'account']
    );
    accountId = acct.rows[0].id;

    // Same reasoning as the account above, and it was missed here: the stream test borrowed
    // `SELECT id FROM fc_lines ORDER BY id LIMIT 1`, which is empty on a from-scratch database —
    // `ci-seed.sql` creates no fc_lines — so the whole suite died on `.id of undefined` in CI while
    // passing against dev. Known Issue #12 exactly, and the file's own comment two lines up is the
    // rule it broke.
    const line = await db.query(
      `INSERT INTO fc_lines (name, line_type, display_order)
       VALUES ($1, 'bs_module_expense', 9999) RETURNING id`,
      [TAG + 'line']
    );
    fcLineId = line.rows[0].id;

    variantId = await mkScenario('plain-variant', baseId);
    overriddenVariantId = await mkScenario('overridden-variant', baseId);

    const { rows } = await db.query(
      `INSERT INTO forecast_modules (scenario_id, name, module_type, currency, base_date, account_id,
                                     has_valuation, setup_status, growth_rate, market_value, market_value_usd,
                                     base_value, base_value_usd)
       VALUES ($1, $2, 'Investment', 'USD', '2025-12-31', $3, TRUE, 'complete', 1.0, 500000, 500000, 500000, 500000)
       RETURNING id`,
      [baseId, TAG + 'holding', accountId]
    );
    moduleId = rows[0].id;

    // One variant carries its own override for this module; the other does not.
    await db.query(
      `INSERT INTO forecast_scenario_overrides (scenario_id, entity_type, base_entity_id, patch)
       VALUES ($1, 'module', $2, '{"growth_rate": 2}'::jsonb)`,
      [overriddenVariantId, moduleId]
    );
  });

  afterAll(async () => {
    await assumptionsDoc(TAG + 'base', 'remove');
    await db.query(`DELETE FROM forecast_scenarios WHERE name LIKE $1`, [TAG + '%']);
    await db.query(`DELETE FROM accounts WHERE name LIKE $1`, [TAG + '%']);
    await db.query(`DELETE FROM fc_lines WHERE name LIKE $1`, [TAG + '%']);
    if (seededCategoryDoc) {
      await db.query(`DELETE FROM forecast_assumptions WHERE key = 'category'`);
    }
    if (seededBankAccounts) {
      await db.query(`DELETE FROM accounts WHERE name = 'Bank Accounts'`);
    }
  });

  describe('blastRadius', () => {
    test('separates the variants that MOVE from the ones that do not', async () => {
      // CR081 §5 asserted "a base edit propagates to four variants". Live data contradicted it: a
      // variant with its own override for that module keeps its value and the base edit reaches
      // nothing. The half worth reading is what does NOT move.
      const r = await preview.blastRadius(moduleId);
      expect(r.moves).toEqual([TAG + 'plain-variant']);
      expect(r.blocked).toEqual([
        { name: TAG + 'overridden-variant', reason: 'has its own override for this module' },
      ]);
    });

    test('a VARIANT module fans out to nothing — editing it is already an override', async () => {
      const { rows } = await db.query(
        `INSERT INTO forecast_modules (scenario_id, name, module_type, currency, base_date,
                                       has_valuation, setup_status, growth_rate)
         VALUES ($1, $2, 'Investment', 'USD', '2025-12-31', TRUE, 'complete', 1.0) RETURNING id`,
        [variantId, TAG + 'variant-local']
      );
      const r = await preview.blastRadius(rows[0].id);
      expect(r.moves).toEqual([]);
      expect(r.blocked).toEqual([]);
    });
  });

  describe('previewModuleChange', () => {
    test('leaves the real module and its scenario untouched', async () => {
      await preview.previewModuleChange({ moduleId, patch: { Growth: 9 } });

      const after = await repo.findModuleById(moduleId);
      expect(Number(after.growth_rate)).toBe(1);

      // And no scratch survived: every copy is torn down in a `finally`.
      const { rows } = await db.query(
        `SELECT count(*)::int AS n FROM forecast_scenarios WHERE name LIKE '__scratch_%'`
      );
      expect(rows[0].n).toBe(0);
    });

    test('⚠️ builds BOTH sides — a stale stored entry never reaches the "before"', async () => {
      // Poison the real scenario's stored entries with a figure no build would ever produce. If the
      // preview read stored entries as its "before", this value would appear in the result and the
      // owner would see a difference that has nothing to do with their edit.
      await db.query(
        `INSERT INTO forecast_entries (scenario_id, forecast_year, account, module, amount)
         VALUES ($1, 2030, 'Bank Accounts', 'STALE_POISON', 123456.78)`,
        [baseId]
      );

      const res = await preview.previewModuleChange({ moduleId, patch: { Growth: 2 } });

      expect(res.before.some((e) => e.Module === 'STALE_POISON')).toBe(false);
      expect(res.after.some((e) => e.Module === 'STALE_POISON')).toBe(false);
      expect(res.scenario).toBe(TAG + 'base');
      expect(res.module).toBe(TAG + 'holding');

      await db.query(`DELETE FROM forecast_entries WHERE module = 'STALE_POISON'`);
    });

    test('actually shows a DIFFERENCE — doubling growth raises the holding every year', async () => {
      // Without this the suite would pass on a preview that returned two identical builds, which is
      // the failure mode a "it ran and cleaned up" test cannot see.
      const res = await preview.previewModuleChange({ moduleId, patch: { Growth: 2 } });

      const holding = (rows) => {
        const byYear = new Map();
        for (const e of rows) {
          if (e.Module !== TAG + 'holding') continue;
          if (e.Account !== TAG + 'account') continue;   // the module posts under its ACCOUNT name
          byYear.set(Number(e.Year), Number(e.Amount));
        }
        return byYear;
      };
      const b = holding(res.before);
      const a = holding(res.after);
      expect(b.size).toBeGreaterThan(0);
      expect(a.size).toBe(b.size);

      // 1× inflation vs 2× inflation on the same 500,000: every forecast year must be higher, and
      // the gap must widen, because the two compound at different rates from the same base.
      const years = [...b.keys()].sort((x, y) => x - y);
      const gaps = years.map((y) => a.get(y) - b.get(y));
      expect(gaps.every((g) => g >= 0)).toBe(true);
      expect(gaps[gaps.length - 1]).toBeGreaterThan(gaps[0]);
      expect(gaps[gaps.length - 1]).toBeGreaterThan(1000);
    });

    test('⚠️ previews a STREAM edit — the case a column-only preview would have missed', async () => {
      // The reason `moduleBodyToColumns` was extracted rather than reimplemented. A stream amount
      // does not live on the module row at all: it is written by `replaceModuleStreams` from the
      // editor's `Streams` array. A preview that only mapped module COLUMNS would have shown "no
      // change" here, which is worse than showing nothing — the owner had just edited the amount.
      const res = await preview.previewModuleChange({
        moduleId,
        patch: {
          Streams: [
            { Direction: 'expense', FcLineId: fcLineId, Mode: 'amount', Amount: 40000, GrowthMult: 1 },
          ],
        },
      });

      const cashOut = (rows) =>
        rows.filter((e) => e.Module === TAG + 'holding' && e.Account === 'Bank Accounts')
            .reduce((sum, e) => sum + Number(e.Amount), 0);

      // The module had no expense stream; now it spends 40,000/yr. Cash out must fall.
      expect(cashOut(res.after)).toBeLessThan(cashOut(res.before));
    });

    test('refuses a module that does not exist rather than previewing nothing', async () => {
      await expect(preview.previewModuleChange({ moduleId: 99999999, patch: { Growth: 1 } }))
        .rejects.toThrow(/Module not found/);
    });
  });
});
