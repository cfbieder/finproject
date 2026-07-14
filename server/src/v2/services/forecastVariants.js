'use strict';
/**
 * Forecast scenario variants (CR050) — inherit-unless-overridden.
 *
 * A VARIANT stores nothing but its overrides: a JSONB patch per changed base row, keyed to the
 * BASE row's id. `syncVariant()` materializes base ⊕ overrides into REAL rows on the variant, so
 * the engine, Review, Compare, AI review and the audit CSVs keep reading an ordinary,
 * fully-populated scenario and do not change. (A read-time overlay was rejected: reads are not
 * funneled — the engine's loaders, the repository's finders and crud.getBaseYearValues are three
 * separate paths, and a reader that forgot the resolver would silently return a wrong number.
 * That is the CR049 failure mode.)
 *
 * The column list is derived from information_schema, never hand-enumerated. This is the direct
 * fix for the bug class that has bitten the deep-copy path twice: CR045 §1 dropped
 * `cash_sweep_priority` (every copied scenario ran unswept, −$3.35M of shortfall left unfunded)
 * and CR048 dropped the whole assumptions slice (copies ran at 0% inflation). A variant that
 * inherits a HOLE is worse than a copy that does.
 *
 * Sync is LAZY, never fanned out from a base write: a variant whose resolved state is invalid
 * must not be able to fail an edit to the base. It runs on a read of the variant's setup pages,
 * on an override write, and unconditionally at the top of the variant's build.
 */

const db = require('../db');
const assumpRepo = require('../repositories/forecastAssumptions');

const SYNC_LOCK_NS = 1178489672; // adjacent to the engine's build lock (1178489671)

/** Columns sync never carries: identity, ownership, bookkeeping. Everything else round-trips. */
const EXCLUDED_COLUMNS = new Set(['id', 'scenario_id', 'created_at', 'updated_at', 'origin_base_id']);

/** Patch keys that address a whole child schedule rather than a column. */
const SCHEDULE_KEYS = {
  forecast_modules: ['investments', 'disposals', 'income_pct'],
  forecast_income_expense: ['changes'],
};

const SCHEDULE_TABLES = {
  investments: { table: 'forecast_module_investments', fk: 'module_id', cols: ['investment_date', 'amount', 'flag', 'note', 'date_end'] },
  disposals: { table: 'forecast_module_disposals', fk: 'module_id', cols: ['disposal_date', 'amount', 'flag', 'note', 'date_end'] },
  income_pct: { table: 'forecast_module_income_pct', fk: 'module_id', cols: ['effective_date', 'value'] },
  changes: { table: 'forecast_incexp_changes', fk: 'incexp_id', cols: ['change_date', 'amount', 'flag', 'note'] },
};

const ENTITY_TABLES = {
  module: 'forecast_modules',
  incexp: 'forecast_income_expense',
};

const ASSUMPTION_KEYS = ['inflation', 'FX', 'Tax Rate', 'PeriodStart', 'PeriodEnd', 'cash_sweep_low', 'cash_sweep_high'];

const columnCache = new Map();

