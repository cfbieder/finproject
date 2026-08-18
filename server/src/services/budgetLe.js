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
const accountsRepo = require('../v2/repositories/accounts');
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
 * Categories carrying transactions anywhere in the year, and how much of that
 * falls AFTER the cut. Keyed by category id; the value is the post-cut total.
 */
async function liveActivityByCategory(budgetYear, actualThrough, client = db) {
  const { rows } = await client.query(
    `WITH scope AS (${repo.SCOPE_SQL})
     SELECT t.category_id,
            COALESCE(SUM(t.base_amount) FILTER (
              WHERE t.transaction_date > $2::date
            ), 0) AS post_cut
     FROM transactions t
     JOIN scope s ON s.id = t.category_id
     WHERE t.transaction_date >= make_date($1, 1, 1)
       AND t.transaction_date <= make_date($1, 12, 31)
     GROUP BY 1`,
    [budgetYear, actualThrough]
  );
  const m = new Map();
  for (const r of rows) m.set(r.category_id, Number(r.post_cut) || 0);
  return m;
}

/**
 * The grid, in COA order with the hierarchy intact.
 *
 * Ordering comes from `getNestedTree`, which since CR063 sorts siblings by
 * `display_order` — the rank migration 049 established — not alphabetically and
 * not by insertion. Every tree, report and dropdown in the app funnels through
 * it, so the LE reads in the same order as the Chart of Accounts and the
 * budget-vs-actual table rather than inventing a third.
 *
 * Parents are emitted as well as leaves, and a parent's figures are the roll-up
 * of its subtree PLUS anything posted directly to it. Two categories do post
 * directly to a non-leaf — `Car Expense` and `Children - Anna` — which is the
 * §2.1a case `/budget-vs-actual` cannot see at all.
 *
 * Estimate months are collapsed to ONE column. The per-month detail lives in the
 * category worksheet, where it can be edited; carrying five read-only columns on
 * the summary bought width and nothing else.
 */
