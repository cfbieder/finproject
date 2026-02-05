/**
 * PSData Repository
 *
 * Database operations for the psdata_staging table.
 * Replaces MongoDB PSdata collection.
 */

const db = require('../db');

/**
 * Count all records
 */
async function count() {
  const sql = `SELECT COUNT(*)::int as count FROM psdata_staging`;
  const result = await db.query(sql);
  return result.rows[0]?.count || 0;
}

/**
 * Get all distinct account names
 */
async function distinctAccounts() {
  const sql = `
    SELECT DISTINCT account_name
    FROM psdata_staging
    WHERE account_name IS NOT NULL AND account_name != ''
    ORDER BY account_name
  `;
  const result = await db.query(sql);
  return result.rows.map(r => r.account_name);
}

/**
 * Get all distinct category names
 */
async function distinctCategories() {
  const sql = `
    SELECT DISTINCT category_name
    FROM psdata_staging
    WHERE category_name IS NOT NULL AND category_name != ''
    ORDER BY category_name
  `;
  const result = await db.query(sql);
  return result.rows.map(r => r.category_name);
}

/**
 * Get all distinct currencies
 */
async function distinctCurrencies() {
  const sql = `
    SELECT DISTINCT currency FROM (
      SELECT currency FROM psdata_staging WHERE currency IS NOT NULL
      UNION
      SELECT base_currency as currency FROM psdata_staging WHERE base_currency IS NOT NULL
    ) c
    ORDER BY currency
  `;
  const result = await db.query(sql);
  return result.rows.map(r => r.currency).filter(Boolean);
}

/**
 * Find by PS ID
 */
async function findByPsId(psId) {
  const sql = `SELECT * FROM psdata_staging WHERE ps_id = $1`;
  const result = await db.query(sql, [String(psId)]);
  return result.rows[0] || null;
}

/**
 * Find multiple by PS IDs
 */
async function findByPsIds(psIds) {
  if (!psIds || !psIds.length) return [];
  const sql = `SELECT * FROM psdata_staging WHERE ps_id = ANY($1)`;
  const result = await db.query(sql, [psIds.map(String)]);
  return result.rows;
}

/**
 * Insert a single record
 */
async function insert(record) {
  const sql = `
    INSERT INTO psdata_staging (
      ps_id, transaction_date, description1, description2,
      amount, currency, base_amount, base_currency,
      transaction_type, account_name, closing_balance,
      category_name, parent_categories, labels, memo, note, bank
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17
    )
    RETURNING *
  `;
  const result = await db.query(sql, [
    record.ID || record.ps_id || null,
    record.Date || record.transaction_date || null,
    record.Description1 || record.description1 || null,
    record.Description2 || record.description2 || null,
    record.Amount || record.amount || null,
    record.Currency || record.currency || null,
    record.BaseAmount || record.base_amount || null,
    record.BaseCurrency || record.base_currency || 'USD',
    record.TransactionType || record.transaction_type || null,
    record.Account || record.account_name || null,
    record.ClosingBalance || record.closing_balance || null,
    record.Category || record.category_name || null,
    record.ParentCategories || record.parent_categories || null,
    record.Labels || record.labels || null,
    record.Memo || record.memo || null,
    record.Note || record.note || null,
    record.Bank || record.bank || null
  ]);
  return result.rows[0];
}

/**
 * Upsert a single record (insert or update if ps_id exists)
 */
async function upsert(record) {
  const psId = record.ID || record.ps_id;
  if (!psId) {
    return insert(record);
  }

  const sql = `
    INSERT INTO psdata_staging (
      ps_id, transaction_date, description1, description2,
      amount, currency, base_amount, base_currency,
      transaction_type, account_name, closing_balance,
      category_name, parent_categories, labels, memo, note, bank
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17
    )
    ON CONFLICT (ps_id) DO UPDATE SET
      transaction_date = EXCLUDED.transaction_date,
      description1 = EXCLUDED.description1,
      description2 = EXCLUDED.description2,
      amount = EXCLUDED.amount,
      currency = EXCLUDED.currency,
      base_amount = EXCLUDED.base_amount,
      base_currency = EXCLUDED.base_currency,
      transaction_type = EXCLUDED.transaction_type,
      account_name = EXCLUDED.account_name,
      closing_balance = EXCLUDED.closing_balance,
      category_name = EXCLUDED.category_name,
      parent_categories = EXCLUDED.parent_categories,
      labels = EXCLUDED.labels,
      memo = EXCLUDED.memo,
      note = EXCLUDED.note,
      bank = EXCLUDED.bank,
      updated_at = NOW()
    RETURNING *,
      (xmax = 0) as inserted
  `;
  const result = await db.query(sql, [
    psId,
    record.Date || record.transaction_date || null,
    record.Description1 || record.description1 || null,
    record.Description2 || record.description2 || null,
    record.Amount || record.amount || null,
    record.Currency || record.currency || null,
    record.BaseAmount || record.base_amount || null,
    record.BaseCurrency || record.base_currency || 'USD',
    record.TransactionType || record.transaction_type || null,
    record.Account || record.account_name || null,
    record.ClosingBalance || record.closing_balance || null,
    record.Category || record.category_name || null,
    record.ParentCategories || record.parent_categories || null,
    record.Labels || record.labels || null,
    record.Memo || record.memo || null,
    record.Note || record.note || null,
    record.Bank || record.bank || null
  ]);
  return result.rows[0];
}