/** The syncable columns of a table, from information_schema — so a future migration cannot be dropped. */
async function syncColumns(client, table) {
  if (columnCache.has(table)) return columnCache.get(table);
  const res = await client.query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = $1
      ORDER BY ordinal_position`,
    [table]
  );
  const cols = res.rows.map((r) => r.column_name).filter((c) => !EXCLUDED_COLUMNS.has(c));
  columnCache.set(table, cols);
  return cols;
}

// ---------------------------------------------------------------------------
// Lineage
// ---------------------------------------------------------------------------

async function getScenario(client, scenarioId) {
  const res = await client.query('SELECT * FROM forecast_scenarios WHERE id = $1', [scenarioId]);
  return res.rows[0] || null;
}

/** The base id if this scenario is a variant, else null. */
async function parentOf(scenarioId, client = db) {
  const res = await client.query('SELECT parent_scenario_id FROM forecast_scenarios WHERE id = $1', [scenarioId]);
  return res.rows[0] ? res.rows[0].parent_scenario_id : null;
}

/** The variant that owns a module / incexp row — used by the write-interception path. */
async function variantOfRow(entityType, rowId, client = db) {
  const table = ENTITY_TABLES[entityType];
  const res = await client.query(
    `SELECT r.id, r.scenario_id, r.origin_base_id, s.parent_scenario_id
       FROM ${table} r JOIN forecast_scenarios s ON s.id = r.scenario_id
      WHERE r.id = $1`,
    [rowId]
  );
  return res.rows[0] || null;
}

// ---------------------------------------------------------------------------
// Overrides
// ---------------------------------------------------------------------------

async function listOverrides(scenarioId, client = db) {
  const res = await client.query(
    `SELECT * FROM forecast_scenario_overrides WHERE scenario_id = $1
      ORDER BY entity_type, entity_key, base_entity_id`,
    [scenarioId]
  );
  return res.rows;
}

/**
 * Merge `patch` into the variant's override for a base row (creating it if absent). Keys already
 * present are replaced; keys absent are left inherited. A key whose value equals the base's is
 * DROPPED — reverting a field by re-typing the base value must not leave a phantom override that
 * pins it forever.
 */
async function mergeEntityOverride(client, variantId, entityType, baseEntityId, patch) {
  const table = ENTITY_TABLES[entityType];
  const baseRow = (await client.query(`SELECT * FROM ${table} WHERE id = $1`, [baseEntityId])).rows[0];
  if (!baseRow) throw new Error(`Base ${entityType} ${baseEntityId} not found`);

  const existing = (await client.query(
    `SELECT * FROM forecast_scenario_overrides
      WHERE scenario_id = $1 AND entity_type = $2 AND base_entity_id = $3`,
    [variantId, entityType, baseEntityId]
  )).rows[0];

  const merged = { ...(existing ? existing.patch : {}), ...patch };
  const scheduleKeys = SCHEDULE_KEYS[table];

  // Drop keys that no longer differ from the base — an override must always mean "different".
  for (const key of Object.keys(merged)) {
    if (scheduleKeys.includes(key)) {
      if (await scheduleEqualsBase(client, key, baseEntityId, merged[key])) delete merged[key];
      continue;
    }
    if (!(key in baseRow)) throw new Error(`Unknown override field '${key}' on ${entityType}`);
    if (valuesEqual(baseRow[key], merged[key])) delete merged[key];
  }

  if (Object.keys(merged).length === 0) {
    if (existing && !existing.is_deleted) {
      await client.query('DELETE FROM forecast_scenario_overrides WHERE id = $1', [existing.id]);
    }
    return null;
  }

  const res = await client.query(
    `INSERT INTO forecast_scenario_overrides (scenario_id, entity_type, base_entity_id, patch)
     VALUES ($1, $2, $3, $4::jsonb)
     ON CONFLICT (scenario_id, entity_type, base_entity_id) WHERE base_entity_id IS NOT NULL
     DO UPDATE SET patch = $4::jsonb, is_deleted = FALSE, updated_at = NOW()
     RETURNING *`,
    [variantId, entityType, baseEntityId, JSON.stringify(merged)]
  );
  return res.rows[0];
}

/** Tombstone: the base row exists, but this variant does not have it. */
async function tombstone(client, variantId, entityType, baseEntityId) {
  await client.query(
    `INSERT INTO forecast_scenario_overrides (scenario_id, entity_type, base_entity_id, patch, is_deleted)
     VALUES ($1, $2, $3, '{}'::jsonb, TRUE)
     ON CONFLICT (scenario_id, entity_type, base_entity_id) WHERE base_entity_id IS NOT NULL
     DO UPDATE SET is_deleted = TRUE, patch = '{}'::jsonb, updated_at = NOW()`,
    [variantId, entityType, baseEntityId]
  );
}

/** Revert: a whole entity back to base, or a single field of it. */
async function clearOverride(variantId, entityType, baseEntityId, field = null) {
  return db.transaction(async (client) => {
    if (!field) {
      await client.query(
        `DELETE FROM forecast_scenario_overrides
          WHERE scenario_id = $1 AND entity_type = $2 AND base_entity_id = $3`,
        [variantId, entityType, baseEntityId]
      );
    } else {
      const row = (await client.query(
        `SELECT * FROM forecast_scenario_overrides
          WHERE scenario_id = $1 AND entity_type = $2 AND base_entity_id = $3`,
        [variantId, entityType, baseEntityId]
      )).rows[0];
      if (!row) return { synced: false };
      const patch = { ...row.patch };
      delete patch[field];
      if (Object.keys(patch).length === 0 && !row.is_deleted) {
        await client.query('DELETE FROM forecast_scenario_overrides WHERE id = $1', [row.id]);
      } else {
        await client.query(
          'UPDATE forecast_scenario_overrides SET patch = $1::jsonb, updated_at = NOW() WHERE id = $2',
          [JSON.stringify(patch), row.id]
        );
      }
    }
    return syncVariant(variantId, { client, force: true });
  });
}

/** An assumption override (period / inflation / FX / tax / sweep band). */
async function setAssumptionOverride(variantId, entityKey, value) {
  if (!ASSUMPTION_KEYS.includes(entityKey)) throw new Error(`Unknown assumption key '${entityKey}'`);
  return db.transaction(async (client) => {
    await client.query(
      `INSERT INTO forecast_scenario_overrides (scenario_id, entity_type, entity_key, patch)
       VALUES ($1, 'assumption', $2, $3::jsonb)
       ON CONFLICT (scenario_id, entity_key) WHERE entity_key IS NOT NULL
       DO UPDATE SET patch = $3::jsonb, updated_at = NOW()`,
      [variantId, entityKey, JSON.stringify({ value })]
    );
    return syncVariant(variantId, { client, force: true });
  });
}

// ---------------------------------------------------------------------------
// Sync — materialize base ⊕ overrides into the variant's real rows
// ---------------------------------------------------------------------------

/** Is the variant behind its base or its own overrides? */
async function needsSync(variantId, client = db) {
  const res = await client.query(
    `SELECT v.synced_at,
            GREATEST(
              COALESCE((SELECT MAX(updated_at) FROM forecast_modules        WHERE scenario_id = v.parent_scenario_id), 'epoch'::timestamptz),
              COALESCE((SELECT MAX(updated_at) FROM forecast_income_expense WHERE scenario_id = v.parent_scenario_id), 'epoch'::timestamptz),
              COALESCE((SELECT MAX(updated_at) FROM forecast_scenario_overrides WHERE scenario_id = v.id), 'epoch'::timestamptz),
              COALESCE((SELECT MAX(updated_at) FROM forecast_assumptions), 'epoch'::timestamptz),
              COALESCE(b.updated_at, 'epoch'::timestamptz)
            ) AS base_touched_at
       FROM forecast_scenarios v
       JOIN forecast_scenarios b ON b.id = v.parent_scenario_id
      WHERE v.id = $1`,
    [variantId]
  );
  if (res.rows.length === 0) return false; // not a variant
  const { synced_at: syncedAt, base_touched_at: touched } = res.rows[0];
  return !syncedAt || new Date(touched) > new Date(syncedAt);
}

/** Sync the variant if (and only if) it is stale. The cheap call for read paths. */
async function syncIfStale(variantId, client = db) {
  if (!(await needsSync(variantId, client))) return { synced: false };
  return syncVariant(variantId, { client });
}

/**
 * Materialize the variant. Idempotent: syncing twice is a no-op, and surrogate ids are stable
 * across syncs (rows are UPSERTed on origin_base_id, never dropped and recreated).
 */
async function syncVariant(variantId, { client = null, force = false } = {}) {
  const run = async (c) => {
    const variant = await getScenario(c, variantId);
    if (!variant) throw new Error(`Scenario ${variantId} not found`);
    if (!variant.parent_scenario_id) return { synced: false, reason: 'not-a-variant' };

    await c.query('SELECT pg_advisory_xact_lock($1, $2)', [SYNC_LOCK_NS, variantId]);
    if (!force && !(await needsSync(variantId, c))) return { synced: false, reason: 'fresh' };

    const baseId = variant.parent_scenario_id;
    const overrides = await listOverrides(variantId, c);
    const stats = { modules: 0, incexp: 0, deleted: 0, local: 0 };

    for (const entityType of ['module', 'incexp']) {
      const s = await syncEntity(c, { variantId, baseId, entityType, overrides });
      stats[entityType === 'module' ? 'modules' : 'incexp'] = s.written;
      stats.deleted += s.deleted;
      stats.local += s.local;
    }

    await syncAssumptions(c, { variant, baseId, overrides });
    await c.query('UPDATE forecast_scenarios SET synced_at = NOW() WHERE id = $1', [variantId]);

    return { synced: true, ...stats };
  };
  return client ? run(client) : db.transaction(run);
}

async function syncEntity(c, { variantId, baseId, entityType, overrides }) {
  const table = ENTITY_TABLES[entityType];
  const cols = await syncColumns(c, table);
  const scheduleKeys = SCHEDULE_KEYS[table];

  const baseRows = (await c.query(`SELECT * FROM ${table} WHERE scenario_id = $1 ORDER BY id`, [baseId])).rows;
  const existing = (await c.query(
    `SELECT id, origin_base_id FROM ${table} WHERE scenario_id = $1 AND origin_base_id IS NOT NULL`,
    [variantId]
  )).rows;
  const localCount = (await c.query(
    `SELECT COUNT(*)::int AS n FROM ${table} WHERE scenario_id = $1 AND origin_base_id IS NULL`,
    [variantId]
  )).rows[0].n;

  const byBaseId = new Map(existing.map((r) => [r.origin_base_id, r.id]));
  const patchFor = new Map(
    overrides.filter((o) => o.entity_type === entityType).map((o) => [o.base_entity_id, o])
  );

  // 1. Resolve: base row ⊕ patch, minus the tombstoned.
  const resolved = [];
  for (const baseRow of baseRows) {
    const ov = patchFor.get(baseRow.id);
    if (ov && ov.is_deleted) continue;
    if (ov) await pruneOverride(c, ov, baseRow, table); // self-heal: see below
    const patch = ov ? ov.patch : {};
    const row = { ...baseRow };
    for (const [key, value] of Object.entries(patch)) {
      if (scheduleKeys.includes(key)) continue; // handled below
      if (cols.includes(key)) row[key] = value;
    }
    resolved.push({ baseId: baseRow.id, row, patch, explicit: new Set(Object.keys(patch)) });
  }

  if (table === 'forecast_modules') resolveSweepFlags(resolved);

  // 2. Drop what the variant no longer inherits (tombstoned, or gone from the base).
  const keep = new Set(resolved.map((r) => r.baseId));
  let deleted = 0;
  for (const [baseRowId, variantRowId] of byBaseId) {
    if (!keep.has(baseRowId)) {
      await c.query(`DELETE FROM ${table} WHERE id = $1`, [variantRowId]);
      byBaseId.delete(baseRowId);
      deleted += 1;
    }
  }

  // 3. Park the rows we are about to rewrite, so no PARTIAL UNIQUE INDEX can be violated
  //    TRANSIENTLY on the way to a valid final state — the row-by-row upsert below writes one row
  //    at a time, and Postgres checks each statement:
  //      • UNIQUE(scenario_id, name)                    — two base rows swapping names in one edit
  //      • UNIQUE(scenario_id, cash_sweep_priority)     — a variant re-ranking the sweep primary:
  //        the new holder takes rank 1 before the displaced one has given it up
  //      • UNIQUE(scenario_id) WHERE cash_sweep_target  — same, for the legacy flag
  //    Every parked value is rewritten in step 4, so this is invisible outside the transaction.
  for (const [, variantRowId] of byBaseId) {
    const parked = table === 'forecast_modules'
      ? `name = $1, cash_sweep_priority = NULL, cash_sweep_target = FALSE`
      : `name = $1`;
    await c.query(`UPDATE ${table} SET ${parked} WHERE id = $2`, [`__sync_${variantRowId}`, variantRowId]);
  }

  // 4. Upsert on origin_base_id — ids stay stable across syncs.
  for (const { baseId: baseRowId, row, patch } of resolved) {
    const values = cols.map((col) => row[col]);
    const existingId = byBaseId.get(baseRowId);
    let variantRowId;

    if (existingId) {
      const sets = cols.map((col, i) => `${col} = $${i + 1}`).join(', ');
      await c.query(
        `UPDATE ${table} SET ${sets}, updated_at = NOW() WHERE id = $${cols.length + 1}`,
        [...values, existingId]
      );
      variantRowId = existingId;
    } else {
      const placeholders = cols.map((_, i) => `$${i + 3}`).join(', ');
      const res = await c.query(
        `INSERT INTO ${table} (scenario_id, origin_base_id, ${cols.join(', ')})
         VALUES ($1, $2, ${placeholders}) RETURNING id`,
        [variantId, baseRowId, ...values]
      );
      variantRowId = res.rows[0].id;
    }

    for (const key of scheduleKeys) {
      const list = key in patch ? patch[key] : await baseSchedule(c, key, baseRowId);
      await replaceSchedule(c, key, variantRowId, list);
    }
  }

  return { written: resolved.length, deleted, local: localCount };
}

/**
 * `cash_sweep_priority` and `cash_sweep_target` are unique PER SCENARIO (partial unique indexes),
 * so an override of them is not independent: overriding "Fidelity is the primary" in a variant
 * necessarily un-primes the base's primary WITHIN that variant — a second override the owner
 * never typed. Derive it, rather than letting the index throw mid-build.
 */
function resolveSweepFlags(resolved) {
  const patchedPriorities = new Map();
  let patchedTarget = null;

  for (const r of resolved) {
    if (r.explicit.has('cash_sweep_priority') && r.row.cash_sweep_priority != null) {
      patchedPriorities.set(Number(r.row.cash_sweep_priority), r.baseId);
    }
    if (r.explicit.has('cash_sweep_target') && r.row.cash_sweep_target === true) {
      patchedTarget = r.baseId;
    }
  }

  for (const r of resolved) {
    const prio = r.row.cash_sweep_priority == null ? null : Number(r.row.cash_sweep_priority);
    if (
      prio != null &&
      !r.explicit.has('cash_sweep_priority') &&
      patchedPriorities.has(prio) &&
      patchedPriorities.get(prio) !== r.baseId
    ) {
      r.row.cash_sweep_priority = null; // displaced by the variant's own ranking
    }
    if (patchedTarget != null && r.row.cash_sweep_target === true && r.baseId !== patchedTarget) {
      r.row.cash_sweep_target = false;
    }
  }
}

/**
 * Drop patch keys that no longer differ from the base — mutating `ov.patch` in place so the caller
 * materializes the pruned version.
 *
 * An override must always MEAN something: "this is different from Base". A key that matches the
 * base is noise in the panel and a lie in the audit trail — it claims the owner pinned a value they
 * never touched. `mergeEntityOverride` already refuses to store such a key, so this is the repair
 * arm: it heals patches written before the date-comparison fix (which wrote a phantom `base_date`
 * and `income_pct` on every save), and it also catches the case where the BASE later changes to
 * match the override, which no write path would otherwise notice.
 */
async function pruneOverride(c, ov, baseRow, table) {
  const scheduleKeys = SCHEDULE_KEYS[table];
  const pruned = { ...ov.patch };
  let changed = false;

  for (const key of Object.keys(pruned)) {
    const same = scheduleKeys.includes(key)
      ? await scheduleEqualsBase(c, key, baseRow.id, pruned[key])
      : key in baseRow && valuesEqual(baseRow[key], pruned[key]);
    if (same) {
      delete pruned[key];
      changed = true;
    }
  }
  if (!changed) return;

  ov.patch = pruned;
  if (Object.keys(pruned).length === 0) {
    await c.query('DELETE FROM forecast_scenario_overrides WHERE id = $1', [ov.id]);
  } else {
    await c.query(
      'UPDATE forecast_scenario_overrides SET patch = $1::jsonb WHERE id = $2',
      [JSON.stringify(pruned), ov.id]
    );
  }
}

async function baseSchedule(c, key, baseRowId) {
  const { table, fk, cols } = SCHEDULE_TABLES[key];
  const res = await c.query(
    `SELECT ${cols.join(', ')} FROM ${table} WHERE ${fk} = $1 ORDER BY id`,
    [baseRowId]
  );
  return res.rows;
}

async function replaceSchedule(c, key, variantRowId, list) {
  const { table, fk, cols } = SCHEDULE_TABLES[key];
  await c.query(`DELETE FROM ${table} WHERE ${fk} = $1`, [variantRowId]);
  for (const item of list || []) {
    const placeholders = cols.map((_, i) => `$${i + 2}`).join(', ');
    await c.query(
      `INSERT INTO ${table} (${fk}, ${cols.join(', ')}) VALUES ($1, ${placeholders})`,
      [variantRowId, ...cols.map((col) => item[col] ?? null)]
    );
  }
}

async function scheduleEqualsBase(c, key, baseRowId, list) {
  const baseList = await baseSchedule(c, key, baseRowId);
  const { cols } = SCHEDULE_TABLES[key];
  if (baseList.length !== (list || []).length) return false;
  return baseList.every((b, i) => cols.every((col) => valuesEqual(b[col], list[i][col])));
}

/**
 * The scenario's period, inflation path, FX paths and tax rate live in the `forecast_assumptions`
 * DOCUMENT, keyed by scenario NAME — not on the scenarios table. Sync resolves base ⊕ overrides
 * and writes them under the variant's name, so every downstream reader (the engine's
 * loadScenarioConfig included) keeps working unchanged.
 *
 * inflation and FX are LISTS of {Year, …}, so they replace wholesale; Tax Rate, PeriodStart /
 * PeriodEnd and the sweep band are scalars.
 */
async function syncAssumptions(c, { variant, baseId, overrides }) {
  const base = await getScenario(c, baseId);
  const doc = await assumpRepo.getDoc();
  const ov = new Map(
    overrides.filter((o) => o.entity_type === 'assumption').map((o) => [o.entity_key, o.patch.value])
  );

  const asList = (raw) => {
    const list = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(list) ? list : [];
  };
  const nameField = (key) => (key === 'scenarios' ? 'Name' : 'Scenario');
  const rekey = (list, key) =>
    list
      .filter((e) => e && e[nameField(key)] === base.name)
      .map((e) => {
        const clone = { ...e, [nameField(key)]: variant.name };
        delete clone.id;
        return clone;
      });

  const next = {};

  // scenarios entry — carries PeriodStart / PeriodEnd.
  const scenarios = asList(doc.scenarios);
  const baseEntry = scenarios.find((e) => e && e.Name === base.name) || {};
  const variantEntry = {
    ...baseEntry,
    Name: variant.name,
    Description: variant.description,
    IsActive: variant.is_active,
    id: variant.id,
    PeriodStart: ov.has('PeriodStart') ? ov.get('PeriodStart') : baseEntry.PeriodStart,
    PeriodEnd: ov.has('PeriodEnd') ? ov.get('PeriodEnd') : baseEntry.PeriodEnd,
  };
  next.scenarios = [...scenarios.filter((e) => e && e.Name !== variant.name), variantEntry];

  // inflation / FX — whole-list replace.
  for (const key of ['inflation', 'FX']) {
    const list = asList(doc[key]);
    const others = list.filter((e) => !e || e.Scenario !== variant.name);
    const mine = ov.has(key)
      ? (ov.get(key) || []).map((e) => ({ ...e, Scenario: variant.name }))
      : rekey(list, key);
    next[key] = [...others, ...mine];
  }

  // Tax Rate — scalar.
  const taxList = asList(doc['Tax Rate']);
  const baseTax = taxList.find((e) => e && e.Scenario === base.name);
  const rate = ov.has('Tax Rate') ? ov.get('Tax Rate') : baseTax && baseTax.Rate;
  next['Tax Rate'] = [
    ...taxList.filter((e) => !e || e.Scenario !== variant.name),
    { Scenario: variant.name, Rate: rate },
  ];

  await assumpRepo.putDoc(next);

  // The sweep band lives on the scenarios ROW.
  const low = ov.has('cash_sweep_low') ? ov.get('cash_sweep_low') : base.cash_sweep_low;
  const high = ov.has('cash_sweep_high') ? ov.get('cash_sweep_high') : base.cash_sweep_high;
  await c.query(
    'UPDATE forecast_scenarios SET cash_sweep_low = $1, cash_sweep_high = $2 WHERE id = $3',
    [low, high, variant.id]
  );
}

// ---------------------------------------------------------------------------
// Write interception
//
// A write that lands in a variant's rows and is then overwritten by the next sync is SILENT
// DATA LOSS — the worst failure mode this feature could have. So every write path that can touch
// a variant's inherited rows is intercepted here and turned into an override instead.
//
// Interception lives at the REPOSITORY, not the route, because `PATCH /modules/bulk-update` and
// any future caller reach the same `repo.updateModule`. The two paths that bypass the repository
// entirely — `crud.replaceModuleSchedules` / `replaceIncExpChanges` (schedules) and
// `crud.refreshModulesFromActuals` (a set-based UPDATE across the whole scenario) — are handled
// by `interceptSchedules` and by an outright refusal, respectively.
// ---------------------------------------------------------------------------

/** True when this row is a variant's INHERITED row (so a write to it means "override"). */
async function inheritedRow(entityType, rowId, client = db) {
  const info = await variantOfRow(entityType, rowId, client);
  if (!info || !info.parent_scenario_id || info.origin_base_id == null) return null;
  return info;
}

/**
 * A column write on a variant's inherited row ⇒ merge the changed fields into its override patch
 * and re-materialize. Returns `{ intercepted: false }` for base scenarios and for variant-LOCAL
 * rows, which are written normally (sync never touches them).
 */
async function interceptWrite(entityType, rowId, patch) {
  const info = await inheritedRow(entityType, rowId);
  if (!info) return { intercepted: false };

  return db.transaction(async (client) => {
    await mergeEntityOverride(client, info.scenario_id, entityType, info.origin_base_id, patch);
    await syncVariant(info.scenario_id, { client, force: true });
    const res = await client.query(`SELECT * FROM ${ENTITY_TABLES[entityType]} WHERE id = $1`, [rowId]);
    return { intercepted: true, row: res.rows[0] || null };
  });
}

/** A delete of a variant's inherited row ⇒ a tombstone, not a row delete. */
async function interceptDelete(entityType, rowId) {
  const info = await inheritedRow(entityType, rowId);
  if (!info) return { intercepted: false };

  return db.transaction(async (client) => {
    await tombstone(client, info.scenario_id, entityType, info.origin_base_id);
    await syncVariant(info.scenario_id, { client, force: true });
    return { intercepted: true, deleted: true };
  });
}

/**
 * Schedules arrive embedded in the module / item body and are replaced WHOLESALE by
 * `crud.replaceModuleSchedules` — which is exactly the whole-list patch semantics an override
 * needs, since these child tables have no unique constraint to merge on.
 */
async function interceptSchedules(entityType, rowId, body) {
  const info = await inheritedRow(entityType, rowId);
  if (!info) return { intercepted: false };

  const patch = {};
  if (entityType === 'module') {
    if (Array.isArray(body.Invest)) {
      patch.investments = body.Invest
        .filter((i) => i.Date || i.Amount !== undefined)
        .map((i) => ({ investment_date: i.Date, amount: i.Amount, flag: i.Flag || '', note: i.Note || '', date_end: i.DateEnd || null }));
    }
    if (Array.isArray(body.Dispose)) {
      patch.disposals = body.Dispose
        .filter((d) => d.Date || d.Amount !== undefined)
        .map((d) => ({ disposal_date: d.Date, amount: d.Amount, flag: d.Flag || '', note: d.Note || '', date_end: d.DateEnd || null }));
    }
    if (Array.isArray(body.IncomePct)) {
      patch.income_pct = body.IncomePct
        .filter((p) => p.Date)
        .map((p) => ({ effective_date: p.Date, value: p.Amount ?? p.Value ?? 0 }));
    }
  } else if (Array.isArray(body)) {
    patch.changes = body
      .filter((ch) => ch.Date || ch.Amount !== undefined)
      .map((ch) => ({ change_date: ch.Date, amount: ch.Amount, flag: ch.Flag || '', note: ch.Note || null }));
  }

  if (Object.keys(patch).length === 0) return { intercepted: true };

  return db.transaction(async (client) => {
    await mergeEntityOverride(client, info.scenario_id, entityType, info.origin_base_id, patch);
    await syncVariant(info.scenario_id, { client, force: true });
    return { intercepted: true };
  });
}

/**
 * The base route REJECTS a sweep rank already held by another module ("no silent eviction"). In a
 * variant the same rule holds for the owner's OWN explicit choices — but a merely INHERITED rank
 * yields to them (sync displaces it; see resolveSweepFlags). So the clash check here looks only at
 * other overrides of this variant.
 */
async function explicitPriorityClash(variantId, baseEntityId, priority, client = db) {
  const res = await client.query(
    `SELECT o.base_entity_id, m.name
       FROM forecast_scenario_overrides o
       JOIN forecast_modules m ON m.id = o.base_entity_id
      WHERE o.scenario_id = $1 AND o.entity_type = 'module'
        AND o.base_entity_id <> $2
        AND o.is_deleted = FALSE
        AND (o.patch->>'cash_sweep_priority')::int = $3
      LIMIT 1`,
    [variantId, baseEntityId, priority]
  );
  return res.rows[0] || null;
}

/** Refuse a scenario-wide set-based write on a variant — it would be erased by the next sync. */
async function assertNotVariant(scenarioId, action, client = db) {
  const parent = await parentOf(scenarioId, client);
  if (parent) {
    const err = new Error(
      `${action} is not available on a variant — it re-bases from the ledger, which is the base scenario's job. A variant inherits the result.`
    );
    err.status = 409;
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Inheritance status, for the UI badges
// ---------------------------------------------------------------------------

