'use strict';
/**
 * The budget builder — CR098.
 *
 * Next year's budget, built from the current year's latest finalised Latest Estimate (CR083):
 *
 *   1. one LINE per (category, currency) of the LE, starting from its full-year figure;
 *   2. a per-category POLICY — Recurring (× (1 + inflation)), One-off (0) or Fixed (typed) —
 *      remembered in `budget_category_policy` so next year's build starts from it;
 *   3. inflation and FX from a forecast scenario, resolved for the target year by the engine's own
 *      `rateAtYear`, so a carried-forward rate is the engine's and the grid can say where it came from;
 *   4. an ACCOUNT and MONTH split from the last twelve actual months (the LE's `actual_through`
 *      is the window's end — the LE's own declaration of what is actual);
 *   5. PUBLISH replaces every budget row of the target year in one transaction, snapshots what it
 *      replaced (and the year's budget FX rates) for UN-PUBLISH, and stores the cells it wrote for an
 *      exact RESTORE.
 *
 * Owner decisions (2026-10-15/16) and the two review passes are in docs/cr/cr-098-budget-builder.md.
 */

const db = require('../v2/db');
const assumpRepo = require('../v2/repositories/forecastAssumptions');
const { SCOPE_SQL } = require('../v2/repositories/budgetLe');
const { rateAtYear } = require('./forecast/fcbuilder-setup');

const CURRENCIES = new Set(['USD', 'PLN', 'EUR']); // the engine's FX knows PLN and EUR only
const POLICIES = new Set(['recurring', 'one_off', 'fixed']);
const SPLITS = new Set(['auto', 'even', 'month']);
const LUMP_SHARE = 0.8;              // one month holding ≥ 80% of |spend| is an annual payment
const LOCK_NS = 1178489698;          // advisory-lock namespace for publish / un-publish

const err = (status, message) => Object.assign(new Error(message), { status });
const round2 = (n) => Math.round(Number(n) * 100) / 100;
const num = (v) => (v == null ? null : Number(v));
const sign = (n) => (n > 0 ? 1 : n < 0 ? -1 : 0);

// ---------------------------------------------------------------------------
// Rates — the engine's own resolution, plus where each rate came from
// ---------------------------------------------------------------------------

/** The entry year `rateAtYear` lands on: the last entry at or before `year`, else the first. */
function sourceYear(entries, year) {
  if (!entries.length) return null;
  let src = entries[0].Year;
  for (const e of entries) {
    if (Number(e.Year) <= Number(year)) src = e.Year;
    else break;
  }
  return Number(src);
}

async function scenarioRates(scenarioName, targetYear) {
  const doc = await assumpRepo.getDoc();
  const list = (key) => {
    const raw = doc[key];
    const arr = typeof raw === 'string' ? JSON.parse(raw) : raw || [];
    return Array.isArray(arr) ? arr.filter((e) => e && e.Scenario === scenarioName) : [];
  };
  const inflation = list('inflation').map((e) => ({ Year: Number(e.Year), Rate: Number(e.Rate) }))
    .sort((a, b) => a.Year - b.Year);
  const fx = list('FX').sort((a, b) => Number(a.Year) - Number(b.Year));
  const fxSeries = (cur) => fx.map((e) => ({
    Year: Number(e.Year), Rate: Number(e.Rates?.[cur] ?? e.Rates?.[`USD${cur}`]),
  })).filter((e) => Number.isFinite(e.Rate) && e.Rate > 0);

  if (!inflation.length) throw err(400, `Scenario '${scenarioName}' has no inflation assumption`);
  const out = {
    inflation: { rate: rateAtYear(inflation, targetYear), fromYear: sourceYear(inflation, targetYear) },
    fx: { USD: { rate: 1, fromYear: null } },
  };
  for (const cur of ['PLN', 'EUR']) {
    const s = fxSeries(cur);
    out.fx[cur] = s.length ? { rate: rateAtYear(s, targetYear), fromYear: sourceYear(s, targetYear) } : null;
  }
  return out;
}

function annualFor(line, rates) {
  if (line.policy === 'one_off') return 0;
  if (line.policy === 'fixed') return round2(line.fixed_amount ?? 0);
  const pct = line.inflation_pct != null ? Number(line.inflation_pct) : rates.inflation.rate;
  return round2(Number(line.le_fy) * (1 + pct / 100));
}

