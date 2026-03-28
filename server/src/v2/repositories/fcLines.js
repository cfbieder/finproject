/**
 * FC Lines Repository
 *
 * Database operations for fc_lines and fc_line_categories tables.
 * FC Lines are user-defined forecast income/expense lines that map
 * budget categories to forecast modules or income/expense items.
 */

const db = require('../db');

/**
 * Get all FC Lines with their assigned categories
 */
async function findAll(budgetYear) {
  const linesResult = await db.query(`
    SELECT l.*,
      (SELECT COUNT(*) FROM fc_line_categories flc WHERE flc.fc_line_id = l.id) as category_count
    FROM fc_lines l
    ORDER BY l.display_order, l.name
  `);

  const catsResult = await db.query(`
    SELECT flc.fc_line_id, flc.category_id, c.name as category_name,
           c.parent_id, pc.name as parent_name,
           COALESCE(SUM(be.base_amount), 0) as budget_total
    FROM fc_line_categories flc
    JOIN categories c ON flc.category_id = c.id
    LEFT JOIN categories pc ON c.parent_id = pc.id
    LEFT JOIN budget_entries be ON be.category_id = c.id
      AND ($1::int IS NULL OR be.budget_year = $1)
    GROUP BY flc.fc_line_id, flc.category_id, c.name, c.parent_id, pc.name
    ORDER BY c.name
  `, [budgetYear || null]);

  const catsByLine = {};
  for (const cat of catsResult.rows) {
    if (!catsByLine[cat.fc_line_id]) catsByLine[cat.fc_line_id] = [];
    catsByLine[cat.fc_line_id].push(cat);
  }

  return linesResult.rows.map(line => ({
    ...line,
    categories: catsByLine[line.id] || [],
  }));
}

/**
 * Get FC Line by ID with categories
 */
async function findById(id) {
  const lineResult = await db.query(`SELECT * FROM fc_lines WHERE id = $1`, [id]);
  const line = lineResult.rows[0];
  if (!line) return null;

  const catsResult = await db.query(`
    SELECT flc.category_id, c.name as category_name,
           c.parent_id, pc.name as parent_name
    FROM fc_line_categories flc
    JOIN categories c ON flc.category_id = c.id
    LEFT JOIN categories pc ON c.parent_id = pc.id
    WHERE flc.fc_line_id = $1
    ORDER BY c.name
  `, [id]);

  return { ...line, categories: catsResult.rows };
}

/**
 * Get FC Line by name
 */
async function findByName(name) {
  const result = await db.query(`SELECT * FROM fc_lines WHERE name = $1`, [name]);
  return result.rows[0] || null;
}

/**
 * Create a new FC Line
 */
async function create(data) {
  const sql = `
    INSERT INTO fc_lines (name, line_type, display_order)
    VALUES ($1, $2, $3)
    RETURNING *
  `;
  const result = await db.query(sql, [
    data.name,
    data.line_type || 'unassigned',
    data.display_order || 0,
  ]);
  return result.rows[0];
}

/**
 * Update an FC Line
 */
async function update(id, data) {
  const fields = [];
  const params = [];
  let paramIndex = 1;

  const allowedFields = ['name', 'line_type', 'display_order'];

  for (const field of allowedFields) {
    if (data[field] !== undefined) {
      fields.push(`${field} = $${paramIndex++}`);
      params.push(data[field]);
    }
  }

  if (fields.length === 0) return null;

  fields.push('updated_at = NOW()');
  params.push(id);

  const sql = `UPDATE fc_lines SET ${fields.join(', ')} WHERE id = $${paramIndex} RETURNING *`;
  const result = await db.query(sql, params);
  return result.rows[0] || null;
}

/**
 * Delete an FC Line.
 * Checks for forecast_income_expense references first (RESTRICT).
 * forecast_modules references are safe (SET NULL via FK).
 * fc_line_categories cascade-delete automatically.
 */
async function remove(id) {
  // Check for forecast_income_expense references
  const refCheck = await db.query(`
    SELECT fie.id, fie.name, fs.name as scenario_name
    FROM forecast_income_expense fie
    JOIN forecast_scenarios fs ON fie.scenario_id = fs.id
    WHERE fie.fc_line_id = $1
  `, [id]);

  if (refCheck.rows.length > 0) {
    return { deleted: false, references: refCheck.rows };
  }

  const result = await db.query(`DELETE FROM fc_lines WHERE id = $1 RETURNING id`, [id]);
  return { deleted: result.rowCount > 0, references: [] };
}