async function getGrid(leId) {
  const le = await repo.findById(leId);
  if (!le) return null;

  const [lines, budgetFy, tree, live] = await Promise.all([
    repo.findLines(leId),
    budgetFyByCategory(le.budget_year),
    accountsRepo.getNestedTree({ section: 'profit_loss' }),
    // Any category with activity ANYWHERE in the year, including AFTER the cut.
    // Without this a category that first spends in an estimate month and has no
    // budget line is invisible — it has nothing in the actual half and nothing
    // to carry into the estimate half — and therefore cannot be estimated at
    // all, because there is no row to open. That is what a genuinely new expense
    // looks like, and `Purchases - IT Costs` is the live example: no 2026 budget
    // and, on a database whose sync predates July, activity only from August.
    liveActivityByCategory(le.budget_year, String(le.actual_through).slice(0, 10)),
  ]);

  const cut = String(le.actual_through).slice(0, 10);
  const excluded = new Set(le.excluded_category_ids || []);

  // Per-category own figures, from the LE's stored lines.
  const own = new Map();
  for (const l of lines) {
    if (!own.has(l.category_id)) {
      own.set(l.category_id, { ytdActual: 0, estimateTotal: 0, sources: new Set() });
    }
    const o = own.get(l.category_id);
    const base = Number(l.base_amount) || 0;
    if (l.source === 'actual') o.ytdActual += base;
    else { o.estimateTotal += base; o.sources.add(l.source); }
  }

  const rows = [];

  // Depth-first in COA order. Returns the subtree totals so a parent can carry
  // its children's figures without a second pass.
  function walk(node, depth) {
    if (excluded.has(node.id)) return null;          // the whole transfer subtree
    const isLeaf = !node.children || node.children.length === 0;
    const o = own.get(node.id) || { ytdActual: 0, estimateTotal: 0, sources: new Set() };

    const totals = {
      ytdActual: o.ytdActual,
      estimateTotal: o.estimateTotal,
      budgetFy: budgetFy.get(node.id) || 0,
    };

    // Reserve this row's slot before descending, so children print under it.
    const slot = rows.length;
    rows.push(null);

    let keptChildren = 0;
    for (const child of node.children || []) {
      const sub = walk(child, depth + 1);
      if (!sub) continue;
      keptChildren += 1;
      totals.ytdActual += sub.ytdActual;
      totals.estimateTotal += sub.estimateTotal;
      totals.budgetFy += sub.budgetFy;
    }

    const hasOwn = o.ytdActual !== 0 || o.estimateTotal !== 0
      || (budgetFy.get(node.id) || 0) !== 0
      || live.has(node.id);
    const empty = totals.ytdActual === 0 && totals.estimateTotal === 0
      && totals.budgetFy === 0;

    // A category with nothing anywhere in its subtree is noise on a 90-row page.
    if (empty && !hasOwn) {
      rows.splice(slot, rows.length - slot);
      return null;
    }

    const fyTotal = totals.ytdActual + totals.estimateTotal;
    const post = live.get(node.id) || 0;
    rows[slot] = {
      // Money already spent on the ESTIMATE side of the cut. It is not part of
      // FY TOTAL — the estimate is what the owner says the rest of the year will
      // be, and quietly adding actuals to it would make a typed figure mean
      // something the owner did not type. It is surfaced so the estimate can be
      // judged against it, and it is what L5 will fire on in P1.
      postCutActual: post,
      // ...but only FLAGGED where it says something. In mid-August a third of
      // the book has some post-cut activity, so marking all of it is wallpaper.
      // Two cases actually warrant a reader's attention:
      //   - spending with NO estimate at all (the `Purchases - IT Costs` shape:
      //     no budget line, so nothing carried, so nothing to overrun); and
      //   - spending that has ALREADY exceeded the whole remaining estimate.
      // Compared on absolutes, because expenses are negative.
      overspent: post !== 0
        && Math.abs(post) > Math.abs(totals.estimateTotal) - 0.005,
      categoryId: node.id,
      categoryName: node.name,
      depth,
      isLeaf,
      // Only a row with figures of its own can be opened for editing. A pure
      // roll-up has nothing to edit — §10.5: roll-ups carry no provenance,
      // because marking a sum implies an edit that does not exist.
      editable: isLeaf || hasOwn,
      hasChildren: keptChildren > 0,
      ytdActual: totals.ytdActual,
      estimateTotal: totals.estimateTotal,
      fyTotal,
      budgetFy: totals.budgetFy,
      variance: fyTotal - totals.budgetFy,
      basis: keptChildren > 0 ? ''
        : o.sources.size === 0 ? '—'
        : o.sources.size > 1 ? 'Mixed'
        : o.sources.has('manual') ? 'Typed' : 'Budget',
    };
    return totals;
  }

  for (const root of tree) walk(root, 0);

  // The NET line is the sum of the DEPTH-0 rows, not of every row — adding
  // parents and their children together would double-count.
  const totals = rows.filter((r) => r && r.depth === 0).reduce((t, r) => ({
    ytdActual: t.ytdActual + r.ytdActual,
    estimateTotal: t.estimateTotal + r.estimateTotal,
    fyTotal: t.fyTotal + r.fyTotal,
    budgetFy: t.budgetFy + r.budgetFy,
    variance: t.variance + r.variance,
  }), { ytdActual: 0, estimateTotal: 0, fyTotal: 0, budgetFy: 0, variance: 0 });

  const cutDate = new Date(`${cut}T00:00:00Z`);
  const estimateMonths = [];
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
    rows: rows.filter(Boolean),
    totals,
    fxBasis: 'Estimate months carry the rate each budget row was computed at, '
      + 'not the declared budget rate — Sep–Dec PLN spans 3.51–3.74 against a '
      + 'declared 3.5517.',
    scopeNote: 'Excludes transfers and Unrealized G/L. Counts transactions posted '
      + 'to non-leaf categories, which /budget-vs-actual does not.',
  };
}

