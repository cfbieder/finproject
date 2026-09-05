'use strict';
/**
 * exposure.js — CR093 P1. What the portfolio is actually exposed to.
 *
 * CR090's register answers "what do I own". This answers "what am I exposed to",
 * and for this portfolio they are very different questions: 72% of the equity
 * sleeve is funds, so a chart that groups holdings by their own ticker describes
 * about a tenth of the money while appearing to describe half of it.
 *
 * ⚠️ COVERAGE IS PART OF THE ANSWER, NOT A FOOTNOTE. Every slice reports what it
 * could not see, and nothing is distributed pro-rata to close a gap — spreading
 * an unclassified holding across the sectors we DO know invents exposure that
 * was never measured. Same rule as CR090's residual row: show the gap.
 *
 * ⚠️ TWO KINDS OF "NO SECTOR", and collapsing them would be the defect:
 *   not_applicable  the instrument HAS no equity sector — a bond, a CD, a
 *                   money-market fund. Expected, permanent, and most of this
 *                   portfolio.
 *   not_covered     an EQUITY holding we cannot sector yet. Today that is the
 *                   three closed-end funds (BDJ, EOS, UTF) whose sector both
 *                   vendors get confidently wrong — `financial_services` is
 *                   their manager's sector, not their holdings' — so
 *                   `Scripts/load-equity-sectors.js` refuses it and leaves them
 *                   with no `sector_weights_as_of`.
 *
 * One bucket for both would leave the owner unable to tell a bond-heavy
 * portfolio from a broken pipeline. The first should be large and stay large;
 * the second should be small and shrink.
 */

const db = require('../v2/db');

const LATEST = `
  SELECT DISTINCT ON (account_id) id FROM security_position_snapshots
   WHERE source = 'bank-feed' AND status = 'fetched'
   ORDER BY account_id, polled_on DESC`;

async function buildExposure() {
  const { rows: pos } = await db.query(`
    WITH latest AS (${LATEST})
    SELECT s.id, s.ticker, s.name, s.asset_class, s.fund_category,
           s.price_basis,
           s.sector_weights_as_of IS NOT NULL AS asked,
           SUM(p.market_value)::float AS mv
      FROM security_positions p
      JOIN securities s ON s.id = p.security_id
     WHERE p.snapshot_id IN (SELECT id FROM latest)
     GROUP BY s.id, s.ticker, s.name, s.asset_class, s.price_basis, s.fund_category, s.sector_weights_as_of`);

  const { rows: weights } = await db.query(`
    SELECT security_id, sector, weight::float AS weight FROM security_sector_weights`);
  const bySec = new Map();
  for (const w of weights) {
    if (!bySec.has(w.security_id)) bySec.set(w.security_id, []);
    bySec.get(w.security_id).push(w);
  }

  const total = pos.reduce((a, p) => a + p.mv, 0);

  // ---- asset class -------------------------------------------------------
  const byClass = new Map();
  for (const p of pos) byClass.set(p.asset_class, (byClass.get(p.asset_class) || 0) + p.mv);

  // ---- sector, with the three absences kept apart ------------------------
  const bySector = new Map();
  const gaps = { not_applicable: [], not_covered: [] };
  for (const p of pos) {
    const w = bySec.get(p.id);
    if (w && w.length) {
      for (const x of w) bySector.set(x.sector, (bySector.get(x.sector) || 0) + p.mv * x.weight);
      continue;
    }
    // An instrument with no equity sector BY NATURE is not a gap in our data.
    // Bond, cash and money-market are that by definition; anything else that was
    // asked and yielded nothing is a refusal we recorded, not an answer.
    // `price_basis = 'par'` is the structural signal, not the asset_class label:
    // three FDIC deposits are classed `unknown` and are plainly not equity — they
    // are held at par. Reading them as "not covered" would put $86,309 of cash
    // into a bucket meant to shrink, where it would sit forever.
    const noEquitySector = ['bond', 'cash', 'mmf'].includes(p.asset_class)
      || p.price_basis === 'par';
    const bucket = noEquitySector || p.asked ? 'not_applicable' : 'not_covered';
    gaps[bucket].push({ security_id: p.id, ticker: p.ticker, name: p.name, asset_class: p.asset_class, market_value: p.mv.toFixed(2) });
  }
  const sectored = [...bySector.values()].reduce((a, b) => a + b, 0);

  const money = (n) => Number(n).toFixed(2);
  const share = (n) => (total ? n / total : 0);

  return {
    total_market_value: money(total),
    by_asset_class: [...byClass.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([asset_class, mv]) => ({ asset_class, market_value: money(mv), share: share(mv) })),
    by_sector: [...bySector.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([sector, mv]) => ({
        sector,
        market_value: money(mv),
        share_of_portfolio: share(mv),
        // Two denominators, deliberately. Share of the SECTORED sleeve is what a
        // pie chart shows; share of the whole portfolio is what the owner
        // actually holds. Reporting only the first makes an 11.8% technology
        // position look like 33%.
        share_of_sectored: sectored ? mv / sectored : 0,
      })),
    sector_coverage: {
      sectored_value: money(sectored),
      share_sectored: share(sectored),
      not_applicable: gaps.not_applicable,
      not_covered: gaps.not_covered,
      not_applicable_value: money(gaps.not_applicable.reduce((a, g) => a + Number(g.market_value), 0)),
      not_covered_value: money(gaps.not_covered.reduce((a, g) => a + Number(g.market_value), 0)),
    },
  };
}

