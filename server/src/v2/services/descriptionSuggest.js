/**
 * Rename proposal from history — the description counterpart of categorySuggest.
 *
 * A promoted bank-feed row keeps its original text in bankfeed_staging.description
 * while transactions.description1 holds what was accepted, so every promoted row
 * is one example of "feed text X was booked as Y". We key the feed text with the
 * same merchant ladder as categories (3 → 2 → 1 tokens) and vote on the accepted
 * description. Rows accepted UNCHANGED vote too (as KEEP), so a merchant renamed
 * once out of twenty is not proposed every month.
 *
 * Only feed rows teach — pre-feed history has no original text to learn from.
 */

const db = require('../db');
const { keyCandidates } = require('./categorySuggest');

const MIN_SAMPLES = 2;
const MIN_MAJORITY = 0.5;
const KEEP = Symbol('keep');

// rows: [{ raw, final, n }] → { key -> Map(final|KEEP -> count) }
function buildLookup(rows) {
  const byKey = new Map();
  for (const r of rows) {
    const vote = r.final.trim() === r.raw.trim() ? KEEP : r.final.trim();
    for (const k of keyCandidates(r.raw)) {
      if (!byKey.has(k)) byKey.set(k, new Map());
      const m = byKey.get(k);
      m.set(vote, (m.get(vote) || 0) + r.n);
    }
  }
  return byKey;
}

// Most specific key level whose majority clears the bar. A KEEP majority is a
// decision too (stop backing off), it just proposes nothing.
function propose(lookup, raw) {
  for (const k of keyCandidates(raw)) {
    const m = lookup.get(k);
    if (!m) continue;
    let best = null;
    let bestN = 0;
    let total = 0;
    for (const [v, n] of m) {
      total += n;
      if (n > bestN) { bestN = n; best = v; }
    }
    if (bestN < MIN_SAMPLES || bestN / total <= MIN_MAJORITY) continue;
    if (best === KEEP) return null;
    return {
      description: best,
      samples: bestN,
      total,
      confidence: Math.round((100 * bestN) / total),
      merchant_key: k,
    };
  }
  return null;
}

/**
 * @param {number[]} ids - transaction ids to propose renames for
 * @returns {Promise<Array<{id, description, samples, total, confidence, merchant_key}>>}
 *          description = null when history has no confident rename.
 */
async function suggestForIds(ids) {
  if (!Array.isArray(ids) || ids.length === 0) return [];
  const { rows: history } = await db.query(`
    SELECT s.description AS raw, t.description1 AS final, COUNT(*)::int AS n
    FROM bankfeed_staging s
    JOIN transactions t ON t.id = s.promoted_transaction_id
    WHERE t.accepted = TRUE AND s.description IS NOT NULL AND t.description1 IS NOT NULL
    GROUP BY s.description, t.description1
  `);
  const lookup = buildLookup(history);

  // Key the target on its feed text when it has one (a rename already typed
  // into description1 would otherwise key on the new name).
  const { rows } = await db.query(`
    SELECT t.id, t.description1, COALESCE(s.description, t.description1) AS raw
    FROM transactions t
    LEFT JOIN bankfeed_staging s ON s.promoted_transaction_id = t.id
    WHERE t.id = ANY($1)
  `, [ids]);

  return rows.map((r) => {
    const hit = propose(lookup, r.raw);
    // Nothing to propose if the row already carries that name.
    if (!hit || hit.description === (r.description1 || '').trim()) {
      return { id: Number(r.id), description: null };
    }
    return { id: Number(r.id), ...hit };
  });
}

module.exports = { buildLookup, propose, suggestForIds };
