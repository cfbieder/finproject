'use strict';
/**
 * CR102 — Compare Forecast: a budget build against a forecast scenario's (or variant's) stored figures
 * for the build's own year, in the forecast's P&L (its lines, grouped Income / Expense as Forecast
 * Review groups them). Read-only: no writes, no locks, no part in the publish token.
 *
 * Per forecast line, all in USD:
 *   Budget   — Σ the build's `annualUsd` over its lines whose category resolves to the forecast line
 *              (FC_LINE_LEAVES_CTE, the forecast's own mapping);
 *   LE       — Σ `leFy / build rate` over the SAME build lines (D4: restated at the build's rates, so
 *              Budget − LE shows only spending changes and equals the grid's own "vs estimate");
 *   Forecast — Σ the scenario's `forecast_entries` for the year whose account is the line's name.
 * A total missing one figure is unknown, never a smaller total (null propagates, as getBuild does).
 * The residual (budget total − Σ lines − not-in-forecast) is returned, so a leaf sitting under two
 * forecast lines shows as a warning instead of a silently doubled figure.
 */

const db = require('../v2/db');
const builder = require('./budgetBuilder');
const fcLinesRepo = require('../v2/repositories/fcLines');
const { FC_LINE_LEAVES_CTE } = require('./forecast/crud');

const err = (status, message) => Object.assign(new Error(message), { status });
const round2 = (n) => Math.round(Number(n) * 100) / 100;
// Null-propagating sum: once any part is unknown, the total is unknown.
const add = (a, b) => (a == null || b == null ? null : round2(a + b));
const INCOME = new Set(['forecast_income', 'bs_module_income']);
const EXPENSE = new Set(['forecast_expense', 'bs_module_expense']);

