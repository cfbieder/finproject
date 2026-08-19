// CR084 — a throwaway copy of a scenario you can build against, and always clean up.
//
// Extracted from CR053's auto-adjust, where this lifecycle was inline inside the bisection solver.
// It is now shared, because a second hand-written copy of "deep-copy → build → tear down" is the
// drift this project keeps paying for: the solver's version already knew three non-obvious things
// that a fresh implementation would have had to rediscover.
//
// ⚠️ The three things, kept verbatim from CR053 because each is load-bearing:
//
//  1. **STANDALONE, never a variant.** A throwaway *variant* is impossible — the 039 trigger
//     rejects a variant-of-a-variant, and `generateForecast` force-syncs a variant at Step 0,
//     which would clobber anything written to the scratch before the build. A parentless copy is
//     never synced, so a direct write to it survives.
//  2. **Teardown must prune the ASSUMPTIONS DOCUMENT.** `deleteScenario` cascades the DB children
//     but does not touch `forecast_assumptions`, whose four shared JSON rows are keyed by scenario
//     NAME. Leaving them behind accumulates junk in a document every build reads.
//  3. **Cleanup runs in `finally`**, so a failed build still tears down. A leaked scratch is
//     `is_active = TRUE` and shows up in every scenario picker in the app.
//
// ⚠️ Concurrency, stated precisely because half of it is fixed and half is not.
// The four shared `forecast_assumptions` rows are touched twice per scratch: once by
// `copyScenario` (which ADDS the scratch's rows) and once by the teardown (which removes them).
// Both were read-modify-writes in CR053, so either could overwrite an owner's concurrent save of a
// new inflation path — and the failure that produces is the quiet one CR064 documents, a build at
// **0% inflation for the whole horizon**.
//   • TEARDOWN: fixed here — the filter runs inside the UPDATE, one statement, no window.
//   • `copyScenario`: still a read-modify-write, and NOT changed by this CR because it is shared
//     with every other caller of scenario copy. The window is ~one statement wide rather than the
//     ~1s of a whole preview, but it is real. Recorded in CR084 §6 as the residual.

const db = require('../db');
const repo = require('../repositories').forecast;
const { generateForecast } = require('../../services/forecast');

const SCRATCH_PREFIX = '__scratch_';

/** The assumptions-document keys that carry per-scenario rows keyed by name. */
const ASSUMPTION_DOC_KEYS = ['scenarios', 'inflation', 'FX', 'Tax Rate'];

/**
 * Remove a scratch's rows from the shared assumptions document — in ONE statement per key.
 *
 * ⚠️ CR053's version read the document into JS, filtered, and wrote the whole array back. That is a
 * read-modify-write over four rows every scenario shares, so a teardown that read the document
 * before an owner saved a new inflation path would overwrite that save — and the failure it
 * produces is the quiet one CR064 documents, where an empty inflation list builds at **0% for the
 * whole horizon**. CR053 made it rare (one owner-initiated solve). A preview on every module save
 * makes it routine, so the window is closed rather than inherited.
 *
 * The filter now runs INSIDE the UPDATE, so the read and the write are the same statement and no
 * concurrent save can be lost between them.
 */
async function pruneAssumptionsForName(client, name) {
  const nameFieldFor = (key) => (key === 'scenarios' ? 'Name' : 'Scenario');
  for (const key of ASSUMPTION_DOC_KEYS) {
    await client.query(
      `UPDATE forecast_assumptions
          SET value = COALESCE(
                (SELECT jsonb_agg(e)
                   FROM jsonb_array_elements(value::jsonb) e
                  WHERE e->>$3 IS DISTINCT FROM $2),
                '[]'::jsonb),
              updated_at = NOW()
        WHERE key = $1
          AND jsonb_typeof(value::jsonb) = 'array'
          AND EXISTS (SELECT 1 FROM jsonb_array_elements(value::jsonb) e
                       WHERE e->>$3 IS NOT DISTINCT FROM $2)`,
      [key, name, nameFieldFor(key)]
    );
  }
}

