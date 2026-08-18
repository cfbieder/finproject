/**
 * budgetLe repository — CR083 P0b.
 *
 * `budget_le` (one Latest Estimate) and `budget_le_lines` (one row per LE ×
 * category × month × currency). Migration 072.
 *
 * ── The three invariants migration 072 CANNOT express, which live here ──
 *
 * A CHECK cannot reach across tables, and this database has exactly one
 * non-internal trigger, so a trigger would be against convention. That leaves
 * these to code — worth naming, because CR083 §4.2 is itself about `calibrate()`
 * rewriting history with no audit row:
 *
 *   1. A line's `period_month` must fall inside its LE's `budget_year`.
 *   2. A `final` LE is IMMUTABLE — no line writes, no header edits but status.
 *   3. A `final` LE's actual rows must carry their snapshot, which is what L2
 *      measures drift against.
 *
 * ── Sparse, not dense ──
 *
 * A materialised LE holds only the (category, month, currency) combinations that
 * actually have a budget row or a transaction — 760 for an August 2026 LE, not
 * the 1,116 a dense 93 × 12 grid would give. That is deliberate: a dense grid
 * writes a zero for every unbudgeted category-month, which makes "nothing was
 * ever budgeted here" indistinguishable from "the owner deliberately zeroed it".
 * L4 exists to police exactly that difference and is worth −66,381 on this book.
 * A missing row is silence; a zero row is a decision.
 */

const db = require('../db');

// The LE scope, in one place. §2: profit_loss, excluding the Transfers subtree
// (accounts.is_transfer is TRUE on exactly its 13 descendants) and Unrealized
// G/L. Resolved BY NAME, never id 88 — Known Issue #21 was a suite that borrowed
// an id which is 74 on dev and 11 on a CI-built database.
const SCOPE_SQL = `
  SELECT a.id
  FROM accounts a
  WHERE a.section = 'profit_loss'
    AND NOT a.is_transfer
    AND a.name <> 'Unrealized G/L'
`;

// ---------------------------------------------------------------------------
// Headers
// ---------------------------------------------------------------------------

async function findAll({ budgetYear } = {}) {
  const params = [];
  let where = `WHERE status <> 'superseded'`;
  if (budgetYear) {
    params.push(budgetYear);
    where += ` AND budget_year = $1`;
  }
  const { rows } = await db.query(
    `SELECT le.*,
            (SELECT COUNT(*)::int FROM budget_le_lines l WHERE l.le_id = le.id) AS line_count
     FROM budget_le le
     ${where}
     ORDER BY budget_year DESC, actual_through DESC, created_at DESC`,
    params
  );
  return rows;
}

async function findById(id, client = db) {
  const { rows } = await client.query(`SELECT * FROM budget_le WHERE id = $1`, [id]);
  return rows[0] || null;
}

/**
 * `name` is LE-MM-YY where MM is the FIRST ESTIMATE month — actual_through + 1
 * day — not the creation month (§6). In the normal case the two coincide, which
 * is why an August cut with July closed is `LE-08-26` exactly as the owner
 * described it. Where they diverge, the cut is the honest one.
 */
function leName(actualThrough) {
  const d = new Date(`${actualThrough}T00:00:00Z`);
  // +1 day lands on the first of the next month, because actual_through is
  // constrained to a month end.
  d.setUTCDate(d.getUTCDate() + 1);
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const yy = String(d.getUTCFullYear() % 100).padStart(2, '0');
  return `LE-${mm}-${yy}`;
}

// ---------------------------------------------------------------------------
// Lines
// ---------------------------------------------------------------------------

async function findLines(leId, client = db) {
  const { rows } = await client.query(
    `SELECT l.*, a.name AS category_name
     FROM budget_le_lines l
     LEFT JOIN accounts a ON a.id = l.category_id
     WHERE l.le_id = $1
     ORDER BY a.name NULLS LAST, l.period_month, l.currency`,
    [leId]
  );
  return rows;
}

/**
 * Everything an LE for `budgetYear` cut at `actualThrough` would contain, read
 * straight from the ledger and the budget. Pure read — it writes nothing, so it
 * doubles as the preview behind "what would this LE say?".
 *
 * The two halves are deliberately asymmetric:
 *   - actual months come from `transactions`, at the rate each transaction was
 *     booked at, and carry `snapshot_row_count` / `snapshot_sum` so L2 can
 *     measure drift later;
 *   - estimate months CARRY `budget_entries.base_amount` VERBATIM (§5.1), with
 *     `fx_rate = amount / base_amount` per row — the rate that figure was
 *     actually computed at, which is NOT the declared `budget_fx_rates` value.
 *     Sep–Dec 2026 PLN carries nine distinct rates, and the two bases differ by
 *     $1,054 on the LE's own headline, so P0a and P0b choosing differently would
 *     put two landings on the board.
 */
