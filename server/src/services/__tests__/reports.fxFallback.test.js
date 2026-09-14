'use strict';
/**
 * fetchAccountBalances must never value a currency at 1:1 (CR087 §8).
 *
 * With no row in exchange_rates and the Frankfurter fallback failing, the balance report
 * returned `rate: 1`, so a 1,650,000 PLN balance posted to net worth as $1,650,000. It
 * fires exactly when a new currency is added. Unit test: db and both rate sources mocked.
 * Kept in its own file so the file-wide jest.mock cannot leak into DB-backed suites.
 */

jest.mock('../../v2/db', () => ({ query: jest.fn(), close: jest.fn() }));
jest.mock('../../v2/repositories', () => ({ accounts: {} }));
jest.mock('../../utils/frankfurterExchangeRates', () => ({ getExchangeRate: jest.fn() }));
jest.mock('../../utils/refreshExchangeRates', () => ({ refreshStaleRates: jest.fn() }));

const db = require('../../v2/db');
const frankfurter = require('../../utils/frankfurterExchangeRates');
const { fetchAccountBalances } = require('../reports');

const BALANCES = [
  { account_name: 'Checking', account_currency: 'USD', closing_balance: '1000' },
  { account_name: 'Konto', account_currency: 'PLN', closing_balance: '1650000' },
];

describe('fetchAccountBalances — no silent 1:1 FX', () => {
  beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    db.query.mockImplementation(async (sql) =>
      (sql.includes('exchange_rates') ? { rows: [] } : { rows: BALANCES })
    );
  });

  afterEach(() => jest.restoreAllMocks());

  test('throws, naming the currency, when the API fallback fails', async () => {
    frankfurter.getExchangeRate.mockRejectedValue(new Error('network down'));
    await expect(fetchAccountBalances('2026-06-30')).rejects.toThrow(/PLN.*refusing to value it at 1:1/);
  });

  test('throws when the API returns no usable rate', async () => {
    frankfurter.getExchangeRate.mockResolvedValue(null);
    await expect(fetchAccountBalances('2026-06-30')).rejects.toThrow(/PLN/);
  });

  test('uses the API rate when it has one', async () => {
    frankfurter.getExchangeRate.mockResolvedValue(4);
    const balances = await fetchAccountBalances('2026-06-30');
    expect(balances.Konto).toEqual(['PLN', 1650000, 4, 412500]);
  });
});
