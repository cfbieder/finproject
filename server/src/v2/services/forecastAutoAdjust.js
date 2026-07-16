// CR053 — Forecast Auto-Adjust: solve the least uniform spend cut that funds the plan.
//
// When a scenario's cash sweep runs out of assets to sell, the owner wants to ask: "how much
// would I have to cut this spending for the plan to stay funded every year?" This service
// answers it by a NUMERICAL solve — there is no closed form, because cutting an expense feeds
// back through the sweep (fewer forced sales ⇒ less capital-gains tax ⇒ more cash, CR049).
//
// Mechanism (Path A, the "slow solver" — see docs/cr/cr-053):
//   1. Deep-copy the target into a throwaway STANDALONE scratch scenario. Standalone (parentless)
//      matters: a throwaway *variant* is impossible — a variant-of-a-variant is rejected by the
//      039 trigger, and generateForecast force-syncs a variant at Step 0, clobbering any factor
//      we write. A standalone copy is not synced, so a direct UPDATE on it survives the rebuild.
//   2. Threshold-search the retained fraction `retain ∈ [minRetain, 1]`: expense = base × retain,
//      so cut% = (1-retain)×100. `f(retain)` = total unfunded shortfall (read from the engine's
//      own persisted `Cash Shortfall` entries — never the client warnings util) is non-decreasing
//      in retain and flat at zero once funded, so we bisect for the LARGEST retain that still
//      funds (the least cut).
//   3. Delete the scratch (DB rows cascade; the assumptions-doc rows keyed by its name are pruned
//      here because deleteScenario does not touch that document).
//
// This module only SOLVES and reports. Persisting the chosen cut (as a CR050 override on a
// variant) and the post-apply verification rebuild live in applySpendReduction().

const db = require('../db');
const repo = require('../repositories').forecast;
const variants = require('./forecastVariants');
const { generateForecast } = require('../../services/forecast');

const SCRATCH_PREFIX = '__autoadjust_';
const RETAIN_EPS = 0.005;      // stop when the retain interval is this narrow (~0.5% of a line)
const DEFAULT_MAX_EVALS = 12;  // hard cap on engine builds per solve
const ENTITY_TABLES = { module: 'forecast_modules', incexp: 'forecast_income_expense' };

function round2(x) {
  return Math.round(x * 100) / 100;
}

function fundedTolerance(band) {
  return Math.max(1000, (Number(band) || 0) * 0.01);
}

async function shortfallByScenarioName(name, client = db) {
  const r = await client.query(
    `SELECT COALESCE(SUM(ABS(e.amount)), 0)::float AS s
       FROM forecast_entries e JOIN forecast_scenarios s ON s.id = e.scenario_id
      WHERE s.name = $1 AND e.account = 'Cash Shortfall'`,
    [name]
  );
  return Math.round(Number(r.rows[0].s) || 0);
}

// ---------------------------------------------------------------------------
// Candidate lines the picker can offer: module expense streams + standalone Expense items.
// ---------------------------------------------------------------------------
async function listExpenseLines(scenarioName, client = db) {
  const s = await repo.findScenarioByName(scenarioName);
  if (!s) return null;
  if (s.parent_scenario_id) await variants.syncVariant(s.id, { force: true });

  const mods = await client.query(
    `SELECT id, name, expense_amount, currency
       FROM forecast_modules
      WHERE scenario_id = $1 AND expense_amount IS NOT NULL AND expense_amount <> 0
      ORDER BY name`,
    [s.id]
  );
  const items = await client.query(
    `SELECT id, name, base_value, base_value_usd, currency
       FROM forecast_income_expense
      WHERE scenario_id = $1 AND item_type = 'Expense' AND base_value IS NOT NULL AND base_value <> 0
      ORDER BY name`,
    [s.id]
  );

  return [
    ...mods.rows.map((r) => ({
      type: 'module',
      id: r.id,
      name: r.name,
      amount: Number(r.expense_amount),
      currency: r.currency || 'USD',
    })),
    ...items.rows.map((r) => ({
      type: 'incexp',
      id: r.id,
      name: r.name,
      amount: Number(r.base_value),
      amountUsd: Number(r.base_value_usd),
      currency: r.currency || 'USD',
    })),
  ];
}

