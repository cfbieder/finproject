'use strict';
/**
 * annualClose.test.js — CR064 P2, the annual close.
 *
 * DB-backed (skip with SKIP_DB_TESTS=1). The Balance Sheet report is MOCKED so the ledger figures
 * are fixed by the test, not by whatever dev holds; everything else — the copy, the re-anchor, the
 * period move, the variant carry and its sync — runs against the real database. Seeds throwaway
 * scenarios and assumption entries, cleans up by unique name.
 */

jest.mock('../../reports', () => ({ buildBalanceSheetReport: jest.fn() }));

const reports = require('../../reports');
const annualClose = require('../annualClose');
const variants = require('../../../v2/services/forecastVariants');
const assumpRepo = require('../../../v2/repositories/forecastAssumptions');
const db = require('../../../v2/db');

const dbDescribe = process.env.SKIP_DB_TESTS ? describe.skip : describe;

const BASE = 'CR064 Close 2025 Base';
const VARIANT = 'CR064 Close 2025 Upside';
const NEW_BASE = 'CR064 Close 2026 Base';
const NEW_VARIANT = 'CR064 Close 2026 Upside';
const NAMES = [BASE, VARIANT, NEW_BASE, NEW_VARIANT];
const STOCKS = 'CR064 Close Stocks';
const HOUSE = 'CR064 Close House';

// The ledger at the OLD anchor (2024-12-31) and at the close (2025-12-31).
const LEDGER = {
  '2024-12-31': { [STOCKS]: [600, 'USD', 600], [HOUSE]: [300000, 'PLN', 75000] },
  '2025-12-31': { [STOCKS]: [700, 'USD', 700], [HOUSE]: [320000, 'PLN', 80000] },
};
reports.buildBalanceSheetReport.mockImplementation(async (date) => ({
  'Balance Sheet Accounts': [{
    name: 'Assets',
    children: Object.entries(LEDGER[date] || {}).map(([name, [total, currency, totalUSD]]) => ({ name, total, currency, totalUSD })),
  }],
}));

