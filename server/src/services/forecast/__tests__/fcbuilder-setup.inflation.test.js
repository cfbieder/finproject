'use strict';
/**
 * CR076 D7 — a missing inflation assumption must FAIL LOUD.
 *
 * `buildRates` returns `entries[0]?.Rate ?? 0`, so an empty list yields 0% for the whole horizon.
 * Since CR072 §8 a module's growth is `growth_rate × inflation` and a yield is `inflation +
 * spread`, so that is not "a scenario with no inflation" — it stops every asset appreciating,
 * every yield paying and every stream escalating, for 36 years, with no error and a page that
 * renders perfectly.
 *
 * The FX path already fails loud on exactly this shape while moving far less of the model. The
 * four assumption documents key scenarios by NAME, so a rename is one edit away from this state.
 *
 * The assumptions document is mocked, so no DB is needed.
 */

jest.mock('../../../v2/repositories/forecastAssumptions', () => ({
  getDoc: jest.fn(),
}));

const assumpRepo = require('../../../v2/repositories/forecastAssumptions');
const { loadScenarioConfig } = require('../fcbuilder-setup');

/** Minimal FCAssump doc for one scenario, with whatever inflation rows a test supplies. */
function docWith(inflationRows) {
  return {
    category: ['Year', 'Inflation', 'FX - PLN', 'FX - EUR', 'Bank Accounts'],
    scenarios: [{ Name: 'S', PeriodStart: 2027, PeriodEnd: 2030 }],
    inflation: inflationRows,
    'Tax Rate': [{ Scenario: 'S', Rate: 20 }],
    FX: [{ Scenario: 'S', Year: 2027, Rates: { PLN: 3.9, EUR: 0.86 } }],
  };
}

beforeEach(() => jest.clearAllMocks());

test('a scenario with a real inflation row loads normally', async () => {
  assumpRepo.getDoc.mockResolvedValue(docWith([{ Scenario: 'S', Year: 2027, Rate: 2.5 }]));
  const cfg = await loadScenarioConfig('S');
  expect(cfg.inflationRates).toEqual([2.5, 2.5, 2.5, 2.5]);
});

test('NO inflation row for the scenario throws instead of flat-lining the plan', async () => {
  // The realistic shape: rows exist, but for a DIFFERENT scenario name. This is what a rename
  // produces, and it is indistinguishable from a correct document until the numbers are read.
  assumpRepo.getDoc.mockResolvedValue(docWith([{ Scenario: 'Some Other Name', Year: 2027, Rate: 2.5 }]));
  await expect(loadScenarioConfig('S')).rejects.toThrow(/no inflation assumption/i);
});

test('an empty inflation list throws', async () => {
  assumpRepo.getDoc.mockResolvedValue(docWith([]));
  await expect(loadScenarioConfig('S')).rejects.toThrow(/no inflation assumption/i);
});

test('the message names the scenario and says why it matters', async () => {
  assumpRepo.getDoc.mockResolvedValue(docWith([]));
  // A guard the owner cannot act on is only half a guard: it must name the scenario and point at
  // the screen that fixes it.
  await expect(loadScenarioConfig('S')).rejects.toThrow(/"S"/);
  await expect(loadScenarioConfig('S')).rejects.toThrow(/Forecast Settings/);
});

test('a non-numeric inflation rate throws rather than being read as 0%', async () => {
  assumpRepo.getDoc.mockResolvedValue(docWith([{ Scenario: 'S', Year: 2027, Rate: 'two point five' }]));
  await expect(loadScenarioConfig('S')).rejects.toThrow(/non-numeric inflation rate for 2027/i);
});

test('a rate of 0 is a REAL rate and is allowed through', async () => {
  // Deliberate zero inflation is a legitimate scenario to model; only ABSENCE is the defect.
  // Conflating the two would make the guard refuse a valid plan.
  assumpRepo.getDoc.mockResolvedValue(docWith([{ Scenario: 'S', Year: 2027, Rate: 0 }]));
  const cfg = await loadScenarioConfig('S');
  expect(cfg.inflationRates).toEqual([0, 0, 0, 0]);
});

