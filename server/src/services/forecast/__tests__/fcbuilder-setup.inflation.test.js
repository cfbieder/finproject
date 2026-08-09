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
