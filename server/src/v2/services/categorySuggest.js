/**
 * Category suggestion from history (CR022 — "learn from my category selections").
 *
 * Approach A (merchant-history rules): derive a stable merchant key from each
 * transaction's description, then suggest the category most often assigned to
 * that merchant across the user's accepted+categorized history (37k+ rows).
 * Deterministic, no ML; self-improving — every Accept enlarges the corpus.
 *
 * The accuracy lives in merchantTokens(): PKO bank-feed descriptions are noisy
 * and DOUBLED (the merchant text repeats), carry refs/IBANs/dates, and trail
 * with location tokens (WARSZAWA POL). We strip those and keep the leading
 * merchant tokens so e.g. "GREEN COFFEE WARSZAWA POL GREEN COFFEE WARSZAWA POL"
 * → ["green","coffee"].
 *
 * Progressive backoff (CR055): a fixed 3-token key fragments merchants whose
 * 3rd token is a per-transaction id — e.g. US card "AMAZON MKTPL*<orderid>"
 * yields "amazon mktpl kk / qv / jr / …", so 177 categorized Amazon rows never
 * accumulate under one key and Amazon is never suggested. Instead we key at
 * three granularities (3 → 2 → 1 leading tokens) and, per target, take the
 * category from the MOST SPECIFIC level that clears the confidence bar. The
 * narrow key wins where its 3rd token is meaningful; we widen only on a miss,
 * so Amazon collapses to "amazon mktpl" (177 rows) without over-broadening
 * merchants that genuinely need three tokens. A suggestion is only returned
 * when a level has >= MIN_SAMPLES examples AND a clear (>50%) majority.
 */

const db = require('../db');

// Location / connector / noise tokens stripped before keying. Intentionally
// conservative — leading merchant tokens are what disambiguate. US-card feeds
// trail a bracketed disposition tag ("MCDONALD'S F1413 [SALE]"); after digit/
// punctuation stripping the tag word survives, so stop it here.
const STOP = new Set([
  'pol', 'pl', 'warszawa', 'warsaw', 'krakow', 'poznan', 'wroclaw', 'gdansk',
  'nld', 'irl', 'gbr', 'usa', 'us', 'deu', 'fra', 'esp',
  'pln', 'usd', 'eur', 'gbp',
  'o', 'od', 'do', 'sp', 'z', 'oo', 'sa', 'com', 'www', 'pending',
  'amsterdam', 'dublin', 'london', 'luton',
  'sale', 'return', 'refund',                       // US-card disposition tags
]);

const MIN_SAMPLES = 2;     // need at least this many historical examples
const MIN_MAJORITY = 0.5;  // dominant category must exceed this share
const KEY_LEVELS = [3, 2, 1]; // leading-token counts, most specific first

// Normalized, de-doubled leading merchant tokens for a description.
function merchantTokens(desc) {
  if (!desc) return [];
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
  return tokens;
}

// Backward-compatible single key (leading 3 tokens) — most specific level.
function merchantKey(desc) {
  return merchantTokens(desc).slice(0, 3).join(' ');
}

// Candidate keys, most specific first, deduped (short descriptions collapse
// levels — e.g. a 2-token merchant yields ["a b", "a"], never "a b" twice).
function keyCandidates(desc) {
  const tokens = merchantTokens(desc);
  const keys = [];
  for (const n of KEY_LEVELS) {
    if (tokens.length < n) continue;
    const k = tokens.slice(0, n).join(' ');
    if (k && !keys.includes(k)) keys.push(k);
  }
  return keys;
}

// Build { key -> Map(category_id -> count) } from accepted history, indexing
// each row at every key granularity (3/2/1 tokens) so backoff can consult the
// same corpus at whichever level the target resolves to.
async function buildLookup() {
  const { rows } = await db.query(`
    SELECT description1, category_id, COUNT(*)::int AS n
    FROM transactions
    WHERE accepted = TRUE AND category_id IS NOT NULL AND description1 IS NOT NULL
    GROUP BY description1, category_id
  `);
  const byKey = new Map();
  for (const r of rows) {
    for (const k of keyCandidates(r.description1)) {
      if (!byKey.has(k)) byKey.set(k, new Map());
      const m = byKey.get(k);
      m.set(r.category_id, (m.get(r.category_id) || 0) + r.n);
    }
  }
  return byKey;
}

// Majority vote within one key's category counts; null unless it clears the bar.
function decide(m) {
  let best = null;
  let bestN = 0;
  let total = 0;
  for (const [cid, n] of m) {
    total += n;
    if (n > bestN) { bestN = n; best = cid; }
  }
  if (best != null && bestN >= MIN_SAMPLES && bestN / total > MIN_MAJORITY) {
    return { category_id: best, samples: bestN, confidence: Math.round((100 * bestN) / total) };
  }
  return null;
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
    // Backoff: take the first (most specific) key level that clears the bar.
    for (const k of keyCandidates(r.description1)) {
      const m = lookup.get(k);
      if (!m) continue;
      const hit = decide(m);
      if (hit) return { id: Number(r.id), merchant_key: k, ...hit };
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

module.exports = { merchantKey, merchantTokens, keyCandidates, suggestForIds };
