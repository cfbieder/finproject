/**
 * Forecast Repository
 *
 * Database operations for forecast tables:
 * - forecast_scenarios
 * - forecast_modules (with investments, disposals, income_pct)
 * - forecast_streams (with their change rows)
 */

const db = require('../db');
const variants = require('../services/forecastVariants'); // CR050 — variant write interception

// ============================================================================
// Scenarios
// ============================================================================

/**
 * Get all scenarios
 */
async function findAllScenarios({ activeOnly = true } = {}) {
  // CR085 P0 — scratch scenarios are hidden from EVERY list, including the `activeOnly: false`
  // one. A throwaway copy that outlives its run (a process killed mid-preview) is garbage the
  // owner should never see, and `is_active` does not say so: `copyScenario` inserts TRUE, which
  // is why one has been showing up in all seven pickers since CR053 (CR084 §9.2).
  const whereClause = activeOnly
    ? 'WHERE is_active = TRUE AND is_scratch = FALSE'
    : 'WHERE is_scratch = FALSE';
  const sql = `
    SELECT s.*,
      (SELECT COUNT(*)::int FROM forecast_modules WHERE scenario_id = s.id) as module_count,
      0::int as incexp_count  -- CR069 P3: items are modules; kept so the shape does not change
    FROM forecast_scenarios s
    ${whereClause}
    ORDER BY name
  `;
  const result = await db.query(sql, []);
  return result.rows;
}

/**
 * Get scenario by ID
 */
async function findScenarioById(id) {
  const sql = `SELECT * FROM forecast_scenarios WHERE id = $1`;
  const result = await db.query(sql, [id]);
  return result.rows[0] || null;
}

/**
 * Get scenario by name
 */
async function findScenarioByName(name) {
  const sql = `SELECT * FROM forecast_scenarios WHERE name = $1`;
  const result = await db.query(sql, [name]);
  return result.rows[0] || null;
}

/**
 * Create a new scenario
 */
async function createScenario(data) {
  const sql = `
    INSERT INTO forecast_scenarios (name, description, is_active, cash_sweep_low, cash_sweep_high)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING *
  `;
  const result = await db.query(sql, [
    data.name,
    data.description || null,
    data.is_active !== false,
    data.cash_sweep_low ?? null,
    data.cash_sweep_high ?? null,
  ]);
  return result.rows[0];
}

/**
 * Update a scenario
 */
async function updateScenario(id, data) {
  const fields = [];
  const params = [];
  let paramIndex = 1;

  // CR064 P1 — a rename must also carry the scenario's assumptions across, so it goes
  // through renameScenario and nowhere else. Refusing it here rather than accepting it
  // makes any future caller fail loudly instead of stranding an inflation path.
  if (data.name !== undefined) {
    throw new Error('updateScenario: use renameScenario() to change a scenario name (CR064 §2.4)');
  }
  if (data.description !== undefined) {
    fields.push(`description = $${paramIndex++}`);
    params.push(data.description);
  }
  if (data.is_active !== undefined) {
    fields.push(`is_active = $${paramIndex++}`);
    params.push(data.is_active);
  }
  if (data.cash_sweep_low !== undefined) {
    fields.push(`cash_sweep_low = $${paramIndex++}`);
    params.push(data.cash_sweep_low);
  }
  if (data.cash_sweep_high !== undefined) {
    fields.push(`cash_sweep_high = $${paramIndex++}`);
    params.push(data.cash_sweep_high);
  }

  if (fields.length === 0) return null;

  fields.push('updated_at = NOW()');
  params.push(id);

  const sql = `
    UPDATE forecast_scenarios SET ${fields.join(', ')}
    WHERE id = $${paramIndex}
    RETURNING *
  `;

  const result = await db.query(sql, params);
  return result.rows[0] || null;
}

/**
 * CR064 P1 — rename a scenario AND every assumptions entry keyed to its old name,
 * in one transaction.
 *
 * A scenario's period, inflation path, FX paths and tax rate live in the
 * `forecast_assumptions` document keyed by the scenario's NAME (CR039). Renaming the
 * row alone leaves them behind, and the resulting failure is not the loud one it looks
 * like: the next generate throws (`loadScenarioConfig` cannot find the scenario), the
 * owner saves Forecast Settings to clear it, that write refreshes only `scenarios` from
 * the DB names — and generate then SUCCEEDS with an empty inflation list, which
 * `buildRates` seeds as `entries[0]?.Rate ?? 0`. **0% inflation for the whole horizon,
 * silently.** Prod carries five orphaned names from renames that already happened
 * (pruned by migration 052).
 *
 * The rename is the only path that can desynchronise the two, which is why fixing the
 * path was preferred to re-keying the documents by id — see CR064 §2.3 for the two
 * places an id would have had to be rewritten, one of them silent.
 *
 * @returns the updated scenario row, or null when `id` does not exist.
 */
