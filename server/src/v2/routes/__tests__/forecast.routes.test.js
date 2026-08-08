'use strict';
/**
 * forecast.routes.test.js — CR043 Phase 1.2.
 *
 * Characterization tests that pin the HTTP contract of the forecast router
 * (status codes + response envelopes) BEFORE the Phase 2.1 route→service
 * extraction, so the split can't silently change behavior. DB-backed (skip with
 * SKIP_DB_TESTS=1); self-seeding — creates a throwaway scenario, exercises the
 * real router + real dev/CI Postgres, and cleans up by unique name (never
 * relies on any pre-existing scenario, so it passes on CI's fresh DB too).
 */

const { makeApp, request } = require('./_httpApp');
const router = require('../forecast');
const db = require('../../db');
const crud = require('../../../services/forecast/crud');

const dbDescribe = process.env.SKIP_DB_TESTS ? describe.skip : describe;
const app = makeApp('/forecast', router);
const req = (m, p, b) => request(app, m, `/forecast${p}`, b);

dbDescribe('forecast router contract (DB)', () => {
  const SCENARIO = 'CR043RouteTestScenario';
  let scenarioId;
  let accountName;

  async function cleanup() {
    await db.query('DELETE FROM forecast_scenarios WHERE name = $1', [SCENARIO]);
  }

  beforeAll(async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    await cleanup();
    scenarioId = (await db.query(
      'INSERT INTO forecast_scenarios (name) VALUES ($1) RETURNING id', [SCENARIO]
    )).rows[0].id;
    accountName = (await db.query(
      `SELECT name FROM accounts
       WHERE parent_id IS NOT NULL AND name NOT IN ('Bank Accounts','Transfer - Bank','Taxes')
       ORDER BY id LIMIT 1`
    )).rows[0].name;
  });

  afterAll(async () => {
    await cleanup();
    await db.close();
  });

  describe('read envelopes', () => {
    test('GET /scenarios → 200 { data: [...] } including the seeded scenario', async () => {
      const r = await req('GET', '/scenarios');
      expect(r.status).toBe(200);
      expect(Array.isArray(r.body.data)).toBe(true);
      expect(r.body.data.some((s) => s.name === SCENARIO)).toBe(true);
    });

    test('GET /modules?scenario=<seeded> → 200 { data: [...] } (N8: enveloped)', async () => {
      const r = await req('GET', `/modules?scenario=${encodeURIComponent(SCENARIO)}`);
      expect(r.status).toBe(200);
      // Was a BARE array while its sibling GET /modules/:id returned {data}. A caller had
      // to know which, and guessing wrong fails SILENTLY — undefined.map never runs, the
      // page just renders empty. That is how the Modify Transfer modal broke. Unified in
      // CR043 N8; the frontend reads it through Rest.unwrap(), which tolerates both, so
      // the migration needed no flag day.
      expect(Array.isArray(r.body.data)).toBe(true);
      expect(Array.isArray(r.body)).toBe(false);
    });

    test('GET /modules/unmatched → 200 { data: [...] } (N8: enveloped)', async () => {
      const r = await req('GET', `/modules/unmatched?scenario=${encodeURIComponent(SCENARIO)}`);
      expect(r.status).toBe(200);
      expect(Array.isArray(r.body.data)).toBe(true);
    });

    test('GET /entries?scenario=<seeded> → 200 { entries: [] }', async () => {
      const r = await req('GET', `/entries?scenario=${encodeURIComponent(SCENARIO)}`);
      expect(r.status).toBe(200);
      expect(Array.isArray(r.body.entries)).toBe(true);
    });

    test('GET /scenarios/years/<unknown> → 200 { years: [] }', async () => {
      const r = await req('GET', '/scenarios/years/CR043NoSuchXYZ');
      expect(r.status).toBe(200);
      expect(r.body.years).toEqual([]);
    });

    // CR069 P2 — /incomeexpense is 410 Gone: an item is a module with one stream. It answers
    // rather than 404s for the one deploy in which a stale client can still call it, because
    // the engine stopped READING that table in the same deploy — a write that still succeeded
    // would be stored and silently ignored.
    test('GET /incomeexpense → 410 Gone, pointing at /modules', async () => {
      const r = await req('GET', '/incomeexpense');
      expect(r.status).toBe(410);
      expect(r.body.error).toMatch(/modules/i);
    });

    test('GET /assumptions carries ParentId, linking a variant to its base', async () => {
      const VARIANT = `${SCENARIO}Variant`;
      await db.query('DELETE FROM forecast_scenarios WHERE name = $1', [VARIANT]);
      await db.query(
        'INSERT INTO forecast_scenarios (name, parent_scenario_id) VALUES ($1, $2)',
        [VARIANT, scenarioId]
      );
      try {
        const r = await req('GET', '/assumptions');
        expect(r.status).toBe(200);
        const found = (r.body.scenarios || []).find((s) => s.Name === VARIANT);
        const parent = (r.body.scenarios || []).find((s) => s.Name === SCENARIO);
        expect(found).toBeDefined();
        // Asserting the id VALUE, not merely that the key exists: a `ParentId: null` on every row
        // would satisfy a presence check and still tell the dropdown nothing.
        expect(found.ParentId).toBe(scenarioId);
        expect(parent.ParentId).toBeNull();
      } finally {
        await db.query('DELETE FROM forecast_scenarios WHERE name = $1', [VARIANT]);
      }
    });
  });

  describe('validation & not-found', () => {
    test('POST /modules with no Scenario → 400', async () => {
      const r = await req('POST', '/modules', {});
      expect(r.status).toBe(400);
      expect(r.body.error).toMatch(/Scenario is required/);
    });

    test('POST /modules with unknown scenario → 404', async () => {
      const r = await req('POST', '/modules', { Scenario: 'CR043NoSuchXYZ' });
      expect(r.status).toBe(404);
      expect(r.body.error).toMatch(/Scenario not found/);
    });

    test('POST /scenarios/byname/:name/copy with no newScenarioName → 400', async () => {
      const r = await req('POST', `/scenarios/byname/${encodeURIComponent(SCENARIO)}/copy`, {});
      expect(r.status).toBe(400);
      expect(r.body.error).toMatch(/New scenario name is required/);
    });

    test('DELETE /scenarios/byname/<unknown> → 404', async () => {
      const r = await req('DELETE', '/scenarios/byname/CR043NoSuchXYZ');
      expect(r.status).toBe(404);
    });

    test('PUT /scenarios/<huge id> → 404', async () => {
      const r = await req('PUT', '/scenarios/999999999', { description: 'x' });
      expect(r.status).toBe(404);
    });

    test('PUT /scenarios/:id with an unknown field → 400 (CR043 N10 whitelist)', async () => {
      const r = await req('PUT', `/scenarios/${scenarioId}`, { cash_sweep_lo: 5000 });
      expect(r.status).toBe(400);
      expect(r.body.error).toMatch(/unknown field/i);
    });

    test('PUT /scenarios/:id with a non-numeric sweep value → 400', async () => {
      const r = await req('PUT', `/scenarios/${scenarioId}`, { cash_sweep_low: 'abc' });
      expect(r.status).toBe(400);
      expect(r.body.error).toMatch(/finite number/i);
    });

    test('PUT /scenarios/:id with a valid sweep band → 200 { data }', async () => {
      const r = await req('PUT', `/scenarios/${scenarioId}`, { cash_sweep_low: 5000, cash_sweep_high: 50000 });
      expect(r.status).toBe(200);
      expect(Number(r.body.data.cash_sweep_low)).toBe(5000);
    });

    test('GET /modules/<huge id> → 404', async () => {
      const r = await req('GET', '/modules/999999999');
      expect(r.status).toBe(404);
    });

    test('DELETE /modules/<non-numeric> → 400 Invalid ID', async () => {
      const r = await req('DELETE', '/modules/notanumber');
      expect(r.status).toBe(400);
      expect(r.body.error).toMatch(/Invalid ID/);
    });

    test('unknown path → 404 via the app 404 handler', async () => {
      const r = await req('GET', '/no-such-endpoint');
      expect(r.status).toBe(404);
    });
  });

  describe('module CRUD round-trip via the API', () => {
    test('POST → GET list → GET one → DELETE → GET 404', async () => {
      const create = await req('POST', '/modules', {
        Scenario: SCENARIO,
        Account: accountName,
        Name: 'CR043 Route Module',
        Type: 'asset',
        Currency: 'USD',
        BaseValue: 1000,
        MarketValue: 1000,
      });
      expect(create.status).toBe(201);
      expect(create.body.data).toBeDefined();
      const id = create.body.data.id;
      expect(id).toBeGreaterThan(0);

      const list = await req('GET', `/modules?scenario=${encodeURIComponent(SCENARIO)}`);
      expect(list.body.data.some((m) => m.id === id)).toBe(true); // {data} since N8

      const one = await req('GET', `/modules/${id}`);
      expect(one.status).toBe(200);
      expect(one.body.data.Name).toBe('CR043 Route Module');

      const del = await req('DELETE', `/modules/${id}`);
      expect(del.status).toBe(200);
      expect(del.body.success).toBe(true);

      const gone = await req('GET', `/modules/${id}`);
      expect(gone.status).toBe(404);
    });
  });

  describe('scenario copy', () => {
    const COPY = 'CR043RouteTestScenarioCopy';

    afterEach(async () => {
      await db.query('DELETE FROM forecast_scenarios WHERE name = $1', [COPY]);
    });

    test('copy carries cash_sweep_priority onto the copied modules', async () => {
      const create = await req('POST', '/modules', {
        Scenario: SCENARIO,
        Account: accountName,
        Name: 'CR043 Sweep Primary',
        Type: 'asset',
        Currency: 'USD',
        BaseValue: 1000,
        MarketValue: 1000,
      });
      const id = create.body.data.id;
      const setPri = await req('PUT', `/modules/${id}`, {
        CashSweepPriority: 1,
        // CR046 window — copied for the same reason the priority is: a column that a
        // copy silently drops is a scenario that silently computes something else.
        // CR069 P3 — the windows are stream properties; the copy must carry the streams.
        Streams: [
          { Direction: 'income', Mode: 'amount', Amount: 0, StartDate: '2030-01-01', Changes: [] },
          { Direction: 'expense', Mode: 'amount', Amount: 0, EndDate: '2040-12-31', Changes: [] },
        ],
      });
      expect(setPri.status).toBe(200);

      const copy = await req('POST', `/scenarios/byname/${encodeURIComponent(SCENARIO)}/copy`, {
        newScenarioName: COPY,
      });
      expect(copy.status).toBe(201);

      // Without the priority in the copy INSERT the module lands unranked, the
      // scenario has no primary, and the sweep silently stops funding shortfalls.
      const copied = await db.query(
        `SELECT m.id, m.cash_sweep_priority
         FROM forecast_modules m
         JOIN forecast_scenarios s ON s.id = m.scenario_id
         WHERE s.name = $1 AND m.name = $2`,
        [COPY, 'CR043 Sweep Primary']
      );
      expect(copied.rows).toHaveLength(1);
      expect(copied.rows[0].cash_sweep_priority).toBe(1);

      // CR069 P2 — the windows ride on the module's STREAMS, so the copy has to carry those
      // too. Same guard, one level deeper: a copy that drops a stream is the CR045 §1 class
      // (the copied scenario silently computes something else), which is exactly why
      // copyScenario's column list is now derived rather than hand-kept.
      const streams = await db.query(
        `SELECT direction, start_date, end_date FROM forecast_streams WHERE module_id = $1`,
        [copied.rows[0].id]
      );
      const inc = streams.rows.find((x) => x.direction === 'income');
      const exp = streams.rows.find((x) => x.direction === 'expense');
      // DATE comes back as a plain 'YYYY-MM-DD' string (the project's TZ-safe parser).
      expect(inc.start_date).toBe('2030-01-01');
      expect(exp.end_date).toBe('2040-12-31');

      await req('DELETE', `/modules/${id}`);
    });

    // CR048. A scenario's period, inflation path, FX paths and tax rate live in the
    // `forecast_assumptions` document keyed by scenario NAME — not on the scenarios table.
    // That half of the copy was done client-side by FCScenarios, so an API copy produced a
    // scenario with 0% inflation and no period, and the engine would build it anyway.
    test('copy carries the per-scenario assumptions (period, inflation, FX, tax rate)', async () => {
      const readDoc = async (key) => {
        const r = await db.query('SELECT value FROM forecast_assumptions WHERE key = $1', [key]);
        if (r.rows.length === 0) return [];
        const raw = r.rows[0].value;
        const list = typeof raw === 'string' ? JSON.parse(raw) : raw;
        return Array.isArray(list) ? list : [];
      };
      const writeDoc = async (key, list) => {
        await db.query(
          `INSERT INTO forecast_assumptions (key, value, ord) VALUES ($1, $2, 99)
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
          [key, JSON.stringify(list)]
        );
      };

      // Snapshot, seed the source scenario's assumptions, and always restore.
      const before = {};
      for (const key of ['scenarios', 'inflation', 'Tax Rate']) before[key] = await readDoc(key);

      try {
        await writeDoc('scenarios', [
          ...before.scenarios.filter((e) => e?.Name !== SCENARIO && e?.Name !== COPY),
          { Name: SCENARIO, PeriodStart: 2027, PeriodEnd: 2029, IsActive: true },
        ]);
        await writeDoc('inflation', [
          ...before.inflation.filter((e) => e?.Scenario !== SCENARIO && e?.Scenario !== COPY),
          { Scenario: SCENARIO, Year: 2027, Rate: 2.5 },
          { Scenario: SCENARIO, Year: 2028, Rate: 2.5 },
        ]);
        await writeDoc('Tax Rate', [
          ...before['Tax Rate'].filter((e) => e?.Scenario !== SCENARIO && e?.Scenario !== COPY),
          { Scenario: SCENARIO, Rate: 25 },
        ]);

        const copy = await req('POST', `/scenarios/byname/${encodeURIComponent(SCENARIO)}/copy`, {
          newScenarioName: COPY,
        });
        expect(copy.status).toBe(201);

        // Pre-fix every one of these was absent: the copy inherited no period and 0% inflation.
        const scenarios = await readDoc('scenarios');
        const period = scenarios.find((e) => e?.Name === COPY);
        expect(period).toBeDefined();
        expect(period.PeriodStart).toBe(2027);
        expect(period.PeriodEnd).toBe(2029);

        const inflation = (await readDoc('inflation')).filter((e) => e?.Scenario === COPY);
        expect(inflation).toHaveLength(2);
        expect(inflation.every((e) => e.Rate === 2.5)).toBe(true);

        const tax = (await readDoc('Tax Rate')).find((e) => e?.Scenario === COPY);
        expect(tax?.Rate).toBe(25);

        // Idempotent: copying again must replace the target's entries, not append to them.
        const again = await req('POST', `/scenarios/byname/${encodeURIComponent(SCENARIO)}/copy`, {
          newScenarioName: COPY,
        });
        expect(again.status).toBe(201);
        expect((await readDoc('inflation')).filter((e) => e?.Scenario === COPY)).toHaveLength(2);
      } finally {
        for (const key of ['scenarios', 'inflation', 'Tax Rate']) await writeDoc(key, before[key]);
      }
    });
  });

  // CR046 window vs the base year. Reported by the owner: "Rental Income shows 35,000 in the
  // 2026 BUDGET column, but I have no rental income in 2026" — the module's income starts in
  // 2028. getBaseYearValues summed income_amount blindly, so a stream whose window had not
  // opened still landed in the base-year P&L, and (via the engine's matching budget-NCF
  // query) in the cash sweep's opening cash.
  describe('the base year IS the budget (CR075)', () => {
    // REPLACES a block that seeded a MODULE and asserted the base-year figure honoured its
    // CR046 stream window. That window logic is gone: year −1 is the budget, and a budget
    // entry is DATED, so a stream that starts mid-year is already only in the months it has.
    //
    // One of the old tests would still PASS against this code — "rent starting 2028 is not
    // 2026 income" returns 0 — but vacuously, because no budget row exists rather than
    // because a window was honoured. That is the CR071 §8 lesson in miniature: a test that
    // checks a number without checking WHY is not evidence. So the module below exists
    // precisely to prove it is ignored.
    const LINE = 'CR075 Budget Line';
    let lineId, catId, modId;

    beforeAll(async () => {
      lineId = (await db.query(
        `INSERT INTO fc_lines (name, line_type) VALUES ($1, 'bs_module_income')
         ON CONFLICT (name) DO UPDATE SET line_type = EXCLUDED.line_type RETURNING id`, [LINE]
      )).rows[0].id;
      catId = (await db.query(
        `SELECT id FROM accounts WHERE section = 'profit_loss' AND parent_id IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM accounts c WHERE c.parent_id = accounts.id)
         ORDER BY id LIMIT 1`
      )).rows[0].id;
      await db.query(
        `INSERT INTO fc_line_categories (fc_line_id, category_id) VALUES ($1, $2)`, [lineId, catId]
      );
    });

    afterAll(async () => {
      if (modId) await db.query('DELETE FROM forecast_modules WHERE id = $1', [modId]);
      await db.query(`DELETE FROM budget_entries WHERE description LIKE 'CR075%'`);
      await db.query('DELETE FROM fc_line_categories WHERE fc_line_id = $1', [lineId]);
      await db.query('DELETE FROM fc_lines WHERE id = $1', [lineId]);
    });

    afterEach(async () => {
      await db.query(`DELETE FROM budget_entries WHERE description LIKE 'CR075%'`);
    });

    const budget = (year, months, perMonth) => db.query(
      `INSERT INTO budget_entries (entry_date, description, amount, currency, base_amount,
                                   category_id, budget_year)
       SELECT make_date($1, m, 1), 'CR075 row', $3, 'USD', $3, $4, $1
       FROM generate_series(1, $2) AS m`,
      [year, months, perMonth, catId]
    );

    const baseYearFor = async (y) =>
      Number((await crud.getBaseYearValues(scenarioId, y))[LINE] ?? 0);

    test('the figure is the budget total for that line and year', async () => {
      await budget(2026, 12, 1000);
      expect(await baseYearFor(2026)).toBeCloseTo(12000, 2);
    });

    test('a budget that runs only part of the year carries only those months', async () => {
      // What replaces the July-1 half-year convention. The old code halved the year a stream's
      // window opened; a budget does not need the rule because it is already dated — six
      // monthly rows are six months of money, whatever any module says.
      await budget(2026, 6, 1000);
      expect(await baseYearFor(2026)).toBeCloseTo(6000, 2);
    });

    test('another YEAR\'s budget is not this year\'s', async () => {
      await budget(2027, 12, 1000);
      expect(await baseYearFor(2026)).toBe(0);
      expect(await baseYearFor(2027)).toBeCloseTo(12000, 2);
    });

    test('a MODULE with a stream on the same line changes nothing', async () => {
      // The whole point of the change: year −1 stops being derived from module inputs. This
      // module carries an amount and a window that the old code would have read; the budget
      // is 12,000 and stays 12,000.
      await budget(2026, 12, 1000);
      const acct = (await db.query(
        `SELECT id FROM accounts WHERE parent_id IS NOT NULL ORDER BY id LIMIT 1`
      )).rows[0];
      modId = (await db.query(
        `INSERT INTO forecast_modules (has_valuation, scenario_id, account_id, name, setup_status)
         VALUES (TRUE, $1, $2, 'CR075 Ignored Module', 'complete') RETURNING id`,
        [scenarioId, acct.id]
      )).rows[0].id;
      await db.query(
        `INSERT INTO forecast_streams (module_id, direction, mode, fc_line_id, amount, start_date)
         VALUES ($1, 'income', 'amount', $2, 999999, '2026-07-01')`,
        [modId, lineId]
      );
      expect(await baseYearFor(2026)).toBeCloseTo(12000, 2);
    });

    test('no base year given ⇒ nothing at all, rather than a guess', async () => {
      await budget(2026, 12, 1000);
      expect(await baseYearFor(null)).toBe(0);
    });
  });
});
