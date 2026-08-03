'use strict';
/**
 * forecastVariants.test.js — CR050 scenario variants (inherit-unless-overridden).
 *
 * DB-backed (skip with SKIP_DB_TESTS=1); needs dev Postgres on :5434 via DATABASE_URL. Seeds a
 * throwaway base scenario, cleans up by unique name — never TRUNCATE.
 *
 * The anchor test is PARITY: a variant with zero overrides must be an exact twin of its base,
 * column for column, derived from information_schema. That is the cheapest possible proof that
 * sync did not silently drop a field — the bug that has bitten the deep-copy path twice (CR045 §1
 * dropped cash_sweep_priority ⇒ every copied scenario ran unswept; CR048 dropped the assumptions
 * ⇒ copies ran at 0% inflation). A variant that inherits a HOLE is worse than a copy that does.
 */

const variants = require('../forecastVariants');
const repo = require('../../repositories/forecast');
const crud = require('../../../services/forecast/crud');
const assumpRepo = require('../../repositories/forecastAssumptions');
const db = require('../../db');

const dbDescribe = process.env.SKIP_DB_TESTS ? describe.skip : describe;

const BASE = 'CR050 Test Base';
const VARIANT = 'CR050 Test Downside';

dbDescribe('forecastVariants (DB)', () => {
  let baseId;
  let variantId;
  let baseModA; // ranked primary, has schedules
  let baseModB;
  let baseItem;

  /** Every column sync is responsible for — straight from the catalog, never hand-listed. */
  async function syncableColumns(table) {
    const res = await db.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = $1`,
      [table]
    );
    return res.rows
      .map((r) => r.column_name)
      .filter((c) => !['id', 'scenario_id', 'created_at', 'updated_at', 'origin_base_id'].includes(c));
  }

  async function rowsOf(table, scenarioId) {
    const res = await db.query(
      `SELECT * FROM ${table} WHERE scenario_id = $1 ORDER BY name`, [scenarioId]
    );
    return res.rows;
  }

  async function cleanup() {
    // Variants first — the base is FK-protected (ON DELETE RESTRICT) while they exist.
    await db.query(
      `DELETE FROM forecast_scenarios WHERE parent_scenario_id IN
         (SELECT id FROM forecast_scenarios WHERE name IN ($1, $2))`,
      [BASE, VARIANT]
    );
    await db.query('DELETE FROM forecast_scenarios WHERE name IN ($1, $2)', [BASE, VARIANT]);
  }

  beforeAll(async () => {
    await cleanup();

    const base = await db.query(
      `INSERT INTO forecast_scenarios (name, description, is_active, cash_sweep_low, cash_sweep_high)
       VALUES ($1, 'CR050 fixture', TRUE, 100000, 200000) RETURNING id`,
      [BASE]
    );
    baseId = base.rows[0].id;

    const modA = await db.query(
      `INSERT INTO forecast_modules
         (scenario_id, name, module_type, currency, base_date, base_value, market_value,
          base_value_usd, market_value_usd, growth_rate, income_amount, expense_amount,
          setup_status, cash_sweep_priority, cash_sweep_target, tax_rate_override,
          income_tax_rate_override, income_start_date)
       VALUES ($1, 'Fixture Stocks', 'asset', 'USD', '2025-12-31', 500000, 600000, 500000, 600000,
               4.0, 12000, 500, 'ready', 1, TRUE, 22.5, 3.0, '2030-07-01')
       RETURNING id`,
      [baseId]
    );
    baseModA = modA.rows[0].id;

    const modB = await db.query(
      `INSERT INTO forecast_modules
         (scenario_id, name, module_type, currency, base_date, base_value, market_value,
          base_value_usd, market_value_usd, growth_rate, setup_status, cash_sweep_priority)
       VALUES ($1, 'Fixture House', 'asset', 'PLN', '2025-12-31', 300000, 300000, 75000, 75000,
               2.0, 'ready', 2)
       RETURNING id`,
      [baseId]
    );
    baseModB = modB.rows[0].id;

    await db.query(
      `INSERT INTO forecast_module_disposals (module_id, disposal_date, amount, flag, note)
       VALUES ($1, '2040-07-01', 100000, 'Partial', 'fixture')`,
      [baseModA]
    );
    await db.query(
      `INSERT INTO forecast_module_income_pct (module_id, effective_date, value)
       VALUES ($1, '2027-01-01', 1.5)`,
      [baseModA]
    );

    const item = await db.query(
      `INSERT INTO forecast_income_expense
         (scenario_id, name, item_type, currency, base_date, base_value, base_value_usd,
          growth_rate, setup_status)
       VALUES ($1, 'Fixture Living Costs', 'expense', 'USD', '2025-12-31', 90000, 90000, 0, 'ready')
       RETURNING id`,
      [baseId]
    );
    baseItem = item.rows[0].id;
    await db.query(
      `INSERT INTO forecast_incexp_changes (incexp_id, change_date, amount, flag)
       VALUES ($1, '2035-07-01', -10000, 'Step')`,
      [baseItem]
    );

    const variant = await variants.createVariant(baseId, { name: VARIANT });
    variantId = variant.id;
  });

  afterAll(async () => {
    await cleanup();
    await db.close();
  });

  // -------------------------------------------------------------------------
  // Parity — the anchor
  // -------------------------------------------------------------------------

  test('a variant with zero overrides is an exact twin of its base, column for column', async () => {
    for (const table of ['forecast_modules', 'forecast_income_expense']) {
      const cols = await syncableColumns(table);
      const baseRows = await rowsOf(table, baseId);
      const variantRows = await rowsOf(table, variantId);

      expect(variantRows).toHaveLength(baseRows.length);

      // Report EVERY column that differs, not just the first — a dropped column is the failure
      // this test exists to catch, and one at a time would hide the rest.
      const differences = [];
      baseRows.forEach((b, i) => {
        for (const col of cols) {
          if (!variants.valuesEqual(b[col], variantRows[i][col])) {
            differences.push(`${table}.${col} on "${b.name}": base=${b[col]} variant=${variantRows[i][col]}`);
          }
        }
      });
      expect(differences).toEqual([]);
    }
  });

  test('the parity check actually covers the columns the copy path has historically dropped', async () => {
    // A canary on the canary: if syncableColumns ever stopped seeing these, the test above would
    // pass vacuously — which is exactly how CR045 §1 and CR048 shipped.
    const cols = await syncableColumns('forecast_modules');
    expect(cols).toEqual(expect.arrayContaining([
      'cash_sweep_priority', 'cash_sweep_target', 'income_tax_rate_override',
      'tax_rate_override', 'income_start_date', 'setup_status',
    ]));
  });

  test('schedules are inherited whole', async () => {
    const vModA = (await db.query(
      'SELECT id FROM forecast_modules WHERE scenario_id = $1 AND origin_base_id = $2',
      [variantId, baseModA]
    )).rows[0];

    const disposals = await db.query(
      'SELECT * FROM forecast_module_disposals WHERE module_id = $1', [vModA.id]
    );
    expect(disposals.rows).toHaveLength(1);
    expect(Number(disposals.rows[0].amount)).toBe(100000);

    const pct = await db.query(
      'SELECT * FROM forecast_module_income_pct WHERE module_id = $1', [vModA.id]
    );
    expect(pct.rows).toHaveLength(1);
  });

  // -------------------------------------------------------------------------
  // The point of the whole CR: field-level carry-through
  // -------------------------------------------------------------------------

  test('an override pins one field; a later change to ANOTHER field in the base still carries', async () => {
    const vMod = (await db.query(
      'SELECT id FROM forecast_modules WHERE scenario_id = $1 AND origin_base_id = $2',
      [variantId, baseModA]
    )).rows[0];

    // Override growth on the variant (through the normal edit path — repo.updateModule).
    await repo.updateModule(vMod.id, { growth_rate: 1.0 });

    // The base must be untouched: an edit on a variant is an override, not a write-through.
    const baseAfter = (await db.query('SELECT * FROM forecast_modules WHERE id = $1', [baseModA])).rows[0];
    expect(Number(baseAfter.growth_rate)).toBe(4);

    // Now change a DIFFERENT field in the base.
    await repo.updateModule(baseModA, { income_amount: 15000 });
    await variants.syncVariant(variantId, { force: true });

    const after = (await db.query('SELECT * FROM forecast_modules WHERE id = $1', [vMod.id])).rows[0];
    expect(Number(after.growth_rate)).toBe(1);      // pinned by the override
    expect(Number(after.income_amount)).toBe(15000); // inherited from the base
  });

  test('reverting a field restores the base value; re-typing the base value drops the override', async () => {
    await variants.clearOverride(variantId, 'module', baseModA, 'growth_rate');

    const after = (await db.query(
      'SELECT * FROM forecast_modules WHERE scenario_id = $1 AND origin_base_id = $2',
      [variantId, baseModA]
    )).rows[0];
    expect(Number(after.growth_rate)).toBe(4);

    const overrides = await variants.listOverrides(variantId);
    expect(overrides.filter((o) => o.base_entity_id === baseModA)).toHaveLength(0);

    // Setting a field to the value it already has in the base must NOT leave a phantom override
    // pinning it forever — an override has to mean "different".
    await repo.updateModule(after.id, { growth_rate: 4.0 });
    expect(await variants.listOverrides(variantId)).toHaveLength(0);
  });

  test('a save that changes nothing writes NO override — dates are compared as calendar days', async () => {
    // The regression this pins: the module edit form sends BaseDate as new Date(x).toISOString()
    // — UTC midnight — while node-postgres parses the DATE column into a Date at LOCAL midnight.
    // Same calendar day, different epoch, so equality said "changed" and every save wrote a
    // phantom base_date override, plus a phantom income_pct one via its effective_date. The owner
    // changed ONE field (growth 1.0 → 2.0) and the panel showed THREE.
    const vMod = (await db.query(
      'SELECT * FROM forecast_modules WHERE scenario_id = $1 AND origin_base_id = $2',
      [variantId, baseModA]
    )).rows[0];

    const asFormWouldSend = (d) => new Date(d).toISOString(); // 2025-12-31 → 2025-12-31T00:00:00.000Z

    await repo.updateModule(vMod.id, { base_date: asFormWouldSend(vMod.base_date) });
    await crud.replaceModuleSchedules(vMod.id, {
      IncomePct: [{ Date: asFormWouldSend('2027-01-01'), Amount: 1.5 }], // identical to the base's
    });

    expect(await variants.listOverrides(variantId)).toHaveLength(0);

    // And the real change alongside them still lands — one field, one override.
    await repo.updateModule(vMod.id, {
      base_date: asFormWouldSend(vMod.base_date),
      growth_rate: 2.0,
    });
    const overrides = await variants.listOverrides(variantId);
    expect(overrides).toHaveLength(1);
    expect(Object.keys(overrides[0].patch)).toEqual(['growth_rate']);

    await variants.clearOverride(variantId, 'module', baseModA);
  });

  test('float noise from the form is not a change — values compare at the column\'s own scale', async () => {
    // The regression: the edit form derives market_value_usd by dividing a local-currency amount by
    // an FX rate, so it arrives as 4175594.9999999995. The column is numeric(15,2) — once stored it
    // IS 4175595.00, identical to the base. Comparing the raw float wrote an override that read
    // "Market Value (USD): 4175595 → 4175595".
    const vMod = (await db.query(
      'SELECT * FROM forecast_modules WHERE scenario_id = $1 AND origin_base_id = $2',
      [variantId, baseModA]
    )).rows[0];
    const stored = Number(vMod.market_value_usd); // 600000.00

    await repo.updateModule(vMod.id, { market_value_usd: stored - 0.0000000005 });
    expect(await variants.listOverrides(variantId)).toHaveLength(0);

    // A change at the column's scale is still a change.
    await repo.updateModule(vMod.id, { market_value_usd: stored + 0.01 });
    const overrides = await variants.listOverrides(variantId);
    expect(overrides).toHaveLength(1);
    expect(overrides[0].patch.market_value_usd).toBe(stored + 0.01);

    await variants.clearOverride(variantId, 'module', baseModA);
  });

  test('sync PRUNES a patch key that no longer differs from the base (self-heal)', async () => {
    // Repairs patches written before the date fix — and the case where the BASE later changes to
    // match an override, which no write path would otherwise notice.
    await db.query(
      `INSERT INTO forecast_scenario_overrides (scenario_id, entity_type, base_entity_id, patch)
       VALUES ($1, 'module', $2, $3::jsonb)`,
      [variantId, baseModA, JSON.stringify({ base_date: '2025-12-31T00:00:00.000Z', growth_rate: 9 })]
    );

    await variants.syncVariant(variantId, { force: true });

    const overrides = await variants.listOverrides(variantId);
    expect(overrides).toHaveLength(1);
    expect(Object.keys(overrides[0].patch)).toEqual(['growth_rate']); // base_date pruned away

    await variants.clearOverride(variantId, 'module', baseModA);
    expect(await variants.listOverrides(variantId)).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Tombstones, local rows, idempotence
  // -------------------------------------------------------------------------

  test('deleting an inherited row tombstones it — gone from the variant, kept in the base, and it stays gone', async () => {
    const vModB = (await db.query(
      'SELECT id FROM forecast_modules WHERE scenario_id = $1 AND origin_base_id = $2',
      [variantId, baseModB]
    )).rows[0];

    await repo.deleteModule(vModB.id);

    expect((await db.query('SELECT id FROM forecast_modules WHERE id = $1', [vModB.id])).rows).toHaveLength(0);
    expect((await db.query('SELECT id FROM forecast_modules WHERE id = $1', [baseModB])).rows).toHaveLength(1);

    await variants.syncVariant(variantId, { force: true }); // must not resurrect it
    const back = await db.query(
      'SELECT id FROM forecast_modules WHERE scenario_id = $1 AND origin_base_id = $2',
      [variantId, baseModB]
    );
    expect(back.rows).toHaveLength(0);

    await variants.clearOverride(variantId, 'module', baseModB); // un-hide
    const restored = await db.query(
      'SELECT * FROM forecast_modules WHERE scenario_id = $1 AND origin_base_id = $2',
      [variantId, baseModB]
    );
    expect(restored.rows).toHaveLength(1);
    expect(restored.rows[0].name).toBe('Fixture House');
  });

  test('a variant-local row survives sync, and the base never sees it', async () => {
    const local = await db.query(
      `INSERT INTO forecast_modules (scenario_id, name, module_type, currency, base_date,
         base_value, market_value, base_value_usd, market_value_usd, growth_rate, setup_status)
       VALUES ($1, 'Fixture Downside-Only', 'asset', 'USD', '2025-12-31', 1, 1, 1, 1, 0, 'ready')
       RETURNING id`,
      [variantId]
    );

    await variants.syncVariant(variantId, { force: true });

    const still = await db.query('SELECT origin_base_id FROM forecast_modules WHERE id = $1', [local.rows[0].id]);
    expect(still.rows).toHaveLength(1);
    expect(still.rows[0].origin_base_id).toBeNull();

    const inBase = await db.query(
      'SELECT id FROM forecast_modules WHERE scenario_id = $1 AND name = $2',
      [baseId, 'Fixture Downside-Only']
    );
    expect(inBase.rows).toHaveLength(0);

    await db.query('DELETE FROM forecast_modules WHERE id = $1', [local.rows[0].id]);
  });

  test('sync is idempotent and keeps surrogate ids stable', async () => {
    const before = await rowsOf('forecast_modules', variantId);
    await variants.syncVariant(variantId, { force: true });
    await variants.syncVariant(variantId, { force: true });
    const after = await rowsOf('forecast_modules', variantId);

    expect(after.map((r) => r.id)).toEqual(before.map((r) => r.id));
    expect(after.map((r) => r.name)).toEqual(before.map((r) => r.name));
  });

  // -------------------------------------------------------------------------
  // No silent overwrite — every bypass write path
  // -------------------------------------------------------------------------

  test('a schedule edit on a variant becomes an override, and survives the next sync', async () => {
    const vMod = (await db.query(
      'SELECT id FROM forecast_modules WHERE scenario_id = $1 AND origin_base_id = $2',
      [variantId, baseModA]
    )).rows[0];

    await crud.replaceModuleSchedules(vMod.id, {
      Dispose: [{ Date: '2045-07-01', Amount: 250000, Flag: 'Full', Note: 'downside sale' }],
    });
    await variants.syncVariant(variantId, { force: true });

    const disposals = await db.query(
      'SELECT * FROM forecast_module_disposals WHERE module_id = $1', [vMod.id]
    );
    expect(disposals.rows).toHaveLength(1);
    expect(Number(disposals.rows[0].amount)).toBe(250000);

    // The base keeps its own schedule.
    const baseDisposals = await db.query(
      'SELECT * FROM forecast_module_disposals WHERE module_id = $1', [baseModA]
    );
    expect(Number(baseDisposals.rows[0].amount)).toBe(100000);

    await variants.clearOverride(variantId, 'module', baseModA);
  });

  test('bulk-update on a variant goes through the same interception (it calls repo.updateModule)', async () => {
    const vMod = (await db.query(
      'SELECT id FROM forecast_modules WHERE scenario_id = $1 AND origin_base_id = $2',
      [variantId, baseModA]
    )).rows[0];

    await repo.updateModule(vMod.id, { market_value: 999000 }); // what bulk-update does, per row
    await variants.syncVariant(variantId, { force: true });

    const after = (await db.query('SELECT market_value FROM forecast_modules WHERE id = $1', [vMod.id])).rows[0];
    expect(Number(after.market_value)).toBe(999000); // not erased by the sync

    const base = (await db.query('SELECT market_value FROM forecast_modules WHERE id = $1', [baseModA])).rows[0];
    expect(Number(base.market_value)).toBe(600000);

    await variants.clearOverride(variantId, 'module', baseModA);
  });

  test('refresh-from-actuals is refused on a variant rather than silently erased', async () => {
    // A set-based UPDATE across the scenario: it bypasses repo.updateModule entirely, so the next
    // sync would wipe it. Re-basing from the ledger is the BASE's job.
    await expect(crud.refreshModulesFromActuals(variantId, '2025-12-31')).rejects.toThrow(/not available on a variant/i);
    await expect(crud.refreshModulesFromActuals(baseId, '2025-12-31')).resolves.toBeDefined();
  });

  // -------------------------------------------------------------------------
  // Scenario-unique sweep flags
  // -------------------------------------------------------------------------

  test('overriding the sweep primary displaces the inherited one instead of tripping the unique index', async () => {
    const vModB = (await db.query(
      'SELECT id FROM forecast_modules WHERE scenario_id = $1 AND origin_base_id = $2',
      [variantId, baseModB]
    )).rows[0];

    // Fixture House takes rank 1 in the variant. Fixture Stocks holds it in the base — inherited,
    // so it must yield rather than collide.
    await repo.updateModule(vModB.id, { cash_sweep_priority: 1, cash_sweep_target: true });
    await variants.syncVariant(variantId, { force: true });

    const rows = await rowsOf('forecast_modules', variantId);
    const house = rows.find((r) => r.name === 'Fixture House');
    const stocks = rows.find((r) => r.name === 'Fixture Stocks');
    expect(house.cash_sweep_priority).toBe(1);
    expect(stocks.cash_sweep_priority).toBeNull(); // displaced
    expect(rows.filter((r) => r.cash_sweep_target).length).toBeLessThanOrEqual(1);

    // The base is untouched.
    const baseStocks = (await db.query('SELECT * FROM forecast_modules WHERE id = $1', [baseModA])).rows[0];
    expect(baseStocks.cash_sweep_priority).toBe(1);

    await variants.clearOverride(variantId, 'module', baseModB);
  });

  // -------------------------------------------------------------------------
  // Base-side lifecycle
  // -------------------------------------------------------------------------

  test('a new module in the base flows into the variant', async () => {
    const added = await db.query(
      `INSERT INTO forecast_modules (scenario_id, name, module_type, currency, base_date,
         base_value, market_value, base_value_usd, market_value_usd, growth_rate, setup_status)
       VALUES ($1, 'Fixture Late Arrival', 'asset', 'USD', '2025-12-31', 10, 10, 10, 10, 1, 'ready')
       RETURNING id`,
      [baseId]
    );

    await variants.syncVariant(variantId, { force: true });

    const inVariant = await db.query(
      'SELECT * FROM forecast_modules WHERE scenario_id = $1 AND origin_base_id = $2',
      [variantId, added.rows[0].id]
    );
    expect(inVariant.rows).toHaveLength(1);
    expect(inVariant.rows[0].name).toBe('Fixture Late Arrival');

    // Deleting it in the base leaves the variant's row behind as a LOCAL row (not vanished).
    await db.query('DELETE FROM forecast_modules WHERE id = $1', [added.rows[0].id]);
    const orphan = await db.query(
      'SELECT origin_base_id FROM forecast_modules WHERE id = $1', [inVariant.rows[0].id]
    );
    expect(orphan.rows).toHaveLength(1);
    expect(orphan.rows[0].origin_base_id).toBeNull();

    await db.query('DELETE FROM forecast_modules WHERE id = $1', [inVariant.rows[0].id]);
  });

  test('an FX edit on a variant becomes an override and SURVIVES sync (no silent erase)', async () => {
    // The regression: the inflation/FX/tax tables write the whole assumptions document directly,
    // bypassing the override system. On a variant that edit was invisible in the panel AND the next
    // syncAssumptions rewrote the variant's FX from base — silently erasing it.
    const doc = await assumpRepo.getDoc();
    const fx = Array.isArray(doc.FX) ? doc.FX : [];

    // Simulate the Scenarios page writing a variant-only 2027 FX row straight to the doc.
    fx.push({ Scenario: VARIANT, Year: 2027, Rates: { PLN: 4.5, EUR: 0.9 } });
    await assumpRepo.putDoc({ ...doc, FX: fx });

    // What the route does after PUT /assumptions.
    await variants.reconcileAssumptionOverrides(variantId);

    const overrides = await variants.listOverrides(variantId);
    const fxOverride = overrides.find((o) => o.entity_key === 'FX');
    expect(fxOverride).toBeTruthy(); // the FX edit was captured as an override

    // The edit must survive a subsequent sync — this is the data-loss guard.
    await variants.syncVariant(variantId, { force: true });
    const after = (await assumpRepo.getDoc()).FX.filter((e) => e.Scenario === VARIANT);
    const has2027 = after.some((e) => Number(e.Year) === 2027 && Number(e.Rates.PLN) === 4.5);
    expect(has2027).toBe(true); // the 2027 FX row is still there after sync

    // Removing the row from the doc and reconciling drops the variant back to the base's FX.
    const doc2 = await assumpRepo.getDoc();
    await assumpRepo.putDoc({
      ...doc2,
      FX: doc2.FX.filter((e) => !(e.Scenario === VARIANT && Number(e.Year) === 2027)),
    });
    await variants.reconcileAssumptionOverrides(variantId);
    expect(await variants.listOverrides(variantId)).toHaveLength(0);
  });

  test('an income/expense item overrides and reverts like a module', async () => {
    const vItem = (await db.query(
      'SELECT id FROM forecast_income_expense WHERE scenario_id = $1 AND origin_base_id = $2',
      [variantId, baseItem]
    )).rows[0];

    await repo.updateIncExp(vItem.id, { base_value: 120000 });
    await variants.syncVariant(variantId, { force: true });

    const after = (await db.query('SELECT base_value FROM forecast_income_expense WHERE id = $1', [vItem.id])).rows[0];
    expect(Number(after.base_value)).toBe(120000);

    const base = (await db.query('SELECT base_value FROM forecast_income_expense WHERE id = $1', [baseItem])).rows[0];
    expect(Number(base.base_value)).toBe(90000);

    await variants.clearOverride(variantId, 'incexp', baseItem);
    const reverted = (await db.query('SELECT base_value FROM forecast_income_expense WHERE id = $1', [vItem.id])).rows[0];
    expect(Number(reverted.base_value)).toBe(90000);
  });

  test('CR051 — currency is an ordinary overridable field (variant PLN, base stays USD, reverts)', async () => {
    const vItem = (await db.query(
      'SELECT id FROM forecast_income_expense WHERE scenario_id = $1 AND origin_base_id = $2',
      [variantId, baseItem]
    )).rows[0];

    await repo.updateIncExp(vItem.id, { currency: 'PLN' });
    await variants.syncVariant(variantId, { force: true });

    const after = (await db.query('SELECT currency FROM forecast_income_expense WHERE id = $1', [vItem.id])).rows[0];
    expect(after.currency).toBe('PLN'); // the override pins the variant

    const base = (await db.query('SELECT currency FROM forecast_income_expense WHERE id = $1', [baseItem])).rows[0];
    expect(base.currency).toBe('USD'); // the base is untouched

    await variants.clearOverride(variantId, 'incexp', baseItem);
    await variants.syncVariant(variantId, { force: true });
    const reverted = (await db.query('SELECT currency FROM forecast_income_expense WHERE id = $1', [vItem.id])).rows[0];
    expect(reverted.currency).toBe('USD'); // reverts to inherit from base
  });

  // -------------------------------------------------------------------------
  // CR062 P2 — secured-asset links, which are the one field carrying a ROW ID
  // -------------------------------------------------------------------------
  //
  // Two id spaces reach the sync's resolution step and they are indistinguishable
  // by value alone: an INHERITED link is a base module id, an OVERRIDDEN one is a
  // variant module id (the picker offers the variant's own modules). Mapping
  // base→variant unconditionally — which is what shipped — turned every link the
  // owner set inside a variant into NULL, in the same request that saved it. Prod
  // lost both of "2026 Buy Business"'s links that way while its override patches
  // still held them, and the Equity report read "No asset carries debt".
  describe('secured-asset links', () => {
    let baseAsset;
    let baseLoan;

    const insertAsset = async (scenarioId, name) => (await db.query(
      `INSERT INTO forecast_modules (scenario_id, name, module_type, currency, base_date,
         base_value, market_value, base_value_usd, market_value_usd, growth_rate, setup_status)
       VALUES ($1, $2, 'asset', 'USD', '2025-12-31', 100, 100, 100, 100, 0, 'ready')
       RETURNING id`,
      [scenarioId, name]
    )).rows[0].id;

    const variantRowOf = async (baseRowId) => (await db.query(
      'SELECT * FROM forecast_modules WHERE scenario_id = $1 AND origin_base_id = $2',
      [variantId, baseRowId]
    )).rows[0];

    beforeAll(async () => {
      baseAsset = await insertAsset(baseId, 'Fixture Secured House');
      baseLoan = (await db.query(
        `INSERT INTO forecast_modules (scenario_id, name, module_type, currency, base_date,
           base_value, market_value, base_value_usd, market_value_usd, growth_rate, setup_status,
           loan_interest_rate, loan_principal, secured_asset_module_id)
         VALUES ($1, 'Fixture Mortgage', 'Loan', 'USD', '2025-12-31', -80, -80, -80, -80, 0,
                 'ready', 6.0, 80, $2)
         RETURNING id`,
        [baseId, baseAsset]
      )).rows[0].id;

      await variants.syncVariant(variantId, { force: true });
    });

    afterAll(async () => {
      await db.query('DELETE FROM forecast_modules WHERE id IN ($1, $2)', [baseLoan, baseAsset]);
      await variants.syncVariant(variantId, { force: true });
      await db.query(
        `DELETE FROM forecast_modules WHERE scenario_id = $1 AND name IN
           ('Fixture Secured House', 'Fixture Mortgage', 'Fixture Variant-Only Asset')`,
        [variantId]
      );
    });

    test('an INHERITED link is re-pointed at the variant\'s own asset, never the base\'s', async () => {
      const vAsset = await variantRowOf(baseAsset);
      const vLoan = await variantRowOf(baseLoan);

      expect(vLoan.secured_asset_module_id).toBe(vAsset.id);
      expect(vLoan.secured_asset_module_id).not.toBe(baseAsset); // the original point of step 5
    });

    test('a link picked INSIDE the variant survives the save that sets it, and every sync after', async () => {
      // THE REGRESSION. The picker offers variant modules, so the patch carries a variant id;
      // the sync read it as a base id, missed, and `|| null` unsecured the loan silently.
      const vLoan = await variantRowOf(baseLoan);
      const vOther = await variantRowOf(baseModA); // a different asset, inherited like the first

      await repo.updateModule(vLoan.id, { secured_asset_module_id: vOther.id });

      const saved = (await db.query(
        'SELECT secured_asset_module_id FROM forecast_modules WHERE id = $1', [vLoan.id]
      )).rows[0];
      expect(saved.secured_asset_module_id).toBe(vOther.id); // was NULL before the fix

      await variants.syncVariant(variantId, { force: true });
      const after = (await db.query(
        'SELECT secured_asset_module_id FROM forecast_modules WHERE id = $1', [vLoan.id]
      )).rows[0];
      expect(after.secured_asset_module_id).toBe(vOther.id);

      // The override records it, and the base loan keeps its own asset.
      const ov = (await variants.listOverrides(variantId)).find((o) => o.base_entity_id === baseLoan);
      expect(ov.patch.secured_asset_module_id).toBe(vOther.id);
      const base = (await db.query(
        'SELECT secured_asset_module_id FROM forecast_modules WHERE id = $1', [baseLoan]
      )).rows[0];
      expect(base.secured_asset_module_id).toBe(baseAsset);

      await variants.clearOverride(variantId, 'module', baseLoan);
    });

    test('a variant-LOCAL asset can secure the loan — there is no base id to translate', async () => {
      const localAsset = await insertAsset(variantId, 'Fixture Variant-Only Asset');
      const vLoan = await variantRowOf(baseLoan);

      await repo.updateModule(vLoan.id, { secured_asset_module_id: localAsset });
      await variants.syncVariant(variantId, { force: true });

      const after = (await db.query(
        'SELECT secured_asset_module_id FROM forecast_modules WHERE id = $1', [vLoan.id]
      )).rows[0];
      expect(after.secured_asset_module_id).toBe(localAsset);

      await variants.clearOverride(variantId, 'module', baseLoan);
      await db.query('DELETE FROM forecast_modules WHERE id = $1', [localAsset]);
    });

    test('a target hidden in the variant unsecures the loan rather than dangling into the base', async () => {
      const vAsset = await variantRowOf(baseAsset);
      await repo.deleteModule(vAsset.id); // tombstone — the base keeps the asset
      await variants.syncVariant(variantId, { force: true });

      const vLoan = await variantRowOf(baseLoan);
      expect(vLoan.secured_asset_module_id).toBeNull(); // NOT baseAsset, which still exists

      await variants.clearOverride(variantId, 'module', baseAsset); // un-hide
      await variants.syncVariant(variantId, { force: true });
      const restored = await variantRowOf(baseLoan);
      expect(restored.secured_asset_module_id).toBe((await variantRowOf(baseAsset)).id);
    });
  });

  // -------------------------------------------------------------------------
  // Lineage rules
  // -------------------------------------------------------------------------

  test('a variant of a variant is rejected, and so is deleting a base that still has variants', async () => {
    await expect(
      variants.createVariant(variantId, { name: 'CR050 Nested' })
    ).rejects.toThrow(/variant of a variant/i);

    await expect(
      db.query('DELETE FROM forecast_scenarios WHERE id = $1', [baseId])
    ).rejects.toThrow(); // FK RESTRICT — the route turns this into a 409 with the variant names

    expect((await variants.variantsOf(baseId)).map((v) => v.name)).toEqual([VARIANT]);
  });

  test('detach freezes the resolved rows and drops the lineage', async () => {
    const vMod = (await db.query(
      'SELECT id FROM forecast_modules WHERE scenario_id = $1 AND origin_base_id = $2',
      [variantId, baseModA]
    )).rows[0];
    await repo.updateModule(vMod.id, { growth_rate: 0.5 });

    await variants.detachVariant(variantId);

    const scenario = (await db.query('SELECT * FROM forecast_scenarios WHERE id = $1', [variantId])).rows[0];
    expect(scenario.parent_scenario_id).toBeNull();
    expect(await variants.listOverrides(variantId)).toHaveLength(0);

    const frozen = (await db.query('SELECT growth_rate, origin_base_id FROM forecast_modules WHERE id = $1', [vMod.id])).rows[0];
    expect(Number(frozen.growth_rate)).toBe(0.5); // kept the override's value
    expect(frozen.origin_base_id).toBeNull();

    // A base change no longer reaches it.
    await repo.updateModule(baseModA, { income_amount: 77777 });
    const after = (await db.query('SELECT income_amount FROM forecast_modules WHERE id = $1', [vMod.id])).rows[0];
    expect(Number(after.income_amount)).not.toBe(77777);
  });
});

/**
 * CR064 P11 — the badge payload must carry the id the revert is addressed by.
 *
 * Reverting an override is `DELETE /scenarios/:id/overrides/module/:baseEntityId`, keyed to
 * the BASE row. The Modules page could show that a row was overridden but had no way to undo
 * it, because `Inheritance` reported only the status and the field names.
 */
describe('CR064 — rowInheritance carries the base id', () => {
  const { rowInheritance } = require('../forecastVariants');

  const map = new Map([[87, { status: 'overridden', fields: ['income_amount', 'growth_rate'] }]]);

  test('an overridden row reports the base id the revert needs', () => {
    expect(rowInheritance(map, { id: 435, origin_base_id: 87 })).toEqual({
      status: 'overridden',
      fields: ['income_amount', 'growth_rate'],
      baseId: 87,
    });
  });

  test('an inherited row carries it too — nothing to revert, but the id is real', () => {
    expect(rowInheritance(map, { id: 436, origin_base_id: 88 })).toEqual({
      status: 'inherited', fields: [], baseId: 88,
    });
  });

  test('a variant-LOCAL row has no base to reset to', () => {
    expect(rowInheritance(map, { id: 437, origin_base_id: null })).toEqual({
      status: 'local', fields: [], baseId: null,
    });
  });

  test('a plain scenario still reports nothing at all', () => {
    expect(rowInheritance(null, { id: 1, origin_base_id: null })).toBeNull();
  });
});