/**
 * One category's worksheet: every month of the year, actuals on the left of the
 * cut and the LE's own estimate on the right.
 *
 * The actual months come from `transactions` rather than the LE's stored rows so
 * the worksheet can show the CURRENT ledger beside what the LE froze — which is
 * the shape L2's drift figure will read, once it ships.
 */
async function getCategoryWorksheet(leId, categoryId) {
  const le = await repo.findById(leId);
  if (!le) return null;

  const { rows: cat } = await db.query(
    `SELECT id, name FROM accounts WHERE id = $1`, [categoryId]
  );
  if (!cat.length) return null;

  const cut = String(le.actual_through).slice(0, 10);

  // Live actuals, by month, for the whole year — not just to the cut, so a
  // transaction that landed in an estimate month is visible rather than hidden.
  const { rows: actual } = await db.query(
    `SELECT to_char(date_trunc('month', t.transaction_date), 'YYYY-MM') AS month,
            SUM(t.base_amount) AS base_amount,
            COUNT(*)::int AS row_count
     FROM transactions t
     WHERE t.category_id = $1
       AND t.transaction_date >= make_date($2, 1, 1)
       AND t.transaction_date <= make_date($2, 12, 31)
     GROUP BY 1 ORDER BY 1`,
    [categoryId, le.budget_year]
  );

  // The budget, by month — the fallback the estimate was seeded from, and what
  // the worksheet compares each typed figure against.
  const { rows: budget } = await db.query(
    `SELECT to_char(date_trunc('month', e.entry_date), 'YYYY-MM') AS month,
            SUM(e.base_amount) AS base_amount
     FROM budget_entries e
     WHERE e.category_id = $1 AND e.budget_year = $2
     GROUP BY 1 ORDER BY 1`,
    [categoryId, le.budget_year]
  );

  // The LE's own stored estimate for this category.
  const { rows: stored } = await db.query(
    `SELECT to_char(period_month, 'YYYY-MM') AS month,
            SUM(base_amount) AS base_amount,
            MIN(source) AS source
     FROM budget_le_lines
     WHERE le_id = $1 AND category_id = $2 AND source <> 'actual'
     GROUP BY 1 ORDER BY 1`,
    [leId, categoryId]
  );

  const by = (rows) => {
    const m = new Map();
    for (const r of rows) m.set(r.month, r);
    return m;
  };
  const aMap = by(actual); const bMap = by(budget); const sMap = by(stored);

  const months = [];
  for (let i = 1; i <= 12; i++) {
    const key = `${le.budget_year}-${String(i).padStart(2, '0')}`;
    const isActual = key <= cut.slice(0, 7);
    const a = aMap.get(key); const b = bMap.get(key); const st = sMap.get(key);
    months.push({
      month: key,
      isActual,
      actual: a ? Number(a.base_amount) : null,
      actualRowCount: a ? a.row_count : 0,
      budget: b ? Number(b.base_amount) : null,
      // Editable only on the estimate side. `null` is an EMPTY cell, not a zero
      // — §7.1: a missing row is silence, a zero row is a decision.
      estimate: st ? Number(st.base_amount) : null,
      source: st ? st.source : null,
    });
  }

  const ytdActual = months.filter((m) => m.isActual)
    .reduce((s, m) => s + (m.actual || 0), 0);
  const estimateTotal = months.filter((m) => !m.isActual)
    .reduce((s, m) => s + (m.estimate || 0), 0);
  const budgetFy = months.reduce((s, m) => s + (m.budget || 0), 0);

  return {
    le: { id: le.id, name: le.name, status: le.status,
          budgetYear: le.budget_year, actualThrough: cut },
    category: { id: cat[0].id, name: cat[0].name },
    months,
    ytdActual,
    estimateTotal,
    fyTotal: ytdActual + estimateTotal,
    budgetFy,
    variance: ytdActual + estimateTotal - budgetFy,
  };
}

/**
 * Write typed estimate figures for one category.
 *
 * `{ "2026-09": 1234.56, "2026-10": null }` — a null CLEARS the month back to
 * empty rather than writing a zero, because those are different facts (§7.1).
 * Every write is `source='manual'`, which is what the advisory's
 * `[ use this figure ]` will also write: it is a typing shortcut, not an
 * acceptance workflow.
 */
