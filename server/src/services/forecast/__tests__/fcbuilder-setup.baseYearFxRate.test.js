'use strict';
/**
 * CR051 — baseYearFxRate() unit tests.
 *
 * The income/expense write path derives base_value_usd = base_value / baseYearFxRate(scenario, ccy)
 * so the stored USD figure matches what the engine computes at build (both read the same FX
 * assumptions). These tests pin: USD is 1:1; a non-USD rate is the PeriodStart (base-year) value,
 * carried forward like the engine's buildRates; and a missing/zero rate for a currency in use
 * FAILS LOUD (finding F1/F2) rather than deriving a silent wrong number.
 *
 * The assumptions document is mocked, so no DB is needed.
 */

jest.mock('../../../v2/repositories/forecastAssumptions', () => ({
  getDoc: jest.fn(),
}));

const assumpRepo = require('../../../v2/repositories/forecastAssumptions');
const { baseYearFxRate } = require('../fcbuilder-setup');

/** Minimal FCAssump doc for one scenario, with the FX rows a test supplies. */
function docWith(fxRows) {
  return {
    category: ['Year', 'Inflation', 'FX - PLN', 'FX - EUR', 'Bank Accounts'],
    scenarios: [{ Name: 'S', PeriodStart: 2026, PeriodEnd: 2030 }],
    inflation: [{ Scenario: 'S', Year: 2026, Rate: 2 }],
    'Tax Rate': [{ Scenario: 'S', Rate: 20 }],
    FX: fxRows,
  };
}

beforeEach(() => jest.clearAllMocks());

test('USD is a 1:1 no-op (no doc read needed)', async () => {
  assumpRepo.getDoc.mockResolvedValue(docWith([]));
  await expect(baseYearFxRate('S', 'USD')).resolves.toBe(1);
});

test('returns the base-year (PeriodStart) PLN rate', async () => {
  assumpRepo.getDoc.mockResolvedValue(docWith([
    { Scenario: 'S', Year: 2026, Rates: { PLN: 4.1, EUR: 0.9 } },
    { Scenario: 'S', Year: 2027, Rates: { PLN: 4.5, EUR: 0.92 } },
  ]));
  await expect(baseYearFxRate('S', 'PLN')).resolves.toBeCloseTo(4.1, 6);
  await expect(baseYearFxRate('S', 'EUR')).resolves.toBeCloseTo(0.9, 6);
});

test('carries the earliest rate forward when no entry sits exactly on the base year', async () => {
  // First FX row is 2028; buildRates carries entries[0] back to PeriodStart (2026).
  assumpRepo.getDoc.mockResolvedValue(docWith([
    { Scenario: 'S', Year: 2028, Rates: { PLN: 5.0, EUR: 1.0 } },
  ]));
  await expect(baseYearFxRate('S', 'PLN')).resolves.toBeCloseTo(5.0, 6);
});

test('F1 — a zero base-year rate for a currency in use throws (no divide-by-zero downstream)', async () => {
  assumpRepo.getDoc.mockResolvedValue(docWith([
    { Scenario: 'S', Year: 2026, Rates: { PLN: 0, EUR: 0.9 } },
  ]));
  await expect(baseYearFxRate('S', 'PLN')).rejects.toThrow(/No valid base-year FX rate for PLN/);
});

test('F1 — a currency with no FX rows throws', async () => {
  assumpRepo.getDoc.mockResolvedValue(docWith([])); // no FX at all ⇒ base-year rate is 0
  await expect(baseYearFxRate('S', 'EUR')).rejects.toThrow(/No valid base-year FX rate for EUR/);
});
