// CR084 — what an edit would do to the plan, before it is saved.
//
// From [CR081 §13]. Both reviewers of CR081 converged on this independently and preferred it to the
// AI assistant it was carved out of: a consequence preview serves EVERY edit the owner makes, not
// only the ones an LLM proposed, and it needs no token contract, no action schema and no benchmark
// table.
//
// ⚠️ BOTH sides are built. The obvious shape — read the scenario's stored entries as "before",
// build a scratch for "after" — is WRONG here, and wrong in the way this codebase keeps being
// wrong: `forecast_entries` is the result of the last build, and "an engine change moves nothing
// until the scenarios are REGENERATED" is written into the infrastructure guide precisely because
// stale entries beside fresh inputs is the NORMAL state of this system. Comparing a stale before
// against a fresh after attributes every un-regenerated edit since the last build to the one change
// the owner is looking at. So the scratch is built twice, from one copy, and the only difference
// between the two reads is the edit itself.
//
// The preview is deliberately NOT a second opinion about the engine: both numbers come from
// `generateForecast`, the same build the owner's own scenario gets.

const db = require('../db');
const repo = require('../repositories').forecast;
const { withScratchScenario, readEntries } = require('./forecastScratch');
const { moduleBodyToColumns } = require('./moduleWrite');
const crud = require('../../services/forecast/crud');

/**
 * Which OTHER scenarios would this module edit actually reach?
 *
 * ⚠️ Computed, never asserted. CR081 §5 claimed "a base edit propagates to four variants" and the
 * live data contradicted it: a variant carrying a `streams` override replaces the module's stream
 * set wholesale, so a base edit reaches NOTHING there. The dangerous direction is the one a fixed
 * number hides — the owner fixes the base, believes five scenarios moved, and two silently kept the
 * old value. Both lists are returned, because "does not move" is the half worth reading.
 *
 * @returns {{ moves: string[], blocked: Array<{name: string, reason: string}> }}
 */
async function blastRadius(moduleId) {
  const { rows: mod } = await db.query(
    `SELECT m.id, m.name, m.scenario_id, s.parent_scenario_id
       FROM forecast_modules m JOIN forecast_scenarios s ON s.id = m.scenario_id
      WHERE m.id = $1`,
    [moduleId]
  );
  if (!mod.length) return { moves: [], blocked: [] };
  const target = mod[0];

  // Only a BASE fans out. Editing a variant is a CR050 override and reaches nothing else.
  if (target.parent_scenario_id != null) return { moves: [], blocked: [] };

  const { rows: variants } = await db.query(
    `SELECT s.id, s.name,
            (SELECT count(*) FROM forecast_scenario_overrides o
              WHERE o.scenario_id = s.id AND o.entity_type = 'module'
                AND o.base_entity_id = $2 AND o.is_deleted = FALSE) AS overrides
       FROM forecast_scenarios s
      WHERE s.parent_scenario_id = $1 AND s.is_active
      ORDER BY s.name`,
    [target.scenario_id, moduleId]
  );

  const moves = [];
  const blocked = [];
  for (const v of variants) {
    if (Number(v.overrides) > 0) {
      blocked.push({ name: v.name, reason: 'has its own override for this module' });
    } else {
      moves.push(v.name);
    }
  }
  return { moves, blocked };
}

/**
 * Build `scenarioName` twice on one throwaway copy — once as it stands, once with `patch` applied
 * to the module — and return both entry sets for the client to diff.
 *
 * Entries are returned RAW rather than summarised. `buildScenarioMatrix`, `fcRealTerms` and
 * `fcWarnings` are all frontend modules with no server twin, and porting them would create a second
 * implementation of numbers the Review and Compare pages already render — the disagreement this
 * whole review has spent itself removing. The client diffs two matrices with the same
 * `compareMatrices` Compare uses, so a preview and a comparison cannot show different arithmetic.
 *
 * @param {object} p
 * @param {number} p.moduleId  the module being edited (in the REAL scenario)
 * @param {object} p.patch     the field changes, as the module editor would save them
 */
async function previewModuleChange({ moduleId, patch }) {
  const target = await repo.findModuleById(moduleId);
  if (!target) throw new Error('Module not found');
  const scenario = await repo.findScenarioById(target.scenario_id);
  if (!scenario) throw new Error('Scenario not found');

  const radius = await blastRadius(moduleId);

  return withScratchScenario(scenario.id, async ({ id: scratchId, name: scratchName, build }) => {
    // BEFORE — the scenario exactly as it stands, rebuilt so it cannot be stale.
    await build();
    const before = await readEntries(scratchId);

    // ⚠️ `copyScenario` re-keys every id, so the real module's id means nothing on the scratch.
    // Resolved by NAME, which is what CR053's `readScratchBaseline` does for the same reason.
    // A name is not a great key, but it is the only stable one across a copy.
    const { rows: match } = await db.query(
      'SELECT id FROM forecast_modules WHERE scenario_id = $1 AND name = $2',
      [scratchId, target.name]
    );
    if (match.length !== 1) {
      throw new Error(
        `Cannot preview "${target.name}": the throwaway copy holds ${match.length} modules with ` +
        `that name, so the edit cannot be placed unambiguously.`
      );
    }

    // ⚠️ The edit is applied through the SAME three steps the save performs, in the same order:
    // the shared body→columns mapping, then the schedules, then the streams. Anything less
    // previews a different edit. The first version of this called `repo.updateModule` with the
    // editor's PascalCase body — which the repository does not understand — and 400'd on the first
    // browser check; had the shapes merely overlapped it would have shown "no change" to an owner
    // who had just edited a stream amount.
    //
    // The scratch is STANDALONE, so `updateModule`'s variant intercept and `interceptSchedules`
    // are inert here — the copy is written directly, which is the point of copying it.
    const scratchModuleId = match[0].id;
    const before2 = await repo.findModuleById(scratchModuleId);
    const columns = await moduleBodyToColumns(patch, before2);
    if (Object.keys(columns).length > 0) {
      const updated = await repo.updateModule(scratchModuleId, columns);
      if (!updated) throw new Error('Preview could not apply the change to the throwaway copy');
    }
    // Guarded exactly as the route guards it: `replaceModuleSchedules` DELETES before it
    // reinserts, so calling it for a body that never mentions a schedule would wipe the module's
    // disposals on the copy and report a vast difference the real save would never produce.
    if (Array.isArray(patch.Invest) || Array.isArray(patch.Dispose) ||
        Array.isArray(patch.IncomePct) || Array.isArray(patch.Amortization) ||
        Array.isArray(patch.IncomeSteps)) {
      await crud.replaceModuleSchedules(scratchModuleId, patch);
    }
    await crud.replaceModuleStreams(scratchModuleId, patch);

    // AFTER — same copy, same engine, one difference.
    await build();
    const after = await readEntries(scratchId);

    return {
      scenario: scenario.name,
      module: target.name,
      // No `periodStart` here: it lives in the assumptions DOCUMENT, not the scenario row, and the
      // client already holds it. Returning `scenario.period_start` would have been a permanent
      // `null` that reads like a real value.
      before,
      after,
      alsoMoves: radius.moves,
      doesNotMove: radius.blocked,
    };
  });
}

module.exports = { previewModuleChange, blastRadius };
