/**
 * Budget Repository
 *
 * Database operations for budget_entries and budget_versions tables.
 */

const db = require('../db');

// ============================================================================
// Budget Versions
// ============================================================================

/**
 * Get all budget versions
 */
async function findAllVersions({ year, activeOnly = true } = {}) {
  const conditions = [];
  const params = [];
  let paramIndex = 1;

  if (activeOnly) {
    conditions.push('is_active = TRUE');
  }
  if (year) {
    conditions.push(`budget_year = $${paramIndex++}`);
    params.push(year);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const sql = `
    SELECT v.*,
      (SELECT COUNT(*)::int FROM budget_entries WHERE version_id = v.id) as entry_count
    FROM budget_versions v
    ${whereClause}
    ORDER BY budget_year DESC, version_name
  `;

  const result = await db.query(sql, params);
  return result.rows;
}

/**
 * Get budget version by ID
 */
async function findVersionById(id) {
  const sql = `SELECT * FROM budget_versions WHERE id = $1`;
  const result = await db.query(sql, [id]);
  return result.rows[0] || null;
}

/**
 * Create a new budget version
 */
async function createVersion(data) {
  const sql = `
    INSERT INTO budget_versions (budget_year, version_name, description, is_active)
    VALUES ($1, $2, $3, $4)
    RETURNING *
  `;

  const result = await db.query(sql, [
    data.budget_year,
    data.version_name,
    data.description || null,
    data.is_active !== false
  ]);

  return result.rows[0];
}

/**
 * Update a budget version
 */
async function updateVersion(id, data) {
  const fields = [];
  const params = [];
  let paramIndex = 1;

  if (data.version_name !== undefined) {
    fields.push(`version_name = $${paramIndex++}`);
    params.push(data.version_name);
  }
  if (data.description !== undefined) {
    fields.push(`description = $${paramIndex++}`);
    params.push(data.description);
  }
  if (data.is_active !== undefined) {
    fields.push(`is_active = $${paramIndex++}`);
    params.push(data.is_active);
  }

  if (fields.length === 0) return null;

  fields.push('updated_at = NOW()');
  params.push(id);

  const sql = `
    UPDATE budget_versions SET ${fields.join(', ')}
    WHERE id = $${paramIndex}
    RETURNING *
  `;

  const result = await db.query(sql, params);
  return result.rows[0] || null;
}

// ============================================================================
// Budget Entries
// ============================================================================

/**
 * Get all budget entries with optional filtering
 */
async function findAll({ versionId, year, categoryId, limit = 1000, offset = 0 } = {}) {
  const conditions = [];
  const params = [];
  let paramIndex = 1;

  if (versionId) {
    conditions.push(`e.version_id = $${paramIndex++}`);
    params.push(versionId);
  }
  if (year) {
    conditions.push(`e.budget_year = $${paramIndex++}`);
    params.push(year);
  }
  if (categoryId) {
    conditions.push(`e.category_id = $${paramIndex++}`);
    params.push(categoryId);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const sql = `
    SELECT
      e.*,
      v.version_name,
      a.name as account_name,
      c.name as category_name
    FROM budget_entries e
    LEFT JOIN budget_versions v ON e.version_id = v.id
    LEFT JOIN accounts a ON e.account_id = a.id
    LEFT JOIN categories c ON e.category_id = c.id
    ${whereClause}
    ORDER BY e.entry_date, e.id
    LIMIT $${paramIndex++} OFFSET $${paramIndex}
  `;

  params.push(limit, offset);
  const result = await db.query(sql, params);
  return result.rows;
}

/**
 * Get budget entries with extended filtering (date range, account/category names, currency)
 * For v1 API compatibility
 */
async function findAllExtended({
  versionId, year, categoryId, accountId,
  startDate, endDate, month,
  categoryNames, accountNames, currency,
  limit = 1000, offset = 0
} = {}) {
  const conditions = [];
  const params = [];
  let paramIndex = 1;

  if (versionId) {
    conditions.push(`e.version_id = $${paramIndex++}`);
    params.push(versionId);
  }
  if (year) {
    conditions.push(`e.budget_year = $${paramIndex++}`);
    params.push(year);
  }
  if (startDate) {
    conditions.push(`e.entry_date >= $${paramIndex++}`);
    params.push(startDate);
  }
  if (endDate) {
    conditions.push(`e.entry_date < $${paramIndex++}`);
    params.push(endDate);
  }
  if (month !== undefined && month !== null) {
    conditions.push(`EXTRACT(MONTH FROM e.entry_date) = $${paramIndex++}`);
    params.push(month);
  }
  if (categoryId) {
    conditions.push(`e.category_id = $${paramIndex++}`);
    params.push(categoryId);
  }
  if (accountId) {
    conditions.push(`e.account_id = $${paramIndex++}`);
    params.push(accountId);
  }
  // Name-based filtering (for v1 API compatibility)
  if (categoryNames && categoryNames.length > 0) {
    const placeholders = categoryNames.map(() => `$${paramIndex++}`).join(', ');
    conditions.push(`c.name IN (${placeholders})`);
    params.push(...categoryNames);
  }
  if (accountNames && accountNames.length > 0) {
    const placeholders = accountNames.map(() => `$${paramIndex++}`).join(', ');
    conditions.push(`a.name IN (${placeholders})`);
    params.push(...accountNames);
  }
  if (currency) {
    conditions.push(`e.currency = $${paramIndex++}`);
    params.push(currency);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const sql = `
    SELECT
      e.*,
      v.version_name,
      a.name as account_name,
      c.name as category_name
    FROM budget_entries e
    LEFT JOIN budget_versions v ON e.version_id = v.id
    LEFT JOIN accounts a ON e.account_id = a.id
    LEFT JOIN categories c ON e.category_id = c.id
    ${whereClause}
    ORDER BY e.entry_date DESC, e.id DESC
    LIMIT $${paramIndex++} OFFSET $${paramIndex}
  `;

  params.push(limit, offset);
  const result = await db.query(sql, params);
  return result.rows;
}

/**
 * Get budget entry by ID
 */
async function findById(id) {
  const sql = `
    SELECT e.*, v.version_name, a.name as account_name, c.name as category_name
    FROM budget_entries e
    LEFT JOIN budget_versions v ON e.version_id = v.id
    LEFT JOIN accounts a ON e.account_id = a.id
    LEFT JOIN categories c ON e.category_id = c.id
    WHERE e.id = $1
  `;
  const result = await db.query(sql, [id]);
  return result.rows[0] || null;
}

/**
 * Get budget totals by category for a year/version
 */
async function sumByCategory({ versionId, year } = {}) {
  const conditions = [];
  const params = [];
  let paramIndex = 1;

  if (versionId) {
    conditions.push(`e.version_id = $${paramIndex++}`);
    params.push(versionId);
  }
  if (year) {
    conditions.push(`e.budget_year = $${paramIndex++}`);
    params.push(year);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const sql = `
    SELECT
      c.id as category_id,
      c.name as category_name,
      a.name as account_name,
      a.account_type,
      SUM(e.base_amount) as total_amount,
      COUNT(*)::int as entry_count
    FROM budget_entries e
    JOIN categories c ON e.category_id = c.id
    LEFT JOIN accounts a ON c.mapped_account_id = a.id
    ${whereClause}
    GROUP BY c.id, c.name, a.name, a.account_type
    ORDER BY a.account_type, c.name
  `;

  const result = await db.query(sql, params);
  return result.rows;
}

/**
 * Get monthly budget totals
 */
async function sumByMonth({ versionId, year } = {}) {
  const conditions = [];
  const params = [];
  let paramIndex = 1;

  if (versionId) {
    conditions.push(`version_id = $${paramIndex++}`);
    params.push(versionId);
  }
  if (year) {
    conditions.push(`budget_year = $${paramIndex++}`);
    params.push(year);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const sql = `
    SELECT
      DATE_TRUNC('month', entry_date)::date as month,
      SUM(base_amount) as total_amount,
      COUNT(*)::int as entry_count
    FROM budget_entries
    ${whereClause}
    GROUP BY DATE_TRUNC('month', entry_date)
    ORDER BY month
  `;

  const result = await db.query(sql, params);
  return result.rows;
}

/**
 * Compare budget vs actual for a year
 */
async function compareToActual({ versionId, year }) {
  const sql = `
    WITH budget AS (
      SELECT
        c.id as category_id,
        c.name as category_name,
        DATE_TRUNC('month', e.entry_date)::date as month,
        SUM(e.base_amount) as budget_amount
      FROM budget_entries e
      JOIN categories c ON e.category_id = c.id
      WHERE e.version_id = $1 AND e.budget_year = $2
      GROUP BY c.id, c.name, DATE_TRUNC('month', e.entry_date)
    ),
    actual AS (
      SELECT
        t.category_id,
        DATE_TRUNC('month', t.transaction_date)::date as month,
        SUM(t.base_amount) as actual_amount
      FROM transactions t
      WHERE EXTRACT(YEAR FROM t.transaction_date) = $2
      GROUP BY t.category_id, DATE_TRUNC('month', t.transaction_date)
    )
    SELECT
      COALESCE(b.category_id, a.category_id) as category_id,
      COALESCE(b.category_name, c.name) as category_name,
      COALESCE(b.month, a.month) as month,
      COALESCE(b.budget_amount, 0) as budget_amount,
      COALESCE(a.actual_amount, 0) as actual_amount,
      COALESCE(a.actual_amount, 0) - COALESCE(b.budget_amount, 0) as variance
    FROM budget b
    FULL OUTER JOIN actual a ON b.category_id = a.category_id AND b.month = a.month
    LEFT JOIN categories c ON a.category_id = c.id
    ORDER BY month, category_name
  `;

  const result = await db.query(sql, [versionId, year]);
  return result.rows;
}

/**
 * Create a new budget entry
 */
async function create(data) {
  const currency = data.currency || 'USD';
  let baseAmount = data.base_amount;

  // Auto-calculate base_amount if not provided
  if (baseAmount === undefined || baseAmount === null || baseAmount === '') {
    if (currency === 'USD') {
      baseAmount = data.amount;
    } else {
      const entryDate = data.entry_date || new Date().toISOString().split('T')[0];
      const entryYear = parseInt(entryDate.substring(0, 4));
      const entryMonth = parseInt(entryDate.substring(5, 7));

      // Try budget_fx_rates table first (with fallback to prior months)
      const budgetFxRatesRepo = require('./budgetFxRates');
      const budgetRate = await budgetFxRatesRepo.findRate(currency, entryYear, entryMonth);

      if (budgetRate && budgetRate > 0) {
        // Budget rate convention: base_amount = amount / rate
        baseAmount = Math.round((data.amount / budgetRate) * 100) / 100;
      } else {
        // Last resort: exchange_rates table (market rate)
        const rateResult = await db.query(`
          SELECT rate FROM exchange_rates
          WHERE from_currency = $1 AND to_currency = 'USD'
          ORDER BY ABS(rate_date - $2::date) ASC
          LIMIT 1
        `, [currency, entryDate]);

        const rate = rateResult.rows[0]?.rate;
        if (rate && parseFloat(rate) > 0) {
          baseAmount = Math.round(data.amount * parseFloat(rate) * 100) / 100;
        } else {
          baseAmount = data.amount; // Fallback if no rate available
        }
      }
    }
  }

  const sql = `
    INSERT INTO budget_entries (
      version_id, entry_date, description, amount, currency,
      base_amount, base_currency, account_id, category_id,
      labels, note, budget_year
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    RETURNING *
  `;

  const result = await db.query(sql, [
    data.version_id || null,
    data.entry_date,
    data.description || null,
    data.amount,
    currency,
    baseAmount,
    data.base_currency || 'USD',
    data.account_id || null,
    data.category_id || null,
    data.labels || null,
    data.note || null,
    data.budget_year || new Date(data.entry_date).getFullYear()
  ]);

  return result.rows[0];
}

/**
 * Update a budget entry
 */
async function update(id, data) {
  const fields = [];
  const params = [];
  let paramIndex = 1;

  const allowedFields = [
    'version_id', 'entry_date', 'description', 'amount', 'currency',
    'base_amount', 'base_currency', 'account_id', 'category_id',
    'labels', 'note', 'budget_year'
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

  const sql = `
    UPDATE budget_entries SET ${fields.join(', ')}
    WHERE id = $${paramIndex}
    RETURNING *
  `;

  const result = await db.query(sql, params);
  return result.rows[0] || null;
}

/**
 * Delete a budget entry
 */
async function remove(id) {
  const sql = `DELETE FROM budget_entries WHERE id = $1 RETURNING id`;
  const result = await db.query(sql, [id]);
  return result.rowCount > 0;
}

/**
 * Copy all entries from one version to a new version
 */
async function copyVersion(sourceVersionId, newVersionData) {
  return await db.transaction(async (client) => {
    // Create new version
    const versionResult = await client.query(`
      INSERT INTO budget_versions (budget_year, version_name, description, is_active)
      VALUES ($1, $2, $3, TRUE)
      RETURNING *
    `, [newVersionData.budget_year, newVersionData.version_name, newVersionData.description]);

    const newVersion = versionResult.rows[0];

    // Copy entries
    await client.query(`
      INSERT INTO budget_entries (
        version_id, entry_date, description, amount, currency,
        base_amount, base_currency, account_id, category_id,
        labels, note, budget_year
      )
      SELECT
        $1, entry_date, description, amount, currency,
        base_amount, base_currency, account_id, category_id,
        labels, note, $2
      FROM budget_entries
      WHERE version_id = $3
    `, [newVersion.id, newVersionData.budget_year, sourceVersionId]);

    return newVersion;
  });
}

module.exports = {
  // Versions
  findAllVersions,
  findVersionById,
  createVersion,
  updateVersion,
  copyVersion,
  // Entries
  findAll,
  findAllExtended,
  findById,
  sumByCategory,
  sumByMonth,
  compareToActual,
  create,
  update,
  remove
};
