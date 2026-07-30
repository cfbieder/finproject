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
  // A NULL promote_from_date means "promote every staged row, whatever its date",
  // which is how mapping an account turned into 31 duplicate transactions on
  // 2026-07-14 (Black Card: the staged history landed on top of a period a manual
  // upload already covered, net +$267 so no balance check could see it).
  //
  // So a newly MAPPED account gets its cutoff pinned to the earliest row already
  // staged for it — today's behavior exactly (everything staged still promotes),
  // but a row that turns up LATER dated before that point is now blocked instead
  // of promoted silently. Nothing staged yet ⇒ pin to today.
  //
  // Deliberately not defaulted to CURRENT_DATE: promote_from_date is read-only
  // everywhere in the frontend, so an account mapped today would promote nothing
  // and the owner would have no way to correct it. Making the cutoff an explicit
  // choice at mapping time is the fix that closes the Black Card class, and it
  // needs that UI write path first — roadmap, not here.
  //
  // An existing cutoff is never overwritten, and an ignore-only row (account_id
  // NULL) keeps NULL, because nothing promotes for it and a pin set now would be
  // a stale date by the time it is mapped.
  const sql = `
    INSERT INTO account_source_mappings (account_id, source, external_name, ignored, promote_from_date)
    VALUES ($1, 'bank-feed', $2, $3,
            CASE WHEN $1::int IS NULL THEN NULL ELSE COALESCE(
              (SELECT MIN(s.transaction_date) FROM bankfeed_staging s
                WHERE s.feed_account_external_id = $2::varchar), CURRENT_DATE) END)
    ON CONFLICT (source, external_name)
    DO UPDATE SET account_id = EXCLUDED.account_id,
                  ignored = EXCLUDED.ignored,
                  promote_from_date = CASE
                    WHEN EXCLUDED.account_id IS NULL THEN account_source_mappings.promote_from_date
                    ELSE COALESCE(account_source_mappings.promote_from_date, EXCLUDED.promote_from_date)
                  END
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
