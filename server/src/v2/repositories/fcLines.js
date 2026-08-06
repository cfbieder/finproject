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
 * CR069 P2 — checks forecast_streams (RESTRICT), where it used to check
 * forecast_income_expense. The scope GREW: `forecast_streams.fc_line_id` is ON DELETE
 * RESTRICT for BOTH directions and both kinds of module, whereas the module's old
 * `expense_fc_line_id`/`income_fc_line_id` were ON DELETE SET NULL — and silently nulling a
 * module's line is exactly how it ends up charging cash to no P&L row at all (roadmap:
 * `Sarasota House`, −1,203,432 against no line). So a line in use is now refused rather than
 * quietly detached, and the caller gets the list of what is using it.
 * fc_line_categories still cascade-delete automatically.
 */
async function remove(id) {
  const refCheck = await db.query(`
    SELECT DISTINCT m.id, m.name, fs.name as scenario_name
    FROM forecast_streams st
    JOIN forecast_modules m ON m.id = st.module_id
    JOIN forecast_scenarios fs ON m.scenario_id = fs.id
    WHERE st.fc_line_id = $1
    ORDER BY 3, 2
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
/**
 * CR070 P6 — ACTUAL spend per FC line for a year.
 *
 * The sibling of `getBudgetTotals`, over `transactions` instead of `budget_entries`, resolving
 * leaves through the identical recursive CTE so the two are directly comparable — a budget and an
 * actual that disagreed about which accounts feed a line would be worse than no comparison.
 *
 * Why it exists: a flow module's prior-year figure used to be looked up in the BALANCE-SHEET
 * report by the module's single `account_id`. Every account feeding an expense line is
 * `profit_loss`, so that lookup could never return anything — and the account named only one of
 * them anyway (`Car Expenses` points at `Car - Insurance` while the line is fed by four accounts).
 * The line is what the engine actually reads, so the line is what the comparison follows.
 *
 * `base_amount` for the same reason `getBudgetTotals` uses it: the figure must be in one currency
 * or a multi-currency line silently sums pounds and zloty (the CR064 P8 class).
 */
async function getActualTotals(year) {
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
    distinct_leaves AS (
      SELECT DISTINCT fc_line_id, id
      FROM cat_tree ct
      WHERE NOT EXISTS (SELECT 1 FROM accounts ch WHERE ch.parent_id = ct.id)
    )
    SELECT
      l.id as fc_line_id,
      l.name as fc_line_name,
      l.line_type,
      COALESCE(SUM(t.base_amount), 0) as actual_total,
      count(t.id) as transaction_count
    FROM fc_lines l
    LEFT JOIN distinct_leaves dl ON dl.fc_line_id = l.id
    LEFT JOIN transactions t
      ON t.category_id = dl.id
     AND t.transaction_date >= make_date($1, 1, 1)
     AND t.transaction_date <= make_date($1, 12, 31)
    GROUP BY l.id, l.name, l.line_type
    ORDER BY l.display_order, l.name
  `, [year]);
  return result.rows;
}

/**
 * CR072 QA — the same total, BROKEN DOWN by the P&L account that produced it.
 *
 * A line's actual is frequently the sum of several chart-of-accounts leaves: `Property Costs`
 * is fed by six modules and more categories than that, so a single figure answers "how much"
 * and not "made of what". The owner asked to drill into it, and the honest way is to run the
 * identical recursive CTE and simply stop grouping — the parts then provably sum to the whole,
 * which a separately-written query could not promise.
 *
 * Grouped by (account, CURRENCY), not by account alone. `Property Costs` draws on EUR, PLN and
 * USD, and one account carries four currencies — so a single "local" figure per account would be
 * the CR064 P8 bug in miniature (pounds added to zloty). USD is the only total that may be summed
 * across the line; the local amounts are shown per currency, beside it, never instead of it.
 */
async function getActualBreakdown(year, fcLineId) {
  const result = await db.query(`
    WITH RECURSIVE cat_tree AS (
      SELECT flc.fc_line_id, c.id
      FROM fc_line_categories flc
      JOIN accounts c ON flc.category_id = c.id
      WHERE flc.fc_line_id = $2
      UNION ALL
      SELECT ct.fc_line_id, ch.id
      FROM cat_tree ct
      JOIN accounts ch ON ch.parent_id = ct.id
    ),
    distinct_leaves AS (
      SELECT DISTINCT fc_line_id, id
      FROM cat_tree ct
      WHERE NOT EXISTS (SELECT 1 FROM accounts ch WHERE ch.parent_id = ct.id)
    )
    SELECT
      a.id   as account_id,
      a.name as account_name,
      t.currency as currency,
      COALESCE(SUM(t.amount), 0)      as local_total,
      COALESCE(SUM(t.base_amount), 0) as actual_total,
      count(t.id) as transaction_count
    FROM distinct_leaves dl
    JOIN accounts a ON a.id = dl.id
    JOIN transactions t
      ON t.category_id = dl.id
     AND t.transaction_date >= make_date($1, 1, 1)
     AND t.transaction_date <= make_date($1, 12, 31)
    GROUP BY a.id, a.name, t.currency
    ORDER BY SUM(t.base_amount) ASC NULLS LAST
  `, [year, fcLineId]);
  return result.rows;
}

/**
 * CR072 QA — the budget total, broken down by the account that budgeted it.
 *
 * The exact sibling of `getActualBreakdown`, over `budget_entries` rather than `transactions`,
 * resolving leaves through the identical recursive CTE. The pairing matters: an actual and a
 * budget that disagreed about which accounts feed a line would make the two drill-downs
 * un-comparable, which is the whole reason anyone opens them side by side.
 *
 * No `HAVING count > 0` here — its sibling uses that to drop accounts with no transactions, but a
 * budget row EXISTS or it does not, so the join already does that work.
 */
async function getBudgetBreakdown(budgetYear, fcLineId) {
  const result = await db.query(`
    WITH RECURSIVE cat_tree AS (
      SELECT flc.fc_line_id, c.id
      FROM fc_line_categories flc
      JOIN accounts c ON flc.category_id = c.id
      WHERE flc.fc_line_id = $2
      UNION ALL
      SELECT ct.fc_line_id, ch.id
      FROM cat_tree ct
      JOIN accounts ch ON ch.parent_id = ct.id
    ),
    distinct_leaves AS (
      SELECT DISTINCT fc_line_id, id
      FROM cat_tree ct
      WHERE NOT EXISTS (SELECT 1 FROM accounts ch WHERE ch.parent_id = ct.id)
    )
    SELECT
      a.id   as account_id,
      a.name as account_name,
      be.currency as currency,
      COALESCE(SUM(be.amount), 0)      as local_total,
      COALESCE(SUM(be.base_amount), 0) as budget_total,
      count(be.id) as transaction_count
    FROM distinct_leaves dl
    JOIN accounts a ON a.id = dl.id
    JOIN budget_entries be ON be.category_id = dl.id AND be.budget_year = $1
    GROUP BY a.id, a.name, be.currency
    ORDER BY SUM(be.base_amount) ASC NULLS LAST
  `, [budgetYear, fcLineId]);
  return result.rows;
}

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
  getActualBreakdown,
  getBudgetBreakdown,
  getActualTotals,
  getSuggestions,
  createBatch,
};
