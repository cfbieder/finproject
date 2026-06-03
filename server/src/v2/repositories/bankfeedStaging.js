/**
 * Bank Feed Staging Repository (CR022 Phase B)
 *
 * Owns reads/writes against `bankfeed_staging` (migration 023). Rows are keyed
 * by (source, external_id); insert is an upsert so re-running an ingest over an
 * overlapping window is idempotent. Promote (Phase C) reads `findUnpromoted()`
 * and stamps `promoted_transaction_id` via `markPromoted()`.
 *
 * Mirrors the shape of repositories/psdata.js (upsert + bulkUpsert + counts).
 */

const db = require('../db');

const INSERT_COLUMNS = `
  external_id, source, feed_account_external_id, transaction_date,
  amount, currency, base_amount, base_currency,
  description, merchant, category_hint, pending, raw, activity_type
`;

function insertParams(row) {
  return [
    row.external_id,
    row.source,
    row.feed_account_external_id || null,
    row.transaction_date,
    row.amount,
    row.currency || null,
    row.base_amount != null ? row.base_amount : null,
    row.base_currency || 'USD',
    row.description || null,
    row.merchant || null,
    row.category_hint || null,
    row.pending === true,
    row.raw != null ? JSON.stringify(row.raw) : null, // jsonb param must be a JSON string
    row.activity_type || null,
  ];
}

/**
 * Upsert one staging row. ON CONFLICT (source, external_id) refreshes the
 * mutable fields; `(xmax = 0) as inserted` distinguishes insert from update.
 * NOTE: a conflicting upsert does NOT reset promoted_transaction_id, so a row
 * already promoted stays linked to its transaction.
 */
async function upsert(row) {
  const sql = `
    INSERT INTO bankfeed_staging (${INSERT_COLUMNS})
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
    ON CONFLICT (source, external_id) DO UPDATE SET
      feed_account_external_id = EXCLUDED.feed_account_external_id,
      transaction_date = EXCLUDED.transaction_date,
      amount = EXCLUDED.amount,
      currency = EXCLUDED.currency,
      base_amount = EXCLUDED.base_amount,
      base_currency = EXCLUDED.base_currency,
      description = EXCLUDED.description,
      merchant = EXCLUDED.merchant,
      category_hint = EXCLUDED.category_hint,
      pending = EXCLUDED.pending,
      raw = EXCLUDED.raw,
      activity_type = EXCLUDED.activity_type
    RETURNING *, (xmax = 0) AS inserted
  `;
  const result = await db.query(sql, insertParams(row));
  return result.rows[0];
}

/**
 * Bulk upsert. Returns { insertedCount, updatedCount, skippedCount }.
 * Mirrors psdata.bulkUpsert; per-row try/catch so one bad row can't sink the batch.
 */
async function insertMany(rows) {
  if (!rows || !rows.length) {
    return { insertedCount: 0, updatedCount: 0, skippedCount: 0 };
  }
  let insertedCount = 0;
  let updatedCount = 0;
  let skippedCount = 0;
  for (const row of rows) {
    try {
      const result = await upsert(row);
      if (result?.inserted) insertedCount++;
      else updatedCount++;
    } catch (err) {
      console.error('[bankfeedStaging] upsert failed:', err.message);
      skippedCount++;
    }
  }
  return { insertedCount, updatedCount, skippedCount };
}

async function findByExternalId(source, externalId) {
  const sql = `SELECT * FROM bankfeed_staging WHERE source = $1 AND external_id = $2`;
  const result = await db.query(sql, [source, String(externalId)]);
  return result.rows[0] || null;
}

/** Rows not yet promoted into transactions (promote candidates). */
async function findUnpromoted() {
  const sql = `
    SELECT * FROM bankfeed_staging
    WHERE promoted_transaction_id IS NULL
    ORDER BY transaction_date, id
  `;
  const result = await db.query(sql);
  return result.rows;
}

/** Stamp a staging row as promoted/linked to a canonical transaction id. */
async function markPromoted(stagingId, transactionId) {
  const sql = `
    UPDATE bankfeed_staging
    SET promoted_transaction_id = $2
    WHERE id = $1
    RETURNING id, promoted_transaction_id
  `;
  const result = await db.query(sql, [stagingId, transactionId]);
  return result.rows[0] || null;
}

async function count() {
  const result = await db.query(`SELECT COUNT(*)::int AS n FROM bankfeed_staging`);
  return result.rows[0].n;
}

module.exports = {
  upsert,
  insertMany,
  findByExternalId,
  findUnpromoted,
  markPromoted,
  count,
};