/** base_entity_id → { status, fields } for a variant's overridden rows. */
async function inheritanceMap(variantId, entityType, client = db) {
  const rows = (await client.query(
    `SELECT base_entity_id, patch, is_deleted FROM forecast_scenario_overrides
      WHERE scenario_id = $1 AND entity_type = $2 AND base_entity_id IS NOT NULL`,
    [variantId, entityType]
  )).rows;
  const map = new Map();
  for (const r of rows) {
    map.set(r.base_entity_id, {
      status: r.is_deleted ? 'hidden' : 'overridden',
      fields: Object.keys(r.patch || {}),
    });
  }
  return map;
}

/** Inherited · Overridden · Local for one materialized row. Null on a non-variant scenario. */
function rowInheritance(map, row) {
  if (!map) return null;
  if (row.origin_base_id == null) return { status: 'local', fields: [] };
  return map.get(row.origin_base_id) || { status: 'inherited', fields: [] };
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

/** Create a variant of `baseId`. With no overrides it is an exact twin of its base. */
async function createVariant(baseId, { name, description = null }) {
  return db.transaction(async (client) => {
    const base = await getScenario(client, baseId);
    if (!base) throw new Error(`Base scenario ${baseId} not found`);
    if (base.parent_scenario_id) throw new Error('Variant of a variant is not supported');

    const clash = await client.query('SELECT id FROM forecast_scenarios WHERE name = $1', [name]);
    if (clash.rows.length > 0) throw new Error(`Scenario '${name}' already exists`);

    const res = await client.query(
      `INSERT INTO forecast_scenarios (name, description, is_active, parent_scenario_id, cash_sweep_low, cash_sweep_high)
       VALUES ($1, $2, TRUE, $3, $4, $5) RETURNING *`,
      [name, description || `Variant of ${base.name}`, baseId, base.cash_sweep_low, base.cash_sweep_high]
    );
    const variant = res.rows[0];
    await syncVariant(variant.id, { client, force: true });
    return variant;
  });
}

/**
 * Convert an existing COPY into a variant: diff it against the chosen base, generate the override
 * set, and adopt. This is how "2026 Upside" migrates with no loss of what makes it Upside.
 * Rows matched by NAME (a copy is name-preserving); anything unmatched stays variant-local.
 */
async function adoptVariant(scenarioId, baseId, { dryRun = false } = {}) {
  return db.transaction(async (client) => {
    const scenario = await getScenario(client, scenarioId);
    const base = await getScenario(client, baseId);
    if (!scenario || !base) throw new Error('Scenario not found');
    if (scenarioId === baseId) throw new Error('A scenario cannot be a variant of itself');
    if (base.parent_scenario_id) throw new Error('Variant of a variant is not supported');
    if (scenario.parent_scenario_id) throw new Error(`'${scenario.name}' is already a variant`);
    const hasChildren = await client.query(
      'SELECT 1 FROM forecast_scenarios WHERE parent_scenario_id = $1 LIMIT 1', [scenarioId]
    );
    if (hasChildren.rows.length > 0) throw new Error(`'${scenario.name}' is itself a base for other variants`);

    const diff = [];
    for (const entityType of ['module', 'incexp']) {
      const table = ENTITY_TABLES[entityType];
      const cols = await syncColumns(client, table);
      const baseRows = (await client.query(`SELECT * FROM ${table} WHERE scenario_id = $1`, [baseId])).rows;
      const mineRows = (await client.query(`SELECT * FROM ${table} WHERE scenario_id = $1`, [scenarioId])).rows;
      const mineByName = new Map(mineRows.map((r) => [r.name, r]));

      for (const baseRow of baseRows) {
        const mine = mineByName.get(baseRow.name);
        if (!mine) {
          diff.push({ entityType, baseEntityId: baseRow.id, name: baseRow.name, tombstone: true });
          continue;
        }
        mineByName.delete(baseRow.name);
        const patch = {};
        for (const col of cols) {
          if (!valuesEqual(baseRow[col], mine[col])) patch[col] = mine[col];
        }
        for (const key of SCHEDULE_KEYS[table]) {
          const mineList = await baseSchedule(client, key, mine.id);
          if (!(await scheduleEqualsBase(client, key, baseRow.id, mineList))) patch[key] = mineList;
        }
        if (Object.keys(patch).length > 0) {
          diff.push({ entityType, baseEntityId: baseRow.id, name: baseRow.name, patch });
        }
        if (!dryRun) {
          await client.query(`UPDATE ${table} SET origin_base_id = $1 WHERE id = $2`, [baseRow.id, mine.id]);
        }
      }
      for (const orphan of mineByName.values()) {
        diff.push({ entityType, name: orphan.name, local: true });
      }
    }

    // Assumptions: whatever differs from the base becomes an assumption override.
    const assumptionDiff = await diffAssumptions(client, scenario, base);
    diff.push(...assumptionDiff.map((d) => ({ entityType: 'assumption', ...d })));

    if (dryRun) return { scenario: scenario.name, base: base.name, diff };

    for (const d of diff) {
      if (d.entityType === 'assumption') {
        await client.query(
          `INSERT INTO forecast_scenario_overrides (scenario_id, entity_type, entity_key, patch)
           VALUES ($1, 'assumption', $2, $3::jsonb)
           ON CONFLICT (scenario_id, entity_key) WHERE entity_key IS NOT NULL
           DO UPDATE SET patch = $3::jsonb, updated_at = NOW()`,
          [scenarioId, d.entityKey, JSON.stringify({ value: d.value })]
        );
      } else if (d.tombstone) {
        await tombstone(client, scenarioId, d.entityType, d.baseEntityId);
      } else if (d.patch) {
        await client.query(
          `INSERT INTO forecast_scenario_overrides (scenario_id, entity_type, base_entity_id, patch)
           VALUES ($1, $2, $3, $4::jsonb)
           ON CONFLICT (scenario_id, entity_type, base_entity_id) WHERE base_entity_id IS NOT NULL
           DO UPDATE SET patch = $4::jsonb, updated_at = NOW()`,
          [scenarioId, d.entityType, d.baseEntityId, JSON.stringify(d.patch)]
        );
      }
    }

    await client.query('UPDATE forecast_scenarios SET parent_scenario_id = $1 WHERE id = $2', [baseId, scenarioId]);
    await syncVariant(scenarioId, { client, force: true });
    return { scenario: scenario.name, base: base.name, diff, adopted: true };
  });
}

async function diffAssumptions(client, scenario, base) {
  const doc = await assumpRepo.getDoc();
  const asList = (raw) => {
    const list = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(list) ? list : [];
  };
  const out = [];

  const scenarios = asList(doc.scenarios);
  const mineEntry = scenarios.find((e) => e && e.Name === scenario.name) || {};
  const baseEntry = scenarios.find((e) => e && e.Name === base.name) || {};
  for (const key of ['PeriodStart', 'PeriodEnd']) {
    if (!valuesEqual(mineEntry[key], baseEntry[key]) && mineEntry[key] != null) {
      out.push({ entityKey: key, value: mineEntry[key] });
    }
  }

  for (const key of ['inflation', 'FX']) {
    const list = asList(doc[key]);
    const strip = (rows) => rows.map(({ Scenario, id, ...rest }) => rest); // eslint-disable-line no-unused-vars
    const mine = strip(list.filter((e) => e && e.Scenario === scenario.name));
    const theirs = strip(list.filter((e) => e && e.Scenario === base.name));
    if (JSON.stringify(mine) !== JSON.stringify(theirs)) out.push({ entityKey: key, value: mine });
  }

  const taxList = asList(doc['Tax Rate']);
  const mineTax = taxList.find((e) => e && e.Scenario === scenario.name);
  const baseTax = taxList.find((e) => e && e.Scenario === base.name);
  if (mineTax && (!baseTax || !valuesEqual(mineTax.Rate, baseTax.Rate))) {
    out.push({ entityKey: 'Tax Rate', value: mineTax.Rate });
  }

  for (const key of ['cash_sweep_low', 'cash_sweep_high']) {
    if (!valuesEqual(scenario[key], base[key])) out.push({ entityKey: key, value: scenario[key] });
  }
  return out;
}

/** Promote a variant to a standalone scenario: keep the rows, drop the lineage. */
async function detachVariant(scenarioId) {
  return db.transaction(async (client) => {
    const scenario = await getScenario(client, scenarioId);
    if (!scenario) throw new Error(`Scenario ${scenarioId} not found`);
    if (!scenario.parent_scenario_id) return { detached: false, reason: 'not-a-variant' };

    await syncVariant(scenarioId, { client, force: true }); // freeze the resolved state first
    await client.query('DELETE FROM forecast_scenario_overrides WHERE scenario_id = $1', [scenarioId]);
    await client.query('UPDATE forecast_modules SET origin_base_id = NULL WHERE scenario_id = $1', [scenarioId]);
    await client.query('UPDATE forecast_income_expense SET origin_base_id = NULL WHERE scenario_id = $1', [scenarioId]);
    await client.query(
      'UPDATE forecast_scenarios SET parent_scenario_id = NULL, synced_at = NULL WHERE id = $1',
      [scenarioId]
    );
    return { detached: true };
  });
}

/** The variants that would be affected by deleting a base scenario or one of its rows. */
async function variantsOf(baseId, client = db) {
  const res = await client.query(
    'SELECT id, name FROM forecast_scenarios WHERE parent_scenario_id = $1 ORDER BY name',
    [baseId]
  );
  return res.rows;
}

// ---------------------------------------------------------------------------

const DATEISH = /^\d{4}-\d{2}-\d{2}(T.*)?$/;

/**
 * The calendar day a value denotes, or null if it isn't a date.
 *
 * These columns are `DATE` — a calendar day, with no time and no zone. But the two sides of a
 * comparison arrive in different shapes: node-postgres parses a DATE into a JS `Date` at **local**
 * midnight, while the module edit form sends `new Date(value).toISOString()` — **UTC** midnight.
 * Same day, different epoch, so an epoch comparison called them different and every save wrote a
 * phantom `base_date` override (and, through `effective_date`, a phantom `income_pct` one). The
 * owner changed one field and the panel showed three.
 *
 * So compare the DAY, not the instant — reading a `Date`'s LOCAL components, because that is the
 * zone node-postgres built it in.
 */
function calendarDay(value) {
  if (value instanceof Date) {
    const pad = (n) => String(n).padStart(2, '0');
    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
  }
  if (typeof value === 'string' && DATEISH.test(value)) return value.slice(0, 10);
  return null;
}

/** Numeric/date-tolerant equality — pg gives us numerics as strings and dates as Date objects. */
function valuesEqual(a, b) {
  if (a === b) return true;
  if (a == null || b == null) return a == null && b == null;

  const dayA = calendarDay(a);
  const dayB = calendarDay(b);
  if (dayA && dayB) return dayA === dayB;
  if (dayA || dayB) return false; // a date against a non-date is a real difference

  const na = Number(a);
  const nb = Number(b);
  if (!Number.isNaN(na) && !Number.isNaN(nb) && a !== '' && b !== '') return na === nb;
  return String(a) === String(b);
}

module.exports = {
  parentOf,
  variantOfRow,
  inheritedRow,
  interceptWrite,
  interceptDelete,
  interceptSchedules,
  explicitPriorityClash,
  assertNotVariant,
  inheritanceMap,
  rowInheritance,
  listOverrides,
  mergeEntityOverride,
  tombstone,
  clearOverride,
  setAssumptionOverride,
  needsSync,
  syncIfStale,
  syncVariant,
  createVariant,
  adoptVariant,
  detachVariant,
  variantsOf,
  valuesEqual,
  SCHEDULE_KEYS,
  ASSUMPTION_KEYS,
};
