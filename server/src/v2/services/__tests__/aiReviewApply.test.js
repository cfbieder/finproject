'use strict';
/**
 * CR081 P0a — the guards on the one write path an LLM drives.
 *
 * This path had NO tests at all before this file, which is why two of its defects survived to be
 * found by a CR review rather than by a suite: the write target came from the model's JSON and was
 * never checked against the reviewed scenario, and `update_scenario` bypassed the CR050 reconcile
 * that lives in the scenarios ROUTE, so a variant's band change reported success and was erased at
 * the next sync.
 *
 * The first four tests are CHARACTERIZATION of guards that already existed — written so the
 * refactor that added the new ones could not quietly drop them.
 *
 * DB-backed: every guard here is about a real row's scenario, its `has_valuation`, or an override
 * actually landing. A mocked repository would assert the mock.
 */
const db = require('../../db');
const aiReview = require('../aiReview');

const describeOrSkip = process.env.SKIP_DB_TESTS ? describe.skip : describe;

const TAG = '__cr081test_';

describeOrSkip('CR081 P0a — AI Review apply guards', () => {
  let baseId, otherId, variantId, valuationModuleId, flowModuleId, otherModuleId, reviewId;

  const mkScenario = async (name, parentId = null) => {
    const { rows } = await db.query(
      `INSERT INTO forecast_scenarios (name, is_active, cash_sweep_low, cash_sweep_high, parent_scenario_id)
       VALUES ($1, TRUE, 100000, 200000, $2) RETURNING id`,
      [TAG + name, parentId]
    );
    return rows[0].id;
  };

  const mkModule = async (scenarioId, name, hasValuation) => {
    const { rows } = await db.query(
      `INSERT INTO forecast_modules (scenario_id, name, module_type, currency, base_date,
                                     has_valuation, setup_status, growth_rate)
       VALUES ($1, $2, 'Investment', 'USD', '2025-12-31', $3, 'complete', 1.0) RETURNING id`,
      [scenarioId, TAG + name, hasValuation]
    );
    return rows[0].id;
  };

  beforeAll(async () => {
    baseId = await mkScenario('base');
    otherId = await mkScenario('other');
    variantId = await mkScenario('variant', baseId);
    valuationModuleId = await mkModule(baseId, 'valuation', true);
    flowModuleId = await mkModule(baseId, 'flow', false);
    otherModuleId = await mkModule(otherId, 'elsewhere', true);
    const { rows } = await db.query(
      `INSERT INTO fc_ai_reviews (scenario_id, title, status) VALUES ($1, $2, 'completed') RETURNING id`,
      [baseId, TAG + 'review']
    );
    reviewId = rows[0].id;
  });

  afterAll(async () => {
    await db.query(`DELETE FROM audit_log WHERE user_info = $1`, [`ai-review:${reviewId}`]);
    await db.query(`DELETE FROM fc_ai_reviews WHERE title LIKE $1`, [TAG + '%']);
    await db.query(`DELETE FROM forecast_scenarios WHERE name LIKE $1`, [TAG + '%']);
  });

  const act = (over = {}) => ({
    type: 'update_module', module_id: valuationModuleId, field: 'growth_rate',
    proposed_value: 2.5, ...over,
  });

  // ---- characterization: guards that already existed ----------------------

  test('refuses a field outside the allowlist', async () => {
    await expect(aiReview.applyAction(reviewId, act({ field: 'base_value' })))
      .rejects.toThrow(/not allowed for auto-apply/);
  });

  test('refuses update_incexp — the table stopped being read (CR069 P2)', async () => {
    await expect(aiReview.applyAction(reviewId, { type: 'update_incexp', field: 'amount' }))
      .rejects.toThrow(/cannot be auto-applied/);
  });

  test('refuses a valuation field on a FLOW module — the engine would never read it', async () => {
    await expect(aiReview.applyAction(reviewId, act({ module_id: flowModuleId })))
      .rejects.toThrow(/has none — it is a flow module/);
  });

  test('refuses an unknown action type', async () => {
    await expect(aiReview.applyAction(reviewId, { type: 'drop_table', field: 'x' }))
      .rejects.toThrow(/Unknown action type/);
  });

  // ---- CR081 P0a: the new guards ------------------------------------------

  test('⚠️ refuses a target in a scenario the review is NOT about', async () => {
    // The worst of the defects: `/apply` took the action alone, so the model named the target and
    // nothing checked it. A review of one scenario could write a module in another — and if that
    // other one is a BASE, the edit fans out to its variants, with no scenario named anywhere on
    // screen.
    await expect(aiReview.applyAction(reviewId, act({ module_id: otherModuleId })))
      .rejects.toThrow(/which this review is not about/);

    const { rows } = await db.query('SELECT growth_rate FROM forecast_modules WHERE id = $1', [otherModuleId]);
    expect(Number(rows[0].growth_rate)).toBe(1);   // untouched
  });

  test('refuses an action with no review behind it', async () => {
    await expect(aiReview.applyAction(null, act())).rejects.toThrow(/no review behind it/);
    await expect(aiReview.applyAction(undefined, act())).rejects.toThrow(/no review behind it/);
  });

  test('reads current_value from the ROW and ignores what the action claims', async () => {
    // The model is asked for a proposal, never for the current state. A hallucinated "from" value
    // used to be rendered to the owner as fact — CR077 §4's rule broken where a number is ACTED on.
    const resolved = await aiReview.resolveAction(reviewId, act({ current_value: 999 }));
    expect(resolved.currentValue).toBe('1.0000');       // the real stored value
    expect(resolved.proposedValue).toBe(2.5);
    expect(resolved.scenarioName).toBe(TAG + 'base');
  });

  test('applies a valid module change and records the real before-value', async () => {
    const res = await aiReview.applyAction(reviewId, act({ proposed_value: 3.5 }));
    expect(res.success).toBe(true);
    expect(res.previous_value).toBe('1.0000');
    const { rows } = await db.query('SELECT growth_rate FROM forecast_modules WHERE id = $1', [valuationModuleId]);
    expect(Number(rows[0].growth_rate)).toBe(3.5);
  });

  test('writes one audit_log row per apply — nothing had ever written to that table', async () => {
    const { rows } = await db.query(
      `SELECT table_name, record_id, action, old_values, new_values
         FROM audit_log WHERE user_info = $1 ORDER BY id DESC LIMIT 1`,
      [`ai-review:${reviewId}`]
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].table_name).toBe('forecast_modules');
    expect(Number(rows[0].record_id)).toBe(valuationModuleId);
    expect(rows[0].action).toBe('ai_review_apply');
    expect(rows[0].old_values).toEqual({ growth_rate: '1.0000' });
    expect(rows[0].new_values).toEqual({ growth_rate: 3.5 });
  });

  test('⚠️ a variant sweep-band change is captured as a CR050 override, not silently reverted', async () => {
    // `updateScenario` has no variant intercept — the reconcile lives in the scenarios ROUTE, which
    // this path never touched. So the band was written to the row and then rewritten from
    // base ⊕ overrides at the next sync: accepted, stored, silently reverted.
    const { rows: r } = await db.query(
      `INSERT INTO fc_ai_reviews (scenario_id, title, status) VALUES ($1, $2, 'completed') RETURNING id`,
      [variantId, TAG + 'review-variant']
    );
    const variantReviewId = r[0].id;

    await aiReview.applyAction(variantReviewId, {
      type: 'update_scenario', scenario_id: variantId,
      field: 'cash_sweep_low', proposed_value: 175000,
    });

    const { rows } = await db.query(
      `SELECT patch FROM forecast_scenario_overrides
        WHERE scenario_id = $1 AND entity_type = 'assumption' AND entity_key = 'cash_sweep_low'`,
      [variantId]
    );
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].patch.value)).toBe(175000);

    await db.query('DELETE FROM audit_log WHERE user_info = $1', [`ai-review:${variantReviewId}`]);
  });
});

/**
 * The prompt is the contract with the model, and one line of it caused a real bad recommendation.
 * Plain assertions on a string, deliberately: this is the only place the units are stated, and a
 * revert would otherwise be silent.
 */
describe('CR081 P0a — what the system prompt tells the model', () => {
  const { DEFAULT_SYSTEM_PROMPT } = aiReview;

  test('states that growth_rate is a MULTIPLIER of inflation, with a worked figure', () => {
    // Observed on prod 2026-08-14: the model proposed `growth_rate → 4` for `Fidelity Stocks`
    // (then 1.0000) reasoning "a more realistic nominal growth rate for US equities" — it read 4
    // as 4%, where 4 means 4 × inflation ≈ 10%/yr. Nothing in the prompt had said otherwise.
    expect(DEFAULT_SYSTEM_PROMPT).toMatch(/MULTIPLIER OF INFLATION/);
    expect(DEFAULT_SYSTEM_PROMPT).toMatch(/growth_rate 4 = 10%\/yr/);
  });

  test('does NOT ask the model for current_value', () => {
    // It was never read server-side, so asking for it only invited a number to be invented and
    // then rendered to the owner as fact.
    expect(DEFAULT_SYSTEM_PROMPT).not.toMatch(/current_value/);
  });
});