async function compareForecast(buildId, { scenario } = {}) {
  const view = await builder.getBuild(buildId);
  const year = view.build.targetYear;
  const baseName = view.build.scenario;

  // The picker's choices: the build's scenario and its variants (pass 2: no other bases).
  const options = (await db.query(
    `SELECT s.id, s.name, s.parent_scenario_id IS NOT NULL AS is_variant,
            (SELECT MAX(e.created_at) FROM forecast_entries e WHERE e.scenario_id = s.id) AS generated_at
       FROM forecast_scenarios s
      WHERE s.name = $1 OR s.parent_scenario_id = (SELECT id FROM forecast_scenarios WHERE name = $1 AND parent_scenario_id IS NULL)
      ORDER BY s.parent_scenario_id NULLS FIRST, s.name`, [baseName]
  )).rows;
  const name = scenario || baseName;
  const scen = (await db.query(
    `SELECT s.id, s.name, s.parent_scenario_id IS NOT NULL AS is_variant,
            (SELECT MAX(e.created_at) FROM forecast_entries e WHERE e.scenario_id = s.id) AS generated_at
       FROM forecast_scenarios s WHERE s.name = $1`, [name]
  )).rows[0];
  if (!scen) throw err(404, `Forecast scenario '${name}' not found`);

  const entries = new Map();
  let yearRows = 0;
  for (const r of (await db.query(
    `SELECT account, SUM(amount) AS amount, COUNT(*)::int AS n FROM forecast_entries
      WHERE scenario_id = $1 AND forecast_year = $2 GROUP BY account`, [scen.id, year]
  )).rows) {
    entries.set(r.account, round2(r.amount));
    yearRows += r.n;
  }
  const generated = yearRows > 0;

  // Category → forecast line(s), the forecast's own leaf mapping.
  const linesOfLeaf = new Map();
  const mappedLines = new Set();
  for (const r of (await db.query(`${FC_LINE_LEAVES_CTE} SELECT fc_line_id, id FROM distinct_leaves`)).rows) {
    if (!linesOfLeaf.has(r.id)) linesOfLeaf.set(r.id, []);
    linesOfLeaf.get(r.id).push(r.fc_line_id);
    mappedLines.add(r.fc_line_id);
  }

  const fx = view.rates.fx;
  const leUsd = (l) => {
    const rate = fx[l.currency]?.rate;
    return rate ? round2(Number(l.leFy) / rate) : null;
  };

  const fcLines = await fcLinesRepo.findAll(null); // Forecast Review's order: display_order, name
  const row = (line, type) => ({
    fcLineId: line.id, name: line.name, lineType: type,
    hasMapping: line.id != null && mappedLines.has(line.id),
    budget: 0, le: 0,
    forecast: generated ? (entries.get(line.name) ?? 0) : null,
    categories: [],
  });
  const income = [];
  const expense = [];
  const byId = new Map();
  for (const l of fcLines) {
    const r = row(l, l.line_type);
    if (INCOME.has(l.line_type)) income.push(r);
    else if (EXPENSE.has(l.line_type)) expense.push(r);
    else continue;
    byId.set(l.id, r);
  }
  // The engine writes its computed tax to a hard-coded `Taxes` account; Review always shows it.
  if (!fcLines.some((l) => l.name === 'Taxes')) {
    expense.push({ ...row({ id: null, name: 'Taxes' }, 'engine_tax'), hasMapping: false });
  }

  const notInForecast = { budget: 0, le: 0, categories: [] };
  let budgetTotal = 0;
  let leTotal = 0;
  for (const l of view.lines) {
    const cat = { categoryId: l.categoryId, name: l.category, currency: l.currency, budget: l.annualUsd,
      le: leUsd(l), inactive: !!l.inactive, isParent: !!l.isParent };
    budgetTotal = add(budgetTotal, cat.budget);
    leTotal = add(leTotal, cat.le);
    const targets = (linesOfLeaf.get(l.categoryId) || []).map((id) => byId.get(id)).filter(Boolean);
    if (!targets.length) {
      notInForecast.budget = add(notInForecast.budget, cat.budget);
      notInForecast.le = add(notInForecast.le, cat.le);
      notInForecast.categories.push(cat);
      continue;
    }
    for (const t of targets) {
      t.budget = add(t.budget, cat.budget);
      t.le = add(t.le, cat.le);
      t.categories.push(cat);
    }
  }
  // A line nothing can be budgeted on shows "—", not 0.
  for (const r of [...income, ...expense]) {
    if (!r.hasMapping) { r.budget = null; r.le = null; r.noMapping = true; }
    r.categories.sort((a, b) => Math.abs(b.budget ?? 0) - Math.abs(a.budget ?? 0));
  }

  const sum = (rows, k) => rows.reduce((s, r) => (r.noMapping && k !== 'forecast' ? s : add(s, r[k])), 0);
  const section = (rows) => ({ budget: sum(rows, 'budget'), le: sum(rows, 'le'), forecast: generated ? sum(rows, 'forecast') : null });
  const inc = section(income);
  const exp = section(expense);
  const net = {
    budget: add(add(inc.budget, exp.budget), notInForecast.budget),
    le: add(add(inc.le, exp.le), notInForecast.le),
    forecast: generated ? add(inc.forecast, exp.forecast) : null,
  };
  const residual = {
    budget: budgetTotal == null || net.budget == null ? null : round2(budgetTotal - net.budget),
    le: leTotal == null || net.le == null ? null : round2(leTotal - net.le),
  };

  const theirs = await builder.scenarioRates(scen.name, year);
  const rateOf = (r, c) => (r?.fx?.[c]?.rate ?? null);
  const ratesDiffer = ['PLN', 'EUR'].some((c) => rateOf(view.rates, c) !== rateOf(theirs, c));

  return {
    build: { id: view.build.id, targetYear: year, buildNo: view.build.buildNo, note: view.build.note, status: view.build.status },
    scenario: { name: scen.name, isVariant: scen.is_variant, generatedAt: scen.generated_at, generatedForYear: generated },
    options: options.map((o) => ({ name: o.name, isVariant: o.is_variant, generatedAt: o.generated_at })),
    le: view.build.le,
    rates: {
      build: { PLN: rateOf(view.rates, 'PLN'), EUR: rateOf(view.rates, 'EUR') },
      forecast: { PLN: rateOf(theirs, 'PLN'), EUR: rateOf(theirs, 'EUR') },
      differ: ratesDiffer,
    },
    income, expense, notInForecast,
    totals: { income: inc, expense: exp, net },
    residual,
  };
}

module.exports = { compareForecast };
