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
// ⚠️ Known concurrency hazard, inherited and NOT fixed here: `copyScenario` and the prune are both
// read-modify-writes over the same four shared `forecast_assumptions` rows, so a teardown that read
// the document before an owner saved a new inflation path will overwrite that save. CR053 made this
// rare (one owner-initiated solve). A preview per save makes it routine — see CR084 §"open".

const db = require('../db');
const repo = require('../repositories').forecast;
const { generateForecast } = require('../../services/forecast');

const SCRATCH_PREFIX = '__scratch_';

/** The assumptions-document keys that carry per-scenario rows keyed by name. */
const ASSUMPTION_DOC_KEYS = ['scenarios', 'inflation', 'FX', 'Tax Rate'];

async function pruneAssumptionsForName(client, name) {
  const nameFieldFor = (key) => (key === 'scenarios' ? 'Name' : 'Scenario');
  for (const key of ASSUMPTION_DOC_KEYS) {
    const row = await client.query('SELECT value FROM forecast_assumptions WHERE key = $1', [key]);
    if (!row.rows[0]) continue;
    const raw = row.rows[0].value;
    const list = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!Array.isArray(list)) continue;
    const field = nameFieldFor(key);
    const next = list.filter((e) => !e || e[field] !== name);
    if (next.length !== list.length) {
      await client.query(
        'UPDATE forecast_assumptions SET value = $1, updated_at = NOW() WHERE key = $2',
        [JSON.stringify(next), key]
      );
    }
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
    scratch = await repo.copyScenario(scenarioId, name);
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

module.exports = {
  withScratchScenario,
  readEntries,
  SCRATCH_PREFIX,
  // Exported for the stale-scratch sweep and for tests that assert nothing was left behind.
  destroyScratch,
};
