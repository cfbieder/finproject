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

/**
 * ── The fixed-income X-ray ──────────────────────────────────────────────────
 *
 * 58% of this portfolio is fixed income, and the register can say nothing about
 * any of it beyond a market value. What it is rated, what it pays and when it
 * matures are all printed on the custodian's own statements (migration 078), so
 * this needs no vendor and cannot be contradicted by one.
 */

/** Both agencies' scales, collapsed to letter grades. Notches (`Baa3`, `BBB-`)
 *  are kept on the holding and dropped from the BUCKET: a distribution across
 *  twenty notches is a list, not a picture, and letter grade is the granularity
 *  the market itself speaks in ("investment grade" is BBB/Baa and above). */
const GRADES = ['aaa', 'aa', 'a', 'bbb', 'bb', 'b', 'ccc_or_below'];
const MOODYS_GRADE = {
  Aaa: 'aaa', Aa1: 'aa', Aa2: 'aa', Aa3: 'aa', A1: 'a', A2: 'a', A3: 'a',
  Baa1: 'bbb', Baa2: 'bbb', Baa3: 'bbb', Ba1: 'bb', Ba2: 'bb', Ba3: 'bb',
  B1: 'b', B2: 'b', B3: 'b',
  Caa1: 'ccc_or_below', Caa2: 'ccc_or_below', Caa3: 'ccc_or_below',
  Ca: 'ccc_or_below', C: 'ccc_or_below',
};
const SP_GRADE = {
  AAA: 'aaa', 'AA+': 'aa', AA: 'aa', 'AA-': 'aa', 'A+': 'a', A: 'a', 'A-': 'a',
  'BBB+': 'bbb', BBB: 'bbb', 'BBB-': 'bbb', 'BB+': 'bb', BB: 'bb', 'BB-': 'bb',
  'B+': 'b', B: 'b', 'B-': 'b',
  'CCC+': 'ccc_or_below', CCC: 'ccc_or_below', 'CCC-': 'ccc_or_below',
  CC: 'ccc_or_below', C: 'ccc_or_below', D: 'ccc_or_below',
};

/**
 * ⚠️ A SPLIT RATING TAKES THE LOWER GRADE, which is the market's own convention
 * and the only safe direction to round. Of the bonds here that carry both,
 * Moody's and S&P agree on the letter for most and disagree for some; picking
 * the agency that happens to be present more often would let the answer depend
 * on coverage rather than on credit. Rounding UP would understate exactly the
 * risk this panel exists to show.
 */
function gradeOf(moodys, sp) {
  const a = MOODYS_GRADE[moodys];
  const b = SP_GRADE[sp];
  if (!a) return b || null;
  if (!b) return a;
  return GRADES.indexOf(a) >= GRADES.indexOf(b) ? a : b;
}

const MATURITY_BANDS = [
  { key: 'under_1y', label: 'under 1 year', max: 1 },
  { key: '1_3y', label: '1–3 years', max: 3 },
  { key: '3_5y', label: '3–5 years', max: 5 },
  { key: '5_10y', label: '5–10 years', max: 10 },
  { key: 'over_10y', label: 'over 10 years', max: Infinity },
];
const COUPON_BANDS = [
  { key: 'under_3', label: 'under 3%', max: 3 },
  { key: '3_4', label: '3–4%', max: 4 },
  { key: '4_5', label: '4–5%', max: 5 },
  { key: '5_6', label: '5–6%', max: 6 },
  { key: 'over_6', label: 'over 6%', max: Infinity },
];
const bandFor = (bands, n) => bands.find((b) => n < b.max) || bands[bands.length - 1];
// The three ways a band can be absent, in the order they are shown. `series`
// drops the ones with no money in them, so a portfolio holding no funds shows no
// fund row rather than a zero.
const ABSENT = ['fund', 'no_terms', 'not_stated'];

/**
 * What the fixed-income sleeve is made of — by credit, by maturity, by coupon.
 *
 * ⚠️ FOUR REASONS A BOND HAS NO RATING, and they are not one bucket:
 *   fdic_insured  a brokered CD. NOT unrated — it is insured, which is a
 *                 stronger statement than most ratings, and it is the LARGEST
 *                 single block in this sleeve. Burying $993,085 in "not rated"
 *                 beside genuinely unrated corporate paper would misdescribe a
 *                 quarter of the portfolio.
 *   fund          a bond FUND holds hundreds of issues and has no single rating,
 *                 coupon or maturity. Its own average is a vendor fact we do not
 *                 have; showing it as a gap in OUR data would be wrong.
 *   not_rated     a bond the custodian printed no rating for. A real answer.
 *   no_terms      we have no statement covering it yet — a bond bought since the
 *                 last quarter-end. This is the only one that should shrink, and
 *                 it does so by itself when the next statement arrives.
 */