/**
 * Assign categories to an FC Line.
 * Accepts an array of category_ids. Categories already assigned to another
 * line are rejected (UNIQUE constraint on category_id).
 */
async function assignCategories(fcLineId, categoryIds) {
  if (!categoryIds || categoryIds.length === 0) return [];

  const results = [];
  for (const categoryId of categoryIds) {
    try {
      const result = await db.query(`
        INSERT INTO fc_line_categories (fc_line_id, category_id)
        VALUES ($1, $2)
        ON CONFLICT (category_id) DO UPDATE SET fc_line_id = $1, created_at = NOW()
        RETURNING *
      `, [fcLineId, categoryId]);
      results.push({ category_id: categoryId, success: true });
    } catch (err) {
      results.push({ category_id: categoryId, success: false, error: err.message });
    }
  }
  return results;
}

/**
 * Unassign a category from its FC Line
 */
async function unassignCategory(fcLineId, categoryId) {
  const result = await db.query(`
    DELETE FROM fc_line_categories
    WHERE fc_line_id = $1 AND category_id = $2
    RETURNING *
  `, [fcLineId, categoryId]);
  return result.rowCount > 0;
}

/**
 * Get all categories not assigned to any FC Line, with optional budget totals
 */
async function findUnassignedCategories(budgetYear) {
  const result = await db.query(`
    SELECT c.id, c.name, c.parent_id, pc.name as parent_name,
           c.mapped_account_id, a.name as mapped_account_name,
           COALESCE(SUM(be.base_amount), 0) as budget_total
    FROM categories c
    LEFT JOIN categories pc ON c.parent_id = pc.id
    LEFT JOIN accounts a ON c.mapped_account_id = a.id
    LEFT JOIN fc_line_categories flc ON flc.category_id = c.id
    LEFT JOIN budget_entries be ON be.category_id = c.id
      AND ($1::int IS NULL OR be.budget_year = $1)
    WHERE flc.id IS NULL AND c.is_active = TRUE
    GROUP BY c.id, c.name, c.parent_id, pc.name, c.mapped_account_id, a.name
    ORDER BY c.name
  `, [budgetYear || null]);
  return result.rows;
}

/**
 * Get budget totals per FC Line for a given budget year
 */
async function getBudgetTotals(budgetYear) {
  const result = await db.query(`
    SELECT
      l.id as fc_line_id,
      l.name as fc_line_name,
      l.line_type,
      COALESCE(SUM(be.base_amount), 0) as budget_total
    FROM fc_lines l
    LEFT JOIN fc_line_categories flc ON flc.fc_line_id = l.id
    LEFT JOIN budget_entries be ON be.category_id = flc.category_id AND be.budget_year = $1
    GROUP BY l.id, l.name, l.line_type
    ORDER BY l.display_order, l.name
  `, [budgetYear]);
  return result.rows;
}

/**
 * Generate suggested FC Lines from P&L account hierarchy.
 * Creates empty lines (no category assignments) named from parent-level P&L accounts.
 * Only creates lines that don't already exist (by name).
 */
async function generateSuggestions() {
  // Get P&L parent accounts (accounts with children, section = profit_loss)
  const result = await db.query(`
    SELECT DISTINCT parent_a.id, parent_a.name
    FROM accounts parent_a
    JOIN accounts child_a ON child_a.parent_id = parent_a.id
    WHERE parent_a.section = 'profit_loss'
      AND parent_a.parent_id IS NOT NULL
    ORDER BY parent_a.name
  `);

  const created = [];
  let order = 0;

  for (const account of result.rows) {
    // Skip if line with this name already exists
    const existing = await findByName(account.name);
    if (existing) continue;

    const line = await create({
      name: account.name,
      line_type: 'unassigned',
      display_order: order++,
    });
    created.push(line);
  }

  return created;
}

module.exports = {
  findAll,
  findById,
  findByName,
  create,
  update,
  remove,
  assignCategories,
  unassignCategory,
  findUnassignedCategories,
  getBudgetTotals,
  generateSuggestions,
};