// Resolve the requested {type,id} lines against the target, returning name + baseline amount.
// Lines are matched to the scratch BY NAME (unique per scenario) because the copy re-keys ids.
async function resolveLines(scenarioId, lines, client = db) {
  const resolved = [];
  for (const line of lines) {
    if (line.type === 'module') {
      const r = await client.query(
        'SELECT name, expense_amount FROM forecast_modules WHERE id = $1 AND scenario_id = $2',
        [line.id, scenarioId]
      );
      if (!r.rows[0]) throw new Error(`module line ${line.id} not found on scenario ${scenarioId}`);
      resolved.push({ type: 'module', name: r.rows[0].name, expenseAmount: Number(r.rows[0].expense_amount) || 0 });
    } else if (line.type === 'incexp') {
      const r = await client.query(
        `SELECT name, item_type, base_value, base_value_usd
           FROM forecast_income_expense WHERE id = $1 AND scenario_id = $2`,
        [line.id, scenarioId]
      );
      if (!r.rows[0]) throw new Error(`incexp line ${line.id} not found on scenario ${scenarioId}`);
      if (r.rows[0].item_type !== 'Expense') throw new Error(`line "${r.rows[0].name}" is not an Expense`);
      resolved.push({
        type: 'incexp',
        name: r.rows[0].name,
        baseValue: Number(r.rows[0].base_value) || 0,
        baseValueUsd: Number(r.rows[0].base_value_usd) || 0,
      });
    } else {
      throw new Error(`unknown line type: ${line.type}`);
    }
  }
  return resolved;
}

// Read the scratch rows for the resolved lines (by name) and capture their baseline amounts.
async function readScratchBaseline(scratchId, resolved, client = db) {
  const baseline = [];
  for (const line of resolved) {
    if (line.type === 'module') {
      const r = await client.query(
        'SELECT id, expense_amount FROM forecast_modules WHERE scenario_id = $1 AND name = $2',
        [scratchId, line.name]
      );
      if (!r.rows[0]) throw new Error(`scratch missing module "${line.name}"`);
      baseline.push({ type: 'module', id: r.rows[0].id, expenseAmount: Number(r.rows[0].expense_amount) || 0 });
    } else {
      const r = await client.query(
        'SELECT id, base_value, base_value_usd FROM forecast_income_expense WHERE scenario_id = $1 AND name = $2',
        [scratchId, line.name]
      );
      if (!r.rows[0]) throw new Error(`scratch missing incexp "${line.name}"`);
      baseline.push({
        type: 'incexp',
        id: r.rows[0].id,
        baseValue: Number(r.rows[0].base_value) || 0,
        baseValueUsd: Number(r.rows[0].base_value_usd) || 0,
      });
    }
  }
  return baseline;
}

// expense = base × retain, applied uniformly. Scaling the base-year value scales every year
// (each year is that base grown by inflation/growth), so "same % across all years" falls out.
async function applyRetain(scratchId, baseline, retain, client = db) {
  for (const b of baseline) {
    if (b.type === 'module') {
      await client.query(
        'UPDATE forecast_modules SET expense_amount = $1 WHERE id = $2',
        [round2(b.expenseAmount * retain), b.id]
      );
    } else {
      // Scale native and USD together — both are linear in the native amount (CR051).
      await client.query(
        'UPDATE forecast_income_expense SET base_value = $1, base_value_usd = $2 WHERE id = $3',
        [round2(b.baseValue * retain), round2(b.baseValueUsd * retain), b.id]
      );
    }
  }
}

