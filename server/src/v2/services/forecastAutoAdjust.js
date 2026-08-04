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
// CR069 P2 — one entity type. A candidate line is an EXPENSE STREAM, whether it hangs off a
// balance-sheet module or a converted Expenditure item; both were always the same knob wearing
// two column names. The line `id` is the STREAM id.
const ENTITY_TABLES = { module: 'forecast_modules' };

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

  // Every scalable expense: an amount-driven expense stream with something in it. `derived`
  // is excluded — a loan's interest is a function of its balance, so scaling an amount that is
  // structurally 0 would silently do nothing while reporting a cut.
  const streams = await client.query(
    `SELECT st.id, m.name, st.amount, st.amount_usd, m.currency, NOT m.has_valuation AS flow
       FROM forecast_streams st
       JOIN forecast_modules m ON m.id = st.module_id
      WHERE m.scenario_id = $1
        AND st.direction = 'expense'
        AND st.mode <> 'derived'
        AND st.amount IS NOT NULL AND st.amount <> 0
      ORDER BY m.name`,
    [s.id]
  );

  return streams.rows.map((r) => ({
    type: 'stream',
    id: r.id,
    name: r.name,
    // Signed the way the UI has always shown a cost, so the modal's numbers do not flip.
    amount: -(Number(r.amount) || 0),
    amountUsd: -(Number(r.amount_usd ?? r.amount) || 0),
    currency: r.currency,
    flow: r.flow,
  }));
}

// Resolve the requested {type,id} lines against the target, returning name + baseline amount.
// Lines are matched to the scratch BY NAME (unique per scenario) because the copy re-keys ids.
async function resolveLines(scenarioId, lines, client = db) {
  const resolved = [];
  for (const line of lines) {
    // CR069 P2 — one shape. The line id is a STREAM id; the module it hangs off is what the
    // owner sees named in the picker, and what the scratch copy is matched on.
    const r = await client.query(
      `SELECT st.id, st.amount, st.amount_usd, st.direction, st.fc_line_id, m.name AS module_name
         FROM forecast_streams st JOIN forecast_modules m ON m.id = st.module_id
        WHERE st.id = $1 AND m.scenario_id = $2`,
      [line.id, scenarioId]
    );
    if (!r.rows[0]) throw new Error(`stream line ${line.id} not found on scenario ${scenarioId}`);
    if (r.rows[0].direction !== 'expense') throw new Error(`line "${r.rows[0].module_name}" is not an expense`);
    resolved.push({
      type: 'stream',
      name: r.rows[0].module_name,
      fcLineId: r.rows[0].fc_line_id,
      amount: Number(r.rows[0].amount) || 0,
      amountUsd: Number(r.rows[0].amount_usd) || 0,
    });
  }
  return resolved;
}

// Read the scratch rows for the resolved lines (by name) and capture their baseline amounts.
async function readScratchBaseline(scratchId, resolved, client = db) {
  const baseline = [];
  for (const line of resolved) {
    // Matched by (module name, direction, line) because the scratch scenario is a fresh COPY
    // with new ids. Name is unique per scenario by constraint; the fc line disambiguates a
    // module carrying two expense streams.
    const r = await client.query(
      `SELECT st.id, st.amount, st.amount_usd
         FROM forecast_streams st JOIN forecast_modules m ON m.id = st.module_id
        WHERE m.scenario_id = $1 AND m.name = $2 AND st.direction = 'expense'
          AND st.fc_line_id IS NOT DISTINCT FROM $3`,
      [scratchId, line.name, line.fcLineId]
    );
    if (!r.rows[0]) throw new Error(`scratch missing expense stream for "${line.name}"`);
    baseline.push({
      type: 'stream', id: r.rows[0].id,
      amount: Number(r.rows[0].amount) || 0,
      amountUsd: Number(r.rows[0].amount_usd) || 0,
    });
  }
  return baseline;
}

