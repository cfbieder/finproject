#!/usr/bin/env node
/**
 * CR085 — THE GATE THAT WAS MISSING.
 *
 * Ten defects of one shape reached the sensitivity page: a knob that writes, builds and moves
 * NOTHING, drawing a zero-length bar that reads *"this assumption does not matter"* in a chart
 * whose entire claim is that the bars are ranked. Nine of the ten were found by a person looking
 * at the output; exactly one was caught by a test. The catalogue had never been checked against
 * the engine in one pass — it was read one field at a time, as failures surfaced.
 *
 * This is that pass, and it does NOT reason about the engine. It measures it: every knob the
 * picker offers is applied down and up against a throwaway copy, rebuilt for real, and the
 * generated entries are hashed. If both sides hash identically to the untouched build, the knob
 * moved nothing — not "moved a little", nothing.
 *
 * ⚠️ A DEAD RESULT IS A CANDIDATE, NOT A VERDICT. It says the field is inert *on this scenario*,
 * which is not the same as inert by construction — a disposal past the horizon, or a stream that
 * ends before it starts, would read the same. Confirm each hit against the engine before gating
 * it, and gate on the ENGINE's precondition, never on "it was zero that time".
 *
 *   node Scripts/sweep-sensitivity-knobs.js "2026 Base"            # against DATABASE_URL
 *
 * Read-only with respect to the scenario: every knob is restored, and the whole run happens
 * inside CR084's scratch harness, which drops its copy in a `finally`.
 */
'use strict';

const crypto = require('crypto');
const path = require('path');

process.env.DATABASE_URL = process.env.DATABASE_URL
  || `postgres://fin:${process.env.POSTGRES_PASSWORD}@localhost:5434/fin`;

const ROOT = path.join(__dirname, '..', 'server', 'src', 'v2');
const db = require(path.join(ROOT, 'db'));
const repo = require(path.join(ROOT, 'repositories')).forecast;
const knobs = require(path.join(ROOT, 'services', 'sensitivityKnobs'));
const sensitivity = require(path.join(ROOT, 'services', 'forecastSensitivity'));
const { withScratchScenario, readEntries } = require(path.join(ROOT, 'services', 'forecastScratch'));

const digest = (entries) => crypto.createHash('sha1').update(JSON.stringify(entries)).digest('hex');

async function main() {
  const scenarioName = process.argv[2] || '2026 Base';
  const source = await repo.findScenarioByName(scenarioName);
  if (!source) throw new Error(`Scenario "${scenarioName}" not found`);

  const catalogue = await sensitivity.listKnobs(scenarioName);
  console.log(`Sweeping ${catalogue.length} knobs on "${scenarioName}" — ${catalogue.length * 2 + 1} builds.\n`);

  // Not exported by the service, and duplicating one SELECT beats widening its surface for a
  // diagnostic. If this drifts from `scenarioTaxRate` the only cost is a wrong BASE for the two
  // `nullIsScenarioRate` knobs, which the sweep reports as DEAD either way.
  const scenarioRate = await (async () => {
    const r = await db.query("SELECT value FROM forecast_assumptions WHERE key = 'Tax Rate'");
    if (!r.rows[0]) return 0;
    const raw = r.rows[0].value;
    const list = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!Array.isArray(list)) return 0;
    const row = list.find((e) => e && e.Scenario === scenarioName);
    return Number(row?.Rate ?? row?.['Tax Rate'] ?? 0) || 0;
  })();
  const dead = [];
  const refused = [];
  const oneSided = [];

  await withScratchScenario(source.id, async ({ id: scratchId, build }) => {
    await build();
    const anchor = digest(await readEntries(scratchId));

    for (const [n, knob] of catalogue.entries()) {
      const id = knobs.knobId(knob);
      const moved = {};
      let failed = null;

      for (const side of ['low', 'high']) {
        let applied;
        try {
          applied = await knobs.applyKnob(db, scratchId, knob, side, { scenarioRate });
        } catch (err) {
          failed = err.message;
          break;
        }
        try {
          await build();
          moved[side] = digest(await readEntries(scratchId)) !== anchor;
        } finally {
          await applied.restore();
        }
      }

      if (failed) refused.push({ id, why: failed });
      else if (!moved.low && !moved.high) dead.push({ id, knob });
      // ⚠️ The ternary picked the side that did NOT move, so every one-sided knob was reported
      // backwards: `Fidelity Fixed Income · base_value` printed "only high" when in fact only LOW
      // moves it (a lower cost basis realises a bigger gain; a higher one is a LOSS, and the model
      // gives no loss relief). A diagnostic that names the wrong half is worse than none.
      else if (!moved.low || !moved.high) oneSided.push({ id, side: moved.low ? 'low' : 'high' });

      const mark = failed ? 'REFUSED' : (!moved.low && !moved.high) ? 'DEAD   '
        : (!moved.low || !moved.high) ? 'ONESIDE' : 'ok     ';
      process.stdout.write(`${String(n + 1).padStart(3)}/${catalogue.length} ${mark} ${id}\n`);
    }
  });

  console.log(`\n=== ${dead.length} knobs moved NOTHING on either side ===`);
  for (const d of dead) console.log(`  ${d.id}   [${d.knob.entity}.${d.knob.field}, ${d.knob.kind}]`);
  console.log(`\n=== ${oneSided.length} moved on one side only ===`);
  for (const o of oneSided) console.log(`  ${o.id}   (only ${o.side})`);
  console.log(`\n=== ${refused.length} refused before building ===`);
  for (const r of refused) console.log(`  ${r.id}\n      ${r.why}`);
  await db.pool?.end?.();
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
