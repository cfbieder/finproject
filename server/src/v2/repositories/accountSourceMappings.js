/**
 * Account Source Mappings Repository
 *
 * Maps external system account names (PocketSmith, Quicken) to internal app accounts.
 * Allows renaming accounts in the app without breaking sync.
 */

const db = require('../db');

async function findByAccountId(accountId) {
  const sql = `
    SELECT id, account_id, source, external_name, created_at
    FROM account_source_mappings
    WHERE account_id = $1
    ORDER BY source, external_name
  `;
  const result = await db.query(sql, [accountId]);
  return result.rows;
}

async function upsert(accountId, source, externalName) {
  const sql = `
    INSERT INTO account_source_mappings (account_id, source, external_name)
    VALUES ($1, $2, $3)
    ON CONFLICT (source, external_name)
    DO UPDATE SET account_id = EXCLUDED.account_id
    RETURNING *
  `;
  const result = await db.query(sql, [accountId, source, externalName]);
  return result.rows[0];
}

async function listBySource(source) {
  const sql = `
    SELECT id, account_id, source, external_name, ignored, created_at
    FROM account_source_mappings
    WHERE source = $1
  `;
  const result = await db.query(sql, [source]);
  return result.rows;
}

/**
 * Upsert a bank-feed mapping with its R1 ignore flag (CR022).
 * external_name is the bank-feed account UUID; accountId is the fin account, or
 * NULL for an ignore-only row (ignored=TRUE, no mapping) — legal since
 * migration 024 dropped NOT NULL on account_id.
 */
async function setBankFeedMapping(externalName, accountId, ignored = false) {
  const sql = `
    INSERT INTO account_source_mappings (account_id, source, external_name, ignored)
    VALUES ($1, 'bank-feed', $2, $3)
    ON CONFLICT (source, external_name)
    DO UPDATE SET account_id = EXCLUDED.account_id, ignored = EXCLUDED.ignored
    RETURNING *
  `;
  const result = await db.query(sql, [accountId != null ? accountId : null, externalName, ignored === true]);
  return result.rows[0];
}

async function removeBySourceAndName(source, externalName) {
  const sql = `DELETE FROM account_source_mappings WHERE source = $1 AND external_name = $2 RETURNING *`;
  const result = await db.query(sql, [source, externalName]);
  return result.rows[0] || null;
}

async function remove(id) {
  const sql = `DELETE FROM account_source_mappings WHERE id = $1 RETURNING *`;
  const result = await db.query(sql, [id]);
  return result.rows[0];
}

async function removeByAccountAndSource(accountId, source) {
  const sql = `
    DELETE FROM account_source_mappings
    WHERE account_id = $1 AND source = $2
    RETURNING *
  `;
  const result = await db.query(sql, [accountId, source]);
  return result.rows;
}

module.exports = {
  findByAccountId,
  upsert,
  remove,
  removeByAccountAndSource,
  listBySource,
  setBankFeedMapping,
  removeBySourceAndName,
};
