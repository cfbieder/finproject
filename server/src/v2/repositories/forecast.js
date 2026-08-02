/**
 * Forecast Repository
 *
 * Database operations for forecast tables:
 * - forecast_scenarios
 * - forecast_modules (with investments, disposals, income_pct)
 * - forecast_income_expense (with changes)
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
  const whereClause = activeOnly ? 'WHERE is_active = TRUE' : '';
  const sql = `
    SELECT s.*,
      (SELECT COUNT(*)::int FROM forecast_modules WHERE scenario_id = s.id) as module_count,
      (SELECT COUNT(*)::int FROM forecast_income_expense WHERE scenario_id = s.id) as incexp_count
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

/**
 * Deep copy a scenario with all related data
 */
async function copyScenario(sourceId, newName) {
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
        'UPDATE forecast_scenarios SET cash_sweep_low = $1, cash_sweep_high = $2, updated_at = NOW() WHERE id = $3',
        [source.rows[0].cash_sweep_low, source.rows[0].cash_sweep_high, newId]
      );
      // Clear existing data so we can copy fresh
      const oldModules = await client.query('SELECT id FROM forecast_modules WHERE scenario_id = $1', [newId]);
      for (const m of oldModules.rows) {
        await client.query('DELETE FROM forecast_module_income_pct WHERE module_id = $1', [m.id]);
        await client.query('DELETE FROM forecast_module_income_steps WHERE module_id = $1', [m.id]);
        await client.query('DELETE FROM forecast_module_investments WHERE module_id = $1', [m.id]);
        await client.query('DELETE FROM forecast_module_disposals WHERE module_id = $1', [m.id]);
      }
      await client.query('DELETE FROM forecast_modules WHERE scenario_id = $1', [newId]);
      const oldIncexp = await client.query('SELECT id FROM forecast_income_expense WHERE scenario_id = $1', [newId]);
      for (const ie of oldIncexp.rows) {
        await client.query('DELETE FROM forecast_incexp_changes WHERE incexp_id = $1', [ie.id]);
      }
      await client.query('DELETE FROM forecast_income_expense WHERE scenario_id = $1', [newId]);
      await client.query('DELETE FROM forecast_entries WHERE scenario_id = $1', [newId]);
    } else {
      const newScenario = await client.query(`
        INSERT INTO forecast_scenarios (name, description, is_active, cash_sweep_low, cash_sweep_high)
        VALUES ($1, $2, TRUE, $3, $4)
        RETURNING *
      `, [newName, `Copy of ${source.rows[0].name}`, source.rows[0].cash_sweep_low, source.rows[0].cash_sweep_high]);
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

    for (const mod of modules.rows) {
      const newModule = await client.query(`
        INSERT INTO forecast_modules (
          scenario_id, account_id, name, module_type, currency,
          expense_amount, expense_fc_line_id, income_fc_line_id, expense_growth_method,
          income_amount, base_date, base_value,
          market_value, base_value_usd, market_value_usd,
          growth_rate, comment, is_matched,
          setup_status, cash_sweep_target, tax_rate_override, cash_sweep_priority,
          income_start_date, income_end_date, expense_start_date, expense_end_date,
          income_tax_rate_override, income_growth_rate,
          loan_principal, loan_start_date, loan_end_date, loan_interest_rate
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32)
        RETURNING id
      `, [
        newId, mod.account_id, mod.name, mod.module_type, mod.currency,
        mod.expense_amount, mod.expense_fc_line_id, mod.income_fc_line_id, mod.expense_growth_method || 'inflation',
        mod.income_amount, mod.base_date, mod.base_value,
        mod.market_value, mod.base_value_usd, mod.market_value_usd,
        mod.growth_rate, mod.comment, mod.is_matched,
        mod.setup_status || 'new', mod.cash_sweep_target || false, mod.tax_rate_override,
        mod.cash_sweep_priority,
        mod.income_start_date, mod.income_end_date, mod.expense_start_date, mod.expense_end_date,
        mod.income_tax_rate_override, mod.income_growth_rate,
        // CR062 — this list is hand-maintained, which is exactly how CR045 §1 lost
        // cash_sweep_priority and CR048 lost the assumptions: a column a copy drops
        // is a scenario that silently computes something else. Covered by a test
        // that asserts on the COPY, not the source.
        mod.loan_principal, mod.loan_start_date, mod.loan_end_date, mod.loan_interest_rate
      ]);

      const newModuleId = newModule.rows[0].id;
      idMap.set(mod.id, newModuleId);

      // Copy income_pct
      await client.query(`
        INSERT INTO forecast_module_income_pct (module_id, effective_date, value)
        SELECT $1, effective_date, value FROM forecast_module_income_pct WHERE module_id = $2
      `, [newModuleId, mod.id]);

      // Copy the CR064 income steps
      await client.query(`
        INSERT INTO forecast_module_income_steps (module_id, effective_date, amount)
        SELECT $1, effective_date, amount FROM forecast_module_income_steps WHERE module_id = $2
      `, [newModuleId, mod.id]);

      // Copy investments
      await client.query(`
        INSERT INTO forecast_module_investments (module_id, investment_date, amount, flag, note, date_end)
        SELECT $1, investment_date, amount, flag, note, date_end FROM forecast_module_investments WHERE module_id = $2
      `, [newModuleId, mod.id]);

      // Copy disposals
      await client.query(`
        INSERT INTO forecast_module_disposals (module_id, disposal_date, amount, flag, note, date_end)
        SELECT $1, disposal_date, amount, flag, note, date_end FROM forecast_module_disposals WHERE module_id = $2
      `, [newModuleId, mod.id]);

      // Copy the CR062 amortization schedule
      await client.query(`
        INSERT INTO forecast_module_amortization (module_id, effective_date, pct)
        SELECT $1, effective_date, pct FROM forecast_module_amortization WHERE module_id = $2
      `, [newModuleId, mod.id]);
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

    // Copy income/expense items
    const incexp = await client.query('SELECT * FROM forecast_income_expense WHERE scenario_id = $1', [sourceId]);

    for (const item of incexp.rows) {
      const newItem = await client.query(`
        INSERT INTO forecast_income_expense (
          scenario_id, account_id, name, item_type, currency,
          base_date, base_value, base_value_usd, growth_rate, comment, is_matched,
          setup_status, fc_line_id, budget_source_year
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
        RETURNING id
      `, [
        newId, item.account_id, item.name, item.item_type, item.currency,
        item.base_date, item.base_value, item.base_value_usd,
        item.growth_rate, item.comment, item.is_matched,
        item.setup_status || 'new', item.fc_line_id, item.budget_source_year
      ]);

      const newItemId = newItem.rows[0].id;

      // Copy changes
      await client.query(`
        INSERT INTO forecast_incexp_changes (incexp_id, change_date, amount, flag, note)
        SELECT $1, change_date, amount, flag, note FROM forecast_incexp_changes WHERE incexp_id = $2
      `, [newItemId, item.id]);
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
    SELECT m.*, a.name as account_name, a.account_type,
      COALESCE((
        SELECT json_agg(json_build_object('effective_date', am.effective_date, 'pct', am.pct)
                        ORDER BY am.effective_date)
        FROM forecast_module_amortization am WHERE am.module_id = m.id
      ), '[]'::json) AS amortization
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
    SELECT m.*, a.name as account_name, a.account_type
    FROM forecast_modules m
    LEFT JOIN accounts a ON m.account_id = a.id
    WHERE m.id = $1
  `, [id]);

  if (moduleResult.rows.length === 0) return null;

  const module = moduleResult.rows[0];

  // Get nested arrays
  const [incomePct, investments, disposals, amortization, incomeSteps] = await Promise.all([
    db.query('SELECT * FROM forecast_module_income_pct WHERE module_id = $1 ORDER BY effective_date', [id]),
    db.query('SELECT * FROM forecast_module_investments WHERE module_id = $1 ORDER BY investment_date', [id]),
    db.query('SELECT * FROM forecast_module_disposals WHERE module_id = $1 ORDER BY disposal_date', [id]),
    db.query('SELECT * FROM forecast_module_amortization WHERE module_id = $1 ORDER BY effective_date', [id]),
    db.query('SELECT * FROM forecast_module_income_steps WHERE module_id = $1 ORDER BY effective_date', [id])
  ]);

  module.income_steps = incomeSteps.rows;
  module.income_pct = incomePct.rows;
  module.investments = investments.rows;
  module.disposals = disposals.rows;
  module.amortization = amortization.rows;

  return module;
}

/**
 * Create a new module
 */
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
  account_id: (d) => d.account_id || null,
  name: (d) => d.name,
  module_type: (d) => d.module_type || null,
  currency: (d) => d.currency || 'USD',
  expense_amount: (d) => d.expense_amount || 0,
  expense_fc_line_id: (d) => d.expense_fc_line_id || null,
  income_fc_line_id: (d) => d.income_fc_line_id || null,
  expense_growth_method: (d) => d.expense_growth_method || 'inflation',
  income_amount: (d) => d.income_amount || 0,
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
  income_tax_rate_override: (d) => d.income_tax_rate_override ?? null,
  // CR064 P6 — multiplier of inflation for amount-based income. NULL = 1 = grow at
  // inflation, the pre-CR064 behaviour, which is what keeps migration 055 dormant.
  income_growth_rate: (d) => d.income_growth_rate ?? null,
  cash_sweep_target: (d) => d.cash_sweep_target || false,
  cash_sweep_priority: (d) => d.cash_sweep_priority ?? null,
  // CR046 window — these are the five the old INSERT dropped.
  income_start_date: (d) => d.income_start_date || null,
  income_end_date: (d) => d.income_end_date || null,
  expense_start_date: (d) => d.expense_start_date || null,
  expense_end_date: (d) => d.expense_end_date || null,
  // CR062 — NULL is "not a loan", so `?? null`: `|| null` would turn a legitimate
  // 0% rate into one.
  loan_principal: (d) => d.loan_principal ?? null,
  loan_start_date: (d) => d.loan_start_date ?? null,
  loan_end_date: (d) => d.loan_end_date ?? null,
  loan_interest_rate: (d) => d.loan_interest_rate ?? null,
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
    INSERT INTO forecast_module_disposals (module_id, disposal_date, amount, flag, note, date_end)
    VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING *
  `;
  const amount = data.amount ?? (data.flag === 'Full' ? 0 : null);
  const result = await client.query(sql, [moduleId, data.disposal_date, amount, data.flag, data.note, data.date_end || null]);
  return result.rows[0];
}

async function setIncomePct(moduleId, data, client = db) {
  const sql = `
    INSERT INTO forecast_module_income_pct (module_id, effective_date, value)
    VALUES ($1, $2, $3)
    ON CONFLICT (module_id, effective_date) DO UPDATE SET value = EXCLUDED.value
    RETURNING *
  `;
  const result = await client.query(sql, [moduleId, data.effective_date, data.value]);
  return result.rows[0];
}

/**
 * CR064 P6: one permanent step change to amount-based income ("2027: +10,000").
 * `amount` is signed — a business losing a contract is the same field, negative.
 */
async function setIncomeStep(moduleId, data, client = db) {
  const sql = `
    INSERT INTO forecast_module_income_steps (module_id, effective_date, amount)
    VALUES ($1, $2, $3)
    ON CONFLICT (module_id, effective_date) DO UPDATE SET amount = EXCLUDED.amount
    RETURNING *
  `;
  const result = await client.query(sql, [moduleId, data.effective_date, data.amount]);
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
 * Get all income/expense items for a scenario (with changes)
 */
async function findIncExpByScenario(scenarioId) {
  const sql = `
    SELECT ie.*, a.name as account_name, fl.name as fc_line_name
    FROM forecast_income_expense ie
    LEFT JOIN accounts a ON ie.account_id = a.id
    LEFT JOIN fc_lines fl ON ie.fc_line_id = fl.id
    WHERE ie.scenario_id = $1
    ORDER BY ie.item_type, ie.name
  `;
  const result = await db.query(sql, [scenarioId]);
  const items = result.rows;

  // Fetch changes for all items in one query
  if (items.length > 0) {
    const itemIds = items.map(item => item.id);
    const changesResult = await db.query(`
      SELECT * FROM forecast_incexp_changes
      WHERE incexp_id = ANY($1)
      ORDER BY change_date
    `, [itemIds]);

    // Group changes by incexp_id
    const changesByItem = {};
    for (const change of changesResult.rows) {
      if (!changesByItem[change.incexp_id]) {
        changesByItem[change.incexp_id] = [];
      }
      changesByItem[change.incexp_id].push({
        Date: change.change_date,
        Amount: change.amount,
        Flag: change.flag || '',
      });
    }

    // Attach changes to items
    for (const item of items) {
      item.changes = changesByItem[item.id] || [];
    }
  }

  return items;
}

/**
 * Get income/expense item by ID with changes
 */
async function findIncExpById(id) {
  const itemResult = await db.query(`
    SELECT ie.*, a.name as account_name
    FROM forecast_income_expense ie
    LEFT JOIN accounts a ON ie.account_id = a.id
    WHERE ie.id = $1
  `, [id]);

  if (itemResult.rows.length === 0) return null;

  const item = itemResult.rows[0];
  const changes = await db.query(
    'SELECT * FROM forecast_incexp_changes WHERE incexp_id = $1 ORDER BY change_date',
    [id]
  );
  item.changes = changes.rows;

  return item;
}

/**
 * Create income/expense item
 */
async function createIncExp(data) {
  const sql = `
    INSERT INTO forecast_income_expense (
      scenario_id, account_id, name, item_type, currency,
      base_date, base_value, base_value_usd, growth_rate, comment, is_matched,
      fc_line_id, budget_source_year
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
    RETURNING *
  `;

  const result = await db.query(sql, [
    data.scenario_id,
    data.account_id || null,
    data.name,
    data.item_type,
    data.currency || 'USD',
    data.base_date || null,
    data.base_value || 0,
    data.base_value_usd || 0,
    data.growth_rate || 0,
    data.comment || null,
    data.is_matched || false,
    data.fc_line_id || null,
    data.budget_source_year || null
  ]);

  return result.rows[0];
}

/**
 * Add change to income/expense item
 */
async function addIncExpChange(incexpId, data) {
  const sql = `
    INSERT INTO forecast_incexp_changes (incexp_id, change_date, amount, flag, note)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING *
  `;
  const result = await db.query(sql, [incexpId, data.change_date, data.amount, data.flag, data.note]);
  return result.rows[0];
}

/**
 * Update income/expense item
 */
async function updateIncExp(id, data) {
  const fields = [];
  const params = [];
  let paramIndex = 1;

  const allowedFields = [
    'account_id', 'name', 'item_type', 'currency',
    'base_date', 'base_value', 'base_value_usd',
    'growth_rate', 'comment', 'is_matched', 'setup_status'
  ];

  const patch = {};
  for (const field of allowedFields) {
    if (data[field] !== undefined) {
      fields.push(`${field} = $${paramIndex++}`);
      params.push(data[field]);
      patch[field] = data[field];
    }
  }

  if (fields.length === 0) return null;

  // CR050 — see updateModule: on a variant's inherited row, an edit is an override.
  const intercepted = await variants.interceptWrite('incexp', id, patch);
  if (intercepted.intercepted) return intercepted.row;

  fields.push('updated_at = NOW()');
  params.push(id);

  const sql = `UPDATE forecast_income_expense SET ${fields.join(', ')} WHERE id = $${paramIndex} RETURNING *`;
  const result = await db.query(sql, params);
  return result.rows[0] || null;
}

/**
 * Delete income/expense item
 */
async function deleteIncExp(id) {
  const intercepted = await variants.interceptDelete('incexp', id); // CR050: tombstone, not delete
  if (intercepted.intercepted) return intercepted.deleted;

  const sql = `DELETE FROM forecast_income_expense WHERE id = $1 RETURNING id`;
  const result = await db.query(sql, [id]);
  return result.rowCount > 0;
}

// ============================================================================
// Forecast Entries
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
  // Modules
  findModulesByScenario,
  findModuleById,
  createModule,
  MODULE_WRITABLE_COLUMNS,
  updateModule,
  deleteModule,
  addInvestment,
  addDisposal,
  setIncomePct,
  setIncomeStep,
  setAmortization,
  // Income/Expense
  findIncExpByScenario,
  findIncExpById,
  createIncExp,
  updateIncExp,
  deleteIncExp,
  addIncExpChange,
  // Entries
  findYearsByScenario,
  findEntriesByScenario,
  findAllEntries,
  findMatchedModuleNames
};