// ---------------------------------------------------------------------------
// Builds — create, read, edit
// ---------------------------------------------------------------------------

async function getBuildRow(client, id, { lock = false } = {}) {
  const { rows } = await client.query(
    `SELECT b.*, le.name AS le_name, le.budget_year AS le_year, le.actual_through,
            le.excluded_category_ids
       FROM budget_builds b JOIN budget_le le ON le.id = b.source_le_id
      WHERE b.id = $1 ${lock ? 'FOR UPDATE OF b' : ''}`, [id]
  );
  if (!rows[0]) throw err(404, 'Build not found');
  return rows[0];
}

/** What the picker offers: finalised LEs (newest first), base scenarios, and every build. */
async function listSources() {
  const les = (await db.query(
    `SELECT id, name, budget_year, actual_through, finalized_at FROM budget_le
      WHERE status = 'final' ORDER BY budget_year DESC, actual_through DESC, id DESC`
  )).rows;
  const scenarios = (await db.query(
    `SELECT name FROM forecast_scenarios
      WHERE parent_scenario_id IS NULL AND NOT is_scratch ORDER BY name`
  )).rows.map((r) => r.name);
  const builds = (await db.query(
    `SELECT b.id, b.target_year, b.build_no, b.status, b.note, b.scenario_name, b.published_at,
            b.parent_build_id, b.created_at, le.name AS le_name
       FROM budget_builds b JOIN budget_le le ON le.id = b.source_le_id
      ORDER BY b.target_year DESC, b.build_no DESC`
  )).rows;
  return { les, scenarios, builds };
}

/**
 * Create a draft. From scratch, each line takes the category's remembered policy; "Start from"
 * (`parentBuildId`) copies an earlier build's per-line choices instead. A copied line the new LE
 * lacks is kept if Fixed and reported as dropped otherwise — never silently.
 */
