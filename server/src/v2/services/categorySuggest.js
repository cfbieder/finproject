/**
 * Category suggestion from history (CR022 — "learn from my category selections").
 *
 * Approach A (merchant-history rules): derive a stable merchant key from each
 * transaction's description, then suggest the category most often assigned to
 * that merchant across the user's accepted+categorized history (27k+ rows).
 * Deterministic, no ML; self-improving — every Accept enlarges the corpus.
 *
 * The accuracy lives in merchantKey(): PKO bank-feed descriptions are noisy and
 * DOUBLED (the merchant text repeats), carry refs/IBANs/dates, and trail with
 * location tokens (WARSZAWA POL). We strip those and keep the leading merchant
 * tokens so e.g. "GREEN COFFEE WARSZAWA POL GREEN COFFEE WARSZAWA POL" → "green
 * coffee". A suggestion is only returned when there are >= MIN_SAMPLES examples
 * AND a clear (>50%) majority, to avoid noise from one-offs / ties.
 */

const db = require('../db');

// Location / connector / noise tokens stripped before keying. Intentionally
// conservative — leading merchant tokens are what disambiguate.
const STOP = new Set([
  'pol', 'pl', 'warszawa', 'warsaw', 'krakow', 'poznan', 'wroclaw', 'gdansk',
  'nld', 'irl', 'gbr', 'usa', 'us', 'deu', 'fra', 'esp',
  'pln', 'usd', 'eur', 'gbp',
  'o', 'od', 'do', 'sp', 'z', 'oo', 'sa', 'com', 'www', 'pending',
  'amsterdam', 'dublin', 'london', 'luton',
]);

const MIN_SAMPLES = 2;     // need at least this many historical examples
const MIN_MAJORITY = 0.5;  // dominant category must exceed this share

function merchantKey(desc) {
  if (!desc) return '';
  let s = String(desc).toLowerCase();
  s = s.replace(/pl\d{10,}/g, ' ');                 // IBAN-ish refs
  s = s.replace(/[0-9]+/g, ' ');                    // any digit runs
  s = s.replace(/[^a-ząćęłńóśźż\s]/g, ' ');         // keep letters (incl. PL diacritics)
  let tokens = s.split(/\s+/).filter((t) => t && t.length > 1 && !STOP.has(t));
  // Collapse bank-feed's whole-string doubling: tokens == X concat X → keep X.
  const half = tokens.length / 2;
  if (tokens.length >= 2 && tokens.length % 2 === 0 &&
      tokens.slice(0, half).join(' ') === tokens.slice(half).join(' ')) {
    tokens = tokens.slice(0, half);
  }
  return tokens.slice(0, 3).join(' ');
}

// Build { merchantKey -> Map(category_id -> count) } from accepted history.
async function buildLookup() {
  const { rows } = await db.query(`
    SELECT description1, category_id, COUNT(*)::int AS n
    FROM transactions
    WHERE accepted = TRUE AND category_id IS NOT NULL AND description1 IS NOT NULL
    GROUP BY description1, category_id
  `);
  const byKey = new Map();
  for (const r of rows) {
    const k = merchantKey(r.description1);
    if (!k) continue;
    if (!byKey.has(k)) byKey.set(k, new Map());
    const m = byKey.get(k);
    m.set(r.category_id, (m.get(r.category_id) || 0) + r.n);
  }
  return byKey;
}

/**
 * @param {number[]} ids - transaction ids to suggest categories for
 * @returns {Promise<Array<{id, category_id, category_name, samples, confidence, merchant_key}>>}
 *          Rows with no confident suggestion have category_id = null.
 */
async function suggestForIds(ids) {
  if (!Array.isArray(ids) || ids.length === 0) return [];
  const lookup = await buildLookup();
  const { rows } = await db.query(
    `SELECT id, description1 FROM transactions WHERE id = ANY($1)`,
    [ids]
  );

  const out = rows.map((r) => {
    const k = merchantKey(r.description1);
    const m = k && lookup.get(k);
    if (!m) return { id: Number(r.id), category_id: null };
    let best = null;
    let bestN = 0;
    let total = 0;
    for (const [cid, n] of m) {
      total += n;
      if (n > bestN) { bestN = n; best = cid; }
    }
    if (best != null && bestN >= MIN_SAMPLES && bestN / total > MIN_MAJORITY) {
      return {
        id: Number(r.id),
        category_id: best,
        samples: bestN,
        confidence: Math.round((100 * bestN) / total),
        merchant_key: k,
      };
    }
    return { id: Number(r.id), category_id: null };
  });

  const catIds = [...new Set(out.map((o) => o.category_id).filter(Boolean))];
  if (catIds.length) {
    const cats = (await db.query(`SELECT id, name FROM accounts WHERE id = ANY($1)`, [catIds])).rows;
    const nameById = new Map(cats.map((c) => [c.id, c.name]));
    for (const o of out) if (o.category_id) o.category_name = nameById.get(o.category_id) || null;
  }
  return out;
}

module.exports = { merchantKey, suggestForIds };
