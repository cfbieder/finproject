'use strict';
/**
 * CR064 P1 — renaming a scenario must carry its assumptions with it.
 *
 * A scenario's period, inflation path, FX paths and tax rate live in the
 * `forecast_assumptions` document keyed by the scenario's NAME (CR039). Renaming the
 * row alone strands them, and the failure that follows is not the loud one it looks
 * like — generate throws once, the owner saves Forecast Settings to clear it, and
 * generate then SUCCEEDS with an empty inflation list, which `buildRates` seeds as
 * `entries[0]?.Rate ?? 0`: 0% inflation for the whole horizon, silently.
 *
 * Prod carries five orphaned names from renames that already happened (migration 052
 * prunes them). These tests pin the fix so a sixth cannot appear.
 *
 * The DB is a fake: one scenarios table and one assumptions document, routed on SQL
 * text. Enough to prove which documents were rewritten and what they now hold.
 */

jest.mock('../../db', () => ({
  query: jest.fn(),
  transaction: jest.fn(),
}));

const db = require('../../db');
const repo = require('../forecast');

/** Prod's shape, trimmed to two scenarios. */
function freshState() {
  return {
    scenarios: [
      { id: 47, name: '2026 Base' },
      { id: 60, name: '2026 Downside' },
    ],
    doc: {
      scenarios: [
        { Name: '2026 Base', Description: null, IsActive: true, id: 47, PeriodStart: 2027, PeriodEnd: 2062 },
        { Name: '2026 Downside', Description: 'Variant of 2026 Base', IsActive: true, id: 60, PeriodStart: 2027, PeriodEnd: 2062 },
      ],
      inflation: [
        { Rate: 2.5, Year: 2026, Scenario: '2026 Base' },
        { Rate: 2.5, Year: 2026, Scenario: '2026 Downside' },
      ],
      FX: [
        { Year: 2026, Rates: { EUR: 0.86, PLN: 3.9 }, Scenario: '2026 Base' },
        { Year: 2027, Rates: { EUR: 0.9, PLN: 4.5 }, Scenario: '2026 Downside' },
      ],
      'Tax Rate': [
        { Scenario: '2026 Base', Rate: 30 },
        { Scenario: '2026 Downside', Rate: 30 },
      ],
    },
  };
}

let state;

function fakeClient() {
  return {
    async query(sql, params = []) {
      if (/SELECT \* FROM forecast_scenarios WHERE id/.test(sql)) {
        return { rows: state.scenarios.filter((s) => s.id === params[0]) };
      }
      if (/SELECT id FROM forecast_scenarios WHERE name/.test(sql)) {
        return { rows: state.scenarios.filter((s) => s.name === params[0] && s.id !== params[1]) };
      }
      if (/UPDATE forecast_scenarios SET name/.test(sql)) {
        const row = state.scenarios.find((s) => s.id === params[1]);
        row.name = params[0];
        return { rows: [{ ...row }] };
      }
      if (/SELECT value FROM forecast_assumptions WHERE key/.test(sql)) {
        const value = state.doc[params[0]];
        return { rows: value === undefined ? [] : [{ value }] };
      }
      if (/UPDATE forecast_assumptions SET value/.test(sql)) {
        state.doc[params[1]] = JSON.parse(params[0]);
        return { rows: [] };
      }
      throw new Error(`unexpected SQL in test: ${sql}`);
    },
  };
}

beforeEach(() => {
  state = freshState();
  jest.clearAllMocks();
  db.transaction.mockImplementation((fn) => fn(fakeClient()));
});

describe('renameScenario', () => {
  it('renames the row AND every assumptions entry keyed to the old name', async () => {
    const updated = await repo.renameScenario(47, '2026 Base Case');

    expect(updated.name).toBe('2026 Base Case');
    expect(state.doc.scenarios.find((e) => e.id === 47).Name).toBe('2026 Base Case');
    expect(state.doc.inflation.map((e) => e.Scenario)).toEqual(['2026 Base Case', '2026 Downside']);
    expect(state.doc.FX.map((e) => e.Scenario)).toEqual(['2026 Base Case', '2026 Downside']);
    expect(state.doc['Tax Rate'].map((e) => e.Scenario)).toEqual(['2026 Base Case', '2026 Downside']);
  });

  it('leaves every other scenario untouched, values and all', async () => {
    const before = JSON.stringify(freshState().doc.FX[1]);
    await repo.renameScenario(47, '2026 Base Case');
    // The Downside FX row keeps its year, its nested Rates object and its key order.
    expect(JSON.stringify(state.doc.FX[1])).toBe(before);
  });

  it('preserves each entry\'s other fields and key order', async () => {
    await repo.renameScenario(47, '2026 Base Case');
    expect(JSON.stringify(state.doc.inflation[0])).toBe(
      JSON.stringify({ Rate: 2.5, Year: 2026, Scenario: '2026 Base Case' })
    );
    expect(JSON.stringify(state.doc.scenarios[0])).toBe(
      JSON.stringify({
        Name: '2026 Base Case', Description: null, IsActive: true,
        id: 47, PeriodStart: 2027, PeriodEnd: 2062,
      })
    );
  });

  it('is a no-op when the name has not changed', async () => {
    const before = JSON.stringify(state.doc);
    const updated = await repo.renameScenario(47, '2026 Base');
    expect(updated.name).toBe('2026 Base');
    expect(JSON.stringify(state.doc)).toBe(before);
  });

  it('trims, and refuses a blank name', async () => {
    await repo.renameScenario(47, '  2026 Trimmed  ');
    expect(state.scenarios.find((s) => s.id === 47).name).toBe('2026 Trimmed');
    await expect(repo.renameScenario(47, '   ')).rejects.toThrow(/a name is required/);
  });

  it('refuses a name another scenario already holds', async () => {
    await expect(repo.renameScenario(47, '2026 Downside')).rejects.toThrow(/already taken/);
    // and nothing moved
    expect(state.scenarios.find((s) => s.id === 47).name).toBe('2026 Base');
    expect(state.doc.inflation[0].Scenario).toBe('2026 Base');
  });

  it('returns null for a scenario that does not exist', async () => {
    await expect(repo.renameScenario(999, 'Whatever')).resolves.toBeNull();
  });

  it('survives a document key that is absent or is not an array', async () => {
    delete state.doc['Tax Rate'];
    state.doc.FX = { not: 'an array' };
    await expect(repo.renameScenario(47, '2026 Base Case')).resolves.toMatchObject({
      name: '2026 Base Case',
    });
    expect(state.doc.inflation[0].Scenario).toBe('2026 Base Case');
  });
});

describe('updateScenario', () => {
  it('refuses a name, so no caller can rename without the assumptions', async () => {
    await expect(repo.updateScenario(47, { name: 'Sneaky' })).rejects.toThrow(/renameScenario/);
    expect(db.query).not.toHaveBeenCalled();
  });

  it('still updates the fields it owns', async () => {
    db.query.mockResolvedValue({ rows: [{ id: 47, cash_sweep_low: 50000 }] });
    await expect(repo.updateScenario(47, { cash_sweep_low: 50000 })).resolves.toMatchObject({
      cash_sweep_low: 50000,
    });
  });
});