async function createBuild({ targetYear, sourceLeId, scenarioName, parentBuildId = null, note = null }) {
  return db.transaction(async (client) => {
    const le = (await client.query('SELECT * FROM budget_le WHERE id = $1', [sourceLeId])).rows[0];
    if (!le) throw err(404, 'Latest Estimate not found');
    if (le.status !== 'final') throw err(400, `${le.name} is a draft — only a finalised LE can seed a budget`);
    const year = Number(targetYear || le.budget_year + 1);
    if (year !== le.budget_year + 1) throw err(400, `${le.name} is for ${le.budget_year}; it seeds ${le.budget_year + 1}, not ${year}`);
    const scen = (await client.query(
      'SELECT name FROM forecast_scenarios WHERE name = $1 AND parent_scenario_id IS NULL', [scenarioName]
    )).rows[0];
    if (!scen) throw err(400, `Base scenario '${scenarioName}' not found`);

    const draft = (await client.query(
      `SELECT build_no FROM budget_builds WHERE target_year = $1 AND status = 'draft'`, [year]
    )).rows[0];
    if (draft) throw err(409, `${year} v${draft.build_no} is already an open draft — finish or delete it first`);

    let parentLines = new Map();
    if (parentBuildId) {
      const parent = (await client.query('SELECT target_year FROM budget_builds WHERE id = $1', [parentBuildId])).rows[0];
      if (!parent) throw err(404, 'Build to start from not found');
      for (const r of (await client.query('SELECT * FROM budget_build_lines WHERE build_id = $1', [parentBuildId])).rows) {
        parentLines.set(`${r.category_id}|${r.currency}`, r);
      }
    }

    const leLines = (await client.query(
      `SELECT category_id, currency, SUM(amount) AS le_fy
         FROM budget_le_lines
        WHERE le_id = $1 AND NOT (category_id = ANY($2::int[]))
        GROUP BY 1, 2`, [le.id, le.excluded_category_ids || []]
    )).rows;
    const bad = leLines.filter((l) => !CURRENCIES.has(l.currency));
    if (bad.length) {
      throw err(400, `The forecast has no FX rate for ${[...new Set(bad.map((l) => l.currency))].join(', ')} — refusing to value it 1:1`);
    }

    const buildNo = Number((await client.query(
      'SELECT COALESCE(MAX(build_no), 0) + 1 AS n FROM budget_builds WHERE target_year = $1', [year]
    )).rows[0].n);
    const build = (await client.query(
      `INSERT INTO budget_builds (target_year, build_no, source_le_id, scenario_name, parent_build_id, note)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [year, buildNo, le.id, scenarioName, parentBuildId, note]
    )).rows[0];

    const policies = new Map((await client.query('SELECT * FROM budget_category_policy')).rows
      .map((p) => [p.category_id, p]));
    const insertLine = (l) => client.query(
      `INSERT INTO budget_build_lines
         (build_id, category_id, currency, le_fy, policy, fixed_amount, inflation_pct, split_method, split_month)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [build.id, l.category_id, l.currency, l.le_fy, l.policy, l.fixed_amount, l.inflation_pct, l.split_method, l.split_month]
    );

    const dropped = [];
    const seen = new Set();
    for (const l of leLines) {
      const key = `${l.category_id}|${l.currency}`;
      seen.add(key);
      const from = parentLines.get(key);
      const pol = policies.get(l.category_id);
      await insertLine({
        category_id: l.category_id, currency: l.currency, le_fy: round2(l.le_fy),
        policy: from?.policy ?? pol?.policy ?? 'recurring',
        // A Fixed line with nothing typed yet starts at its LE figure, so a flip to Fixed is an edit,
        // not a zero that silently drops the line.
        fixed_amount: from ? from.fixed_amount : (pol?.policy === 'fixed' ? round2(l.le_fy) : null),
        inflation_pct: from ? from.inflation_pct : (pol?.inflation_override_pct ?? null),
        split_method: from?.split_method ?? pol?.split_override ?? 'auto',
        split_month: from?.split_month ?? pol?.split_month ?? null,
      });
    }
    for (const [key, from] of parentLines) {
      if (seen.has(key)) continue;
      if (from.policy === 'fixed') {
        await insertLine({ ...from, le_fy: 0 });
      } else {
        dropped.push({ category_id: from.category_id, currency: from.currency, policy: from.policy });
      }
    }
    return { build, dropped };
  });
}

async function deleteDraft(id) {
  const res = await db.query(`DELETE FROM budget_builds WHERE id = $1 AND status = 'draft' RETURNING id`, [id]);
  if (!res.rowCount) throw err(409, 'Only a draft can be deleted');
}

async function setNote(id, note) {
  await db.query('UPDATE budget_builds SET note = $2, updated_at = NOW() WHERE id = $1', [id, note || null]);
}

/**
 * Edit one line of a draft. Policy, inflation override and split are also REMEMBERED for the
 * category (decision 2); a Fixed amount is the line's own (one per currency line).
 */
async function updateLine(buildId, lineId, patch) {
  return db.transaction(async (client) => {
    const build = await getBuildRow(client, buildId, { lock: true });
    if (build.status !== 'draft') throw err(409, 'Only a draft can be edited — start a new build from this one');
    const line = (await client.query(
      'SELECT * FROM budget_build_lines WHERE id = $1 AND build_id = $2', [lineId, buildId]
    )).rows[0];
    if (!line) throw err(404, 'Line not found');

    const next = { ...line };
    if (patch.policy !== undefined) {
      if (!POLICIES.has(patch.policy)) throw err(400, `Unknown policy '${patch.policy}'`);
      next.policy = patch.policy;
      if (patch.policy === 'fixed' && next.fixed_amount == null) next.fixed_amount = line.le_fy;
    }
    if (patch.fixedAmount !== undefined) {
      const v = patch.fixedAmount === null || patch.fixedAmount === '' ? null : Number(patch.fixedAmount);
      if (v !== null && !Number.isFinite(v)) throw err(400, 'Fixed amount must be a number');
      next.fixed_amount = v;
    }
    if (patch.inflationPct !== undefined) {
      const v = patch.inflationPct === null || patch.inflationPct === '' ? null : Number(patch.inflationPct);
      if (v !== null && (!Number.isFinite(v) || v < -100 || v > 1000)) throw err(400, 'Inflation % must be between −100 and 1000');
      next.inflation_pct = v;
    }
    if (patch.splitMethod !== undefined) {
      if (!SPLITS.has(patch.splitMethod)) throw err(400, `Unknown split '${patch.splitMethod}'`);
      next.split_method = patch.splitMethod;
    }
    if (patch.splitMonth !== undefined) next.split_month = patch.splitMonth == null ? null : Number(patch.splitMonth);
    if (next.split_method === 'month' && !(next.split_month >= 1 && next.split_month <= 12)) {
      throw err(400, 'Pick the month the whole line goes in');
    }
    if (next.split_method !== 'month') next.split_month = null;

    await client.query(
      `UPDATE budget_build_lines SET policy = $2, fixed_amount = $3, inflation_pct = $4,
              split_method = $5, split_month = $6 WHERE id = $1`,
      [lineId, next.policy, next.fixed_amount, next.inflation_pct, next.split_method, next.split_month]
    );
    await client.query(
      `INSERT INTO budget_category_policy (category_id, policy, inflation_override_pct, split_override, split_month, updated_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       ON CONFLICT (category_id) DO UPDATE SET policy = EXCLUDED.policy,
         inflation_override_pct = EXCLUDED.inflation_override_pct, split_override = EXCLUDED.split_override,
         split_month = EXCLUDED.split_month, updated_at = NOW()`,
      [line.category_id, next.policy, next.inflation_pct, next.split_method, next.split_month]
    );
    await client.query('UPDATE budget_builds SET updated_at = NOW() WHERE id = $1', [buildId]);
  });
}

/** The draft or build with every line's annual figure, its deltas and its flags. */
async function getBuild(id) {
  const build = await getBuildRow(db, id);
  const rates = await scenarioRates(build.scenario_name, build.target_year);
  const lines = (await db.query(
    `SELECT l.*, c.name AS category_name, c.section,
            p.name AS parent_name,
            EXISTS (SELECT 1 FROM accounts ch WHERE ch.parent_id = c.id) AS is_parent,
            EXISTS (SELECT 1 FROM fc_line_categories flc WHERE flc.category_id IN (
                      WITH RECURSIVE up AS (SELECT c.id AS id, c.parent_id
                                            UNION ALL
                                            SELECT a.id, a.parent_id FROM accounts a JOIN up ON a.id = up.parent_id)
                      SELECT id FROM up)) AS on_forecast_line,
            COALESCE((SELECT SUM(be.amount) FROM budget_entries be
                       WHERE be.budget_year = $2 AND be.category_id = l.category_id
                         AND be.currency = l.currency), 0) AS this_year_budget
       FROM budget_build_lines l
       JOIN accounts c ON c.id = l.category_id
       LEFT JOIN accounts p ON p.id = c.parent_id
      WHERE l.build_id = $1
      ORDER BY p.name NULLS FIRST, c.name, l.currency`, [id, build.le_year]
  )).rows;

  const totals = {};
  let usdTotal = 0;
  const out = lines.map((l) => {
    const annual = build.status === 'draft' ? annualFor(l, rates) : round2(l.annual_amount);
    const fx = rates.fx[l.currency];
    const usd = fx && fx.rate ? round2(annual / fx.rate) : null;
    totals[l.currency] = round2((totals[l.currency] || 0) + annual);
    if (usd != null) usdTotal += usd;
    return {
      id: l.id, categoryId: l.category_id, category: l.category_name, parent: l.parent_name,
      currency: l.currency, leFy: num(l.le_fy), policy: l.policy, fixedAmount: num(l.fixed_amount),
      inflationPct: num(l.inflation_pct), effectiveInflationPct: l.policy === 'recurring'
        ? (l.inflation_pct != null ? Number(l.inflation_pct) : rates.inflation.rate) : null,
      splitMethod: l.split_method, splitMonth: l.split_month,
      annual, annualUsd: usd, vsLe: round2(annual - Number(l.le_fy)),
      thisYearBudget: round2(l.this_year_budget), vsThisYear: round2(annual - Number(l.this_year_budget)),
      isParent: l.is_parent, onForecastLine: l.on_forecast_line,
    };
  });
  return {
    build: {
      id: build.id, targetYear: build.target_year, buildNo: build.build_no, status: build.status,
      note: build.note, scenario: build.scenario_name, le: { id: build.source_le_id, name: build.le_name,
        year: build.le_year, actualThrough: build.actual_through }, parentBuildId: build.parent_build_id,
      publishedAt: build.published_at,
    },
    rates, lines: out, totals, usdTotal: round2(usdTotal),
  };
}

// ---------------------------------------------------------------------------
// The split — accounts, then months, from the last twelve actual months
// ---------------------------------------------------------------------------

/** Spread `total` over `weights` (same sign as total), to cents, summing exactly to `total`. */
function allocate(total, weights) {
  const sum = weights.reduce((s, w) => s + w, 0);
  if (!sum) return weights.map(() => 0);
  const raw = weights.map((w) => (total * w) / sum);
  const cents = raw.map(round2);
  const diff = round2(total - cents.reduce((s, c) => s + c, 0));
  if (diff !== 0) {
    let k = 0;
    for (let i = 1; i < cents.length; i++) if (Math.abs(raw[i]) > Math.abs(raw[k])) k = i;
    cents[k] = round2(cents[k] + diff);
  }
  return cents;
}

/**
 * Cells for one line: [{ account_id, month, amount }]. `grid` maps account → [12 monthly sums]
 * (calendar months 1..12) from actuals, or from this year's budget as the fallback.
 */
function splitLine(annual, line, actualGrid, budgetGrid) {
  if (!annual) return { cells: [], source: 'none', method: 'zero' };
  const s = sign(annual);
  const valid = (grid) => {
    if (!grid || !grid.size) return false;
    let total = 0;
    for (const months of grid.values()) {
      const t = months.reduce((a, b) => a + b, 0);
      if (sign(t) === -s) return false;    // an account against the line's sign
      total += t;
    }
    return sign(total) === s;
  };
  let grid = null;
  let source = 'none';
  if (valid(actualGrid)) { grid = actualGrid; source = 'actuals'; }
  else if (valid(budgetGrid)) { grid = budgetGrid; source = 'budget'; }

  const accounts = grid ? [...grid.keys()] : [null];
  const accTotals = grid ? accounts.map((a) => grid.get(a).reduce((x, y) => x + y, 0)) : [1];
  const accAmounts = allocate(annual, grid ? accTotals.map(Math.abs) : [1]);

  // Month weights per account.
  let method = line.split_method;
  let lumpMonth = null;
  if (method === 'auto' && grid) {
    const lineMonths = Array.from({ length: 12 }, (_, m) => accounts.reduce((t, a) => t + Math.abs(grid.get(a)[m]), 0));
    const absTotal = lineMonths.reduce((a, b) => a + b, 0);
    const maxM = lineMonths.indexOf(Math.max(...lineMonths));
    if (absTotal > 0 && lineMonths[maxM] / absTotal >= LUMP_SHARE) lumpMonth = maxM + 1;
  }
  if (method === 'auto' && !grid) method = 'even';

  const cells = [];
  accounts.forEach((acct, i) => {
    let weights;
    if (method === 'month') weights = Array.from({ length: 12 }, (_, m) => (m + 1 === line.split_month ? 1 : 0));
    else if (lumpMonth) weights = Array.from({ length: 12 }, (_, m) => (m + 1 === lumpMonth ? 1 : 0));
    else if (method === 'even') weights = Array(12).fill(1);
    else {
      const months = grid.get(acct);
      const accSign = sign(months.reduce((a, b) => a + b, 0));
      // A month against the account's own sign would be amplified by re-scaling — split evenly.
      weights = months.some((v) => sign(v) === -accSign) ? Array(12).fill(1) : months.map(Math.abs);
      if (!weights.some((w) => w > 0)) weights = Array(12).fill(1);
    }
    allocate(accAmounts[i], weights).forEach((amount, m) => {
      if (amount) cells.push({ account_id: acct, month: m + 1, amount });
    });
  });
  return { cells, source, method: lumpMonth ? `lump:${lumpMonth}` : method };
}

/** Actual and this-year-budget grids for every line of a build, keyed `category|currency`. */
async function loadGrids(client, build) {
  const end = new Date(`${String(build.actual_through).slice(0, 10)}T00:00:00Z`);
  const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - 11, 1));
  const toGrid = (rows) => {
    const out = new Map();
    for (const r of rows) {
      const key = `${r.category_id}|${r.currency}`;
      if (!out.has(key)) out.set(key, new Map());
      const g = out.get(key);
      const acct = r.account_id == null ? null : Number(r.account_id);
      if (!g.has(acct)) g.set(acct, Array(12).fill(0));
      g.get(acct)[Number(r.m) - 1] += Number(r.amount);
    }
    return out;
  };
  const actual = toGrid((await client.query(
    `WITH scope AS (${SCOPE_SQL})
     SELECT t.category_id, t.currency, t.account_id, EXTRACT(MONTH FROM t.transaction_date)::int AS m,
            SUM(t.amount) AS amount
       FROM transactions t JOIN scope s ON s.id = t.category_id
      WHERE t.transaction_date >= $1::date AND t.transaction_date <= $2::date
      GROUP BY 1, 2, 3, 4`,
    [start.toISOString().slice(0, 10), String(build.actual_through).slice(0, 10)]
  )).rows);
  const budget = toGrid((await client.query(
    `SELECT category_id, currency, account_id, EXTRACT(MONTH FROM entry_date)::int AS m, SUM(amount) AS amount
       FROM budget_entries WHERE budget_year = $1 GROUP BY 1, 2, 3, 4`, [build.le_year]
  )).rows);
  return { actual, budget, window: { from: start.toISOString().slice(0, 10), to: String(build.actual_through).slice(0, 10) } };
}