async function saveCategoryEstimates(leId, categoryId, values) {
  const le = await repo.findById(leId);
  if (!le) return null;
  // Invariant the schema cannot express (migration 072's closing note): a final
  // LE is immutable.
  if (le.status !== 'draft') {
    throw validate.badRequest('This estimate is final and cannot be edited.');
  }
  const cut = String(le.actual_through).slice(0, 10);

  await db.transaction(async (client) => {
    for (const [month, raw] of Object.entries(values || {})) {
      if (!/^\d{4}-\d{2}$/.test(month)) {
        throw validate.badRequest(`${month} is not a YYYY-MM month`);
      }
      // The other invariant 072 cannot express: a line must fall inside its
      // LE's own year, and it must be on the estimate side of the cut.
      if (!month.startsWith(String(le.budget_year))) {
        throw validate.badRequest(`${month} is outside ${le.budget_year}`);
      }
      if (month <= cut.slice(0, 7)) {
        throw validate.badRequest(`${month} is an actual month and cannot be estimated`);
      }

      const first = `${month}-01`;
      // A typed figure replaces every currency slice for that cell with one USD
      // row: the owner typed a dollar amount, not a set of slices.
      await client.query(
        `DELETE FROM budget_le_lines
         WHERE le_id = $1 AND category_id = $2 AND period_month = $3::date
           AND source <> 'actual'`,
        [leId, categoryId, first]
      );

      if (raw === null || raw === undefined || raw === '') continue;  // cleared
      const amount = Number(raw);
      if (!Number.isFinite(amount)) {
        throw validate.badRequest(`${month}: not a number`);
      }
      await client.query(
        `INSERT INTO budget_le_lines
           (le_id, category_id, period_month, currency, source, method,
            amount, base_amount, fx_rate, fx_basis)
         VALUES ($1, $2, $3::date, 'USD', 'manual', 'MANUAL', $4, $4, 1, 'manual')`,
        [leId, categoryId, first, amount]
      );
    }
    await client.query(
      `UPDATE budget_le SET updated_at = NOW() WHERE id = $1`, [leId]
    );
  });

  // Re-read AFTER the commit, deliberately. Calling getCategoryWorksheet inside
  // the transaction returns the PRE-commit state, because it reads through the
  // pool rather than the transaction's client — so the write lands correctly and
  // the caller is handed the old figures, which the UI then renders. The write
  // is right and the screen is wrong, which is the worst version of this bug.
  return getCategoryWorksheet(leId, categoryId);
}

// ---------------------------------------------------------------------------
// Deviations — CR083, the deterministic half of §3.4
// ---------------------------------------------------------------------------

// Guards from §3.4. All four, because the fourth is the one whose absence let
// `Option Trade` become 57% of the proposal engine's headline in review.
const RATIO_CLAMP = [0.25, 4.0];
const MIN_DENOMINATOR = 500;     // a tiny budget makes a wild ratio
const CHURN_REFUSE = 3.0;        // gross ÷ |net|: a net standing on two-way gross
// Materiality is measured on the EFFECT, not on the year-to-date gap. A category
// can be far off YTD and still imply no change to the rest of the year; what
// earns the owner's attention is a deviation that moves the months still to come.
const MATERIAL_EFFECT = 1000;

/**
 * Categories whose year-to-date behaviour says the REMAINING months of the LE
 * may be wrong.
 *
 * Deliberately arithmetic, start to finish. CR077's rule is that an LLM stage
 * runs "only over the deterministic rules, never instead of them", and CR081
 * measured model-proposed edits at 0/15 twice. So detection, ranking and the
 * proposed figure are all computed here; anything a model ever adds sits on top
 * and can fail without taking the section with it.
 *
 * The trigger is NOT "actual differs from budget year-to-date". A category that
 * is overspent because its budget is back-loaded needs no LE change at all — the
 * year still lands where the budget says. What is flagged is a deviation that
 * implies a LEVEL shift, which is §12 rank 3's timing-vs-permanent distinction.
 */
