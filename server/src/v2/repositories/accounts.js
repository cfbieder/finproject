/**
 * Accounts Repository
 *
 * Database operations for the accounts table.
 * Includes recursive CTE queries for hierarchical account structure.
 */

const db = require('../db');

/**
 * Get all accounts
 */
async function findAll({ section, accountType, activeOnly = true } = {}) {
  const conditions = [];
  const params = [];
  let paramIndex = 1;

  if (activeOnly) {
    conditions.push('a.is_active = TRUE');
  }
  if (section) {
    conditions.push(`a.section = $${paramIndex++}`);
    params.push(section);
  }
  if (accountType) {
    conditions.push(`a.account_type = $${paramIndex++}`);
    params.push(accountType);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const sql = `
    SELECT
      a.*,
      p.name as parent_name
    FROM accounts a
    LEFT JOIN accounts p ON a.parent_id = p.id
    ${whereClause}
    ORDER BY a.display_order, a.name
  `;

  const result = await db.query(sql, params);
  return result.rows;
}

/**
 * Get account by ID
 */
async function findById(id) {
  const sql = `
    SELECT a.*, p.name as parent_name
    FROM accounts a
    LEFT JOIN accounts p ON a.parent_id = p.id
    WHERE a.id = $1
  `;
  const result = await db.query(sql, [id]);
  return result.rows[0] || null;
}

/**
 * Get account by name
 */
async function findByName(name) {
  const sql = `SELECT * FROM accounts WHERE name = $1`;
  const result = await db.query(sql, [name]);
  return result.rows[0] || null;
}

/**
 * Get account hierarchy as tree (using recursive CTE)
 */
async function getTree({ section, rootOnly = false } = {}) {
  const conditions = ['a.is_active = TRUE'];
  const params = [];
  let paramIndex = 1;

  if (section) {
    conditions.push(`a.section = $${paramIndex++}`);
    params.push(section);
  }
  if (rootOnly) {
    conditions.push('a.parent_id IS NULL');
  }

  const whereClause = conditions.join(' AND ');

  const sql = `
    WITH RECURSIVE account_tree AS (
      -- Base case: root accounts (no parent)
      SELECT
        id, name, parent_id, account_type, section, currency,
        display_order, 0 as depth, ARRAY[id] as path, name as full_path
      FROM accounts
      WHERE parent_id IS NULL AND is_active = TRUE

      UNION ALL

      -- Recursive case: children
      SELECT
        a.id, a.name, a.parent_id, a.account_type, a.section, a.currency,
        a.display_order, t.depth + 1, t.path || a.id, t.full_path || ' > ' || a.name
      FROM accounts a
      JOIN account_tree t ON a.parent_id = t.id
      WHERE a.is_active = TRUE
    )
    SELECT * FROM account_tree
    WHERE ${whereClause}
    ORDER BY path
  `;

  const result = await db.query(sql, params);
  return result.rows;
}

/**
 * Get children of an account
 */
async function getChildren(parentId) {
  const sql = `
    SELECT * FROM accounts
    WHERE parent_id = $1 AND is_active = TRUE
    ORDER BY display_order, name
  `;
  const result = await db.query(sql, [parentId]);
  return result.rows;
}

/**
 * Get all descendants of an account (recursive)
 */
async function getDescendants(accountId) {
  const sql = `
    WITH RECURSIVE descendants AS (
      SELECT id, name, parent_id, 0 as depth
      FROM accounts WHERE id = $1

      UNION ALL

      SELECT a.id, a.name, a.parent_id, d.depth + 1
      FROM accounts a
      JOIN descendants d ON a.parent_id = d.id
      WHERE a.is_active = TRUE
    )
    SELECT * FROM descendants WHERE id != $1
    ORDER BY depth, name
  `;

  const result = await db.query(sql, [accountId]);
  return result.rows;
}

/**
 * Get account balances from transactions
 */
async function getBalances({ asOfDate, section } = {}) {
  const conditions = ['a.is_active = TRUE'];
  const params = [];
  let paramIndex = 1;

  if (asOfDate) {
    conditions.push(`t.transaction_date <= $${paramIndex++}`);
    params.push(asOfDate);
  }
  if (section) {
    conditions.push(`a.section = $${paramIndex++}`);
    params.push(section);
  }

  const sql = `
    SELECT
      a.id, a.name, a.account_type, a.section, a.currency, a.parent_id,
      COALESCE(SUM(t.base_amount), 0) as balance
    FROM accounts a
    LEFT JOIN categories c ON c.mapped_account_id = a.id
    LEFT JOIN transactions t ON t.category_id = c.id
      ${asOfDate ? `AND t.transaction_date <= $1` : ''}
    WHERE ${conditions.join(' AND ')}
    GROUP BY a.id, a.name, a.account_type, a.section, a.currency, a.parent_id
    ORDER BY a.display_order, a.name
  `;

  const result = await db.query(sql, params);
  return result.rows;
}

/**
 * Create a new account
 */
async function create(data) {
  const sql = `
    INSERT INTO accounts (
      name, parent_id, account_type, section, currency,
      account_number, display_order, is_active, ps_account_name
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    RETURNING *
  `;

  const result = await db.query(sql, [
    data.name,
    data.parent_id || null,
    data.account_type,
    data.section,
    data.currency || 'USD',
    data.account_number || null,
    data.display_order || 0,
    data.is_active !== false,
    data.ps_account_name || data.name
  ]);

  return result.rows[0];
}

/**
 * Update an account
 */
async function update(id, data) {
  const fields = [];
  const params = [];
  let paramIndex = 1;

  const allowedFields = [
    'name', 'parent_id', 'account_type', 'section', 'currency',
    'account_number', 'display_order', 'is_active', 'ps_account_name'
  ];

  for (const field of allowedFields) {
    if (data[field] !== undefined) {
      fields.push(`${field} = $${paramIndex++}`);
      params.push(data[field]);
    }
  }

  if (fields.length === 0) return null;

  params.push(id);

  const sql = `
    UPDATE accounts SET ${fields.join(', ')}
    WHERE id = $${paramIndex}
    RETURNING *
  `;

  const result = await db.query(sql, params);
  return result.rows[0] || null;
}

/**
 * Soft delete an account (set is_active = false)
 */
async function remove(id) {
  const sql = `UPDATE accounts SET is_active = FALSE WHERE id = $1 RETURNING id`;
  const result = await db.query(sql, [id]);
  return result.rowCount > 0;
}

/**
 * Get account hierarchy as a nested { name, children } tree.
 *
 * Uses the flat rows from getTree() and assembles them into a nested
 * structure suitable for frontend rendering.
 */
async function getNestedTree({ section } = {}) {
  const rows = await getTree({ section });

  const nodeMap = new Map();
  const roots = [];

  for (const row of rows) {
    const node = { name: row.name, children: [] };
    nodeMap.set(row.id, node);

    if (row.parent_id && nodeMap.has(row.parent_id)) {
      nodeMap.get(row.parent_id).children.push(node);
    } else {
      roots.push(node);
    }
  }

  return roots;
}

/**
 * Get a traits map mirroring the shape of coa_traits.json.
 *
 * Returns { "AccountName": { Currency, Type, AccountNumber } }
 */
async function getTraitsMap() {
  const sql = `
    SELECT name, currency, account_type, account_number
    FROM accounts
    WHERE is_active = TRUE
    ORDER BY name
  `;
  const result = await db.query(sql);
  const traits = {};
  for (const row of result.rows) {
    traits[row.name] = {
      Currency: row.currency || 'N/A',
      Type: row.account_type,
      AccountNumber: row.account_number || '',
    };
  }
  return traits;
}

module.exports = {
  findAll,
  findById,
  findByName,
  getTree,
  getNestedTree,
  getChildren,
  getDescendants,
  getBalances,
  getTraitsMap,
  create,
  update,
  remove
};