// expense = base × retain, applied uniformly. Scaling the base-year value scales every year
// (each year is that base grown by inflation/growth), so "same % across all years" falls out.
async function applyRetain(scratchId, baseline, retain, client = db) {
  for (const b of baseline) {
    // Scale native and USD together — both are linear in the native amount (CR051). Amounts
    // are magnitudes (migration 057 CHECKs it), so a retain in (0,1] can never change a sign.
    await client.query(
      'UPDATE forecast_streams SET amount = $1, amount_usd = $2 WHERE id = $3',
      [round2(b.amount * retain), round2(b.amountUsd * retain), b.id]
    );
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
// CR069 P2 — a stream amount lives in a SCHEDULE, so the override is a `streams` patch that
// replaces the module's whole stream set (Decision 9's accepted coarsening). The shape comes
// from `variants.buildStreamsPatch`, which is the same function variant sync reads base
// schedules with — so the patch and the thing it is compared against cannot drift apart.
/** Scale one stream row's amounts by `retain`. Pure, and the unit under test for the cut. */
function scaleStreamAmounts(row, retain) {
  return {
    ...row,
    amount: round2((Number(row.amount) || 0) * retain),
    amount_usd: row.amount_usd == null ? null : round2((Number(row.amount_usd) || 0) * retain),
  };
}

async function streamsPatchWithRetain(client, moduleId, fcLineId, retain) {
  let hit = false;
  const patched = await variants.buildStreamsPatch(client, moduleId, (row) => {
    const match = row.direction === 'expense'
      && ((row.fc_line_id ?? null) === (fcLineId ?? null));
    if (!match) return row;
    hit = true;
    return scaleStreamAmounts(row, retain);
  });
  if (!hit) throw new Error(`no expense stream on module ${moduleId} for line ${fcLineId}`);
  return patched;
}

// Resolve each requested line to its materialized stream on the variant. For a variant target
// the module id IS the variant's; for a base target the base module maps to the variant row via
// origin_base_id (the row sync materialized from that base row).
async function resolveVariantRows(client, variantId, isVariantTarget, lines) {
  const out = [];
  for (const line of lines) {
    const r = await client.query(
      `SELECT st.id AS stream_id, st.amount, st.fc_line_id, st.direction,
              m.id AS module_id, m.name, m.origin_base_id
         FROM forecast_streams st JOIN forecast_modules m ON m.id = st.module_id
        WHERE m.scenario_id = $1
          AND st.direction = 'expense'
          AND (m.name, st.fc_line_id) IN (
            SELECT m2.name, st2.fc_line_id FROM forecast_streams st2
              JOIN forecast_modules m2 ON m2.id = st2.module_id
             WHERE st2.id = $2
          )`,
      [variantId, line.id]
    );
    if (!r.rows[0]) throw new Error(`line stream:${line.id} not found on variant ${variantId}`);
    out.push({ type: 'stream', row: r.rows[0] });
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
    for (const { row } of resolved) {
      if (row.origin_base_id != null) {
        // An inherited module: the cut becomes an override on the BASE module's id.
        const patch = {
          streams: await streamsPatchWithRetain(client, row.origin_base_id, row.fc_line_id, retain),
        };
        await variants.mergeEntityOverride(client, variantId, 'module', row.origin_base_id, patch);
      } else {
        // Variant-LOCAL: no base row to key an override on, so write the stream directly.
        await client.query(
          `UPDATE forecast_streams
              SET amount = ROUND(amount * $1, 2),
                  amount_usd = CASE WHEN amount_usd IS NULL THEN NULL ELSE ROUND(amount_usd * $1, 2) END
            WHERE id = $2`,
          [retain, row.stream_id]
        );
      }
      appliedLines.push({ type: 'stream', id: row.stream_id, name: row.name, retain });
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
  _internals: { round2, fundedTolerance, scaleStreamAmounts },
};