/**
 * CR076 D8 — the assumption declared for the BASE year (PeriodStart − 1) must reach the engine.
 *
 * `buildRates` starts its series at PeriodStart, so a row dated PeriodStart−1 survived only as
 * the loop's seed and was overwritten on the first iteration whenever a PeriodStart row existed.
 * The frame's first column IS PeriodStart−1, so the base year read a rate the owner never
 * declared for it: `2026 Downside` declares FX 2026 = PLN 3.9 and 2027 = 4.5, and the engine
 * struck the 2026 column at 4.5.
 */
describe('CR076 D8 — base-year (PeriodStart-1) assumptions', () => {
  const docWithFx = (fxRows, inflationRows) => ({
    category: ['Year', 'Inflation', 'FX - PLN', 'FX - EUR', 'Bank Accounts'],
    scenarios: [{ Name: 'S', PeriodStart: 2027, PeriodEnd: 2030 }],
    inflation: inflationRows || [{ Scenario: 'S', Year: 2026, Rate: 2.5 }],
    'Tax Rate': [{ Scenario: 'S', Rate: 20 }],
    FX: fxRows,
  });

  test("the base year keeps ITS OWN declared rate when PeriodStart declares a different one", async () => {
    // Prod's `2026 Downside`, exactly.
    assumpRepo.getDoc.mockResolvedValue(docWithFx([
      { Scenario: 'S', Year: 2026, Rates: { PLN: 3.9, EUR: 0.86 } },
      { Scenario: 'S', Year: 2027, Rates: { PLN: 4.5, EUR: 0.9 } },
    ]));
    const cfg = await loadScenarioConfig('S');
    expect(cfg.scenario.BaseYearRates.PLN).toBe(3.9);   // was 4.5 — the bug
    expect(cfg.scenario.BaseYearRates.EUR).toBe(0.86);
    expect(cfg.fxratesPLN[0]).toBe(4.5);                // PeriodStart itself is unchanged
  });

  test('a single declared rate carries backwards, so one-row scenarios are untouched', async () => {
    // The other four prod scenarios. This is the no-change guarantee.
    assumpRepo.getDoc.mockResolvedValue(docWithFx([
      { Scenario: 'S', Year: 2026, Rates: { PLN: 3.9, EUR: 0.86 } },
    ]));
    const cfg = await loadScenarioConfig('S');
    expect(cfg.scenario.BaseYearRates.PLN).toBe(3.9);
    expect(cfg.fxratesPLN[0]).toBe(3.9);
  });

  test('a rate declared only AFTER the base year still carries backwards', async () => {
    // No 2026 row at all: the base year has nothing of its own, so it keeps the old behaviour
    // rather than inventing a rate.
    assumpRepo.getDoc.mockResolvedValue(docWithFx([
      { Scenario: 'S', Year: 2027, Rates: { PLN: 4.5, EUR: 0.9 } },
    ]));
    const cfg = await loadScenarioConfig('S');
    expect(cfg.scenario.BaseYearRates.PLN).toBe(4.5);
  });

  test('inflation gets the same treatment, closing the latent half', async () => {
    // No prod scenario has two inflation rows today, so this is currently dormant — but the
    // engine's own comment argued CR072 §8 was right BECAUSE inflation is declared for 2026,
    // and that argument dies the moment a 2027 row is added.
    assumpRepo.getDoc.mockResolvedValue(docWithFx(
      [{ Scenario: 'S', Year: 2026, Rates: { PLN: 3.9, EUR: 0.86 } }],
      [{ Scenario: 'S', Year: 2026, Rate: 2.5 }, { Scenario: 'S', Year: 2027, Rate: 4 }]
    ));
    const cfg = await loadScenarioConfig('S');
    expect(cfg.scenario.BaseYearRates.inflation).toBe(2.5);
    expect(cfg.inflationRates[0]).toBe(4);
  });
});
