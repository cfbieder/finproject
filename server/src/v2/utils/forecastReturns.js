'use strict';
/**
 * CR099 — a forecast module's per-year return path, as it arrives in a module body:
 * `Returns: [{ Year, Pct }]`. One normaliser and one validator, shared by the module routes,
 * `crud.replaceModuleSchedules` and the variant intercept, so the three cannot disagree about
 * what a row is.
 */

const validate = require('./validate');

/** Rows as numbers, sorted by year. Variant comparison is positional, so order must be fixed. */
function normalizeReturns(rows) {
  return (rows || [])
    .map((r) => ({ Year: Number(r?.Year), Pct: Number(r?.Pct) }))
    .sort((a, b) => a.Year - b.Year);
}

const blank = (v) => v == null || v === '' || typeof v === 'boolean';

/**
 * Refuse a path the engine would ignore or misapply, with a 400 rather than a DB error.
 *
 * @param {object[]} rows   the body's `Returns`
 * @param {object}   ctx    { baseYear, periodEnd, isLoan, hasValuation, stored }. baseYear /
 *                          periodEnd may be null when unknown, and then that bound is not checked.
 *                          `stored` is the module's current path ({ year, pct } rows): a row sent
 *                          back UNCHANGED is not re-judged against the year bounds, the loan or the
 *                          valuation. Otherwise a row made stale by the annual close (base_date +1)
 *                          or a shorter variant period would make every later save of the module a
 *                          400, even one changing an unrelated field. The engine ignores such a row
 *                          and the Review's warnings name it.
 */
function validateReturns(rows, { baseYear = null, periodEnd = null, isLoan = false, hasValuation = true, stored = [] } = {}) {
  for (const r of rows || []) {
    if (blank(r?.Year)) throw validate.badRequest('Every return-path row needs a year.');
    if (blank(r?.Pct)) throw validate.badRequest(`The return for ${r.Year} is blank — enter a percent, or remove the row.`);
  }
  const list = normalizeReturns(rows);
  const kept = new Map((stored || []).map((r) => [Number(r.year), Number(r.pct)]));
  const isNew = (r) => !(kept.has(r.Year) && kept.get(r.Year) === r.Pct);
  const fresh = list.filter(isNew);
  if (fresh.length && isLoan) throw validate.badRequest('A loan cannot carry a return path — a negative return would shrink the debt.');
  if (fresh.length && !hasValuation) throw validate.badRequest('A module with no valuation cannot carry a return path — there is no value for it to move.');
  const seen = new Set();
  for (const r of list) {
    if (!Number.isInteger(r.Year)) throw validate.badRequest('A return-path year must be a whole year.');
    if (!Number.isFinite(r.Pct)) throw validate.badRequest(`The return for ${r.Year} must be a number.`);
    if (r.Pct <= -100) throw validate.badRequest(`The return for ${r.Year} must be above −100% — at −100% the value is gone and every later year multiplies zero.`);
    if (r.Pct > 1000) throw validate.badRequest(`The return for ${r.Year} is above 1000% — enter percent, not a fraction.`);
    if (seen.has(r.Year)) throw validate.badRequest(`${r.Year} appears twice in the return path.`);
    seen.add(r.Year);
    if (!isNew(r)) continue;
    if (baseYear != null && r.Year <= baseYear) {
      throw validate.badRequest(`${r.Year} is not after the module's base year (${baseYear}); the base year is observed, not projected.`);
    }
    if (periodEnd != null && r.Year > periodEnd) {
      throw validate.badRequest(`${r.Year} is after the scenario ends (${periodEnd}).`);
    }
  }
  return list;
}

/**
 * The calendar year of a date as the caller wrote it. A 'YYYY-MM-DD' string is read from its text:
 * `new Date('2026-01-01')` is UTC midnight, which is 31 December in the server's zone.
 */
function yearOf(d) {
  if (d == null || d === '') return null;
  if (d instanceof Date) return d.getFullYear();
  const y = Number(String(d).slice(0, 4));
  return Number.isInteger(y) ? y : null;
}

/**
 * Validate `body.Returns` against the module as the write would leave it — the body's base date,
 * valuation and loan state where it sends them, the stored ones otherwise. Shared by the module PUT
 * and the save-time preview, so the preview refuses with the same sentence and never reaches the
 * table's CHECK.
 */
async function assertReturnsForModule(client, before, body) {
  if (body.Returns === undefined) return;
  validateReturns(body.Returns, {
    baseYear: yearOf(body.BaseDate !== undefined ? body.BaseDate : before.base_date),
    periodEnd: await scenarioPeriodEnd(client, before.scenario_id),
    isLoan: body.LoanInterestRate !== undefined ? body.LoanInterestRate != null : before.loan_interest_rate != null,
    hasValuation: body.HasValuation !== undefined ? Boolean(body.HasValuation) : before.has_valuation !== false,
    stored: before.returns || [],
  });
}

/**
 * The scenario's resolved PeriodEnd. A variant's is synced into the assumptions document under its
 * own name, so a variant that overrides its period is checked against its own end.
 */
async function scenarioPeriodEnd(client, scenarioId) {
  const s = (await client.query('SELECT name FROM forecast_scenarios WHERE id = $1', [scenarioId])).rows[0];
  if (!s) return null;
  const raw = (await client.query(`SELECT value FROM forecast_assumptions WHERE key = 'scenarios'`)).rows[0]?.value;
  const list = typeof raw === 'string' ? JSON.parse(raw) : raw || [];
  const e = list.find((x) => x && x.Name === s.name);
  return e?.PeriodEnd != null ? Number(e.PeriodEnd) : null;
}

module.exports = { normalizeReturns, validateReturns, scenarioPeriodEnd, yearOf, assertReturnsForModule };