async function renameScenario(id, newName) {
  const name = String(newName ?? '').trim();
  if (!name) throw new Error('renameScenario: a name is required');

  return db.transaction(async (client) => {
    const current = await client.query(
      'SELECT * FROM forecast_scenarios WHERE id = $1', [id]
    );
    if (current.rows.length === 0) return null;
    const oldName = current.rows[0].name;
    if (oldName === name) return current.rows[0];

    const clash = await client.query(
      'SELECT id FROM forecast_scenarios WHERE name = $1 AND id <> $2', [name, id]
    );
    if (clash.rows.length > 0) {
      throw new Error(`renameScenario: "${name}" is already taken by scenario ${clash.rows[0].id}`);
    }

    const updated = await client.query(
      `UPDATE forecast_scenarios SET name = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
      [name, id]
    );

    // `value` is `json`, not `jsonb`, on purpose (CR039: jsonb reorders object keys and
    // broke byte-parity), so the documents are round-tripped through JS — which also
    // keeps each entry's key order exactly as stored.
    const NAME_FIELD = { scenarios: 'Name', inflation: 'Scenario', FX: 'Scenario', 'Tax Rate': 'Scenario' };
    for (const [key, field] of Object.entries(NAME_FIELD)) {
      const row = await client.query(
        'SELECT value FROM forecast_assumptions WHERE key = $1', [key]
      );
      if (row.rows.length === 0) continue;
      const raw = row.rows[0].value;
      const list = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (!Array.isArray(list)) continue;
      let touched = false;
      const next = list.map((entry) => {
        if (!entry || entry[field] !== oldName) return entry;
        touched = true;
        return { ...entry, [field]: name };
      });
      if (!touched) continue;
      await client.query(
        'UPDATE forecast_assumptions SET value = $1, updated_at = NOW() WHERE key = $2',
        [JSON.stringify(next), key]
      );
    }

    return updated.rows[0];
  });
}

/**
 * Delete a scenario (cascades to modules and incexp)
 */
async function deleteScenario(id) {
  const sql = `DELETE FROM forecast_scenarios WHERE id = $1 RETURNING id`;
  const result = await db.query(sql, [id]);
  return result.rowCount > 0;
}

const CHILD_IDENTITY = new Set(['id', 'module_id']);

/**
 * The columns a scenario copy carries into each of the module's child tables — DERIVED from
 * information_schema, never hand-kept (see the note inside `copyScenario`).
 *
 * ⚠️ Exported because CR085's fidelity gate compares a scratch copy against its source column by
 * column, and it must use THIS list. The copy deliberately omits `id` and the parent key, so a gate
 * with its own hand-kept exclusion list would false-positive on every run — and a second hand-kept
 * list is the exact drift this derivation exists to kill.
 */
async function copyChildColumns(client = db) {
  const cols = async (table, notCopied = CHILD_IDENTITY) => (await client.query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = $1
      ORDER BY ordinal_position`, [table]
  )).rows.map((r) => r.column_name).filter((c) => !notCopied.has(c));

  return {
    investCols: await cols('forecast_module_investments'),
    disposeCols: await cols('forecast_module_disposals'),
    amortCols: await cols('forecast_module_amortization'),
    streamCols: await cols('forecast_streams'),
    streamChangeCols: await cols('forecast_stream_changes', new Set(['id', 'stream_id'])),
  };
}

/**
 * Deep copy a scenario with all related data.
 *
 * @param {number} sourceId
 * @param {string} newName
 * @param {object} [opts]
 * @param {boolean} [opts.isScratch=false]  mark the copy a throwaway (CR085 P0, migration 073) —
 *   hidden from every scenario list and swept once stale. Set by the callers that create a copy
 *   to build against and delete: CR084's preview harness and CR053's auto-adjust solver. A copy
 *   the OWNER asked for is never scratch, which is why this defaults to false.
 */
async function copyScenario(sourceId, newName, { isScratch = false } = {}) {
  return await db.transaction(async (client) => {
    // Create new scenario
    const source = await client.query('SELECT * FROM forecast_scenarios WHERE id = $1', [sourceId]);
    if (source.rows.length === 0) throw new Error('Source scenario not found');

    // If target scenario already exists, use it (clear its modules/incexp first)
    // Otherwise create a new one
    const existing = await client.query('SELECT * FROM forecast_scenarios WHERE name = $1', [newName]);
    let newId;

    if (existing.rows.length > 0) {
      newId = existing.rows[0].id;
      // Mirror scenario-level fields from source onto target
      await client.query(
        `UPDATE forecast_scenarios
            SET cash_sweep_low = $1, cash_sweep_high = $2, is_scratch = $4, updated_at = NOW()
          WHERE id = $3`,
        [source.rows[0].cash_sweep_low, source.rows[0].cash_sweep_high, newId, isScratch]
      );
      // Clear existing data so we can copy fresh
      const oldModules = await client.query('SELECT id FROM forecast_modules WHERE scenario_id = $1', [newId]);
      for (const m of oldModules.rows) {
        await client.query('DELETE FROM forecast_module_investments WHERE module_id = $1', [m.id]);
        await client.query('DELETE FROM forecast_module_disposals WHERE module_id = $1', [m.id]);
      }
      await client.query('DELETE FROM forecast_modules WHERE scenario_id = $1', [newId]);
      // CR069 P3 — no incexp rows to clear: an item is a module, cleared with the modules above.
      await client.query('DELETE FROM forecast_entries WHERE scenario_id = $1', [newId]);
    } else {
      const newScenario = await client.query(`
        INSERT INTO forecast_scenarios (name, description, is_active, cash_sweep_low, cash_sweep_high, is_scratch)
        VALUES ($1, $2, TRUE, $3, $4, $5)
        RETURNING *
      `, [newName, `Copy of ${source.rows[0].name}`, source.rows[0].cash_sweep_low, source.rows[0].cash_sweep_high, isScratch]);
      newId = newScenario.rows[0].id;
    }

    // Copy the PER-SCENARIO ASSUMPTIONS (CR048): the scenario's period, its inflation path,
    // its FX paths and its tax rate all live in the `forecast_assumptions` document, keyed by
    // scenario NAME — not on the scenarios table. Until now this half was done client-side by
    // FCScenarios, so a copy made through the API produced a scenario with **0% inflation** and
    // no period: the engine would build it, and it would be quietly wrong. Same split-brain
    // shape as the CR045 §1 copy bug (a copy that silently drops a field is a scenario that
    // silently computes something else), so it belongs here, inside the same transaction.
    //
    // `value` is `json`, not `jsonb`, on purpose (CR039: jsonb reorders object keys and broke
    // byte-parity), so the document is round-tripped through JS rather than SQL operators.
    // Idempotent: any entry already keyed to the target name is replaced, never appended to —
    // a re-copy onto an existing scenario must not accumulate duplicate rows.
    const sourceName = source.rows[0].name;
    const ASSUMPTION_KEYS = ['scenarios', 'inflation', 'FX', 'Tax Rate'];
    // 'scenarios' entries key the scenario by `Name`; the rest by `Scenario`.
    const nameFieldFor = (key) => (key === 'scenarios' ? 'Name' : 'Scenario');

    for (const key of ASSUMPTION_KEYS) {
      const docRow = await client.query(
        'SELECT value FROM forecast_assumptions WHERE key = $1', [key]
      );
      if (docRow.rows.length === 0) continue;

      const raw = docRow.rows[0].value;
      const list = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (!Array.isArray(list)) continue;

      const field = nameFieldFor(key);
      const copies = list
        .filter((entry) => entry && entry[field] === sourceName)
        .map((entry) => {
          const clone = { ...entry, [field]: newName };
          delete clone.id; // the source's DB id must not ride along
          return clone;
        });
      if (copies.length === 0) continue;

      const withoutTarget = list.filter((entry) => !entry || entry[field] !== newName);
      const next = [...withoutTarget, ...copies];

      await client.query(
        'UPDATE forecast_assumptions SET value = $1, updated_at = NOW() WHERE key = $2',
        [JSON.stringify(next), key]
      );
    }

    // Copy modules
    const modules = await client.query('SELECT * FROM forecast_modules WHERE scenario_id = $1', [sourceId]);

    // CR062 P2 — modules are inserted one at a time, so a link to another module
    // cannot be resolved until every row exists. Carrying the SOURCE id through
    // would leave the copy's Equity report reading the SOURCE scenario's asset,
    // with both numbers real and neither obviously wrong. Collected here, repointed
    // in a second pass below.
    const idMap = new Map();

    // CR069 P2 — the column list is DERIVED, not hand-kept.
    //
    // The list this replaces carried its own warning: "hand-maintained, which is exactly how
    // CR045 §1 lost cash_sweep_priority and CR048 lost the assumptions". It had already lost
    // `has_valuation` (migration 057) before anyone noticed, and P2 adds streams — so this is
    // the moment it drifts again. Reading information_schema is what CR050's variant sync
    // does for the same reason and the same class of bug; identity and bookkeeping are the
    // only exclusions.
    const copyCols = (await client.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = 'forecast_modules'
          AND column_name NOT IN ('id','scenario_id','created_at','updated_at',
                                  'origin_base_id','secured_asset_module_id')
        ORDER BY ordinal_position`
    )).rows.map((r) => r.column_name);

    // CR085 P0 — the CHILD lists are derived too, for the same reason the module list above is.
    //
    // Until now only `forecast_modules` read its columns from information_schema; its five child
    // tables were still hand-enumerated. That is precisely how `disposal_cost_pct` (CR078,
    // migration 062) went missing from the disposals list — every copied scenario silently lost
    // its selling costs and reported the FULL sale proceeds, found only because a scratch copy of
    // `2026 SRQ House Purchase` measured ~890K BETTER than the original for no modelled reason.
    // `copyScenario.columns.test.js` was written then, but it guarded three of the five tables:
    // `forecast_streams` and `forecast_stream_changes` were both unguarded AND hand-enumerated,
    // in the part of the schema CR069-CR073 have been actively changing. No list is hand-kept now.
    //
    // Derived ONCE, outside the per-module loop: five information_schema reads per copy, not five
    // per module. The names come from the catalog, never from a caller, so interpolating them is
    // not an injection surface.
    const {
      investCols, disposeCols, amortCols, streamCols, streamChangeCols,
    } = await copyChildColumns(client);

    for (const mod of modules.rows) {
      const placeholders = copyCols.map((_, i) => `$${i + 2}`).join(', ');
      const newModule = await client.query(
        `INSERT INTO forecast_modules (scenario_id, ${copyCols.join(', ')})
         VALUES ($1, ${placeholders}) RETURNING id`,
        [newId, ...copyCols.map((c) => mod[c] ?? null)]
      );

      const newModuleId = newModule.rows[0].id;
      idMap.set(mod.id, newModuleId);

      // The module's three flat schedules. One shape for all of them: every column the table
      // has, straight across, under the new parent id.
      for (const [table, cols] of [
        ['forecast_module_investments', investCols],
        ['forecast_module_disposals', disposeCols],
        ['forecast_module_amortization', amortCols],
      ]) {
        await client.query(
          `INSERT INTO ${table} (module_id, ${cols.join(', ')})
           SELECT $1, ${cols.join(', ')} FROM ${table} WHERE module_id = $2`,
          [newModuleId, mod.id]
        );
      }

      // CR069 — streams, and each stream's own change rows. TWO levels, so the child ids have
      // to be remapped as they are created; a `SELECT ... INSERT` cannot express it. A copy
      // that took the streams and dropped their changes would look complete and project a
      // different number for every year the schedule touches.
      const srcStreams = await client.query(
        'SELECT * FROM forecast_streams WHERE module_id = $1 ORDER BY id', [mod.id]
      );
      for (const st of srcStreams.rows) {
        const streamPlaceholders = streamCols.map((_, i) => `$${i + 2}`).join(', ');
        const newStream = await client.query(
          `INSERT INTO forecast_streams (module_id, ${streamCols.join(', ')})
           VALUES ($1, ${streamPlaceholders}) RETURNING id`,
          [newModuleId, ...streamCols.map((c) => st[c] ?? null)]
        );
        await client.query(
          `INSERT INTO forecast_stream_changes (stream_id, ${streamChangeCols.join(', ')})
           SELECT $1, ${streamChangeCols.join(', ')}
             FROM forecast_stream_changes WHERE stream_id = $2`,
          [newStream.rows[0].id, st.id]
        );
      }
    }

    // CR062 P2 — second pass: repoint every secured-asset link at the COPY's own
    // asset. A link whose target was not copied (impossible today, since the whole
    // scenario is copied) is left NULL rather than dangling.
    for (const mod of modules.rows) {
      if (!mod.secured_asset_module_id) continue;
      const newLoanId = idMap.get(mod.id);
      const newAssetId = idMap.get(mod.secured_asset_module_id) || null;
      if (!newLoanId) continue;
      await client.query(
        'UPDATE forecast_modules SET secured_asset_module_id = $1 WHERE id = $2',
        [newAssetId, newLoanId]
      );
    }

    // Return the target scenario
    const result = await client.query('SELECT * FROM forecast_scenarios WHERE id = $1', [newId]);
    return result.rows[0];
  });
}

// ============================================================================
// Modules
// ============================================================================

/**
 * Get all modules for a scenario
 */
async function findModulesByScenario(scenarioId) {
  // CR062 — the amortization schedule rides along on the LIST, not just the detail
  // fetch. `fcWarnings` is a pure client-side derivation over what FCReview already
  // loads, and the clamp warning cannot be derived without the schedule. Serving it
  // only on GET /modules/:id is the shape that broke Modify Transfer for two years:
  // a page reads the list, the list lacks the child rows, and the feature silently
  // shows nothing. The four loan_* columns come free via `m.*`.
  const sql = `
    SELECT m.*, a.name as account_name, a.account_type, a.currency AS account_currency,
      -- CR069 P2 — the module's streams with their change rows, so list consumers (the Review
      -- page's graph point-adjust among them) can read a stream without an N+1.
      COALESCE((
        SELECT json_agg(json_build_object(
                 'id', st.id, 'direction', st.direction, 'fc_line_id', st.fc_line_id,
                 'fc_line_name', l.name, 'mode', st.mode, 'amount', st.amount,
                 'amount_usd', st.amount_usd, 'growth_mult', st.growth_mult,
                 'start_date', st.start_date, 'end_date', st.end_date,
                 'tax_rate_override', st.tax_rate_override,
                 'changes', COALESCE((
                   SELECT json_agg(json_build_object(
                            'change_date', c.change_date, 'amount', c.amount, 'flag', c.flag
                          ) ORDER BY c.change_date)
                     FROM forecast_stream_changes c WHERE c.stream_id = st.id
                 ), '[]'::json)
               ) ORDER BY st.direction, st.id)
          FROM forecast_streams st
          LEFT JOIN fc_lines l ON l.id = st.fc_line_id
         WHERE st.module_id = m.id
      ), '[]'::json) AS streams,   COALESCE((
        SELECT json_agg(json_build_object('effective_date', am.effective_date, 'pct', am.pct)
                        ORDER BY am.effective_date)
        FROM forecast_module_amortization am WHERE am.module_id = m.id
      ), '[]'::json) AS amortization,
      -- CR071 — disposal SUMMARY, not the schedule. Three of this CR's rules need to know
      -- whether a module disposes and when (a basis that equals market value only matters if
      -- something is sold; a disposal dated before PeriodStart does nothing), and the list
      -- deliberately does not carry Invest/Dispose — those are on GET /modules/:id, and
      -- shipping every row to every consumer to answer a yes/no question is the wrong trade.
      -- Scalars instead: two counts and the earliest year.
      (SELECT count(*) FROM forecast_module_disposals d WHERE d.module_id = m.id)
        AS dispose_count,
      (SELECT count(*) FROM forecast_module_disposals d
        WHERE d.module_id = m.id AND d.flag = 'Full') AS dispose_full_count,
      (SELECT min(EXTRACT(YEAR FROM d.disposal_date))::int FROM forecast_module_disposals d
        WHERE d.module_id = m.id) AS dispose_first_year
    FROM forecast_modules m
    LEFT JOIN accounts a ON m.account_id = a.id
    WHERE m.scenario_id = $1
    ORDER BY m.module_type, m.name
  `;
  const result = await db.query(sql, [scenarioId]);
  return result.rows;
}

/**
 * Get module by ID with all nested data
 */
async function findModuleById(id) {
  const moduleResult = await db.query(`
    SELECT m.*, a.name as account_name, a.account_type, a.currency AS account_currency
    FROM forecast_modules m
    LEFT JOIN accounts a ON m.account_id = a.id
    WHERE m.id = $1
  `, [id]);

  if (moduleResult.rows.length === 0) return null;

  const module = moduleResult.rows[0];

  // Get nested arrays
  const [investments, disposals, amortization] = await Promise.all([
    db.query('SELECT * FROM forecast_module_investments WHERE module_id = $1 ORDER BY investment_date', [id]),
    db.query('SELECT * FROM forecast_module_disposals WHERE module_id = $1 ORDER BY disposal_date', [id]),
    db.query('SELECT * FROM forecast_module_amortization WHERE module_id = $1 ORDER BY effective_date', [id])
  ]);

  // CR069 P3 — the yield schedule and the income steps are stream change rows now; the route
  // loads them with the streams themselves.
  module.investments = investments.rows;
  module.disposals = disposals.rows;
  module.amortization = amortization.rows;

  return module;
}

/**
 * Every column on forecast_modules a caller may write, in one place.
 *
 * It used to be TWO places — createModule carried its own hand-written INSERT
 * list and updateModule its own allow-list — and they drifted, exactly as the
 * shapes they were guarding against did. The create list was missing CR046's
 * four window dates and CR047's income tax override, all five of which the route
 * had already mapped into `moduleData`: POST returned 201 and threw them away.
 * Silent, and identical to the v3.0.86 defect one layer up in fcModulePayload.
 *
 * Defaults live here too, because "what column" and "what does absent mean" are
 * the same question. `??` where NULL is load-bearing (a 0% rate is a real rate,
 * not "unset"); `||` where 0 and NULL mean the same thing.
 *
 * A test asserts this list covers every non-managed column in the live catalogue,
 * so the next migration that adds one cannot silently go unwired.
 */
const MODULE_COLUMN_DEFAULTS = {
  // CR069 P3 — the eleven income_/expense_ columns are GONE (migration 060). A module's flows
  // are rows in `forecast_streams`, written by `crud.replaceModuleStreams`. Leaving them here
  // would put a dropped column in every INSERT.
  account_id: (d) => d.account_id || null,
  name: (d) => d.name,
  module_type: (d) => d.module_type || null,
  currency: (d) => d.currency || 'USD',
  base_date: (d) => d.base_date || null,
  base_value: (d) => d.base_value || 0,
  market_value: (d) => d.market_value || 0,
  base_value_usd: (d) => d.base_value_usd || 0,
  market_value_usd: (d) => d.market_value_usd || 0,
  growth_rate: (d) => d.growth_rate || 0,
  comment: (d) => d.comment || null,
  is_matched: (d) => d.is_matched || false,
  setup_status: (d) => d.setup_status || 'new',
  tax_rate_override: (d) => d.tax_rate_override ?? null,
  // CR064 P6 — multiplier of inflation for amount-based income. NULL = 1 = grow at
  // inflation, the pre-CR064 behaviour, which is what keeps migration 055 dormant.
  cash_sweep_target: (d) => d.cash_sweep_target || false,
  cash_sweep_priority: (d) => d.cash_sweep_priority ?? null,
  // CR046 window — these are the five the old INSERT dropped.
  // CR062 — NULL is "not a loan", so `?? null`: `|| null` would turn a legitimate
  // 0% rate into one.
  loan_principal: (d) => d.loan_principal ?? null,
  loan_start_date: (d) => d.loan_start_date ?? null,
  loan_end_date: (d) => d.loan_end_date ?? null,
  loan_interest_rate: (d) => d.loan_interest_rate ?? null,
  // CR069 P2 — FALSE = a pure P&L container (a converted Expenditure item): no valuation, and
  // the CR041 ownership gate does not apply to its streams. Defaults TRUE, which is what every
  // module written before this CR is.
  has_valuation: (d) => d.has_valuation ?? true,
  secured_asset_module_id: (d) => d.secured_asset_module_id ?? null,
};

const MODULE_WRITABLE_COLUMNS = Object.keys(MODULE_COLUMN_DEFAULTS);

/**
 * Create a new module
 */
async function createModule(data) {
  const cols = ['scenario_id', ...MODULE_WRITABLE_COLUMNS];
  const values = [data.scenario_id, ...MODULE_WRITABLE_COLUMNS.map((c) => MODULE_COLUMN_DEFAULTS[c](data))];
  const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');

  const result = await db.query(
    `INSERT INTO forecast_modules (${cols.join(', ')}) VALUES (${placeholders}) RETURNING *`,
    values
  );

  return result.rows[0];
}

/**
 * Update a module
 */
async function updateModule(id, data) {
  const fields = [];
  const params = [];
  let paramIndex = 1;

  // One list, shared with createModule — see MODULE_COLUMN_DEFAULTS.
  const allowedFields = MODULE_WRITABLE_COLUMNS;

  const patch = {};
  for (const field of allowedFields) {
    if (data[field] !== undefined) {
      fields.push(`${field} = $${paramIndex++}`);
      params.push(data[field]);
      patch[field] = data[field];
    }
  }

  if (fields.length === 0) return null;

  // CR050: on a variant's INHERITED row this is not an update, it is an override. Intercepted
  // here rather than in the route so that every caller is covered — PUT /modules/:id, PATCH
  // /modules/bulk-update, and whatever comes next. A write that reached the row directly would
  // be silently erased by the next sync, which is the one failure mode this feature must not have.
  const intercepted = await variants.interceptWrite('module', id, patch);
  if (intercepted.intercepted) return intercepted.row;

  fields.push('updated_at = NOW()');
  params.push(id);

  const sql = `UPDATE forecast_modules SET ${fields.join(', ')} WHERE id = $${paramIndex} RETURNING *`;
  const result = await db.query(sql, params);
  return result.rows[0] || null;
}

/**
 * Delete a module
 */
async function deleteModule(id) {
  // CR050: deleting an inherited row on a variant is a TOMBSTONE ("hide this in Downside"),
  // not a row delete — the next sync would otherwise re-materialize it from the base.
  const intercepted = await variants.interceptDelete('module', id);
  if (intercepted.intercepted) return intercepted.deleted;

  const sql = `DELETE FROM forecast_modules WHERE id = $1 RETURNING id`;
  const result = await db.query(sql, [id]);
  return result.rowCount > 0;
}

// ============================================================================
// Module nested data (investments, disposals, income_pct)
// ============================================================================

// The optional `client` on the three helpers below lets callers run them
// inside a db.transaction (pool and client share the .query signature) —
// the module PUT's delete-then-reinsert must be atomic (CR037 P5).
async function addInvestment(moduleId, data, client = db) {
  const sql = `
    INSERT INTO forecast_module_investments (module_id, investment_date, amount, flag, note, date_end)
    VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING *
  `;
  const result = await client.query(sql, [moduleId, data.investment_date, data.amount, data.flag, data.note, data.date_end || null]);
  return result.rows[0];
}

async function addDisposal(moduleId, data, client = db) {
  const sql = `
    INSERT INTO forecast_module_disposals
      (module_id, disposal_date, amount, flag, note, date_end, disposal_cost_pct)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    RETURNING *
  `;
  const amount = data.amount ?? (data.flag === 'Full' ? 0 : null);
  // CR078 — NULL and 0 mean different things here and both must survive the write. NULL is
  // "no selling cost modelled" (the migration's default, and what CR077's advisory asks about);
  // 0 is "considered, and free". `?? null` keeps an absent key NULL without turning a typed 0
  // into one, which `|| null` would.
  const costPct = data.disposal_cost_pct ?? null;
  const result = await client.query(sql, [
    moduleId, data.disposal_date, amount, data.flag, data.note, data.date_end || null, costPct,
  ]);
  return result.rows[0];
}



/** CR062: one year of a loan's principal schedule, as a % of loan_principal. */
async function setAmortization(moduleId, data, client = db) {
  const sql = `
    INSERT INTO forecast_module_amortization (module_id, effective_date, pct)
    VALUES ($1, $2, $3)
    ON CONFLICT (module_id, effective_date) DO UPDATE SET pct = EXCLUDED.pct
    RETURNING *
  `;
  const result = await client.query(sql, [moduleId, data.effective_date, data.pct]);
  return result.rows[0];
}

// ============================================================================
// Income/Expense Items
// ============================================================================

/**
 * Get distinct years for a scenario
 */
async function findYearsByScenario(scenarioId) {
  const sql = `
    SELECT DISTINCT forecast_year
    FROM forecast_entries
    WHERE scenario_id = $1
    ORDER BY forecast_year
  `;
  const result = await db.query(sql, [scenarioId]);
  return result.rows.map(row => row.forecast_year);
}


// ============================================================================
// Income/expense items — RETIRED by CR069 P3, with their tables.
//
// An Expenditure item is a module with `has_valuation = FALSE` and one stream, so every
// function that lived here (findIncExpByScenario, findIncExpById, createIncExp, updateIncExp,
// deleteIncExp, addIncExpChange) has a module equivalent one call away. They are deleted
// rather than left as unreachable exports: migration 060 drops the tables they name, so
// keeping them would mean shipping code that throws on its first line.
// ============================================================================

/**
 * Get entries for a scenario
 */
async function findEntriesByScenario(scenarioId) {
  const sql = `
    SELECT forecast_year as "Year", account as "Account", amount as "Amount",
           module as "Module", entry_type as "EntryType"
    FROM forecast_entries
    WHERE scenario_id = $1
    ORDER BY forecast_year, account
  `;
  const result = await db.query(sql, [scenarioId]);
  return result.rows;
}

/**
 * Get all entries (optionally filtered by scenario name)
 */
async function findAllEntries(scenarioName) {
  let sql = `
    SELECT fe.forecast_year as "Year", fe.account as "Account", fe.amount as "Amount",
           fe.module as "Module", fe.entry_type as "EntryType", fe.comment as "Comment", fs.name as "Scenario"
    FROM forecast_entries fe
    JOIN forecast_scenarios fs ON fe.scenario_id = fs.id
  `;
  const params = [];

  if (scenarioName) {
    sql += ` WHERE fs.name = $1`;
    params.push(scenarioName);
  }

  sql += ` ORDER BY fs.name, fe.forecast_year, fe.account`;
  const result = await db.query(sql, params);
  return result.rows;
}

// ============================================================================
// Unmatched Accounts
// ============================================================================

/**
 * Get matched module names/accounts for a scenario
 */
async function findMatchedModuleNames(scenarioId) {
  const sql = `
    SELECT DISTINCT m.name, a.name as account_name
    FROM forecast_modules m
    LEFT JOIN accounts a ON m.account_id = a.id
    WHERE m.scenario_id = $1 AND m.is_matched = TRUE
  `;
  const result = await db.query(sql, [scenarioId]);
  const names = new Set();
  for (const row of result.rows) {
    if (row.name) names.add(row.name);
    if (row.account_name) names.add(row.account_name);
  }
  return names;
}


// ============================================================================
// Warning dismissals (CR074)
// ============================================================================

/** `{ [warning_id]: fingerprint }` — the shape the panel filters with. */
async function findWarningDismissals(scenarioId) {
  const result = await db.query(
    'SELECT warning_id, fingerprint FROM forecast_warning_dismissals WHERE scenario_id = $1',
    [scenarioId]
  );
  return Object.fromEntries(result.rows.map((r) => [r.warning_id, r.fingerprint]));
}

/**
 * Upsert one or many. Re-dismissing an id REPLACES its fingerprint, which is what makes
 * "dismiss again after the numbers moved" mean "I have accepted this new version too" rather
 * than silently keeping the stale one.
 */
async function dismissWarnings(scenarioId, items = []) {
  if (!items.length) return 0;
  const values = [];
  const params = [scenarioId];
  for (const it of items) {
    params.push(String(it.warningId), String(it.fingerprint));
    values.push(`($1, $${params.length - 1}, $${params.length})`);
  }
  const result = await db.query(
    `INSERT INTO forecast_warning_dismissals (scenario_id, warning_id, fingerprint)
     VALUES ${values.join(', ')}
     ON CONFLICT (scenario_id, warning_id)
     DO UPDATE SET fingerprint = EXCLUDED.fingerprint, dismissed_at = NOW()`,
    params
  );
  return result.rowCount;
}

/** Restore one warning, or — with no id — every dismissal in the scenario. */
async function restoreWarnings(scenarioId, warningId = null) {
  const result = warningId
    ? await db.query(
        'DELETE FROM forecast_warning_dismissals WHERE scenario_id = $1 AND warning_id = $2',
        [scenarioId, warningId]
      )
    : await db.query(
        'DELETE FROM forecast_warning_dismissals WHERE scenario_id = $1', [scenarioId]
      );
  return result.rowCount;
}

module.exports = {
  // Scenarios
  findAllScenarios,
  findScenarioById,
  findScenarioByName,
  createScenario,
  updateScenario,
  renameScenario,
  deleteScenario,
  copyScenario,
  copyChildColumns,
  // Modules
  findModulesByScenario,
  findModuleById,
  createModule,
  MODULE_WRITABLE_COLUMNS,
  updateModule,
  deleteModule,
  addInvestment,
  addDisposal,
  setAmortization,
  // Income/Expense
  // Entries
  findYearsByScenario,
  findEntriesByScenario,
  findAllEntries,
  findMatchedModuleNames,
  // Warning dismissals (CR074)
  findWarningDismissals,
  dismissWarnings,
  restoreWarnings,
};
