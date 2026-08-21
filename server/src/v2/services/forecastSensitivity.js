'use strict';
// CR085 P1 — which assumption is load-bearing.
//
// One throwaway copy of the scenario; a zero-point build for the anchor; then, per knob and per
// side, apply → build → read → restore. Every point is a REAL `generateForecast` build, so no
// number here is a model of the model.
//
// ⚠️ THE RANKING IS THE PRODUCT, AND THREE THINGS CAN CORRUPT IT WITHOUT RAISING ANYTHING:
//
//  1. A COPY THAT LOST A COLUMN. This has already happened in production through this exact path:
//     `copyScenario` dropped `disposal_cost_pct`, and it surfaced only because a scratch copy of
//     `2026 SRQ House Purchase` measured ~890K BETTER than the original for no modelled reason.
//     A dropped column cancels out of the Δ arithmetic (both sides share the copy) but NOT out of
//     the anchor this prints, nor out of the REGIME — a plan built without selling costs sits
//     somewhere else against the cash sweep, so a knob's measured impact, and the order of the
//     bars, can differ. `assertCopyFidelity` runs before any number is produced.
//  2. A LOSSY RESTORE. If one restore does not put the row back, every later point measures its
//     own knob plus a residue: fifteen wrong bars and no exception. `applyKnob` replays a captured
//     prior value rather than computing an inverse, and `inputFingerprint` re-checks the whole
//     input surface after every single restore.
//  3. A STALE VARIANT. The scratch is parentless by design, so `generateForecast`'s Step-0 variant
//     sync never fires on it — and four of five live scenarios ARE variants. The source is synced
//     before it is copied, or the entire run measures a stale materialisation.
//
// The metrics are NOT computed here. Net assets is `buildScenarioMatrix` and real terms is
// `fcRealTerms`, both frontend code that CR084 explicitly refused to port ("porting them would
// create a second implementation of numbers the Review and Compare pages already render"). A
// server-side net-assets sum that disagreed with Compare on any rule would produce a different
// ranking with no error anywhere. So this returns raw entries per point. The one exception is
// Σ unfunded shortfall, which is already server code.

const crypto = require('crypto');
const db = require('../db');
const repo = require('../repositories').forecast;
const variants = require('./forecastVariants');
const { withScratchScenario, readEntries, sweepStaleScratch } = require('./forecastScratch');
const knobs = require('./sensitivityKnobs');

const { KnobError } = knobs;

/** ≤8 knobs ⇒ at most 17 builds ⇒ ~8s. The knob cap binds first; a build cap would be dead text. */
const MAX_KNOBS = 8;

class SensitivityError extends Error {}

// ---------------------------------------------------------------------------
// Layer 1 — the fidelity gate
// ---------------------------------------------------------------------------

/**
 * Compare the scratch against its source, column by column, using the REPOSITORY'S OWN derived
 * column lists. Read-only: no build, no write to the source.
 *
 * Modules are matched by name (the copy re-keys ids and name is unique per scenario). Child rows
 * are folded into one ordered digest per module, so a missing row is caught as well as a missing
 * column.
 */
