/**
 * Categories Repository
 *
 * Database operations for the categories table.
 */

const db = require('../db');

/**
 * Get all categories
 */
async function findAll({ activeOnly = true, includeTransfers = true } = {}) {
  const conditions = [];

  if (activeOnly) {
    conditions.push('c.is_active = TRUE');
  }
  if (!includeTransfers) {
    conditions.push('c.is_transfer = FALSE');
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const sql = `
    SELECT
      c.*,
      p.name as parent_name,
      a.name as mapped_account_name,
      a.account_type as mapped_account_type
    FROM categories c
    LEFT JOIN categories p ON c.parent_id = p.id
    LEFT JOIN accounts a ON c.mapped_account_id = a.id
    ${whereClause}
    ORDER BY c.name
  `;

  const result = await db.query(sql, []);
  return result.rows;
}

/**
 * Get category by ID
 */
async function findById(id) {
  const sql = `
    SELECT
      c.*,
      p.name as parent_name,
      a.name as mapped_account_name
    FROM categories c
    LEFT JOIN categories p ON c.parent_id = p.id
    LEFT JOIN accounts a ON c.mapped_account_id = a.id
    WHERE c.id = $1
  `;
  const result = await db.query(sql, [id]);
  return result.rows[0] || null;
}

/**
 * Get category by name
 */
async function findByName(name) {
  const sql = `SELECT * FROM categories WHERE name = $1`;
  const result = await db.query(sql, [name]);
  return result.rows[0] || null;
}

/**
 * Get category by PocketSmith category ID
 */
async function findByPsCategoryId(psCategoryId) {
  const sql = `SELECT * FROM categories WHERE ps_category_id = $1`;
  const result = await db.query(sql, [psCategoryId]);
  return result.rows[0] || null;
}

/**
 * Get categories as hierarchical tree
 */
async function getTree({ includeTransfers = false } = {}) {
  const transferCondition = includeTransfers ? '' : 'AND is_transfer = FALSE';

  const sql = `
    WITH RECURSIVE category_tree AS (
      SELECT
        id, name, parent_id, is_transfer, mapped_account_id,
        0 as depth, ARRAY[id] as path
      FROM categories
      WHERE parent_id IS NULL AND is_active = TRUE ${transferCondition}

      UNION ALL

      SELECT
        c.id, c.name, c.parent_id, c.is_transfer, c.mapped_account_id,
        t.depth + 1, t.path || c.id
      FROM categories c
      JOIN category_tree t ON c.parent_id = t.id
      WHERE c.is_active = TRUE ${transferCondition}
    )
    SELECT * FROM category_tree
    ORDER BY path
  `;

  const result = await db.query(sql, []);
  return result.rows;
}

/**
 * Get category totals from transactions
 */
async function getTotals({ startDate, endDate } = {}) {
  const conditions = ['c.is_active = TRUE'];
  const params = [];
  let paramIndex = 1;

  if (startDate) {
    conditions.push(`t.transaction_date >= $${paramIndex++}`);
    params.push(startDate);
  }
  if (endDate) {
    conditions.push(`t.transaction_date <= $${paramIndex++}`);
    params.push(endDate);
  }

  const sql = `
    SELECT
      c.id, c.name, c.is_transfer, c.parent_id,
      a.name as account_name, a.account_type,
      COALESCE(SUM(t.base_amount), 0) as total,
      COUNT(t.id)::int as transaction_count
    FROM categories c
    LEFT JOIN accounts a ON c.mapped_account_id = a.id
    LEFT JOIN transactions t ON t.category_id = c.id
      ${startDate ? `AND t.transaction_date >= $1` : ''}
      ${endDate ? `AND t.transaction_date <= $${startDate ? 2 : 1}` : ''}
    WHERE ${conditions.join(' AND ')}
    GROUP BY c.id, c.name, c.is_transfer, c.parent_id, a.name, a.account_type
    ORDER BY ABS(COALESCE(SUM(t.base_amount), 0)) DESC
  `;

  const result = await db.query(sql, params);
  return result.rows;
}

/**
 * Create a new category
 */
async function create(data) {
  const sql = `
    INSERT INTO categories (name, parent_id, ps_category_id, mapped_account_id, is_transfer, is_active)
    VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING *
  `;

  const result = await db.query(sql, [
    data.name,
    data.parent_id || null,
    data.ps_category_id || null,
    data.mapped_account_id || null,
    data.is_transfer || false,
    data.is_active !== false
  ]);

  return result.rows[0];
}

/**
 * Update a category
 */
async function update(id, data) {
  const fields = [];
  const params = [];
  let paramIndex = 1;

  const allowedFields = ['name', 'parent_id', 'ps_category_id', 'mapped_account_id', 'is_transfer', 'is_active'];

  for (const field of allowedFields) {
    if (data[field] !== undefined) {
      fields.push(`${field} = $${paramIndex++}`);
      params.push(data[field]);
    }
  }

  if (fields.length === 0) return null;

  params.push(id);

  const sql = `
    UPDATE categories SET ${fields.join(', ')}
    WHERE id = $${paramIndex}
    RETURNING *
  `;

  const result = await db.query(sql, params);
  return result.rows[0] || null;
}

/**
 * Soft delete a category
 */
async function remove(id) {
  const sql = `UPDATE categories SET is_active = FALSE WHERE id = $1 RETURNING id`;
  const result = await db.query(sql, [id]);
  return result.rowCount > 0;
}

module.exports = {
  findAll,
  findById,
  findByName,
  findByPsCategoryId,
  getTree,
  getTotals,
  create,
  update,
  remove
};
