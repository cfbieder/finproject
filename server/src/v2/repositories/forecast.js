/**
 * Forecast Repository
 *
 * Database operations for forecast tables:
 * - forecast_scenarios
 * - forecast_modules (with investments, disposals, income_pct)
 * - forecast_income_expense (with changes)
 */

const db = require('../db');

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

  if (data.name !== undefined) {
    fields.push(`name = $${paramIndex++}`);
    params.push(data.name);
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
      // Clear existing data so we can copy fresh
      const oldModules = await client.query('SELECT id FROM forecast_modules WHERE scenario_id = $1', [newId]);
      for (const m of oldModules.rows) {
        await client.query('DELETE FROM forecast_module_income_pct WHERE module_id = $1', [m.id]);
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
        INSERT INTO forecast_scenarios (name, description, is_active)
        VALUES ($1, $2, TRUE)
        RETURNING *
      `, [newName, `Copy of ${source.rows[0].name}`]);
      newId = newScenario.rows[0].id;
    }

    // Copy modules
    const modules = await client.query('SELECT * FROM forecast_modules WHERE scenario_id = $1', [sourceId]);

    for (const mod of modules.rows) {
      const newModule = await client.query(`
        INSERT INTO forecast_modules (
          scenario_id, account_id, name, module_type, currency,
          expense_amount, expense_fc_line_id, income_fc_line_id, expense_growth_method,
          income_amount, base_date, base_value,
          market_value, base_value_usd, market_value_usd,
          growth_rate, comment, is_matched
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
        RETURNING id
      `, [
        newId, mod.account_id, mod.name, mod.module_type, mod.currency,
        mod.expense_amount, mod.expense_fc_line_id, mod.income_fc_line_id, mod.expense_growth_method || 'inflation',
        mod.income_amount, mod.base_date, mod.base_value,
        mod.market_value, mod.base_value_usd, mod.market_value_usd,
        mod.growth_rate, mod.comment, mod.is_matched
      ]);

      const newModuleId = newModule.rows[0].id;

      // Copy income_pct
      await client.query(`
        INSERT INTO forecast_module_income_pct (module_id, effective_date, value)
        SELECT $1, effective_date, value FROM forecast_module_income_pct WHERE module_id = $2
      `, [newModuleId, mod.id]);

      // Copy investments
      await client.query(`
        INSERT INTO forecast_module_investments (module_id, investment_date, amount, flag, note)
        SELECT $1, investment_date, amount, flag, note FROM forecast_module_investments WHERE module_id = $2
      `, [newModuleId, mod.id]);

      // Copy disposals
      await client.query(`
        INSERT INTO forecast_module_disposals (module_id, disposal_date, amount, flag, note, date_end)
        SELECT $1, disposal_date, amount, flag, note, date_end FROM forecast_module_disposals WHERE module_id = $2
      `, [newModuleId, mod.id]);
    }

    // Copy income/expense items
    const incexp = await client.query('SELECT * FROM forecast_income_expense WHERE scenario_id = $1', [sourceId]);

    for (const item of incexp.rows) {
      const newItem = await client.query(`
        INSERT INTO forecast_income_expense (
          scenario_id, account_id, name, item_type, currency,
          base_date, base_value, base_value_usd, growth_rate, comment, is_matched
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        RETURNING id
      `, [
        newId, item.account_id, item.name, item.item_type, item.currency,
        item.base_date, item.base_value, item.base_value_usd,
        item.growth_rate, item.comment, item.is_matched
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
  const sql = `
    SELECT m.*, a.name as account_name, a.account_type
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
  const [incomePct, investments, disposals] = await Promise.all([
    db.query('SELECT * FROM forecast_module_income_pct WHERE module_id = $1 ORDER BY effective_date', [id]),
    db.query('SELECT * FROM forecast_module_investments WHERE module_id = $1 ORDER BY investment_date', [id]),
    db.query('SELECT * FROM forecast_module_disposals WHERE module_id = $1 ORDER BY disposal_date', [id])
  ]);

  module.income_pct = incomePct.rows;
  module.investments = investments.rows;
  module.disposals = disposals.rows;

  return module;
}

/**
 * Create a new module
 */
async function createModule(data) {
  const sql = `
    INSERT INTO forecast_modules (
      scenario_id, account_id, name, module_type, currency,
      expense_amount, expense_fc_line_id, income_fc_line_id, expense_growth_method,
      income_amount, base_date, base_value,
      market_value, base_value_usd, market_value_usd,
      growth_rate, comment, is_matched
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
    RETURNING *
  `;

  const result = await db.query(sql, [
    data.scenario_id,
    data.account_id || null,
    data.name,
    data.module_type || null,
    data.currency || 'USD',
    data.expense_amount || 0,
    data.expense_fc_line_id || null,
    data.income_fc_line_id || null,
    data.expense_growth_method || 'inflation',
    data.income_amount || 0,
    data.base_date || null,
    data.base_value || 0,
    data.market_value || 0,
    data.base_value_usd || 0,
    data.market_value_usd || 0,
    data.growth_rate || 0,
    data.comment || null,
    data.is_matched || false
  ]);

  return result.rows[0];
}

/**
 * Update a module
 */
async function updateModule(id, data) {
  const fields = [];
  const params = [];
  let paramIndex = 1;

  const allowedFields = [
    'account_id', 'name', 'module_type', 'currency',
    'expense_amount', 'expense_fc_line_id', 'income_fc_line_id', 'expense_growth_method',
    'income_amount', 'base_date', 'base_value', 'tax_rate_override', 'setup_status',
    'market_value', 'base_value_usd', 'market_value_usd',
    'growth_rate', 'comment', 'is_matched', 'cash_sweep_target'
  ];

  for (const field of allowedFields) {
    if (data[field] !== undefined) {
      fields.push(`${field} = $${paramIndex++}`);
      params.push(data[field]);
    }
  }

  if (fields.length === 0) return null;

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
  const sql = `DELETE FROM forecast_modules WHERE id = $1 RETURNING id`;
  const result = await db.query(sql, [id]);
  return result.rowCount > 0;
}

// ============================================================================
// Module nested data (investments, disposals, income_pct)
// ============================================================================

async function addInvestment(moduleId, data) {
  const sql = `
    INSERT INTO forecast_module_investments (module_id, investment_date, amount, flag, note)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING *
  `;
  const result = await db.query(sql, [moduleId, data.investment_date, data.amount, data.flag, data.note]);
  return result.rows[0];
}

async function addDisposal(moduleId, data) {
  const sql = `
    INSERT INTO forecast_module_disposals (module_id, disposal_date, amount, flag, note, date_end)
    VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING *
  `;
  const amount = data.amount ?? (data.flag === 'Full' ? 0 : null);
  const result = await db.query(sql, [moduleId, data.disposal_date, amount, data.flag, data.note, data.date_end || null]);
  return result.rows[0];
}

async function setIncomePct(moduleId, data) {
  const sql = `
    INSERT INTO forecast_module_income_pct (module_id, effective_date, value)
    VALUES ($1, $2, $3)
    ON CONFLICT (module_id, effective_date) DO UPDATE SET value = EXCLUDED.value
    RETURNING *
  `;
  const result = await db.query(sql, [moduleId, data.effective_date, data.value]);
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
    SELECT ie.*, a.name as account_name
    FROM forecast_income_expense ie
    LEFT JOIN accounts a ON ie.account_id = a.id
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

  for (const field of allowedFields) {
    if (data[field] !== undefined) {
      fields.push(`${field} = $${paramIndex++}`);
      params.push(data[field]);
    }
  }

  if (fields.length === 0) return null;

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
  deleteScenario,
  copyScenario,
  // Modules
  findModulesByScenario,
  findModuleById,
  createModule,
  updateModule,
  deleteModule,
  addInvestment,
  addDisposal,
  setIncomePct,
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