async function assertCopyFidelity(sourceId, scratchId, client = db) {
  const { investCols, disposeCols, amortCols, streamCols, streamChangeCols } =
    await repo.copyChildColumns(client);

  const digest = async (scenarioId) => {
    const mods = await client.query(
      'SELECT id, name FROM forecast_modules WHERE scenario_id = $1 ORDER BY name', [scenarioId]
    );
    const out = new Map();
    for (const m of mods.rows) {
      const parts = [];
      for (const [table, cols, key] of [
        ['forecast_module_investments', investCols, 'module_id'],
        ['forecast_module_disposals', disposeCols, 'module_id'],
        ['forecast_module_amortization', amortCols, 'module_id'],
        ['forecast_streams', streamCols, 'module_id'],
      ]) {
        const r = await client.query(
          `SELECT ${cols.join(', ')} FROM ${table} WHERE ${key} = $1
            ORDER BY ${cols.join(', ')}`, [m.id]
        );
        parts.push(`${table}:${JSON.stringify(r.rows)}`);
      }
      // ⚠️ Qualified with `c.`: `amount` exists on BOTH forecast_stream_changes and
      // forecast_streams, so the unqualified form is an ambiguous-column error at runtime.
      const chCols = streamChangeCols.map((c) => `c.${c}`).join(', ');
      const ch = await client.query(
        `SELECT ${chCols} FROM forecast_stream_changes c
           JOIN forecast_streams s ON s.id = c.stream_id
          WHERE s.module_id = $1 ORDER BY ${chCols}`, [m.id]
      );
      parts.push(`changes:${JSON.stringify(ch.rows)}`);
      out.set(m.name, crypto.createHash('md5').update(parts.join('|')).digest('hex'));
    }
    return out;
  };

  const [a, b] = [await digest(sourceId), await digest(scratchId)];
  if (a.size !== b.size) {
    throw new SensitivityError(
      `The throwaway copy has ${b.size} modules against the scenario's ${a.size}. Refusing to ` +
      `rank anything: the copy is not the plan.`
    );
  }
  for (const [name, hash] of a) {
    if (b.get(name) !== hash) {
      throw new SensitivityError(
        `The throwaway copy of "${name}" does not match the scenario it was copied from — a ` +
        `column or a schedule row did not survive the copy. This is the defect class that once ` +
        `made a copied scenario read ~890K better than the original, so the run stops here ` +
        `rather than ranking numbers off a plan that is not yours.`
      );
    }
  }
}

// ---------------------------------------------------------------------------
// The drift detector
// ---------------------------------------------------------------------------

/** Everything a knob can touch, hashed. Milliseconds against a 0.5s build. */
async function inputFingerprint(scenarioId, client = db) {
  const { rows } = await client.query(
    `SELECT md5(string_agg(t.line, '|' ORDER BY t.line)) AS h FROM (
        SELECT m.id::text || ':' || m.name || ':' || COALESCE(m.growth_rate::text,'~')
               || ':' || COALESCE(m.market_value::text,'~') || ':' || COALESCE(m.market_value_usd::text,'~')
               || ':' || COALESCE(m.base_value::text,'~') || ':' || COALESCE(m.base_value_usd::text,'~')
               || ':' || COALESCE(m.loan_principal::text,'~') || ':' || COALESCE(m.loan_interest_rate::text,'~')
               || ':' || COALESCE(m.loan_end_date::text,'~') || ':' || COALESCE(m.tax_rate_override::text,'~')
               || ':' || COALESCE(m.setup_status,'~') AS line
          FROM forecast_modules m WHERE m.scenario_id = $1
        UNION ALL
        SELECT 's' || s.id::text || ':' || COALESCE(s.amount::text,'~') || ':' || COALESCE(s.amount_usd::text,'~')
               || ':' || COALESCE(s.growth_mult::text,'~') || ':' || COALESCE(s.start_date::text,'~')
               || ':' || COALESCE(s.end_date::text,'~') || ':' || COALESCE(s.tax_rate_override::text,'~')
          FROM forecast_streams s JOIN forecast_modules m ON m.id = s.module_id
         WHERE m.scenario_id = $1
        UNION ALL
        SELECT 'd' || d.id::text || ':' || COALESCE(d.amount::text,'~') || ':' || COALESCE(d.disposal_date::text,'~')
               || ':' || COALESCE(d.disposal_cost_pct::text,'~')
          FROM forecast_module_disposals d JOIN forecast_modules m ON m.id = d.module_id
         WHERE m.scenario_id = $1
        UNION ALL
        SELECT 'c' || c.id::text || ':' || COALESCE(c.amount::text,'~') || ':' || COALESCE(c.change_date::text,'~')
          FROM forecast_stream_changes c JOIN forecast_streams s ON s.id = c.stream_id
          JOIN forecast_modules m ON m.id = s.module_id WHERE m.scenario_id = $1
     ) t`,
    [scenarioId]
  );
  return rows[0].h;
}