// f(retain): total unfunded shortfall in dollars (≥ 0), from the engine's own Cash Shortfall rows.
async function totalShortfall(scratchId, client = db) {
  const r = await client.query(
    `SELECT COALESCE(SUM(amount), 0) AS s FROM forecast_entries
      WHERE scenario_id = $1 AND account = 'Cash Shortfall'`,
    [scratchId]
  );
  return Math.abs(Number(r.rows[0].s) || 0); // entries store -shortfall
}

async function pruneAssumptionsForName(client, name) {
  const KEYS = ['scenarios', 'inflation', 'FX', 'Tax Rate'];
  const nameFieldFor = (key) => (key === 'scenarios' ? 'Name' : 'Scenario');
  for (const key of KEYS) {
    const row = await client.query('SELECT value FROM forecast_assumptions WHERE key = $1', [key]);
    if (!row.rows[0]) continue;
    const raw = row.rows[0].value;
    const list = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!Array.isArray(list)) continue;
    const field = nameFieldFor(key);
    const next = list.filter((e) => !e || e[field] !== name);
    if (next.length !== list.length) {
      await client.query('UPDATE forecast_assumptions SET value = $1, updated_at = NOW() WHERE key = $2', [
        JSON.stringify(next),
        key,
      ]);
    }
  }
}

async function destroyScratch(scratchId, scratchName) {
  try {
    await db.transaction(async (client) => {
      await pruneAssumptionsForName(client, scratchName);
    });
    await repo.deleteScenario(scratchId); // DB children cascade
  } catch (err) {
    console.error(`[auto-adjust] scratch cleanup failed for ${scratchName}:`, err.message);
  }
}

/**
 * Solve the least uniform spend cut that keeps every year funded.
 *
 * @param {object}  p
 * @param {string}  p.scenarioName       target scenario (base or variant)
 * @param {Array}   p.lines              [{ type:'module'|'incexp', id }] expense lines to scale
 * @param {number} [p.minRetain=0]       floor on retained fraction (1 - max cut); 0 = may zero the lines
 * @param {number} [p.tolerance]         $ shortfall counted as "funded"; default max(1000, 1% of band)
 * @param {number} [p.maxEvals=12]       hard cap on engine builds
 * @returns {object} { feasible, alreadyFunded, retain, cutPct, shortfallBefore, shortfallAfter, evals }
 */