dbDescribe('annual close (DB)', () => {
  let baseId;
  let variantId;
  const ids = {};

  async function cleanup() {
    await db.query(
      `DELETE FROM forecast_scenarios WHERE parent_scenario_id IN (SELECT id FROM forecast_scenarios WHERE name = ANY($1))`, [NAMES]
    );
    await db.query('DELETE FROM forecast_scenarios WHERE name = ANY($1)', [NAMES]);
    await db.query('DELETE FROM accounts WHERE name = ANY($1)', [[STOCKS, HOUSE]]);
    const doc = await assumpRepo.getDoc();
    const keep = (list, field) => (Array.isArray(list) ? list.filter((e) => !e || !NAMES.includes(e[field])) : list);
    await assumpRepo.putDoc({
      scenarios: keep(doc.scenarios, 'Name'),
      inflation: keep(doc.inflation, 'Scenario'),
      FX: keep(doc.FX, 'Scenario'),
      'Tax Rate': keep(doc['Tax Rate'], 'Scenario'),
    });
  }

  beforeAll(async () => {
    await cleanup();
    const acct = async (name, currency) => (await db.query(
      `INSERT INTO accounts (name, account_type, section, currency, opening_balance)
       VALUES ($1, 'asset', 'balance_sheet', $2, 0) RETURNING id`, [name, currency]
    )).rows[0].id;
    const stocksAcct = await acct(STOCKS, 'USD');
    const houseAcct = await acct(HOUSE, 'PLN');

    baseId = (await db.query(
      `INSERT INTO forecast_scenarios (name, is_active, cash_sweep_low, cash_sweep_high)
       VALUES ($1, TRUE, 100000, 200000) RETURNING id`, [BASE]
    )).rows[0].id;
    const doc = await assumpRepo.getDoc();
    await assumpRepo.putDoc({
      scenarios: [...(doc.scenarios || []), { Name: BASE, IsActive: true, PeriodStart: 2026, PeriodEnd: 2040 }],
      inflation: [...(doc.inflation || []), { Scenario: BASE, Year: 2026, Rate: 2.5 }],
    });

    const mod = async (cols) => {
      const keys = Object.keys(cols);
      return (await db.query(
        `INSERT INTO forecast_modules (scenario_id, ${keys.join(', ')})
         VALUES ($1, ${keys.map((_, i) => `$${i + 2}`).join(', ')}) RETURNING id`,
        [baseId, ...keys.map((k) => cols[k])]
      )).rows[0].id;
    };
    // Cost basis set by hand (500 ≠ ledger 600); market value tracked the ledger (600 = 600).
    ids.stocks = await mod({ name: 'Stocks', module_type: 'Stocks', currency: 'USD', account_id: stocksAcct,
      is_matched: true, has_valuation: true, base_date: '2024-12-31',
      base_value: 500, base_value_usd: 500, market_value: 600, market_value_usd: 600 });
    // Both columns tracked the ledger.
    ids.house = await mod({ name: 'House', module_type: 'Real Estate', currency: 'PLN', account_id: houseAcct,
      is_matched: true, has_valuation: true, base_date: '2024-12-31',
      base_value: 300000, base_value_usd: 75000, market_value: 300000, market_value_usd: 75000 });
    // A planned purchase: matched to nothing, so only its date moves — WITH the period.
    ids.planned = await mod({ name: 'Planned', module_type: 'Real Estate', currency: 'USD',
      is_matched: false, has_valuation: true, base_date: '2025-12-31', base_value: 0, market_value: 0 });
    // A flow module sits at PeriodStart − 1.
    ids.flow = await mod({ name: 'Living', module_type: 'Expense', currency: 'USD',
      is_matched: false, has_valuation: false, base_date: '2025-12-31', base_value: 0, market_value: 0 });

    // A loan, so a variant can secure it — the two-id-space link that broke "2026 Buy Business".
    ids.loan = await mod({ name: 'Loan', module_type: 'Loan', currency: 'USD',
      is_matched: false, has_valuation: true, base_date: '2025-12-31', base_value: 0, market_value: 0,
      loan_interest_rate: 5 });

    const v = await variants.createVariant(baseId, { name: VARIANT });
    variantId = v.id;
    await variants.mergeEntityOverride(db, variantId, 'module', ids.stocks, { growth_rate: 9 });
    // The link names the OLD VARIANT's own House row (an id the owner picked from that variant).
    const variantHouse = (await db.query(
      'SELECT id FROM forecast_modules WHERE scenario_id = $1 AND origin_base_id = $2', [variantId, ids.house]
    )).rows[0].id;
    await variants.mergeEntityOverride(db, variantId, 'module', ids.loan, { secured_asset_module_id: variantHouse });
    // A pinned period must move with the base's, or the variant is a year short after the close.
    await variants.setAssumptionOverride(variantId, 'PeriodStart', 2027);
    await variants.syncVariant(variantId, { force: true });
  });

  afterAll(async () => {
    await cleanup();
    await db.close();
  });

  test('preview: defaults follow what each column tracked; the names and period move a year', async () => {
    const p = await annualClose.previewAnnualClose(baseId, '2025-12-31');
    expect(p.newPeriodStart).toBe(2027);
    expect(p.suggestedName).toBe(NEW_BASE);
    const by = Object.fromEntries(p.modules.map((m) => [m.name, m]));
    expect(by.Stocks).toMatchObject({ canRoll: true, rollBase: false, rollMarket: true, ledger: 700 });
    expect(by.House).toMatchObject({ canRoll: true, rollBase: true, rollMarket: true, ledger: 320000, ledgerUsd: 80000 });
    expect(by.Planned).toMatchObject({ canRoll: false, reason: expect.stringMatching(/not matched/) });
    expect(by.Living).toMatchObject({ canRoll: false, reason: expect.stringMatching(/flow/) });
    expect(p.variants).toEqual([expect.objectContaining({ name: VARIANT, newName: NEW_VARIANT, carry: true })]);
  });

  test('a variant is refused — its base closes for it', async () => {
    await expect(annualClose.previewAnnualClose(variantId, '2025-12-31')).rejects.toThrow(/base scenario/);
  });

  test('a date that has not happened is refused', async () => {
    await expect(annualClose.runAnnualClose(baseId, { newName: NEW_BASE, asOfDate: '2999-12-31' }))
      .rejects.toThrow(/has not happened/);
  });

  test('a collision on a VARIANT name rolls the whole close back — no base is left behind', async () => {
    await expect(annualClose.runAnnualClose(baseId, {
      newName: NEW_BASE, asOfDate: '2025-12-31', variantNames: { [variantId]: BASE },
    })).rejects.toThrow(/already exists/);
    const left = (await db.query('SELECT 1 FROM forecast_scenarios WHERE name = $1', [NEW_BASE])).rows;
    expect(left).toHaveLength(0);
  });

  test('apply: cost basis kept, market value rolled, period moved, variant carried', async () => {
    const r = await annualClose.runAnnualClose(baseId, {
      newName: NEW_BASE, asOfDate: '2025-12-31', rollBase: [ids.house], rollMarket: [ids.stocks, ids.house],
    });
    expect(r.periodStart).toBe(2027);
    expect(r.carried).toEqual([expect.objectContaining({ name: NEW_VARIANT })]);
    expect(r.carried[0].syncError).toBeUndefined();

    const rows = Object.fromEntries((await db.query(
      `SELECT name, base_date::text, base_value::float, base_value_usd::float, market_value::float, market_value_usd::float
         FROM forecast_modules WHERE scenario_id = $1`, [r.scenario.id]
    )).rows.map((x) => [x.name, x]));
    expect(rows.Stocks).toMatchObject({ base_date: '2025-12-31', base_value: 500, market_value: 700, market_value_usd: 700 });
    expect(rows.House).toMatchObject({ base_date: '2025-12-31', base_value: 320000, base_value_usd: 80000, market_value: 320000 });
    expect(rows.Planned.base_date).toBe('2026-12-31');
    expect(rows.Living.base_date).toBe('2026-12-31');

    const doc = await assumpRepo.getDoc();
    expect(doc.scenarios.find((e) => e.Name === NEW_BASE).PeriodStart).toBe(2027);
    expect(doc.scenarios.find((e) => e.Name === NEW_VARIANT).PeriodStart).toBe(2028); // its own pin, shifted
    expect(doc.inflation.filter((e) => e.Scenario === NEW_VARIANT)).toHaveLength(1);

    // The override moved onto the NEW base's module and the sync applied it.
    const nv = (await db.query('SELECT id, parent_scenario_id FROM forecast_scenarios WHERE name = $1', [NEW_VARIANT])).rows[0];
    expect(nv.parent_scenario_id).toBe(r.scenario.id);
    const vStocks = (await db.query(
      `SELECT growth_rate::float, market_value::float FROM forecast_modules WHERE scenario_id = $1 AND name = 'Stocks'`, [nv.id]
    )).rows[0];
    expect(vStocks).toEqual({ growth_rate: 9, market_value: 700 });

    // The loan is secured on the NEW variant's own House, not the old variant's or any base's.
    const link = (await db.query(
      `SELECT h.scenario_id, h.name FROM forecast_modules l JOIN forecast_modules h ON h.id = l.secured_asset_module_id
        WHERE l.scenario_id = $1 AND l.name = 'Loan'`, [nv.id]
    )).rows[0];
    expect(link).toEqual({ scenario_id: nv.id, name: 'House' });

    // The variant's pinned PeriodStart (2027 against the base's 2026) moved by the same year.
    const pin = (await db.query(
      `SELECT patch FROM forecast_scenario_overrides WHERE scenario_id = $1 AND entity_key = 'PeriodStart'`, [nv.id]
    )).rows[0].patch;
    expect(pin.value).toBe(2028);

    // The source is untouched.
    const src = (await db.query(`SELECT base_date::text, market_value::float FROM forecast_modules WHERE id = $1`, [ids.stocks])).rows[0];
    expect(src).toEqual({ base_date: '2024-12-31', market_value: 600 });
  });

  test('a second close onto an existing name is refused, never overwritten', async () => {
    await expect(annualClose.runAnnualClose(baseId, { newName: NEW_BASE, asOfDate: '2025-12-31' }))
      .rejects.toThrow(/already exists/);
  });

  test('anchor status: the closed base is current, and none of its modules sits behind', async () => {
    const s = (await annualClose.anchorStatus()).find((x) => x.name === NEW_BASE);
    expect(s).toMatchObject({ periodStart: 2027, actualYear: 2025, behind: 0, mixed: false });
    const old = (await annualClose.anchorStatus()).find((x) => x.name === BASE);
    expect(old).toMatchObject({ actualYear: 2024, behind: 0 });
  });

  test('renameForYear swaps the year token, or appends one', () => {
    expect(annualClose.renameForYear('2026 Upside', 2026, 2027)).toBe('2027 Upside');
    expect(annualClose.renameForYear('Upside', 2026, 2027)).toBe('Upside (2027)');
  });
});