// ---------------------------------------------------------------------------
// Σ unfunded shortfall — the one metric that stays server-side
// ---------------------------------------------------------------------------

async function totalShortfall(scenarioId, client = db) {
  const r = await client.query(
    `SELECT COALESCE(SUM(amount), 0) AS s FROM forecast_entries
      WHERE scenario_id = $1 AND account = 'Cash Shortfall'`,
    [scenarioId]
  );
  return Math.abs(Number(r.rows[0].s) || 0);   // entries store -shortfall
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

/**
 * @param {string} scenarioName
 * @param {Array}  knobList  [{ entity, target, field, band?, lowBand?, highBand? }]
 * @param {Function} [onProgress]  (done, total) — the build counter the spinner shows
 */
async function runSensitivity({ scenarioName, knobs: knobList, onProgress = () => {} }) {
  if (!scenarioName) throw new SensitivityError('scenario is required');
  if (!Array.isArray(knobList) || knobList.length === 0) {
    throw new SensitivityError('at least one knob is required');
  }
  if (knobList.length > MAX_KNOBS) {
    throw new SensitivityError(
      `${knobList.length} knobs exceeds the cap of ${MAX_KNOBS}. Runs on an unchanged scenario ` +
      `share an anchor, so a second run is comparable to this one — the cap is a batch size, not ` +
      `a limit on the question.`
    );
  }

  const source = await repo.findScenarioByName(scenarioName);
  if (!source) throw new SensitivityError(`Scenario "${scenarioName}" not found`);

  // ⚠️ Hazard 1 — sync the SOURCE before copying it. `syncIfStale`, not a forced sync: same
  // guarantee, and no write when the variant is already fresh.
  if (source.parent_scenario_id) await variants.syncIfStale(source.id);

  // A leaked scratch from a killed process is invisible but real; clearing it at the start of a
  // run costs one statement and keeps the DB from accumulating them between restarts.
  await sweepStaleScratch(60);

  const scenarioRate = await scenarioTaxRate(scenarioName);
  const totalBuilds = knobList.length * 2 + 1;
  let done = 0;

  return withScratchScenario(source.id, async ({ id: scratchId, build }) => {
    await assertCopyFidelity(source.id, scratchId);
    await feasibilityPass(scratchId, knobList, scenarioRate);

    await build();
    done += 1; onProgress(done, totalBuilds);
    const anchor = { entries: await readEntries(scratchId), shortfall: await totalShortfall(scratchId) };
    const fingerprint = await inputFingerprint(scratchId);

    const points = [];
    for (const knob of knobList) {
      for (const side of ['low', 'high']) {
        const restore = await knobs.applyKnob(db, scratchId, knob, side, { scenarioRate });
        try {
          await build();
          points.push({
            knobId: knobs.knobId(knob), side,
            entries: await readEntries(scratchId),
            shortfall: await totalShortfall(scratchId),
          });
        } finally {
          await restore();
        }
        done += 1; onProgress(done, totalBuilds);

        const after = await inputFingerprint(scratchId);
        if (after !== fingerprint) {
          throw new SensitivityError(
            `The throwaway copy did not return to its starting state after moving ` +
            `"${knobs.knobId(knob)}" (${side}). Every later bar would measure that knob plus a ` +
            `residue, so the run stops here rather than returning a ranking it cannot stand behind.`
          );
        }

        // Let the event loop drain: 17 sequential builds otherwise hold it for ~8s and every
        // other request in the process waits.
        await new Promise((r) => setImmediate(r));
      }
    }

    return {
      scenario: scenarioName,
      knobs: knobList.map((k) => ({ ...k, knobId: knobs.knobId(k) })),
      anchor,
      points,
      builds: totalBuilds,
      // §6 layer 2 — the non-blocking staleness signal. Read, no build, no write.
      storedEntries: await readEntries(source.id),
    };
  });
}

/** The scenario's tax rate, needed as the base for a NULL `tax_rate_override`. */
async function scenarioTaxRate(scenarioName) {
  const r = await db.query("SELECT value FROM forecast_assumptions WHERE key = 'Tax Rate'");
  if (!r.rows[0]) return 0;
  const raw = r.rows[0].value;
  const list = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (!Array.isArray(list)) return 0;
  const row = list.find((e) => e && e.Scenario === scenarioName);
  return Number(row?.Rate ?? row?.['Tax Rate'] ?? 0) || 0;
}

/**
 * Every knob applied and immediately reverted at BOTH ends, with zero builds.
 *
 * ⚠️ Perturbations hit CHECK constraints: `disposal_cost_pct` is `CHECK (>= 0 AND < 100)`, so ±1pp
 * on a 0.5% cost violates it, and `forecast_streams.amount` is a non-negative magnitude. Finding
 * that out on build 11 of 17 wastes eight seconds and returns nothing. This uses the REAL
 * constraints — it applies the value and lets Postgres object — rather than a second copy of them
 * that could drift from the schema.
 */
async function feasibilityPass(scratchId, knobList, scenarioRate) {
  const problems = [];
  for (const knob of knobList) {
    for (const side of ['low', 'high']) {
      try {
        await db.transaction(async (client) => {
          await knobs.applyKnob(client, scratchId, knob, side, { scenarioRate });
          throw new Rollback();          // never keep it: this is a probe, not a change
        });
      } catch (err) {
        if (err instanceof Rollback) continue;
        problems.push(`${knobs.knobId(knob)} (${side}): ${err.message}`);
      }
    }
  }
  if (problems.length) {
    throw new SensitivityError(
      `These knobs cannot be moved as asked, so nothing was run:\n  • ${problems.join('\n  • ')}`
    );
  }
}

class Rollback extends Error {}

// ---------------------------------------------------------------------------
// Job map — CR053's pattern, with the guard CR053 never had
// ---------------------------------------------------------------------------

const JOB_TTL_MS = 30 * 60 * 1000;
const jobs = new Map();
let jobSeq = 0;

function pruneJobs() {
  const now = Date.now();
  for (const [id, j] of jobs) if (now - j.startedAt > JOB_TTL_MS) jobs.delete(id);
}

/**
 * ⚠️ ONE RUN AT A TIME, globally. CR053's `startSolveJob` keys nothing on scenario, so two solves
 * could overlap. Two sensitivity runs hold separate scratches and separate advisory locks — they
 * neither deadlock nor contend on the engine — but they do contend on the four shared
 * `forecast_assumptions` rows through `copyScenario`, and 34 concurrent builds would hold the
 * event loop for the better part of a minute.
 */
function startSensitivityJob(params) {
  pruneJobs();
  for (const [, j] of jobs) {
    if (j.status === 'running') {
      throw new SensitivityError(
        `A sensitivity run on "${j.scenario}" is still going. They share one engine, so a second ` +
        `run would slow both — wait for it, or reload if it has been more than a minute.`
      );
    }
  }
  const jobId = `sens_${Date.now()}_${++jobSeq}`;
  const job = {
    status: 'running', startedAt: Date.now(), scenario: params.scenarioName, done: 0,
    total: (params.knobs?.length ?? 0) * 2 + 1,
  };
  jobs.set(jobId, job);

  runSensitivity({
    ...params,
    onProgress: (done, total) => { job.done = done; job.total = total; },
  })
    .then((result) => jobs.set(jobId, { ...job, status: 'done', result }))
    .catch((error) => {
      console.error('[sensitivity] run failed:', error.message);
      jobs.set(jobId, { ...job, status: 'error', error: error.message });
    });

  return jobId;
}

function getSensitivityJob(jobId) {
  const j = jobs.get(jobId);
  if (!j) return null;
  return {
    status: j.status, done: j.done, total: j.total,
    ...(j.result ? { result: j.result } : {}),
    ...(j.error ? { error: j.error } : {}),
  };
}

// ---------------------------------------------------------------------------
// The picker's catalogue
// ---------------------------------------------------------------------------

/**
 * Every knob that can actually be moved on this scenario, with its current value and default band.
 *
 * ⚠️ Applicability is decided by the SAME `assertApplicable` the setter uses, called here and
 * caught. A separate "can I offer this?" predicate would be a second implementation of the rule,
 * and the two would drift — offering a knob the setter then refuses, or hiding one that works.
 */
async function listKnobs(scenarioName, client = db) {
  const scenario = await repo.findScenarioByName(scenarioName);
  if (!scenario) throw new SensitivityError(`Scenario "${scenarioName}" not found`);

  const { rows: mods } = await client.query(
    `SELECT * FROM forecast_modules WHERE scenario_id = $1 ORDER BY name`, [scenario.id]
  );
  const out = [];

  const offer = (spec, row, moduleRow, target, current, streams = []) => {
    try {
      knobs._internals.assertApplicable(spec, row, moduleRow);
    } catch {
      return;   // not offerable — the setter would refuse it, so the picker does not show it
    }
    out.push({
      entity: spec.entity, field: spec.field, kind: spec.kind, label: spec.label,
      band: knobs.DEFAULT_BAND[spec.kind],
      module: moduleRow.name, moduleType: moduleRow.module_type, target,
      // Asset · liability · income · expense, decided server-side from what the ENGINE branches
      // on. The frontend must not re-derive it from `module_type`, which is free text.
      group: knobs.knobGroup(spec, row, moduleRow, streams),
      current: current == null ? null : String(current),
    });
  };

  for (const m of mods) {
    // Loaded FIRST: a flow module has no valuation to classify by, so its group comes from the
    // direction of its own streams.
    const { rows: streams } = await client.query(
      'SELECT * FROM forecast_streams WHERE module_id = $1 ORDER BY direction, id', [m.id]
    );

    for (const [field, spec] of Object.entries(knobs.MODULE_FIELDS)) {
      offer({ ...spec, entity: 'module', field }, m, m, { module: m.name }, m[field], streams);
    }

    for (const st of streams) {
      for (const [field, spec] of Object.entries(knobs.STREAM_FIELDS)) {
        offer(
          { ...spec, entity: 'stream', field }, st, m,
          { module: m.name, direction: st.direction, fcLineId: st.fc_line_id }, st[field], streams
        );
      }
    }

    const { rows: disposals } = await client.query(
      'SELECT * FROM forecast_module_disposals WHERE module_id = $1 ORDER BY disposal_date', [m.id]
    );
    for (const d of disposals) {
      for (const [field, spec] of Object.entries(knobs.DISPOSAL_FIELDS)) {
        const date = d.disposal_date instanceof Date
          ? `${d.disposal_date.getFullYear()}-${String(d.disposal_date.getMonth() + 1).padStart(2, '0')}-${String(d.disposal_date.getDate()).padStart(2, '0')}`
          : d.disposal_date;
        // ⚠️ The date rides in the LABEL. A module with three disposals otherwise offers
        // "Disposal amount / Selling cost / Disposal date" three times over with nothing to
        // tell them apart, and picking the wrong one is invisible until the bar is wrong.
        offer(
          { ...spec, entity: 'disposal', field, label: `${spec.label} (${date})` }, d, m,
          { module: m.name, date }, d[field], streams
        );
      }
    }
  }
  return out;
}

module.exports = {
  runSensitivity,
  listKnobs,
  startSensitivityJob,
  getSensitivityJob,
  assertCopyFidelity,
  inputFingerprint,
  totalShortfall,
  MAX_KNOBS,
  SensitivityError,
  KnobError,
};