async function destroyScratch(scratchId, scratchName) {
  try {
    await db.transaction(async (client) => {
      await pruneAssumptionsForName(client, scratchName);
    });
    await repo.deleteScenario(scratchId);   // DB children cascade
  } catch (err) {
    // Swallowed deliberately: a cleanup failure must not mask the caller's real result or error.
    // It is logged loudly because the leak is visible to the owner in every scenario picker.
    console.error(`[scratch] cleanup failed for ${scratchName}:`, err.message);
  }
}

/**
 * Deep-copy `scenarioId` into a throwaway scenario, hand it to `fn`, and always tear it down.
 *
 * `fn` receives `{ id, name, build }`. `build()` runs a REAL engine build against the scratch and
 * throws on failure — the same build the owner's own scenario gets, because a preview computed by
 * anything other than the engine is a second opinion about the engine.
 *
 * @param {number} scenarioId  the scenario to copy
 * @param {Function} fn        async ({ id, name, build }) => T
 * @returns {Promise<T>}       whatever `fn` returns
 */
async function withScratchScenario(scenarioId, fn) {
  const name = `${SCRATCH_PREFIX}${scenarioId}_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  let scratch = null;
  try {
    // CR085 P0 — `isScratch` marks the copy in the DATABASE (migration 073), which is what keeps
    // it out of every scenario picker and what lets `sweepStaleScratch` find one this `finally`
    // never got to run for. The name prefix above is now only a human-readable hint.
    scratch = await repo.copyScenario(scenarioId, name, { isScratch: true });
    const build = async () => {
      // `writeAudit: false` — the audit CSVs are written by the container as root and a scratch's
      // would never be read. CR053 does the same.
      const r = await generateForecast(name, { writeAudit: false });
      if (!r.success) throw new Error(`scratch build failed: ${r.error}`);
      return r;
    };
    return await fn({ id: scratch.id, name, build });
  } finally {
    if (scratch) await destroyScratch(scratch.id, name);
  }
}

/** Every forecast entry for a scenario, in the shape the client's matrix builder consumes. */
async function readEntries(scenarioId) {
  const { rows } = await db.query(
    `SELECT forecast_year AS "Year", account AS "Account", amount AS "Amount", module AS "Module"
       FROM forecast_entries WHERE scenario_id = $1
      ORDER BY forecast_year, account, module`,
    [scenarioId]
  );
  return rows;
}

/**
 * Delete scratch scenarios that no run can still be using — CR085 P0, closing CR084 §9.2.
 *
 * The `finally` in `withScratchScenario` covers every failure short of the process dying between
 * the copy and the teardown. When that happens the copy survives, and before migration 073 it
 * survived VISIBLY: `copyScenario` inserts `is_active = TRUE`, so it appeared in every scenario
 * picker in the app with no way to tell it from a real scenario.
 *
 * ⚠️ Keyed on AGE, not on existence. A scratch belonging to a run happening right now is
 * indistinguishable from a leaked one except by how old it is, and deleting a live one would fail
 * the owner's build mid-flight. One hour is far longer than the longest run this harness supports
 * (CR085 caps a sensitivity run at ~40 builds, well under a minute) and far shorter than the
 * interval between deploys, which is when this runs.
 *
 * Failures are logged and swallowed: a boot-time cleanup must never stop the server from starting.
 *
 * @param {number} [olderThanMinutes=60]
 * @returns {Promise<number>} how many were removed
 */
async function sweepStaleScratch(olderThanMinutes = 60) {
  try {
    const { rows } = await db.query(
      `SELECT id, name FROM forecast_scenarios
        WHERE is_scratch AND created_at < NOW() - ($1 || ' minutes')::interval
        ORDER BY id`,
      [String(olderThanMinutes)]
    );
    for (const r of rows) await destroyScratch(r.id, r.name);
    if (rows.length) {
      console.log(`[scratch] swept ${rows.length} stale scratch scenario(s): ${rows.map((r) => r.name).join(', ')}`);
    }
    return rows.length;
  } catch (err) {
    console.error('[scratch] stale sweep failed:', err.message);
    return 0;
  }
}

module.exports = {
  withScratchScenario,
  readEntries,
  SCRATCH_PREFIX,
  // Exported for the stale-scratch sweep and for tests that assert nothing was left behind.
  destroyScratch,
  sweepStaleScratch,
};