/** Every cell a publish of this draft would write, with each line's split source and method. */
async function computeCells(client, build, view) {
  const { actual, budget, window } = await loadGrids(client, build);
  const cells = [];
  const lines = view.lines.map((l) => {
    const key = `${l.categoryId}|${l.currency}`;
    const rawLine = { split_method: l.splitMethod, split_month: l.splitMonth };
    const { cells: lc, source, method } = splitLine(l.annual, rawLine, actual.get(key), budget.get(key));
    const fx = view.rates.fx[l.currency];
    for (const c of lc) {
      cells.push({
        category_id: l.categoryId, account_id: c.account_id, currency: l.currency, month: c.month,
        amount: c.amount, fx_rate: fx.rate, base_amount: round2(c.amount / fx.rate),
      });
    }
    const months = Array(12).fill(0);
    for (const c of lc) months[c.month - 1] = round2(months[c.month - 1] + c.amount);
    return { id: l.id, splitSource: source, splitApplied: method, months, accounts: [...new Set(lc.map((c) => c.account_id))] };
  });
  return { cells, lines, window };
}

// ---------------------------------------------------------------------------
// Publish / un-publish / restore
// ---------------------------------------------------------------------------

/** md5 over every column of the year's budget rows — `updated_at` included, so a Recalculate counts. */
async function yearChecksum(client, year) {
  return (await client.query(
    `SELECT md5(COALESCE(string_agg(row_to_json(be)::text, '|' ORDER BY be.id), '')) AS c
       FROM budget_entries be WHERE be.budget_year = $1`, [year]
  )).rows[0].c;
}