async function solveSpendReduction({ scenarioName, lines, minRetain = 0, tolerance, maxEvals = DEFAULT_MAX_EVALS }) {
  if (!scenarioName) throw new Error('scenarioName is required');
  if (!Array.isArray(lines) || lines.length === 0) throw new Error('at least one expense line is required');
  if (!(minRetain >= 0 && minRetain < 1)) throw new Error('minRetain must be in [0, 1)');

  const target = await repo.findScenarioByName(scenarioName);
  if (!target) throw new Error(`scenario "${scenarioName}" not found`);

  // A variant's materialized rows must be current before we copy them.
  if (target.parent_scenario_id) await variants.syncVariant(target.id, { force: true });

  const resolved = await resolveLines(target.id, lines);
  const band = Number(target.cash_sweep_low) || 0;
  const tol = tolerance != null ? tolerance : Math.max(1000, band * 0.01);

  const scratchName = `${SCRATCH_PREFIX}${target.id}_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  let scratch = null;
  try {
    scratch = await repo.copyScenario(target.id, scratchName);
    const baseline = await readScratchBaseline(scratch.id, resolved);

    let evals = 0;
    const evalShortfall = async (retain) => {
      await applyRetain(scratch.id, baseline, retain);
      const r = await generateForecast(scratchName, { writeAudit: false });
      if (!r.success) throw new Error(`scratch build failed: ${r.error}`);
      evals += 1;
      return totalShortfall(scratch.id);
    };

    // f(1) = shortfall with no cut. If already funded, nothing to do.
    const shortfallBefore = await evalShortfall(1);
    if (shortfallBefore <= tol) {
      return { feasible: true, alreadyFunded: true, retain: 1, cutPct: 0, shortfallBefore, shortfallAfter: shortfallBefore, evals };
    }

    // f(minRetain) = shortfall at the maximum allowed cut. If still unfunded, infeasible.
    const shortfallFloor = await evalShortfall(minRetain);
    if (shortfallFloor > tol) {
      return {
        feasible: false,
        retain: minRetain,
        cutPct: round2((1 - minRetain) * 100),
        shortfallBefore,
        shortfallAfter: shortfallFloor,
        residual: shortfallFloor,
        evals,
      };
    }

    // Bisect for the LARGEST retain that still funds (least cut).
    // Invariant: f(lo) ≤ tol (funded), f(hi) > tol (unfunded).
    let lo = minRetain;
    let hi = 1;
    let bestRetain = minRetain;
    let bestShortfall = shortfallFloor;
    while (evals < maxEvals && hi - lo > RETAIN_EPS) {
      const mid = (lo + hi) / 2;
      const s = await evalShortfall(mid);
      if (s <= tol) {
        lo = mid;
        bestRetain = mid;
        bestShortfall = s;
      } else {
        hi = mid;
      }
    }

    return {
      feasible: true,
      alreadyFunded: false,
      retain: round2(bestRetain),
      cutPct: round2((1 - bestRetain) * 100),
      shortfallBefore,
      shortfallAfter: bestShortfall,
      evals,
    };
  } finally {
    if (scratch) await destroyScratch(scratch.id, scratchName);
  }
}

// ---------------------------------------------------------------------------
// Apply — persist the chosen cut as a CR050 override on a variant, then VERIFY by rebuilding
// the real scenario and re-reading the engine's shortfall (the scratch build is not trusted).
// A base target is never mutated: a base gets a variant "<name> — reduced spend" instead.
// ---------------------------------------------------------------------------
function patchFor(type, current, retain) {
  if (type === 'module') {
    return { expense_amount: round2((Number(current.expense_amount) || 0) * retain) };
  }
  // incexp: scale native and USD together (both linear in the native amount, CR051).
  return {
    base_value: round2((Number(current.base_value) || 0) * retain),
    base_value_usd: round2((Number(current.base_value_usd) || 0) * retain),
  };
}

// Resolve each requested line to its materialized row on the variant, with the fields needed to
// scale it. For a variant target the id IS the variant row; for a base target the base id maps to
// the variant row via origin_base_id (the row sync materialized from that base row).
async function resolveVariantRows(client, variantId, isVariantTarget, lines) {
  const out = [];
  for (const line of lines) {
    const table = ENTITY_TABLES[line.type];
    if (!table) throw new Error(`unknown line type: ${line.type}`);
    const where = isVariantTarget
      ? 'id = $1 AND scenario_id = $2'
      : 'origin_base_id = $1 AND scenario_id = $2';
    const r = await client.query(`SELECT * FROM ${table} WHERE ${where}`, [line.id, variantId]);
    if (!r.rows[0]) throw new Error(`line ${line.type}:${line.id} not found on variant ${variantId}`);
    out.push({ type: line.type, row: r.rows[0] });
  }
  return out;
}

async function applySpendReduction({ scenarioName, lines, retain, variantName }) {
  if (!scenarioName) throw new Error('scenarioName is required');
  if (!Array.isArray(lines) || lines.length === 0) throw new Error('at least one expense line is required');
  if (!(retain > 0 && retain <= 1)) throw new Error('retain must be in (0, 1]');

  const target = await repo.findScenarioByName(scenarioName);
  if (!target) throw new Error(`scenario "${scenarioName}" not found`);

  const isVariantTarget = !!target.parent_scenario_id;
  let variantId;
  let resultName;
  let createdVariant = false;

  if (isVariantTarget) {
    variantId = target.id;
    resultName = target.name;
    await variants.syncVariant(variantId, { force: true });
  } else {
    resultName = (variantName && variantName.trim()) || `${target.name} — reduced spend`;
    const existing = await repo.findScenarioByName(resultName);
    if (existing) {
      if (existing.parent_scenario_id !== target.id) {
        throw new Error(`"${resultName}" already exists and is not a variant of "${target.name}"`);
      }
      variantId = existing.id;
      await variants.syncVariant(variantId, { force: true });
    } else {
      const v = await variants.createVariant(target.id, {
        name: resultName,
        description: `Auto-adjust: uniform spend cut to fund ${target.name} (CR053)`,
      });
      variantId = v.id;
      createdVariant = true;
    }
  }

  // Write every override in ONE transaction, then a SINGLE re-sync (interceptWrite would re-sync
  // per line). A row with a base origin becomes an override; a variant-LOCAL row (no origin) is
  // written directly, since the override table is keyed by base-row id.
  const appliedLines = [];
  await db.transaction(async (client) => {
    const resolved = await resolveVariantRows(client, variantId, isVariantTarget, lines);
    for (const { type, row } of resolved) {
      const patch = patchFor(type, row, retain);
      if (row.origin_base_id != null) {
        await variants.mergeEntityOverride(client, variantId, type, row.origin_base_id, patch);
      } else {
        const sets = Object.keys(patch).map((k, i) => `${k} = $${i + 1}`).join(', ');
        await client.query(`UPDATE ${ENTITY_TABLES[type]} SET ${sets} WHERE id = $${Object.keys(patch).length + 1}`, [
          ...Object.values(patch),
          row.id,
        ]);
      }
      appliedLines.push({ type, id: row.id, name: row.name, ...patch });
    }
    await variants.syncVariant(variantId, { client, force: true });
  });

  // Verification rebuild — a REAL build (audit on) of the resulting scenario, then re-read the
  // engine's own shortfall. Do NOT trust the solver's scratch number.
  const gen = await generateForecast(resultName);
  if (!gen.success) throw new Error(`verification rebuild failed: ${gen.error}`);
  const shortfallAfter = await shortfallByScenarioName(resultName);
  const tol = fundedTolerance(target.cash_sweep_low);

  return {
    appliedTo: resultName,
    createdVariant,
    retain: round2(retain),
    cutPct: round2((1 - retain) * 100),
    shortfallAfter,
    verifiedFunded: shortfallAfter <= tol,
    lines: appliedLines,
  };
}

// ---------------------------------------------------------------------------
// In-memory async job registry for solves (a solve is ~10 engine builds; a synchronous request
// would risk proxy timeouts). Single-process only — a restart mid-solve loses the job (v1: re-run).
// ---------------------------------------------------------------------------
const jobs = new Map();
let jobSeq = 0;
const JOB_TTL_MS = 10 * 60 * 1000;

function pruneJobs() {
  const now = Date.now();
  for (const [id, j] of jobs) {
    if (now - j.startedAt > JOB_TTL_MS) jobs.delete(id);
  }
}

function startSolveJob(params) {
  pruneJobs();
  const jobId = `solve_${Date.now()}_${++jobSeq}`;
  const startedAt = Date.now();
  jobs.set(jobId, { status: 'running', startedAt, params: { scenarioName: params.scenarioName } });
  solveSpendReduction(params)
    .then((result) => jobs.set(jobId, { status: 'done', startedAt, result }))
    .catch((error) => {
      console.error('[auto-adjust] solve job failed:', error);
      jobs.set(jobId, { status: 'error', startedAt, error: error.message });
    });
  return jobId;
}

function getSolveJob(jobId) {
  return jobs.get(jobId) || null;
}

module.exports = {
  listExpenseLines,
  solveSpendReduction,
  applySpendReduction,
  startSolveJob,
  getSolveJob,
  SCRATCH_PREFIX,
  // Pure helpers exposed for unit tests.
  _internals: { round2, fundedTolerance, patchFor },
};
