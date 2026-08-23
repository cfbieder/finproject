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

/** ≤8 knobs, still — past that the ranking stops being readable whatever the chart does. */
const MAX_KNOBS = 8;

/**
 * ⚠️ THE BUILD CAP NOW BINDS, and §5.1 predicted exactly this: *"a build cap is stated in P2,
 * where a sweep can exceed this; in P1 the knob cap binds first and a second cap would be dead
 * text."* A knob may now carry SEVERAL bands — ±10% and ±20% and ±50% — and each band is two more
 * real engine builds, so 8 knobs × 3 bands is 49 builds where 8 knobs × 1 band was 17.
 *
 * At ~0.5s a build that is ~25s, which is the outer edge of a foreground wait. The run is REFUSED
 * past it rather than truncated: a ranking that quietly dropped a band would be a ranking of
 * whatever survived.
 */
const MAX_BUILDS = 50;

class SensitivityError extends Error {}

/**
 * A knob's bands, always as a list. `bands: [10, 20, 50]` is the multi-band form; a plain `band`
 * (or nothing) is the single-band case written as a list of one, so callers and the run loop have
 * one shape rather than two.
 *
 * Sorted ascending and de-duplicated: the chart draws them nested, and two identical bands would
 * be two identical builds and one invisible bar.
 */