async function getDeviations(leId) {
  const le = await repo.findById(leId);
  if (!le) return null;

  const cut = String(le.actual_through).slice(0, 10);
  const year = le.budget_year;

  const { rows } = await db.query(
    `WITH scope AS (${repo.SCOPE_SQL}),
     b AS (
       SELECT category_id,
              COALESCE(SUM(base_amount) FILTER (WHERE entry_date <= $2::date), 0) AS budget_ytd,
              COALESCE(SUM(base_amount) FILTER (WHERE entry_date >  $2::date), 0) AS budget_rest,
              COUNT(DISTINCT date_trunc('month', entry_date))
                FILTER (WHERE entry_date <= $2::date)::int AS budget_months
       FROM budget_entries WHERE budget_year = $1 GROUP BY 1
     ),
     a AS (
       SELECT category_id,
              COALESCE(SUM(base_amount), 0) AS actual_ytd,
              COALESCE(SUM(ABS(base_amount)), 0) AS gross_ytd,
              COUNT(DISTINCT date_trunc('month', transaction_date))::int AS actual_months
       FROM transactions
       WHERE transaction_date >= make_date($1,1,1) AND transaction_date <= $2::date
       GROUP BY 1
     ),
     le_est AS (
       SELECT category_id,
              COALESCE(SUM(base_amount), 0) AS estimate_rest,
              BOOL_OR(source = 'manual') AS estimate_is_typed
       FROM budget_le_lines WHERE le_id = $3 AND source <> 'actual' GROUP BY 1
     )
     SELECT s.id, acc.name,
            COALESCE(b.budget_ytd,0)    AS budget_ytd,
            COALESCE(b.budget_rest,0)   AS budget_rest,
            COALESCE(b.budget_months,0) AS budget_months,
            COALESCE(a.actual_ytd,0)    AS actual_ytd,
            COALESCE(a.gross_ytd,0)     AS gross_ytd,
            COALESCE(a.actual_months,0) AS actual_months,
            COALESCE(l.estimate_rest,0) AS estimate_rest,
            COALESCE(l.estimate_is_typed,false) AS estimate_is_typed
     FROM scope s
     JOIN accounts acc ON acc.id = s.id
     LEFT JOIN b ON b.category_id = s.id
     LEFT JOIN a ON a.category_id = s.id
     LEFT JOIN le_est l ON l.category_id = s.id`,
    [year, cut, leId]
  );

  const K = new Date(`${cut}T00:00:00Z`).getUTCMonth() + 1;
  const flags = [];

  for (const r of rows) {
    const budgetYtd = Number(r.budget_ytd);
    const budgetRest = Number(r.budget_rest);
    const actualYtd = Number(r.actual_ytd);
    const grossYtd = Number(r.gross_ytd);
    const estimateRest = Number(r.estimate_rest);
    const estimateIsTyped = r.estimate_is_typed === true;
    const churn = actualYtd === 0 ? 0 : grossYtd / Math.abs(actualYtd);

    // §3.1's buckets. The method only matters on bucket C; on the rest the
    // correct answer is to leave the budget alone, which is why they are
    // reported as context rather than as something to act on.
    let bucket;
    if (budgetYtd === 0 && budgetRest === 0 && actualYtd !== 0) bucket = 'E';
    else if (budgetRest === 0 && budgetYtd !== 0) bucket = 'A';
    else if (budgetYtd === 0 && budgetRest !== 0) bucket = 'B';
    else if (r.budget_months >= K && r.actual_months >= K - 1) bucket = 'C';
    else bucket = 'D';

    // E is its own kind of flag: real money with no budget line, so nothing was
    // carried and there is nothing to overrun. Eight such categories on this
    // book.
    if (bucket === 'E' && Math.abs(actualYtd) >= MATERIAL_EFFECT) {
      flags.push({
        categoryId: r.id, categoryName: r.name, kind: 'no_budget', bucket,
        budgetYtd, actualYtd, deviation: actualYtd, ratio: null,
        estimateRest, proposedRest: null, effect: null,
        reason: `${fmt(actualYtd)} spent year-to-date with no budget line at all, so nothing was carried into the estimate.`,
      });
      continue;
    }

    if (bucket !== 'C') continue;

    const ratio = actualYtd / budgetYtd;
    const guards = [];
    if (Math.sign(actualYtd) !== Math.sign(budgetYtd)) guards.push('sign flip');
    if (Math.abs(budgetYtd) < MIN_DENOMINATOR) guards.push('budget too small to divide by');
    if (churn >= CHURN_REFUSE) guards.push(`churn ${churn.toFixed(1)}× — a net standing on two-way gross`);
    const clamped = ratio < RATIO_CLAMP[0] || ratio > RATIO_CLAMP[1];
    if (clamped) guards.push('ratio outside the 0.25–4.0 clamp');

    const r2 = Math.min(Math.max(ratio, RATIO_CLAMP[0]), RATIO_CLAMP[1]);
    // Re-level the budget's OWN monthly shape, so a December tax bill and a
    // November property tax survive the adjustment. This is PHASE_TO_YTD, and it
    // is why a flat run-rate is not used: on this book that is $147,028 wrong.
    const proposedRest = budgetRest * r2;
    const effect = proposedRest - estimateRest;

    if (guards.length) {
      // Reported, never proposed. A refusal that names its reason is more useful
      // than silence — `Option Trade` would otherwise look overlooked.
      if (Math.abs(budgetRest * (r2 - 1)) >= MATERIAL_EFFECT) {
        flags.push({
          categoryId: r.id, categoryName: r.name, kind: 'refused', bucket,
          budgetYtd, actualYtd, deviation: actualYtd - budgetYtd, ratio,
          estimateRest, proposedRest: null, effect: null, guards,
          reason: `Running at ${ratio.toFixed(2)}× budget year-to-date, but re-levelling is refused: ${guards.join('; ')}.`,
        });
      }
      continue;
    }

    if (Math.abs(effect) < MATERIAL_EFFECT) continue;

    flags.push({
      categoryId: r.id, categoryName: r.name, kind: 'relevel', bucket,
      budgetYtd, actualYtd, deviation: actualYtd - budgetYtd, ratio,
      estimateRest, proposedRest, effect, guards: [], estimateIsTyped,
      reason: `Year-to-date ${fmt(actualYtd)} against a budget of ${fmt(budgetYtd)} — ${ratio.toFixed(3)}×. `
        + `Re-levelling the budget's own monthly shape for the rest of the year gives ${fmt(proposedRest)} `
        + `instead of ${fmt(estimateRest)}`
        // A figure the owner typed is a decision, not an oversight. Saying so is
        // the difference between a flag and a nag -- and an advisory that nags
        // about settled decisions is one the owner stops reading.
        + (estimateIsTyped ? `, which you typed.` : `.`),
    });
  }

  flags.sort((x, y) =>
    Math.abs(y.effect ?? y.deviation ?? 0) - Math.abs(x.effect ?? x.deviation ?? 0));

  const actionable = flags.filter((f) => f.kind === 'relevel');
  return {
    leId, actualThrough: cut, actualMonths: K,
    flags,
    totalEffect: actionable.reduce((s, f) => s + f.effect, 0),
    thresholds: {
      materialEffect: MATERIAL_EFFECT,
      note: `Materiality is measured on the effect a change would have on the months still to come, `
        + `not on the year-to-date gap — a category can be far off year-to-date and still imply no `
        + `change to the rest of the year.`,
    },
  };
}

function fmt(n) {
  const v = Math.abs(Number(n) || 0).toLocaleString('en-US', {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  });
  return Number(n) < 0 ? `($${v})` : `$${v}`;
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

module.exports = {
  defaultCut, getGrid, list, create, remove, budgetFyByCategory,
  getCategoryWorksheet, saveCategoryEstimates, getDeviations,
};