async function yearSummary(client, year) {
  const rows = (await client.query(
    `SELECT COALESCE(c.name, '(no category)') AS category, be.currency, COUNT(*)::int AS n,
            SUM(be.amount) AS amount, SUM(be.base_amount) AS base_amount
       FROM budget_entries be LEFT JOIN accounts c ON c.id = be.category_id
      WHERE be.budget_year = $1 GROUP BY 1, 2 ORDER BY 1, 2`, [year]
  )).rows;
  return {
    rows: rows.map((r) => ({ category: r.category, currency: r.currency, count: r.n,
      amount: round2(r.amount), usd: round2(r.base_amount || 0) })),
    count: rows.reduce((s, r) => s + r.n, 0),
    usd: round2(rows.reduce((s, r) => s + Number(r.base_amount || 0), 0)),
  };
}

/** Base scenarios whose base year (PeriodStart − 1) is `year` — they read this year's budget. */
async function scenariosReading(year) {
  const doc = await assumpRepo.getDoc();
  const raw = doc.scenarios;
  const list = typeof raw === 'string' ? JSON.parse(raw) : raw || [];
  return list.filter((e) => e && Number(e.PeriodStart) - 1 === Number(year)).map((e) => e.Name);
}

/** The publish preview: what goes, what comes, and anything that blocks it. */
async function previewPublish(id) {
  const view = await getBuild(id);
  const build = await getBuildRow(db, id);
  const blockers = [];
  for (const l of view.lines) {
    if (l.isParent && l.annual) {
      blockers.push(`${l.category} (${l.currency}) is a parent category — the forecast's base year cannot see it. ` +
        'Set it to One-off and put its amount on a sub-category.');
    }
    if (!view.rates.fx[l.currency]) blockers.push(`No ${l.currency} rate in scenario '${view.build.scenario}'`);
  }
  const computed = build.status === 'draft'
    ? await computeCells(db, build, view)
    : { cells: (await db.query('SELECT * FROM budget_build_cells WHERE build_id = $1', [id])).rows, lines: [], window: null };
  const willWrite = {
    count: computed.cells.length,
    usd: round2(computed.cells.reduce((s, c) => s + Number(c.base_amount), 0)),
  };
  return {
    ...view, split: computed.lines, window: computed.window, blockers,
    current: await yearSummary(db, view.build.targetYear),
    checksum: await yearChecksum(db, view.build.targetYear),
    willWrite,
    readers: await scenariosReading(view.build.targetYear),
  };
}

