'use strict';
/**
 * aiReviewCompare.test.js — CR040 P3 compare extension of the AI Review service.
 *
 * DB-backed (skip with SKIP_DB_TESTS=1); needs dev Postgres via DATABASE_URL.
 * Seeds two throwaway scenarios with divergent forecast_entries and cleans up
 * by unique name — never TRUNCATE. The LLM gateway is stubbed via global.fetch
 * so no network call leaves the test.
 */

const aiReview = require('../aiReview');
const db = require('../../db');

const dbDescribe = process.env.SKIP_DB_TESTS ? describe.skip : describe;

dbDescribe('aiReview compare (DB)', () => {
  const NAME_A = 'CR040TestCompareBaseline';
  const NAME_B = 'CR040TestCompareVariant';
  let idA, idB;
  let realFetch;

  async function cleanup() {
    // fc_ai_reviews + forecast_entries cascade from scenario deletion
    await db.query('DELETE FROM forecast_scenarios WHERE name = ANY($1::text[])', [[NAME_A, NAME_B]]);
  }

  beforeAll(async () => {
    realFetch = global.fetch;
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({ response: 'stubbed compare narrative' }),
    }));

    await cleanup();
    idA = (await db.query(
      'INSERT INTO forecast_scenarios (name) VALUES ($1) RETURNING id', [NAME_A]
    )).rows[0].id;
    idB = (await db.query(
      'INSERT INTO forecast_scenarios (name) VALUES ($1) RETURNING id', [NAME_B]
    )).rows[0].id;

    // A: Salary 100/yr for 2030-2031. B: Salary 150/yr — cumulative Δ = +100.
    // Plus a sweep-tagged row on B that the divergence table must ignore.
    const ins = (sid, year, account, amount, module = null) =>
      db.query(
        'INSERT INTO forecast_entries (scenario_id, forecast_year, account, amount, module) VALUES ($1,$2,$3,$4,$5)',
        [sid, year, account, amount, module]
      );
    await ins(idA, 2030, 'Salary', 100);
    await ins(idA, 2031, 'Salary', 100);
    await ins(idB, 2030, 'Salary', 150);
    await ins(idB, 2031, 'Salary', 150);
    await ins(idB, 2031, 'Transfer - Bank', -9999, '_cash_sweep');
  });

  afterAll(async () => {
    global.fetch = realFetch;
    await cleanup();
    await db.close();
  });

  describe('buildCompareContext', () => {
    it('contains both scenario sections and the B − A divergence table', async () => {
      const { context, scenarioA, scenarioB } = await aiReview.buildCompareContext(NAME_A, NAME_B);
      expect(scenarioA.id).toBe(idA);
      expect(scenarioB.id).toBe(idB);
      expect(context).toContain(`# BASELINE SCENARIO A: ${NAME_A}`);
      expect(context).toContain(`# COMPARISON SCENARIO B: ${NAME_B}`);
      // Salary: A 200 | B 300 | delta 100
      expect(context).toMatch(/Salary: 200 \| 300 \| 100/);
      // Sweep-tagged rows are excluded from the divergence table
      expect(context).not.toMatch(/Transfer - Bank: .*9,999/);
    });

    it('throws for an unknown scenario', async () => {
      await expect(aiReview.buildCompareContext(NAME_A, 'CR040NoSuchScenario'))
        .rejects.toThrow(/not found/);
    });
  });

  describe('createReview with compareWith', () => {
    it('persists compare_scenario_id and a pair title; worker completes via stub gateway', async () => {
      const { review } = await aiReview.createReview(NAME_A, NAME_B);
      expect(review.scenario_id).toBe(idA);
      expect(review.compare_scenario_id).toBe(idB);
      expect(review.title).toBe(`Compare: ${NAME_A} vs ${NAME_B}`);
      expect(review.status).toBe('pending');

      // Background worker with stubbed fetch should complete quickly
      let status;
      for (let i = 0; i < 40; i++) {
        status = await aiReview.getReviewStatus(review.id);
        if (status.status !== 'pending') break;
        await new Promise((r) => setTimeout(r, 250));
      }
      expect(status.status).toBe('completed');

      const messages = await db.query(
        'SELECT role, content FROM fc_ai_messages WHERE review_id = $1 ORDER BY created_at',
        [review.id]
      );
      expect(messages.rows[0].role).toBe('user');
      expect(messages.rows.at(-1)).toEqual(
        expect.objectContaining({ role: 'assistant', content: 'stubbed compare narrative' })
      );

      // The compare system prompt (no action blocks) went to the gateway
      const gatewayBody = JSON.parse(global.fetch.mock.calls.at(-1)[1].body);
      expect(gatewayBody.system).toBe(aiReview.COMPARE_SYSTEM_PROMPT);
      expect(gatewayBody.prompt).toContain('# SCENARIO COMPARISON DATA');
    });

    it('rejects comparing a scenario to itself and unknown compare targets', async () => {
      await expect(aiReview.createReview(NAME_A, NAME_A)).rejects.toThrow(/must differ/);
      await expect(aiReview.createReview(NAME_A, 'CR040NoSuchScenario')).rejects.toThrow(/not found/);
    });

    it('single-scenario createReview still leaves compare_scenario_id NULL', async () => {
      const { review } = await aiReview.createReview(NAME_A);
      expect(review.compare_scenario_id).toBeNull();
      expect(review.title).toBe(`Review of ${NAME_A}`);
      // Let its worker finish so afterAll teardown doesn't race the pool close
      for (let i = 0; i < 40; i++) {
        const s = await aiReview.getReviewStatus(review.id);
        if (s.status !== 'pending') break;
        await new Promise((r) => setTimeout(r, 250));
      }
    });
  });
});
