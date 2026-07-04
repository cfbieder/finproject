'use strict';
/**
 * forecastAssumptions repository (CR039)
 *
 * Storage for the forecast assumption document that used to live in
 * components/data/FCAssump.json — one row per top-level key ('scenarios',
 * 'category', 'inflation', 'FX', 'Tax Rate', …), value as JSONB. `ord`
 * preserves the original document's key order so getDoc() reassembles an
 * object whose JSON serialization matches the old file-backed API response
 * byte for byte.
 */

const db = require('../db');

/** Reassemble the full assumption document ({ key: value, … } in ord order). */
async function getDoc() {
  const result = await db.query(
    `SELECT key, value FROM forecast_assumptions ORDER BY ord, key`
  );
  const doc = {};
  for (const row of result.rows) {
    doc[row.key] = row.value;
  }
  return doc;
}

/**
 * Upsert the given top-level keys (partial update — untouched keys keep their
 * rows, matching the old file's {...existing, ...body} merge). New keys are
 * appended after the existing ones, like JSON key insertion order.
 */
async function putDoc(partial) {
  const keys = Object.keys(partial || {});
  if (keys.length === 0) return;
  await db.transaction(async (client) => {
    const maxOrd = await client.query(
      `SELECT COALESCE(MAX(ord), -1)::int AS max_ord FROM forecast_assumptions`
    );
    let nextOrd = maxOrd.rows[0].max_ord + 1;
    for (const key of keys) {
      const inserted = await client.query(
        `INSERT INTO forecast_assumptions (key, value, ord)
         VALUES ($1, $2::json, $3)
         ON CONFLICT (key) DO UPDATE
           SET value = EXCLUDED.value, updated_at = NOW()
         RETURNING (xmax = 0) AS is_new`,
        [key, JSON.stringify(partial[key]), nextOrd]
      );
      if (inserted.rows[0].is_new) nextOrd++;
    }
  });
}

module.exports = { getDoc, putDoc };