/** Publish a draft (computed cells) or restore a published-before build (its stored cells). */
async function publish(id, { checksum }) {
  return db.transaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock($1, $2)', [LOCK_NS, 0]);
    const build = await getBuildRow(client, id, { lock: true });
    const year = build.target_year;
    if (build.status === 'published') throw err(409, `${year} v${build.build_no} is already the live budget`);
    if (build.status === 'unpublished' || build.status === 'superseded') {
      const n = (await client.query('SELECT COUNT(*)::int AS n FROM budget_build_cells WHERE build_id = $1', [id])).rows[0].n;
      if (!n) throw err(409, 'This build was never published, so it has nothing to restore');
    }
    if (!checksum || checksum !== await yearChecksum(client, year)) {
      throw err(409, `The ${year} budget changed since the preview — open the preview again`);
    }

    let cells;
    let lineAnnual = null;
    if (build.status === 'draft') {
      const view = await getBuild(id);
      if (view.lines.some((l) => l.isParent && l.annual)) {
        throw err(400, 'A parent-category line has an amount — the forecast cannot see it (see the preview)');
      }
      const computed = await computeCells(client, build, view);
      cells = computed.cells;
      lineAnnual = view.lines;
    } else {
      cells = (await client.query('SELECT * FROM budget_build_cells WHERE build_id = $1', [id])).rows;
    }

    // 1. Snapshot every row of the year, and the year's budget FX rates, verbatim.
    await client.query('DELETE FROM budget_build_snapshot WHERE build_id = $1', [id]);
    await client.query(
      `INSERT INTO budget_build_snapshot (build_id, kind, row_data)
       SELECT $1, 'entry', to_jsonb(be) FROM budget_entries be WHERE be.budget_year = $2`, [id, year]
    );
    await client.query(
      `INSERT INTO budget_build_snapshot (build_id, kind, row_data)
       SELECT $1, 'fx_rate', to_jsonb(r) FROM budget_fx_rates r WHERE r.year = $2`, [id, year]
    );

    // 2. One version for the year: the active one, else a new "Built".
    let version = (await client.query(
      `SELECT id FROM budget_versions WHERE budget_year = $1 AND is_active ORDER BY id LIMIT 1`, [year]
    )).rows[0];
    let createdVersionId = null;
    if (!version) {
      version = (await client.query(
        `INSERT INTO budget_versions (budget_year, version_name, description, is_active)
         VALUES ($1, 'Built', 'Created by the budget builder (CR098)', TRUE) RETURNING id`, [year]
      )).rows[0];
      createdVersionId = version.id;
    }

    // 3. Replace the year — every version, NULL versions included.
    await client.query('DELETE FROM budget_entries WHERE budget_year = $1', [year]);
    for (const c of cells) {
      await client.query(
        `INSERT INTO budget_entries (version_id, entry_date, description, amount, currency, base_amount,
                                     base_currency, account_id, category_id, note, budget_year)
         VALUES ($1, make_date($2, $3, 1), $4, $5, $6, $7, 'USD', $8, $9, $10, $2)`,
        [version.id, year, c.month, `Budget builder ${year} v${build.build_no}`, c.amount, c.currency,
         c.base_amount, c.account_id, c.category_id, `CR098 build ${build.id}`]
      );
    }

    // 4. The year's budget FX rates at the same rates, so a later edit or Recalculate prices alike.
    const fxByCur = new Map();
    for (const c of cells) if (c.currency !== 'USD') fxByCur.set(c.currency, Number(c.fx_rate));
    await client.query('DELETE FROM budget_fx_rates WHERE year = $1', [year]);
    for (const [cur, rate] of fxByCur) {
      for (let m = 1; m <= 12; m++) {
        await client.query(
          `INSERT INTO budget_fx_rates (currency, year, month, rate, updated_at) VALUES ($1, $2, $3, $4, NOW())`,
          [cur, year, m, rate]
        );
      }
    }

    // 5. Store what was written (a draft's first publish), and the state.
    if (build.status === 'draft') {
      for (const c of cells) {
        await client.query(
          `INSERT INTO budget_build_cells (build_id, category_id, account_id, currency, month, amount, base_amount, fx_rate)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [id, c.category_id, c.account_id, c.currency, c.month, c.amount, c.base_amount, c.fx_rate]
        );
      }
      for (const l of lineAnnual) {
        await client.query('UPDATE budget_build_lines SET annual_amount = $2 WHERE id = $1', [l.id, l.annual]);
      }
    }
    await client.query(
      `UPDATE budget_builds SET status = 'superseded', updated_at = NOW()
        WHERE target_year = $1 AND status = 'published' AND id <> $2`, [year, id]
    );
    const after = await yearChecksum(client, year);
    await client.query(
      `UPDATE budget_builds SET status = 'published', published_at = NOW(), published_checksum = $2,
              created_version_id = $3, updated_at = NOW() WHERE id = $1`, [id, after, createdVersionId]
    );
    const versions = (await client.query(
      'SELECT COUNT(DISTINCT version_id)::int AS n FROM budget_entries WHERE budget_year = $1', [year]
    )).rows[0].n;
    if (versions > 1) throw err(500, `Publish left ${versions} versions in ${year} — rolled back`);
    return { written: cells.length, year, buildNo: build.build_no };
  });
}

/** Restore what the most recent publish of this build replaced — exactly, or not at all. */
async function unpublish(id) {
  return db.transaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock($1, $2)', [LOCK_NS, 0]);
    const build = await getBuildRow(client, id, { lock: true });
    const year = build.target_year;
    if (build.status !== 'published') throw err(409, 'Only the live build can be un-published');
    if (build.published_checksum !== await yearChecksum(client, year)) {
      throw err(409, `The ${year} budget was edited after this publish — un-publishing would lose those edits`);
    }
    await client.query('DELETE FROM budget_entries WHERE budget_year = $1', [year]);
    const restored = (await client.query(
      `INSERT INTO budget_entries
       SELECT (jsonb_populate_record(NULL::budget_entries, s.row_data)).*
         FROM budget_build_snapshot s WHERE s.build_id = $1 AND s.kind = 'entry'`, [id]
    )).rowCount;
    await client.query('DELETE FROM budget_fx_rates WHERE year = $1', [year]);
    await client.query(
      `INSERT INTO budget_fx_rates
       SELECT (jsonb_populate_record(NULL::budget_fx_rates, s.row_data)).*
         FROM budget_build_snapshot s WHERE s.build_id = $1 AND s.kind = 'fx_rate'`, [id]
    );
    // Release the build's reference first — the version row is still pointed at until then.
    await client.query(
      `UPDATE budget_builds SET status = 'unpublished', created_version_id = NULL, updated_at = NOW()
        WHERE id = $1`, [id]
    );
    if (build.created_version_id) {
      await client.query('DELETE FROM budget_versions WHERE id = $1', [build.created_version_id]);
    }
    return { restored, year };
  });
}

module.exports = {
  listSources, createBuild, deleteDraft, setNote, updateLine, getBuild, previewPublish,
  publish, unpublish, scenariosReading,
  // exported for tests
  splitLine, allocate, sourceYear, LUMP_SHARE,
};
