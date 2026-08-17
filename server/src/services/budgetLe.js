/**
 * Budget LE service — CR083 P0b.
 *
 * Shapes the repository's rows into what the grid renders. All money maths
 * happens here: §10.4's rule is that the frontend renders the sentence and never
 * re-derives a figure.
 *
 * ⚠️ OPEN ITEM for finalise (not built in this increment). The `BUDGET FY` column
 * and therefore the variance are read LIVE from `budget_entries`, because the LE
 * stores only the *estimate* half of the budget (as `budget_carry` rows) and has
 * nowhere to put the full-year figure. That is correct for a **draft**. It is
 * NOT correct once §4.2's freeze ships: a finalised LE would silently restate its
 * own variance the next time the budget is edited — and the owner edits the
 * budget in-year (30 rows since April, 22 of them backdated into elapsed months).
 * Before finalise ships, the full-year budget per category must be snapshotted
 * onto the LE, which needs a column and therefore a migration.
 */

const db = require('../v2/db');
const repo = require('../v2/repositories/budgetLe');
const validate = require('../v2/utils/validate');

/** The last complete calendar month, from the database's own clock (§1.2). */
async function defaultCut(budgetYear) {
  const { rows } = await db.query(
    `SELECT LEAST(
       make_date($1, 11, 30),
       GREATEST(
         make_date($1, 1, 31),
         (date_trunc('month', CURRENT_DATE)::date - 1)
       )
     ) AS cut`,
    [budgetYear]
  );
  return rows[0].cut;
}

/**
 * The full-year budget per category, on the LE's own scope. Separate from the
 * LE's stored lines by necessity — see the OPEN ITEM above.
 */
async function budgetFyByCategory(budgetYear, client = db) {
  const { rows } = await client.query(
    `WITH scope AS (${repo.SCOPE_SQL})
     SELECT e.category_id, SUM(e.base_amount) AS budget_fy
     FROM budget_entries e
     JOIN scope s ON s.id = e.category_id
     WHERE e.budget_year = $1
     GROUP BY 1`,
    [budgetYear]
  );
  const map = new Map();
  for (const r of rows) map.set(r.category_id, Number(r.budget_fy) || 0);
  return map;
}

/**
 * The grid: one row per category, with the YTD actual, the estimate months, and
 * the three comparison figures. Sparse in, dense-per-row out — a category with
 * no September budget simply has no September entry, and the UI renders that as
 * an editable empty rather than a zero (§7.1: a missing row is silence, a zero
 * row is a decision).
 */
async function getGrid(leId) {
  const le = await repo.findById(leId);
  if (!le) return null;

  const [lines, budgetFy] = await Promise.all([
    repo.findLines(leId),
    budgetFyByCategory(le.budget_year),
  ]);

  const cut = String(le.actual_through).slice(0, 10);
  const byCategory = new Map();

  for (const l of lines) {
    const key = l.category_id;
    if (!byCategory.has(key)) {
      byCategory.set(key, {
        categoryId: key,
        categoryName: l.category_name,
        ytdActual: 0,
        months: {},          // 'YYYY-MM' -> { baseAmount, source, method }
        ytdRowCount: 0,
      });
    }
    const row = byCategory.get(key);
    const base = Number(l.base_amount) || 0;
    const month = String(l.period_month).slice(0, 7);

    if (l.source === 'actual') {
      row.ytdActual += base;
      row.ytdRowCount += l.snapshot_row_count || 0;
    } else {
      // Multi-currency cells contribute several slices to one month.
      const cell = row.months[month] || { baseAmount: 0, source: l.source, method: l.method };
      cell.baseAmount += base;
      // A month is "Typed" if ANY slice was typed; §10.5's Mixed case.
      if (l.source === 'manual') { cell.source = 'manual'; cell.method = l.method; }
      row.months[month] = cell;
    }
  }

  const rows = [];
  for (const row of byCategory.values()) {
    const estimate = Object.values(row.months).reduce((s, c) => s + c.baseAmount, 0);
    const fyTotal = row.ytdActual + estimate;
    const bud = budgetFy.get(row.categoryId) || 0;
    const sources = new Set(Object.values(row.months).map((c) => c.source));
    rows.push({
      ...row,
      estimateTotal: estimate,
      fyTotal,
      budgetFy: bud,
      variance: fyTotal - bud,
      basis: sources.size === 0 ? '—'
        : sources.size > 1 ? 'Mixed'
        : sources.has('manual') ? 'Typed' : 'Budget',
    });
  }

  rows.sort((a, b) => (a.categoryName || '').localeCompare(b.categoryName || ''));

  const totals = rows.reduce((t, r) => ({
    ytdActual: t.ytdActual + r.ytdActual,
    estimateTotal: t.estimateTotal + r.estimateTotal,
    fyTotal: t.fyTotal + r.fyTotal,
    budgetFy: t.budgetFy + r.budgetFy,
    variance: t.variance + r.variance,
  }), { ytdActual: 0, estimateTotal: 0, fyTotal: 0, budgetFy: 0, variance: 0 });

  // The estimate columns, in order — derived from the cut so the header and the
  // cells cannot disagree about which months are editable.
  const estimateMonths = [];
  const cutDate = new Date(`${cut}T00:00:00Z`);
  for (let m = cutDate.getUTCMonth() + 1; m < 12; m++) {
    estimateMonths.push(`${le.budget_year}-${String(m + 1).padStart(2, '0')}`);
  }

  return {
    le: {
      id: le.id, name: le.name, label: le.label, status: le.status,
      budgetYear: le.budget_year, actualThrough: cut,
      actualMonths: cutDate.getUTCMonth() + 1,
    },
    estimateMonths,
    rows,
    totals,
    // The banner §5.1 mandates. Stated here, once, so the page cannot invent a
    // second version of it — two mandatory banners is how the wrong one ships.
    fxBasis: 'Estimate months carry the rate each budget row was computed at, '
      + 'not the declared 2026 budget rate — Sep–Dec PLN spans 3.51–3.74 against '
      + 'a declared 3.5517.',
    scopeNote: 'Excludes transfers and Unrealized G/L. Counts transactions posted '
      + 'to non-leaf categories, which /budget-vs-actual does not.',
  };
}

async function list({ budgetYear } = {}) {
  return repo.findAll({ budgetYear: budgetYear ? parseInt(budgetYear, 10) : undefined });
}

async function create({ budgetYear, actualThrough, label, note }) {
  const year = parseInt(budgetYear, 10);
  if (!Number.isInteger(year)) throw validate.badRequest('budgetYear is required');
  const cut = actualThrough || (await defaultCut(year));
  return repo.create({ budgetYear: year, actualThrough: cut, label, note });
}

async function remove(id) {
  const { rowCount } = await db.query(`DELETE FROM budget_le WHERE id = $1`, [id]);
  return rowCount > 0;
}

module.exports = { defaultCut, getGrid, list, create, remove, budgetFyByCategory };
