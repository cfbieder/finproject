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
    WITH RECURSIVE cat_tree AS (
      -- Directly assigned categories
      SELECT flc.fc_line_id, flc.category_id as root_id, c.id as id
      FROM fc_line_categories flc
      JOIN accounts c ON flc.category_id = c.id
      UNION ALL
      -- Recursively include children
      SELECT ct.fc_line_id, ct.root_id, ch.id
      FROM cat_tree ct
      JOIN accounts ch ON ch.parent_id = ct.id
    ),
    -- Deduplicate leaves per root, then sum budget
    distinct_leaves AS (
      SELECT DISTINCT fc_line_id, root_id, id
      FROM cat_tree
      WHERE NOT EXISTS (SELECT 1 FROM accounts ch WHERE ch.parent_id = cat_tree.id)
    ),
    leaf_budget AS (
      SELECT dl.fc_line_id, dl.root_id,
             COALESCE(SUM(be.base_amount), 0) as budget_total
      FROM distinct_leaves dl
      LEFT JOIN budget_entries be ON be.category_id = dl.id
        AND ($1::int IS NULL OR be.budget_year = $1)
      GROUP BY dl.fc_line_id, dl.root_id
    )
    SELECT flc.fc_line_id, flc.category_id, c.name as category_name,
           c.parent_id, pc.name as parent_name,
           COALESCE(lb.budget_total, 0) as budget_total
    FROM fc_line_categories flc
    JOIN accounts c ON flc.category_id = c.id
    LEFT JOIN accounts pc ON c.parent_id = pc.id
    LEFT JOIN leaf_budget lb ON lb.fc_line_id = flc.fc_line_id AND lb.root_id = flc.category_id
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
    JOIN accounts c ON flc.category_id = c.id
    LEFT JOIN accounts pc ON c.parent_id = pc.id
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
    WITH RECURSIVE assigned_tree AS (
      -- Direct assignments
      SELECT category_id AS id FROM fc_line_categories
      UNION
      -- Recursively include all children of assigned categories
      SELECT c.id
      FROM accounts c
      JOIN assigned_tree at ON c.parent_id = at.id
    )
    SELECT c.id, c.name, c.parent_id, pc.name as parent_name,
           NULL::int as mapped_account_id, NULL::text as mapped_account_name,
           COALESCE(SUM(be.base_amount), 0) as budget_total
    FROM accounts c
    LEFT JOIN accounts pc ON c.parent_id = pc.id
    LEFT JOIN budget_entries be ON be.category_id = c.id
      AND ($1::int IS NULL OR be.budget_year = $1)
    WHERE c.id NOT IN (SELECT id FROM assigned_tree)
      AND c.is_active = TRUE
      AND c.section = 'profit_loss'
    GROUP BY c.id, c.name, c.parent_id, pc.name
    ORDER BY c.name
  `, [budgetYear || null]);
  return result.rows;
}

/**
 * Get budget totals per FC Line for a given budget year
 */
async function getBudgetTotals(budgetYear) {
  const result = await db.query(`
    WITH RECURSIVE cat_tree AS (
      SELECT flc.fc_line_id, c.id
      FROM fc_line_categories flc
      JOIN accounts c ON flc.category_id = c.id
      UNION ALL
      SELECT ct.fc_line_id, ch.id
      FROM cat_tree ct
      JOIN accounts ch ON ch.parent_id = ct.id
    ),
    -- Deduplicate: each leaf counted once per fc_line
    distinct_leaves AS (
      SELECT DISTINCT fc_line_id, id
      FROM cat_tree ct
      WHERE NOT EXISTS (SELECT 1 FROM accounts ch WHERE ch.parent_id = ct.id)
    )
    SELECT
      l.id as fc_line_id,
      l.name as fc_line_name,
      l.line_type,
      COALESCE(SUM(be.base_amount), 0) as budget_total
    FROM fc_lines l
    LEFT JOIN distinct_leaves dl ON dl.fc_line_id = l.id
    LEFT JOIN budget_entries be ON be.category_id = dl.id AND be.budget_year = $1
    GROUP BY l.id, l.name, l.line_type
    ORDER BY l.display_order, l.name
  `, [budgetYear]);
  return result.rows;
}

/**
 * Get suggested FC Line names from P&L account hierarchy.
 * Returns names that don't already exist as FC Lines.
 */
async function getSuggestions() {
  const result = await db.query(`
    SELECT DISTINCT parent_a.id, parent_a.name
    FROM accounts parent_a
    JOIN accounts child_a ON child_a.parent_id = parent_a.id
    WHERE parent_a.section = 'profit_loss'
      AND parent_a.parent_id IS NOT NULL
    ORDER BY parent_a.name
  `);

  const existing = await db.query('SELECT name FROM fc_lines');
  const existingNames = new Set(existing.rows.map(r => r.name));

  return result.rows
    .filter(a => !existingNames.has(a.name))
    .map(a => ({ account_id: a.id, name: a.name }));
}

/**
 * Create FC Lines from a list of names.
 */
async function createBatch(names) {
  const created = [];
  let order = 0;

  for (const name of names) {
    const existing = await findByName(name);
    if (existing) continue;

    const line = await create({
      name,
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
  getSuggestions,
  createBatch,
};