function bandsOf(knob) {
  const raw = Array.isArray(knob.bands) && knob.bands.length
    ? knob.bands
    : [knob.band ?? knob.lowBand ?? knob.highBand];
  const clean = [...new Set(raw.map(Number).filter((n) => Number.isFinite(n) && n > 0))];
  if (!clean.length) throw new SensitivityError('a knob needs at least one band');
  return clean.sort((a, b) => a - b);
}

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

  // Each knob is a list of BANDS. One band is the ordinary case and is written as a list of one,
  // so the loop below has a single shape.
  const withBands = knobList.map((k) => ({ ...k, bands: bandsOf(k) }));
  const plannedBuilds = withBands.reduce((n, k) => n + k.bands.length * 2, 1);
  if (plannedBuilds > MAX_BUILDS) {
    throw new SensitivityError(
      `That is ${plannedBuilds} forecast builds (about ${Math.round(plannedBuilds * 0.5)}s) and the ` +
      `cap is ${MAX_BUILDS}. Every band on every knob is two more real builds. Drop a band or a ` +
      `knob — the run is refused rather than shortened, because a ranking missing a band silently ` +
      `would be a ranking of whatever happened to fit.`
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
  // ⚠️ Counted from the BANDS, not from the knob count. The old `knobs * 2 + 1` was right only
  // while every knob had exactly one band; with three it reported "build 7/3" — a progress
  // indicator that overshoots its own total tells the reader the run is broken.
  const totalBuilds = plannedBuilds;
  let done = 0;

  return withScratchScenario(source.id, async ({ id: scratchId, build }) => {
    await assertCopyFidelity(source.id, scratchId);
    await feasibilityPass(scratchId, knobList, scenarioRate);

    await build();
    done += 1; onProgress(done, totalBuilds);
    const anchor = { entries: await readEntries(scratchId), shortfall: await totalShortfall(scratchId) };
    const fingerprint = await inputFingerprint(scratchId);

    const points = [];
    for (const knob of withBands) {
      for (const band of knob.bands) {
        for (const side of ['low', 'high']) {
        const { restore, value, before, valueUsd, beforeUsd } = await knobs.applyKnob(
          db, scratchId, { ...knob, band, lowBand: band, highBand: band }, side, { scenarioRate }
        );
        try {
          await build();
          points.push({
            knobId: knobs.knobId(knob), side, band,
            // What the knob was actually moved TO, and from. "±0.25×" on a growth of 0.8 is
            // unreadable without them.
            appliedValue: value == null ? null : String(value),
            beforeValue: before == null ? null : String(before),
            // The same figures in USD, where the column has a USD twin — the impacts are USD and
            // the knob's own value is not.
            appliedValueUsd: valueUsd == null ? null : String(valueUsd),
            beforeValueUsd: beforeUsd == null ? null : String(beforeUsd),
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
            `"${knobs.knobId(knob)}" (${side}, ±${band}). Every later bar would measure that knob ` +
            `plus a residue, so the run stops here rather than returning a ranking it cannot ` +
            `stand behind.`
          );
        }

        // Let the event loop drain: dozens of sequential builds otherwise hold it for the whole
        // run and every other request in the process waits.
        await new Promise((r) => setImmediate(r));
        }
      }
    }

    return {
      scenario: scenarioName,
      knobs: withBands.map((k) => ({ ...k, knobId: knobs.knobId(k) })),
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
    // EVERY band is probed, not just the first: ±10% on a 0.5% selling cost is legal and ±50% is
    // not, and finding that out on build 30 of 49 wastes the whole run.
    for (const band of bandsOf(knob)) {
      for (const side of ['low', 'high']) {
        try {
          await db.transaction(async (client) => {
            await knobs.applyKnob(
              client, scratchId, { ...knob, band, lowBand: band, highBand: band }, side,
              { scenarioRate }
            );
            throw new Rollback();        // never keep it: this is a probe, not a change
          });
        } catch (err) {
          if (err instanceof Rollback) continue;
          problems.push(`${knobs.knobId(knob)} (${side}, ±${band}): ${err.message}`);
        }
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
    // Best-effort until the run reports its own count; same band-aware arithmetic so the first
    // poll does not show a total the run immediately exceeds.
    total: (params.knobs || []).reduce((n, k) => {
      const bands = Array.isArray(k.bands) && k.bands.length ? k.bands.length : 1;
      return n + bands * 2;
    }, 1),
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

/** Same one-at-a-time guard: a combination run holds a scratch and the engine exactly as a ranking run does. */
function startCombinedJob(params) {
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
    total: (params.combinations?.length ?? 0) + 1,
  };
  jobs.set(jobId, job);

  runCombined({ ...params, onProgress: (d, t) => { job.done = d; job.total = t; } })
    .then((result) => jobs.set(jobId, { ...job, status: 'done', result }))
    .catch((error) => {
      console.error('[sensitivity] combined run failed:', error.message);
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

/**
 * CR085 P3 — all the knobs moved AT ONCE, as a real build.
 *
 * ⚠️ THIS IS NOT THE SUM OF THE BARS, AND THAT IS THE ENTIRE POINT.
 * §5.4 forbids *displaying a sum of impacts*, because the model is path-dependent: the cash sweep
 * sells different assets when three things move together than when each moves alone, so adding the
 * bars gives a number the engine never produces. Building the combination instead gives a MEASURED
 * number, and the gap between it and the sum is the interaction — which is the only honest way to
 * say whether the tornado's implied independence holds on this plan.
 *
 * The caller supplies an explicit `side` per knob, because "all adverse" is a statement about the
 * METRIC and the metric is computed on the client (§5.3). The server does not guess it.
 *
 * Its own anchor is rebuilt here rather than carried over from the ranking run: a different scratch
 * copy is a different scenario, and a combination compared against another run's anchor would fold
 * any copy-to-copy difference into the interaction figure.
 *
 * @param {Array} combinations [{ label, knobs: [{entity,target,field,band,side}] }]
 */
async function runCombined({ scenarioName, combinations, onProgress = () => {} }) {
  if (!scenarioName) throw new SensitivityError('scenario is required');
  if (!Array.isArray(combinations) || combinations.length === 0) {
    throw new SensitivityError('at least one combination is required');
  }
  for (const c of combinations) {
    if (!Array.isArray(c.knobs) || c.knobs.length === 0) {
      throw new SensitivityError('a combination needs at least one knob');
    }
    if (c.knobs.length > MAX_KNOBS) {
      throw new SensitivityError(`a combination may hold at most ${MAX_KNOBS} knobs`);
    }
    for (const k of c.knobs) {
      if (k.side !== 'low' && k.side !== 'high') {
        throw new SensitivityError(`each knob needs an explicit side; got "${k.side}"`);
      }
    }
  }

  const source = await repo.findScenarioByName(scenarioName);
  if (!source) throw new SensitivityError(`Scenario "${scenarioName}" not found`);
  if (source.parent_scenario_id) await variants.syncIfStale(source.id);
  await sweepStaleScratch(60);

  const scenarioRate = await scenarioTaxRate(scenarioName);
  const totalBuilds = combinations.length + 1;
  let done = 0;

  return withScratchScenario(source.id, async ({ id: scratchId, build }) => {
    await assertCopyFidelity(source.id, scratchId);

    await build();
    done += 1; onProgress(done, totalBuilds);
    const anchor = { entries: await readEntries(scratchId), shortfall: await totalShortfall(scratchId) };
    const fingerprint = await inputFingerprint(scratchId);

    const out = [];
    for (const combo of combinations) {
      const restores = [];
      try {
        // Applied in one pass, all of them, before a single build. Every knob is a distinct row —
        // two knobs on the SAME field of the same row would have the second silently overwrite the
        // first's capture and make the restore lossy, so that is refused up front.
        const seen = new Set();
        for (const k of combo.knobs) {
          const id = knobs.knobId(k);
          if (seen.has(id)) {
            throw new SensitivityError(`"${id}" appears twice in one combination`);
          }
          seen.add(id);
          const { restore } = await knobs.applyKnob(db, scratchId, k, k.side, { scenarioRate });
          restores.push(restore);
        }
        await build();
        out.push({
          label: combo.label,
          knobs: combo.knobs.map((k) => ({ knobId: knobs.knobId(k), side: k.side })),
          entries: await readEntries(scratchId),
          shortfall: await totalShortfall(scratchId),
        });
      } finally {
        // Unwound in REVERSE, so a field touched by two writes lands back on the earliest capture.
        for (const r of restores.reverse()) await r();
      }
      done += 1; onProgress(done, totalBuilds);

      const after = await inputFingerprint(scratchId);
      if (after !== fingerprint) {
        throw new SensitivityError(
          `The throwaway copy did not return to its starting state after the "${combo.label}" ` +
          `combination, so any later figure would carry a residue. The run stops here.`
        );
      }
      await new Promise((r) => setImmediate(r));
    }

    return { scenario: scenarioName, anchor, combinations: out, builds: totalBuilds };
  });
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

  const offer = (spec, row, moduleRow, target, current, streams = [], disposals = [], extra = {}) => {
    try {
      knobs._internals.assertApplicable(spec, row, moduleRow, {
        streams, disposals,
        changeCount: row?.change_count, levelRowCount: row?.level_row_count,
        changeRows: extra.changeRows,
      });
    } catch {
      return;   // not offerable — the setter would refuse it, so the picker does not show it
    }
    out.push({
      entity: spec.entity, field: spec.field, kind: spec.kind, label: spec.label,
      band: knobs.DEFAULT_BAND[spec.kind],
      module: moduleRow.name, moduleType: moduleRow.module_type, target,
      // A knob moves the module's OWN-currency column. Without the currency the picker and the
      // results table print a bare number that a reader will compare against a USD impact.
      currency: moduleRow.currency || 'USD',
      // Asset · liability · income · expense, decided server-side from what the ENGINE branches
      // on. The frontend must not re-derive it from `module_type`, which is free text.
      group: knobs.knobGroup(spec, row, moduleRow, streams),
      current: current == null ? null : String(current),
      // ⚠️ USD, ALWAYS. A knob moves the module's OWN-currency column, and `United Beverages` at
      // 15,000,000 PLN would otherwise outrank every dollar figure in the plan by sorting on a
      // number that is not money — the CR054 class, and the same 3.6× the results table already
      // had to fix. Null for anything without a USD twin: those are simply not candidates.
      usdMagnitude: spec.usdTwin && row[spec.usdTwin] != null
        ? Math.abs(Number(row[spec.usdTwin])) : null,
    });
  };

  for (const m of mods) {
    // Loaded FIRST: a flow module has no valuation to classify by, so its group comes from the
    // direction of its own streams.
    // The FC line's name rides along: a module's own `growth_rate` and a stream's `growth_mult`
    // both render as "Growth (× inflation)", so eight modules offered two identical rows for two
    // completely different things — one grows the asset's value, the other grows a stream.
    // ⚠️ `change_count` rides along because an `amount` of 0 does NOT mean the stream is idle:
    // `forecast_stream_changes` rows supply per-year figures, and `Social Security`, `One-Off
    // Items` and `Retirement Home` all sit at 0 while moving the plan through theirs. A gate that
    // read the column alone hid five working knobs.
    const { rows: streams } = await client.query(
      `SELECT st.*, l.name AS fc_line_name,
              (SELECT count(*)::int FROM forecast_stream_changes c WHERE c.stream_id = st.id) AS change_count,
              (SELECT count(*)::int FROM forecast_stream_changes c
                WHERE c.stream_id = st.id AND c.flag = 'Fixed $') AS level_row_count
         FROM forecast_streams st
         LEFT JOIN fc_lines l ON l.id = st.fc_line_id
        WHERE st.module_id = $1 ORDER BY st.direction, st.id`, [m.id]
    );
    // Loaded before the module-level offers: a module's tax rate is only live if there is
    // something to tax — an income stream, or a disposal to realise a gain on.
    const { rows: disposals } = await client.query(
      'SELECT * FROM forecast_module_disposals WHERE module_id = $1 ORDER BY disposal_date', [m.id]
    );

    for (const [field, spec] of Object.entries(knobs.MODULE_FIELDS)) {
      offer({ ...spec, entity: 'module', field }, m, m, { module: m.name }, m[field], streams, disposals);
    }

    for (const st of streams) {
      for (const [field, spec] of Object.entries(knobs.STREAM_FIELDS)) {
        offer(
          {
            ...spec,
            entity: 'stream',
            field,
            // Named by the line it posts to, falling back to its direction. Same reason the
            // disposal knobs carry their date: picking the wrong one of two identical rows is
            // invisible until the bar is wrong.
            label: `${spec.label} · ${st.fc_line_name || st.direction}`,
          },
          st, m,
          { module: m.name, direction: st.direction, fcLineId: st.fc_line_id }, st[field],
          streams, disposals
        );
      }
    }
    // CR085 §4.1's deferred item: the `forecast_stream_changes` SCHEDULES, moved as a whole list.
    // One knob per (stream, flag) that actually has rows — a flag with none is not a knob, and
    // offering it would be a bar for a schedule that does not exist.
    for (const st of streams) {
      const { rows: changes } = await client.query(
        `SELECT * FROM forecast_stream_changes WHERE stream_id = $1 ORDER BY change_date, id`,
        [st.id]
      );
      if (!changes.length) continue;
      for (const [flag, spec] of Object.entries(knobs.CHANGE_FLAGS)) {
        const rows = changes.filter((c) => c.flag === flag);
        offer(
          {
            ...spec, entity: 'change', field: flag,
            label: `${spec.label} · ${st.fc_line_name || st.direction}`,
          },
          st, m,
          { module: m.name, direction: st.direction, fcLineId: st.fc_line_id, flag },
          // A schedule has no single value, so the picker shows its SHAPE — and it uses the SAME
          // helper the run's applied-value does, or the two would describe one schedule
          // differently in two places on the same page.
          rows.length ? knobs.describeSchedule(rows.map((r) => r.amount)) : null,
          streams, disposals, { changeRows: rows }
        );
      }
    }

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
          { module: m.name, date }, d[field], streams, disposals
        );
      }
    }
  }
  return markStartingSet(out);
}

/** How many knobs the picker opens with — 11 builds, about six seconds, well inside the cap. */
const STARTING_SET_SIZE = 5;

/**
 * §15 cut 5 — the picker should not open empty. Its other half ("say that runs compose") shipped
 * with P1; this is the half that did not.
 *
 * ⚠️ A STARTING SET MUST NOT READ AS AN ANSWER. This page exists because you CANNOT tell in advance
 * which assumption the plan rests on — that is the whole premise, and a pre-ticked set labelled as
 * anything like "the important ones" would contradict it before the first build. So the rule is
 * deliberately dumb and stated plainly in the UI: **the biggest numbers in the plan**, which is a
 * fact about the balance sheet, not a claim about sensitivity. The run is what turns one into the
 * other, and the two are genuinely different — a large asset disposed in year one moves less than a
 * middling one compounding for thirty-six.
 *
 * Only LEVEL knobs with a USD twin are candidates: a magnitude is the only thing comparable across
 * knobs, and rates, multipliers and dates do not have one. Cost basis is excluded — it is a tax
 * input rather than a driver of the plan, and §22 established that it only moves anything at all
 * when the module is sold.
 *
 * BREADTH FIRST, THEN SIZE: one knob from each group before a second from any, so a plan whose four
 * biggest numbers are all assets does not open with four ways of asking the same question.
 *
 * ⚠️ BUT BREADTH HAS A FLOOR, or it reproduces this CR's own pathology. On `2026 Base` the largest
 * LIABILITY is `USD Credit Cards` at $27,187, against `United Beverages` at $4,175,595 — a hundred
 * and fifty times smaller. Included for balance it draws a bar of a few pixels beside one that
 * fills the chart, and a bar that renders as nothing reads as *"this assumption does not matter"*,
 * which is the exact misreading eleven fixes in this CR exist to prevent. A group whose best
 * candidate is under 1% of the largest one is left out and its slot goes to the next biggest
 * knob instead.
 */
const STARTING_SET_FLOOR = 0.01;

function markStartingSet(list) {
  const all = list
    .filter((k) => k.kind === knobs.KIND.LEVEL && k.usdMagnitude > 0 && k.field !== 'base_value')
    .sort((a, b) => b.usdMagnitude - a.usdMagnitude);
  if (!all.length) return list;

  // ⚠️ THE FLOOR APPLIES TO BOTH PASSES. It first guarded only the breadth pass, so a plan with
  // few candidates could still open with a knob 150× smaller than the largest — admitted by SIZE
  // rather than by balance, and drawing exactly the same few-pixel bar. Caught by its own test.
  // A short starting set is a better answer than a padded one.
  const floor = all[0].usdMagnitude * STARTING_SET_FLOOR;
  const candidates = all.filter((k) => k.usdMagnitude >= floor);

  const picked = [];
  const seenGroups = new Set();
  for (const k of candidates) {
    if (picked.length >= STARTING_SET_SIZE) break;
    if (seenGroups.has(k.group)) continue;
    seenGroups.add(k.group);
    picked.push(k);
  }
  for (const k of candidates) {
    if (picked.length >= STARTING_SET_SIZE) break;
    if (!picked.includes(k)) picked.push(k);
  }

  for (const k of picked) k.starting = true;
  return list;
}

module.exports = {
  runSensitivity,
  runCombined,
  startCombinedJob,
  listKnobs,
  // Exported for its unit test: the rule is a judgement, and a judgement needs pinning.
  _internals: { markStartingSet, STARTING_SET_SIZE, STARTING_SET_FLOOR },
  startSensitivityJob,
  getSensitivityJob,
  assertCopyFidelity,
  inputFingerprint,
  totalShortfall,
  MAX_KNOBS,
  MAX_BUILDS,
  bandsOf,
  SensitivityError,
  KnobError,
};