async function materialise({ budgetYear, actualThrough }, client = db) {
  const { rows } = await client.query(
    `WITH scope AS (${SCOPE_SQL}),
     bounds AS (
       SELECT make_date($1, 1, 1) AS year_start,
              make_date($1, 12, 31) AS year_end,
              $2::date AS cut
     ),
     actual_rows AS (
       SELECT t.category_id,
              date_trunc('month', t.transaction_date)::date AS period_month,
              t.currency,
              SUM(t.amount)      AS amount,
              SUM(t.base_amount) AS base_amount,
              COUNT(*)::int      AS snapshot_row_count,
              SUM(t.base_amount) AS snapshot_sum
       FROM transactions t
       JOIN scope s ON s.id = t.category_id
       CROSS JOIN bounds b
       WHERE t.transaction_date >= b.year_start
         AND t.transaction_date <= b.cut
       GROUP BY 1, 2, 3
     ),
     estimate_rows AS (
       SELECT e.category_id,
              date_trunc('month', e.entry_date)::date AS period_month,
              e.currency,
              SUM(e.amount)      AS amount,
              SUM(e.base_amount) AS base_amount
       FROM budget_entries e
       JOIN scope s ON s.id = e.category_id
       CROSS JOIN bounds b
       WHERE e.budget_year = $1
         AND e.entry_date > b.cut
         AND e.entry_date <= b.year_end
       GROUP BY 1, 2, 3
     )
     SELECT category_id, period_month, currency, amount, base_amount,
            'actual'::text AS source, 'ACTUAL'::text AS method,
            snapshot_row_count, snapshot_sum,
            NULL::numeric AS fx_rate, NULL::text AS fx_basis
     FROM actual_rows
     UNION ALL
     SELECT category_id, period_month, currency, amount, base_amount,
            'budget_carry', 'CARRY',
            NULL::int, NULL::numeric,
            CASE WHEN base_amount = 0 THEN NULL ELSE amount / base_amount END,
            'budget'
     FROM estimate_rows
     ORDER BY category_id, period_month, currency`,
    [budgetYear, actualThrough]
  );
  return rows;
}

/**
 * Create an LE and materialise it, in one transaction. §7.1: `POST /le`
 * materialises ~760 rows and a half-written LE is something only L10 would ever
 * notice, so it is all-or-nothing.
 */
async function create({ budgetYear, actualThrough, label, note }) {
  return db.transaction(async (client) => {
    const { rows: excluded } = await client.query(
      `SELECT ARRAY(
         SELECT a.id FROM accounts a
         WHERE a.section = 'profit_loss'
           AND (a.is_transfer OR a.name = 'Unrealized G/L')
       ) AS ids`
    );

    const { rows: header } = await client.query(
      `INSERT INTO budget_le
         (budget_year, actual_through, name, label, note, excluded_category_ids)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [budgetYear, actualThrough, leName(actualThrough), label || null,
       note || null, excluded[0].ids]
    );
    const le = header[0];

    // Seed the estimate half from the most recent PRIOR LE for this year where
    // it has a figure, falling back to the budget where it does not. Carrying
    // the budget forward every time would throw away the owner's own latest
    // thinking the moment a second LE is cut — the whole point of a series is
    // that LE-09 starts where LE-08 finished.
    //
    // The provenance travels WITH the number: a month the owner typed stays
    // `manual`, a month that was carried from budget stays `budget_carry`. That
    // is why no new `source` value is needed for "carried from a prior LE" —
    // what carried forward is the fact, not the act of carrying.
    const { rows: prior } = await client.query(
      `SELECT id FROM budget_le
       WHERE budget_year = $1 AND id <> $2
       ORDER BY actual_through DESC, created_at DESC
       LIMIT 1`,
      [budgetYear, le.id]
    );

    let priorByCell = new Map();
    if (prior.length) {
      const { rows: pl } = await client.query(
        `SELECT category_id, period_month, currency, amount, base_amount,
                source, method, fx_rate, fx_basis
         FROM budget_le_lines
         WHERE le_id = $1 AND source <> 'actual' AND period_month > $2::date`,
        [prior[0].id, actualThrough]
      );
      priorByCell = new Map(
        pl.map((r) => [`${r.category_id}|${String(r.period_month).slice(0, 10)}|${r.currency}`, r])
      );
    }

    const lines = await materialise({ budgetYear, actualThrough }, client);
    for (const raw of lines) {
      // An estimate cell the prior LE already answered wins over the budget.
      const key = `${raw.category_id}|${String(raw.period_month).slice(0, 10)}|${raw.currency}`;
      const carried = raw.source !== 'actual' && priorByCell.get(key);
      const l = carried ? { ...raw, ...carried, snapshot_row_count: null, snapshot_sum: null } : raw;
      await client.query(
        `INSERT INTO budget_le_lines
           (le_id, category_id, period_month, currency, source, method,
            amount, base_amount, fx_rate, fx_basis,
            snapshot_row_count, snapshot_sum)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [le.id, l.category_id, l.period_month, l.currency, l.source, l.method,
         l.amount, l.base_amount, l.fx_rate, l.fx_basis,
         l.snapshot_row_count, l.snapshot_sum]
      );
    }

    return { ...le, line_count: lines.length, seeded_from_le: prior[0]?.id || null };
  });
}

module.exports = {
  SCOPE_SQL,
  leName,
  findAll,
  findById,
  findLines,
  materialise,
  create,
};