/** The eleven the whole feature speaks. Kept in one place so the API, the DB
 *  CHECK (migration 077) and the page cannot drift apart. */
const SECTORS = [
  'technology', 'financial_services', 'healthcare', 'consumer_cyclical',
  'consumer_defensive', 'industrials', 'energy', 'utilities',
  'realestate', 'basic_materials', 'communication_services',
];

/**
 * Set a security's sector weights BY HAND — the first write in a section CR090
 * deliberately made read-only, so it is narrow on purpose: one security, a set
 * of weights, nothing else.
 *
 * ⚠️ WEIGHTS, NOT A SECTOR. A single pick would be right for a company and wrong
 * for a diversified fund — BDJ and EOS hold broad equity portfolios, and calling
 * either "financial services" by hand is the same error the vendors made, just
 * with a different wrong answer. The UI defaults to one sector at 100% because
 * that IS correct for a single name or a sector fund; it permits more because
 * some holdings need it.
 *
 * ⚠️ THE SUM-TO-1 RULE IS ENFORCED HERE TOO, not only in the loader. Migration
 * 077 records that it cannot be a CHECK constraint (cross-row) and is owned by
 * whoever writes; a hand-entered 60/30 would otherwise store a fund at 90% of
 * its own value and under-report it forever, looking perfectly well-formed.
 *
 * Replaces rather than merges, for the same reason the loader does: a sector
 * removed by hand must actually go, or the set stops summing to 1.
 */
async function setSectorWeights(securityId, weights) {
  if (!Array.isArray(weights) || !weights.length) {
    throw Object.assign(new Error('weights must be a non-empty array'), { status: 400 });
  }
  const seen = new Set();
  for (const w of weights) {
    if (!SECTORS.includes(w.sector)) {
      throw Object.assign(new Error(`unknown sector "${w.sector}"`), { status: 400 });
    }
    if (seen.has(w.sector)) {
      throw Object.assign(new Error(`sector "${w.sector}" given twice`), { status: 400 });
    }
    seen.add(w.sector);
    const n = Number(w.weight);
    if (!(n > 0) || n > 1) {
      throw Object.assign(new Error(`weight for "${w.sector}" must be >0 and <=1`), { status: 400 });
    }
  }
  const sum = weights.reduce((a, w) => a + Number(w.weight), 0);
  if (Math.abs(sum - 1) > 0.005) {
    throw Object.assign(
      new Error(`weights sum to ${(sum * 100).toFixed(1)}%, not 100% — a partial set silently under-reports the holding`),
      { status: 400 },
    );
  }

  const { rows } = await db.query('SELECT id FROM securities WHERE id = $1', [securityId]);
  if (!rows.length) throw Object.assign(new Error('no such security'), { status: 404 });

  await db.query('BEGIN');
  try {
    await db.query('DELETE FROM security_sector_weights WHERE security_id = $1', [securityId]);
    for (const w of weights) {
      await db.query(`INSERT INTO security_sector_weights (security_id, sector, weight, source)
                      VALUES ($1,$2,$3,'manual')`, [securityId, w.sector, Number(w.weight)]);
    }
    // Set on the same transaction: the date means "we have a definitive answer",
    // and a hand-entered set is exactly that.
    await db.query(`UPDATE securities SET sector_weights_as_of = CURRENT_DATE, updated_at = now()
                     WHERE id = $1`, [securityId]);
    await db.query('COMMIT');
  } catch (err) {
    await db.query('ROLLBACK');
    throw err;
  }
  return { security_id: securityId, weights };
}

module.exports = { buildExposure, setSectorWeights, SECTORS };