/**
 * The DB half: fetch the fixed-income sleeve and the portfolio total, then hand
 * both to the pure function below.
 *
 * ⚠️ THE SPLIT IS WHAT MAKES THIS TESTABLE. This query reads EVERY account's
 * latest snapshot — that is what a portfolio view is — so any test of its output
 * is a test of whatever the database happens to hold. Nine tests written against
 * it were green on CI's empty database and red on dev's real one, which is
 * roadmap issue #26 and a rule this repo already writes down: a DB-backed test
 * may not read ambient data. The decision logic — which bucket a holding lands
 * in, how a split rating resolves, how the three absences stay apart — is all in
 * `summariseFixedIncome`, which takes rows and returns an answer, and is tested
 * with invented rows and no database at all.
 */
async function buildFixedIncome() {
  const { rows: pos } = await db.query(`
    WITH latest AS (${LATEST})
    SELECT s.id, s.ticker, s.name, s.price_basis, s.quantity_unit,
           t.as_of, t.maturity_date::text AS maturity_date, t.next_call_date::text AS next_call_date,
           t.coupon_rate::float AS coupon_rate, t.coupon_type, t.payment_frequency,
           t.moodys_rating, t.sp_rating, COALESCE(t.fdic_insured, false) AS fdic_insured,
           SUM(p.market_value)::float AS mv,
           SUM(p.quantity)::float AS quantity
      FROM security_positions p
      JOIN securities s ON s.id = p.security_id
      LEFT JOIN security_bond_terms t ON t.security_id = s.id
     WHERE p.snapshot_id IN (SELECT id FROM latest)
       AND s.asset_class = 'bond'
     GROUP BY s.id, s.ticker, s.name, s.price_basis, s.quantity_unit, t.as_of,
              t.maturity_date, t.next_call_date, t.coupon_rate, t.coupon_type,
              t.payment_frequency, t.moodys_rating, t.sp_rating, t.fdic_insured`);

  const { rows: totalRow } = await db.query(`
    WITH latest AS (${LATEST})
    SELECT COALESCE(SUM(p.market_value), 0)::float AS mv FROM security_positions p
     WHERE p.snapshot_id IN (SELECT id FROM latest)`);
  return summariseFixedIncome(pos, totalRow[0].mv);
}

/**
 * Pure. Rows in, slices out — no database, no clock beyond `today`, so every
 * rule below is pinned by a test that cannot be moved by other people's data.
 */