/**
 * Bulk upsert records
 * Returns { insertedCount, updatedCount, skippedCount }
 */
async function bulkUpsert(records) {
  if (!records || !records.length) {
    return { insertedCount: 0, updatedCount: 0, skippedCount: 0 };
  }

  let insertedCount = 0;
  let updatedCount = 0;
  let skippedCount = 0;

  // Process in batches of 100 for performance
  const batchSize = 100;
  for (let i = 0; i < records.length; i += batchSize) {
    const batch = records.slice(i, i + batchSize);

    for (const record of batch) {
      try {
        const result = await upsert(record);
        if (result?.inserted) {
          insertedCount++;
        } else {
          updatedCount++;
        }
      } catch (err) {
        console.error('[psdata] Failed to upsert record:', err.message);
        skippedCount++;
      }
    }
  }

  return { insertedCount, updatedCount, skippedCount };
}

/**
 * Update a record by PS ID
 */
async function updateByPsId(psId, data) {
  const fields = [];
  const params = [];
  let paramIndex = 1;

  const fieldMappings = {
    Date: 'transaction_date',
    transaction_date: 'transaction_date',
    Description1: 'description1',
    description1: 'description1',
    Description2: 'description2',
    description2: 'description2',
    Amount: 'amount',
    amount: 'amount',
    Currency: 'currency',
    currency: 'currency',
    BaseAmount: 'base_amount',
    base_amount: 'base_amount',
    BaseCurrency: 'base_currency',
    base_currency: 'base_currency',
    TransactionType: 'transaction_type',
    transaction_type: 'transaction_type',
    Account: 'account_name',
    account_name: 'account_name',
    ClosingBalance: 'closing_balance',
    closing_balance: 'closing_balance',
    Category: 'category_name',
    category_name: 'category_name',
    ParentCategories: 'parent_categories',
    parent_categories: 'parent_categories',
    Labels: 'labels',
    labels: 'labels',
    Memo: 'memo',
    memo: 'memo',
    Note: 'note',
    note: 'note',
    Bank: 'bank',
    bank: 'bank'
  };

  for (const [key, value] of Object.entries(data)) {
    const dbField = fieldMappings[key];
    if (dbField && value !== undefined) {
      fields.push(`${dbField} = $${paramIndex++}`);
      params.push(value);
    }
  }

  if (fields.length === 0) return null;

  fields.push(`updated_at = NOW()`);
  params.push(String(psId));

  const sql = `
    UPDATE psdata_staging
    SET ${fields.join(', ')}
    WHERE ps_id = $${paramIndex}
    RETURNING *
  `;

  const result = await db.query(sql, params);
  return result.rows[0] || null;
}

/**
 * Delete all records
 */
async function clearAll() {
  const sql = `DELETE FROM psdata_staging`;
  const result = await db.query(sql);
  return result.rowCount;
}

/**
 * Delete a record by PS ID
 */
async function deleteByPsId(psId) {
  const sql = `DELETE FROM psdata_staging WHERE ps_id = $1 RETURNING id`;
  const result = await db.query(sql, [String(psId)]);
  return result.rowCount > 0;
}

// ============================================================================
// App Data Operations
// ============================================================================

/**
 * Get app data value by key
 */
async function getAppData(key) {
  const sql = `SELECT value FROM app_data WHERE key = $1`;
  const result = await db.query(sql, [key]);
  return result.rows[0]?.value ?? null;
}

/**
 * Set app data value
 */
async function setAppData(key, value) {
  const sql = `
    INSERT INTO app_data (key, value, updated_at)
    VALUES ($1, $2, NOW())
    ON CONFLICT (key) DO UPDATE SET
      value = EXCLUDED.value,
      updated_at = NOW()
    RETURNING *
  `;
  const result = await db.query(sql, [key, JSON.stringify(value)]);
  return result.rows[0];
}

/**
 * Get all app data
 */
async function getAllAppData() {
  const sql = `SELECT key, value FROM app_data`;
  const result = await db.query(sql);

  const appData = {};
  for (const row of result.rows) {
    appData[row.key] = row.value;
  }
  return appData;
}

/**
 * Update multiple app data keys
 */
async function updateAppData(updates) {
  const results = [];
  for (const [key, value] of Object.entries(updates)) {
    const result = await setAppData(key, value);
    results.push(result);
  }
  return results;
}

module.exports = {
  count,
  distinctAccounts,
  distinctCategories,
  distinctCurrencies,
  findByPsId,
  findByPsIds,
  insert,
  upsert,
  bulkUpsert,
  updateByPsId,
  clearAll,
  deleteByPsId,
  getAppData,
  setAppData,
  getAllAppData,
  updateAppData
};
