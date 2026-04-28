/**
 * Transfer Match Groups Repository
 *
 * Database operations for manual transfer match groups.
 */

const db = require('../db');

/**
 * Create a new match group with the given transaction IDs.
 * @param {number[]} transactionIds - array of transaction IDs to group
 * @param {string|null} note - optional note/label
 * @returns {Promise<{id: number, note: string, created_at: string, transaction_ids: number[]}>}
 */
async function create(transactionIds, note = null) {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    // Check none of these transactions are already in a group
    const checkSql = `
      SELECT transaction_id FROM transfer_match_group_members
      WHERE transaction_id = ANY($1)
    `;
    const existing = await client.query(checkSql, [transactionIds]);
    if (existing.rows.length > 0) {
      const ids = existing.rows.map(r => r.transaction_id).join(', ');
      throw new Error(`Transactions already in a match group: ${ids}`);
    }

    // Create group
    const groupResult = await client.query(
      'INSERT INTO transfer_match_groups (note) VALUES ($1) RETURNING id, note, created_at',
      [note]
    );
    const group = groupResult.rows[0];

    // Insert members
    const values = transactionIds.map((tid, i) => `($1, $${i + 2})`).join(', ');
    const params = [group.id, ...transactionIds];
    await client.query(
      `INSERT INTO transfer_match_group_members (group_id, transaction_id) VALUES ${values}`,
      params
    );

    await client.query('COMMIT');
    return { ...group, transaction_ids: transactionIds };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Delete a match group by ID (cascade deletes members).
 * @param {number} groupId
 * @returns {Promise<boolean>} true if deleted
 */
async function remove(groupId) {
  const result = await db.query(
    'DELETE FROM transfer_match_groups WHERE id = $1',
    [groupId]
  );
  return result.rowCount > 0;
}

/**
 * Find all match groups, optionally filtered by transaction date range.
 * Returns groups with their member transactions.
 */
async function findAll({ startDate, endDate } = {}) {
  const conditions = [];
  const params = [];
  let idx = 1;

  if (startDate) {
    conditions.push(`t.transaction_date >= $${idx++}`);
    params.push(startDate);
  }
  if (endDate) {
    conditions.push(`t.transaction_date <= $${idx++}`);
    params.push(endDate);
  }

  const whereClause = conditions.length > 0
    ? `WHERE ${conditions.join(' AND ')}`
    : '';

  const sql = `
    SELECT
      g.id AS group_id, g.note, g.created_at AS group_created_at,
      m.transaction_id,
      t.transaction_date, t.description1, t.description2,
      t.amount, t.currency, t.base_amount, t.base_currency,
      t.account_id, a.name AS account_name,
      t.category_id, c.name AS category_name
    FROM transfer_match_groups g
    JOIN transfer_match_group_members m ON m.group_id = g.id
    JOIN transactions t ON t.id = m.transaction_id
    LEFT JOIN accounts a ON t.account_id = a.id
    LEFT JOIN accounts c ON t.category_id = c.id
    ${whereClause}
    ORDER BY g.id, t.transaction_date, t.id
  `;

  const result = await db.query(sql, params);

  // Group rows by group_id
  const groups = {};
  for (const row of result.rows) {
    if (!groups[row.group_id]) {
      groups[row.group_id] = {
        id: row.group_id,
        note: row.note,
        created_at: row.group_created_at,
        transactions: [],
      };
    }
    groups[row.group_id].transactions.push({
      id: row.transaction_id,
      transaction_date: row.transaction_date,
      description1: row.description1,
      description2: row.description2,
      amount: row.amount,
      currency: row.currency,
      base_amount: row.base_amount,
      base_currency: row.base_currency,
      account_id: row.account_id,
      account_name: row.account_name,
      category_id: row.category_id,
      category_name: row.category_name,
    });
  }

  return Object.values(groups);
}

/**
 * Get all transaction IDs that are in any match group (for a date range).
 * Used to exclude manually matched transactions from auto-matching.
 */
async function findMatchedTransactionIds({ startDate, endDate } = {}) {
  const conditions = [];
  const params = [];
  let idx = 1;

  if (startDate) {
    conditions.push(`t.transaction_date >= $${idx++}`);
    params.push(startDate);
  }
  if (endDate) {
    conditions.push(`t.transaction_date <= $${idx++}`);
    params.push(endDate);
  }

  const whereClause = conditions.length > 0
    ? `WHERE ${conditions.join(' AND ')}`
    : '';

  const sql = `
    SELECT m.transaction_id
    FROM transfer_match_group_members m
    JOIN transactions t ON t.id = m.transaction_id
    ${whereClause}
  `;

  const result = await db.query(sql, params);
  return new Set(result.rows.map(r => r.transaction_id));
}

module.exports = {
  create,
  remove,
  findAll,
  findMatchedTransactionIds,
};