function summariseFixedIncome(pos, portfolio) {
  const sleeve = pos.reduce((a, p) => a + p.mv, 0);
  const today = new Date();
  const yearsTo = (iso) => (new Date(`${iso}T00:00:00Z`) - today) / (365.25 * 24 * 3600 * 1000);

  const credit = new Map();
  const maturity = new Map();
  const coupon = new Map();
  const gaps = { fdic_insured: [], fund: [], not_rated: [], no_terms: [] };
  const add = (m, k, v) => m.set(k, (m.get(k) || 0) + v);

  let couponWeighted = 0;
  let couponBase = 0;
  let asOfMin = null;
  let asOfMax = null;

  const holdings = [];
  for (const p of pos) {
    // A bond FUND is priced per share; an individual bond or CD is priced
    // against face. That is the structural signal for "this is one instrument
    // with terms" vs "this is hundreds of them", and it does not depend on
    // whether we happen to have parsed a statement for it.
    const isFund = p.price_basis === 'per_share';
    const grade = isFund ? null : gradeOf(p.moodys_rating, p.sp_rating);

    let bucket;
    if (grade) bucket = grade;
    else if (isFund) bucket = 'fund';
    else if (p.fdic_insured) bucket = 'fdic_insured';
    else if (p.as_of) bucket = 'not_rated';
    else bucket = 'no_terms';

    add(credit, bucket, p.mv);
    // `gaps` holds exactly the four non-grade buckets, so membership decides
    // this rather than a chain of conditions restating the same thing.
    if (gaps[bucket]) gaps[bucket].push(holdingRow(p, bucket));

    // ⚠️ ONE "no maturity" BUCKET WOULD BE THE SAME DEFECT AGAIN. A bond fund has
    // no single maturity — permanent, expected, and true of $566,878 here. A
    // bond bought since the last quarter-end has one we have not read yet —
    // $348,563, and it closes by itself. Merged, they read as $915,441 of
    // "funds", which is 40.8% of the sleeve described by the wrong word.
    const absent = isFund ? 'fund' : (p.as_of ? 'not_stated' : 'no_terms');

    if (p.maturity_date) {
      add(maturity, bandFor(MATURITY_BANDS, yearsTo(p.maturity_date)).key, p.mv);
    } else {
      add(maturity, absent, p.mv);
    }

    if (p.coupon_rate !== null && p.coupon_rate !== undefined) {
      add(coupon, bandFor(COUPON_BANDS, p.coupon_rate).key, p.mv);
      couponWeighted += p.coupon_rate * p.mv;
      couponBase += p.mv;
    } else {
      add(coupon, absent, p.mv);
    }

    if (p.as_of) {
      const d = p.as_of instanceof Date ? p.as_of.toISOString().slice(0, 10) : String(p.as_of).slice(0, 10);
      if (!asOfMin || d < asOfMin) asOfMin = d;
      if (!asOfMax || d > asOfMax) asOfMax = d;
    }
    holdings.push(holdingRow(p, bucket));
  }

  const money = (n) => Number(n).toFixed(2);
  const shareOfSleeve = (n) => (sleeve ? n / sleeve : 0);
  const series = (m, order) => order
    .filter((k) => m.has(k))
    .map((k) => ({ bucket: k, market_value: money(m.get(k)), share: shareOfSleeve(m.get(k)) }));

  const rated = GRADES.reduce((a, g) => a + (credit.get(g) || 0), 0);
  const investmentGrade = ['aaa', 'aa', 'a', 'bbb'].reduce((a, g) => a + (credit.get(g) || 0), 0);

  return {
    portfolio_market_value: money(portfolio),
    fixed_income_value: money(sleeve),
    share_of_portfolio: portfolio ? sleeve / portfolio : 0,
    // ⚠️ The date range of the STATEMENTS these terms came from, printed rather
    // than implied. A quarterly statement can be three months old, and a rating
    // shown without its date reads as today's.
    terms_as_of: { earliest: asOfMin, latest: asOfMax },
    by_credit: series(credit, [...GRADES, 'fdic_insured', 'fund', 'not_rated', 'no_terms']),
    credit_coverage: {
      rated_value: money(rated),
      // Two denominators, as elsewhere: investment grade as a share of what is
      // RATED is the credit statement; as a share of the sleeve it is a
      // different and smaller number, and only both together are honest.
      investment_grade_value: money(investmentGrade),
      investment_grade_share_of_rated: rated ? investmentGrade / rated : 0,
      share_rated: shareOfSleeve(rated),
      fdic_insured: gaps.fdic_insured,
      fund: gaps.fund,
      not_rated: gaps.not_rated,
      no_terms: gaps.no_terms,
      fdic_insured_value: money(gaps.fdic_insured.reduce((a, g) => a + Number(g.market_value), 0)),
      fund_value: money(gaps.fund.reduce((a, g) => a + Number(g.market_value), 0)),
      not_rated_value: money(gaps.not_rated.reduce((a, g) => a + Number(g.market_value), 0)),
      no_terms_value: money(gaps.no_terms.reduce((a, g) => a + Number(g.market_value), 0)),
    },
    by_maturity: series(maturity, [...MATURITY_BANDS.map((b) => b.key), ...ABSENT]),
    by_coupon: series(coupon, [...COUPON_BANDS.map((b) => b.key), ...ABSENT]),
    // ⚠️ WEIGHTED BY MARKET VALUE, and named so. Coupon income is face × rate,
    // and these bonds trade near par so the two weightings differ by well under
    // a basis point — but the label has to say which, because CR093 §4 already
    // records how easily a yield-shaped number is read as the wrong thing.
    // This is the COUPON the sleeve carries, NOT a yield: it says nothing about
    // what was paid for the bonds.
    weighted_average_coupon: couponBase ? Number((couponWeighted / couponBase).toFixed(4)) : null,
    weighted_average_coupon_base: money(couponBase),
    holdings: holdings.sort((a, b) => Number(b.market_value) - Number(a.market_value)),
    bands: {
      maturity: MATURITY_BANDS.map(({ key, label }) => ({ key, label })),
      coupon: COUPON_BANDS.map(({ key, label }) => ({ key, label })),
    },
  };
}

function holdingRow(p, bucket) {
  return {
    security_id: p.id,
    ticker: p.ticker,
    name: p.name,
    market_value: Number(p.mv).toFixed(2),
    bucket,
    // Both agencies verbatim beside the derived grade, so a split rating is
    // visible rather than silently resolved.
    moodys_rating: p.moodys_rating,
    sp_rating: p.sp_rating,
    coupon_rate: p.coupon_rate,
    coupon_type: p.coupon_type,
    payment_frequency: p.payment_frequency,
    maturity_date: p.maturity_date,
    next_call_date: p.next_call_date,
    fdic_insured: p.fdic_insured,
    terms_as_of: p.as_of
      ? (p.as_of instanceof Date ? p.as_of.toISOString().slice(0, 10) : String(p.as_of).slice(0, 10))
      : null,
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

module.exports = {
  buildExposure, buildFixedIncome, summariseFixedIncome, setSectorWeights, SECTORS, gradeOf,
};
