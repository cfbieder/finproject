'use strict';
/**
 * manualHoldings.test.js — CR097 P1a holdings register.
 *
 * DB-backed (skip with SKIP_DB_TESTS=1); needs dev Postgres on :5434 via
 * DATABASE_URL. Seeds its own USD account, its own FX currency (XTT, source
 * 'test') and its own contributions; cleans up by name — never reads ambient data.
 *
 * The worked example (rates XTT→USD: Jan-10 1.30, May-31 1.30, Jun-30 1.40):
 *   A  units  10 @ cost 1000 XTT, cost_acct default 1300
 *   B  amount      cost  500 XTT, cost_acct ENTERED 660
 *   contributions 1300 + 660 = 1960 → gap 0
 *   05-31: A @110 → 1430, B carried 500 → 650; total 2080, MTM +120
 *          (A price +130 / fx 0; B price 0 / fx −10)
 *   06-30: nothing re-priced, rate 1.40 → 1540 + 700 = 2240, MTM +160, all FX
 */

const fs = require('fs');
const path = require('path');
const svc = require('../manualHoldings');
const {
  setManualBalance, reconcileManual, resetOpeningBalance, MTM_SOURCE,
} = require('../reconcileManual');
const db = require('../../db');

const dbDescribe = process.env.SKIP_DB_TESTS ? describe.skip : describe;

dbDescribe('manualHoldings (DB)', () => {
  const ACCT = 'TestCR097RegisterAcct';
  const SEC_PREFIX = 'TestCR097 ';
  let acctId;

  async function cleanup() {
    const ids = (await db.query(`SELECT id FROM accounts WHERE name = $1`, [ACCT])).rows.map((r) => r.id);
    for (const id of ids) {
      await db.query(`DELETE FROM transactions WHERE account_id = $1`, [id]);
      await db.query(`DELETE FROM manual_balances WHERE account_id = $1`, [id]);
      await db.query(`DELETE FROM security_position_snapshots WHERE account_id = $1`, [id]);
      await db.query(`DELETE FROM manual_holdings WHERE account_id = $1`, [id]);
      await db.query(`DELETE FROM account_source_mappings WHERE account_id = $1`, [id]);
    }
    await db.query(`DELETE FROM securities WHERE name LIKE $1`, [`${SEC_PREFIX}%`]);
    await db.query(`DELETE FROM accounts WHERE name = $1`, [ACCT]);
    await db.query(`DELETE FROM exchange_rates WHERE from_currency = 'XTT' AND source = 'test'`);
    acctId = null;
  }

  async function freshAccount({ currency = 'USD', mode = 'calibrate' } = {}) {
    await cleanup();
    acctId = (await db.query(
      `INSERT INTO accounts (name, account_type, section, currency, opening_balance, manual_reconcile_mode)
       VALUES ($1, 'asset', 'balance_sheet', $2, 0, $3) RETURNING id`,
      [ACCT, currency, mode]
    )).rows[0].id;
    for (const [d, r] of [['2026-01-10', 1.30], ['2026-05-31', 1.30], ['2026-06-30', 1.40]]) {
      await db.query(
        `INSERT INTO exchange_rates (from_currency, to_currency, rate, rate_date, source)
         VALUES ('XTT', 'USD', $1, $2, 'test')`, [r, d]);
    }
  }

  async function contribute(amount, date = '2026-01-10') {
    await db.query(
      `INSERT INTO transactions (transaction_date, amount, currency, account_id, source, accepted)
       VALUES ($1, $2, 'USD', $3, 'manual', TRUE)`, [date, amount, acctId]);
  }

  /** The worked example, enabled and populated; returns { a, b } holdings. */
  async function example() {
    await freshAccount();
    await svc.enableRegister(acctId);
    const a = await svc.createHolding(acctId, {
      name: `${SEC_PREFIX}A`, currency: 'XTT', kind: 'units', quantity: 10,
      cost_local: 1000, acquired_on: '2026-01-10', platform: 'P1',
    });
    const b = await svc.createHolding(acctId, {
      name: `${SEC_PREFIX}B`, currency: 'XTT', kind: 'amount',
      cost_local: 500, cost_acct: 660, acquired_on: '2026-01-10', platform: 'P1',
    });
    await contribute(1300);
    await contribute(660);
    return { a, b };
  }

  const ledger = async (asOf) => Number((await db.query(
    `SELECT a.opening_balance + COALESCE(SUM(t.amount), 0) AS b
       FROM accounts a LEFT JOIN transactions t ON t.account_id = a.id AND t.transaction_date <= $2::date
      WHERE a.id = $1 GROUP BY a.opening_balance`, [acctId, asOf])).rows[0].b);
  const mtmRows = async () => (await db.query(
    `SELECT transaction_date::text AS d, amount FROM transactions
      WHERE account_id = $1 AND source = $2 ORDER BY transaction_date`, [acctId, MTM_SOURCE]))
    .rows.map((r) => ({ d: r.d, amount: Number(r.amount) }));
  const counts = async () => (await db.query(
    `SELECT (SELECT COUNT(*)::int FROM security_position_snapshots WHERE account_id = $1) AS snaps,
            (SELECT COUNT(*)::int FROM manual_balances WHERE account_id = $1) AS balances,
            (SELECT COUNT(*)::int FROM transactions WHERE account_id = $1 AND source = $2) AS mtm`,
    [acctId, MTM_SOURCE])).rows[0];

  afterAll(async () => { await cleanup(); await db.close(); });

  test('enable switches the account to mtm; non-USD and fed accounts are refused', async () => {
    await freshAccount({ mode: 'calibrate' });
    const out = await svc.enableRegister(acctId);
    expect(out.mode_switched).toBe(true);
    const a = (await db.query(`SELECT manual_reconcile_mode, manual_holdings_enabled FROM accounts WHERE id=$1`, [acctId])).rows[0];
    expect(a).toEqual({ manual_reconcile_mode: 'mtm', manual_holdings_enabled: true });

    await freshAccount({ currency: 'PLN' });
    await expect(svc.enableRegister(acctId)).rejects.toThrow(/USD accounts only/);

    await freshAccount();
    await db.query(
      `INSERT INTO account_source_mappings (source, external_name, account_id) VALUES ('bank-feed', 'cr097-test', $1)`,
      [acctId]);
    await expect(svc.enableRegister(acctId)).rejects.toThrow(/bank feed/);
  });

  test('while enabled, every direct balance/mark path is refused', async () => {
    await freshAccount();
    await svc.enableRegister(acctId);
    await expect(setManualBalance(acctId, { balance: 1, balanceDate: '2026-05-31' })).rejects.toThrow(/holdings register/);
    await expect(reconcileManual(acctId, { asOf: '2026-05-31' })).rejects.toThrow(/holdings register/);
    await expect(resetOpeningBalance(acctId, { dryRun: true })).rejects.toThrow(/holdings register/);
    await svc.disableRegister(acctId);
    await expect(setManualBalance(acctId, { balance: 1, balanceDate: '2026-05-31' })).resolves.toBeTruthy();
  });

  test('createHolding: default cost at the purchase rate; the security stays off ticker and quote paths', async () => {
    const { a, b } = await example();
    expect(a.cost_acct).toBeCloseTo(1300, 2);
    expect(a.cost_acct_source).toBe('fx_default');
    expect(b.cost_acct).toBeCloseTo(660, 2);
    expect(b.cost_acct_source).toBe('entered');
    const s = (await db.query(
      `SELECT ticker, price_basis, classification_source, asset_class FROM securities WHERE id = $1`, [a.security_id])).rows[0];
    expect(s).toEqual({ ticker: null, price_basis: null, classification_source: 'manual', asset_class: 'private' });
  });

  test('createHolding refuses a currency with no FX rate', async () => {
    await freshAccount();
    await svc.enableRegister(acctId);
    await expect(svc.createHolding(acctId, {
      name: `${SEC_PREFIX}Q`, currency: 'XTQ', kind: 'amount', cost_local: 1, acquired_on: '2026-01-10',
    })).rejects.toThrow(/no USD exchange rate for XTQ/);
  });

  test('preview writes nothing and explains the booked row to the cent', async () => {
    const { a } = await example();
    const before = await counts();
    const p = await svc.previewValuation(acctId, { valuedOn: '2026-05-31', items: [{ holding_id: a.id, price: 110 }] });
    expect(await counts()).toEqual(before);
    expect(p.applied).toBe(false);
    expect(p.total).toBeCloseTo(2080, 2);
    expect(p.mtm_amount).toBeCloseTo(120, 2);
    expect(p.explain.price_period).toBeCloseTo(130, 2);
    expect(p.explain.fx_period).toBeCloseTo(-10, 2);
    expect(p.explain.cost_change).toBeCloseTo(0, 2);
    expect(p.cost.gap).toBeCloseTo(0, 2);
    expect(p.blocked).toEqual([]);
  });

  test('save books on the valuation date; a re-price-free month is pure FX', async () => {
    const { a } = await example();
    const v1 = await svc.saveValuation(acctId, { valuedOn: '2026-05-31', items: [{ holding_id: a.id, price: 110 }] });
    expect(v1.applied).toBe(true);
    expect(await mtmRows()).toEqual([{ d: '2026-05-31', amount: 120 }]);
    expect(await ledger('2026-05-31')).toBeCloseTo(2080, 2);

    const v2 = await svc.saveValuation(acctId, { valuedOn: '2026-06-30', items: [] });
    expect(v2.explain.price_period).toBeCloseTo(0, 2);
    expect(v2.explain.fx_period).toBeCloseTo(160, 2);
    expect(v2.mtm_amount).toBeCloseTo(160, 2);
    expect(await ledger('2026-06-30')).toBeCloseTo(2240, 2);
    const lineA = v2.lines.find((l) => l.holding_id === a.id);
    expect(lineA.carried).toBe(true);
    expect(lineA.value_acct).toBeCloseTo(1540, 2);
    // Market value stays in the ACCOUNT currency; the holding's own beside it.
    const pos = (await db.query(
      `SELECT sp.market_value, sp.market_value_local, sp.fx_rate, sp.quantity, sp.price, sp.currency
         FROM security_positions sp JOIN security_position_snapshots s ON s.id = sp.snapshot_id
        WHERE s.account_id = $1 AND s.polled_on = '2026-06-30' AND sp.security_id = $2`,
      [acctId, a.security_id])).rows[0];
    expect(Number(pos.market_value)).toBeCloseTo(1540, 2);
    expect(Number(pos.market_value_local)).toBeCloseTo(1100, 2);
    expect(Number(pos.quantity) * Number(pos.price)).toBeCloseTo(Number(pos.market_value), 2);
    expect(pos.currency).toBe('USD');

    // The register lists each valuation with the G/L it booked, latest first.
    const reg = await svc.getRegister(acctId);
    expect(reg.valuations.map((v) => [v.valued_on, v.total, v.mtm_amount]))
      .toEqual([['2026-06-30', 2240, 160], ['2026-05-31', 2080, 120]]);

    // The Holdings index lists it as a register, with its latest valuation.
    const mine = (await svc.listRegisters()).find((r) => r.id === acctId);
    expect(mine).toMatchObject({ enabled: true, holdings: 2, last_valued_on: '2026-06-30', last_total: 2240 });
  });

  test('the Holdings index offers a non-fed USD account, and not a non-USD one', async () => {
    await freshAccount();
    expect((await svc.listRegisters()).find((r) => r.id === acctId)).toMatchObject({ enabled: false, holdings: 0 });
    await freshAccount({ currency: 'PLN' });
    expect((await svc.listRegisters()).find((r) => r.id === acctId)).toBeUndefined();
  });

  test('a top-up is a cost movement, not a price move', async () => {
    const { a } = await example();
    await svc.saveValuation(acctId, { valuedOn: '2026-05-31', items: [{ holding_id: a.id, price: 110 }] });
    // Buy 10 more at £100 (cost follows at the Jan-10 rate: 2000 × 1.30 = 2600).
    const up = await svc.updateHolding(acctId, a.id, { quantity: 20, cost_local: 2000 });
    expect(up.cost_acct).toBeCloseTo(2600, 2);
    await contribute(1300, '2026-06-15');
    const v = await svc.previewValuation(acctId, { valuedOn: '2026-06-30', items: [] });
    // Only the 10 new units bought at 100 and held at 110 gained: 10 × 10 × 1.30.
    const la = v.lines.find((l) => l.holding_id === a.id);
    expect(la.price_period).toBeCloseTo(130, 2);
    expect(v.explain.price_period).toBeCloseTo(130, 2);
    expect(v.explain.fx_period).toBeCloseTo(270, 2); // A 220 + B 50
    expect(v.explain.cost_change).toBeCloseTo(0, 2);
    expect(v.explain.other).toBeCloseTo(0, 2);
    expect(v.mtm_amount).toBeCloseTo(400, 2);
  });

  test('an exit with proceeds withdrawn books proceeds − value, and the gap stays 0', async () => {
    const { a } = await example();
    await svc.saveValuation(acctId, { valuedOn: '2026-05-31', items: [{ holding_id: a.id, price: 110 }] });
    await svc.updateHolding(acctId, a.id, { status: 'exited', proceeds_acct: 1500 });
    await contribute(-1500, '2026-06-15');
    const v = await svc.previewValuation(acctId, { valuedOn: '2026-06-30', items: [], force: true });
    const la = v.lines.find((l) => l.holding_id === a.id);
    expect(la.price_period).toBeCloseTo(70, 2); // 1500 received − 1430 last valued
    expect(la.fx_period).toBeCloseTo(0, 2);
    expect(la.unrealized).toBeCloseTo(200, 2); // 1500 − 1300 cost, frozen
    expect(v.cost.gap).toBeCloseTo(0, 2);
    expect(v.explain.cost_change).toBeCloseTo(0, 2);
    expect(v.mtm_amount).toBeCloseTo(120, 2); // 70 + B's FX 50
  });

  test('PATCH cost: an FX-default cost follows its inputs; null reverts an entered one', async () => {
    const { a, b } = await example();
    const a2 = await svc.updateHolding(acctId, a.id, { cost_local: 1100 });
    expect(a2.cost_acct).toBeCloseTo(1430, 2);
    expect(a2.cost_acct_source).toBe('fx_default');
    const b2 = await svc.updateHolding(acctId, b.id, { cost_acct: null });
    expect(b2.cost_acct).toBeCloseTo(650, 2); // 500 × 1.30
    expect(b2.cost_acct_source).toBe('fx_default');
  });

  test('a default cost needs a rate near the purchase date', async () => {
    await freshAccount();
    await svc.enableRegister(acctId);
    await expect(svc.createHolding(acctId, {
      name: `${SEC_PREFIX}Old`, currency: 'XTT', kind: 'amount', cost_local: 100, acquired_on: '2025-01-01',
    })).rejects.toThrow(/nearest XTT rate .* enter the cost/);
    const ok = await svc.createHolding(acctId, {
      name: `${SEC_PREFIX}Old`, currency: 'XTT', kind: 'amount', cost_local: 100, cost_acct: 125, acquired_on: '2025-01-01',
    });
    expect(ok.cost_acct_source).toBe('entered');
  });

  test('a valuation dated before a balance typed earlier is refused', async () => {
    await freshAccount({ mode: 'mtm' });
    await setManualBalance(acctId, { balance: 1960, balanceDate: '2026-06-30' });
    await svc.enableRegister(acctId);
    await svc.createHolding(acctId, {
      name: `${SEC_PREFIX}A`, currency: 'XTT', kind: 'amount', cost_local: 1000, acquired_on: '2026-01-10',
    });
    await expect(svc.previewValuation(acctId, { valuedOn: '2026-05-31', items: [] }))
      .rejects.toThrow(/dated 2026-06-30 already exists/);
  });

  test('negative exit proceeds are refused (they would quietly shift the cost check)', async () => {
    const { a } = await example();
    await expect(svc.updateHolding(acctId, a.id, { status: 'exited', proceeds_acct: -5 }))
      .rejects.toThrow(/proceeds_acct must be ≥ 0/);
  });

  test('re-saving the latest day replaces it; back-dated saves and non-latest deletes are refused', async () => {
    const { a } = await example();
    await svc.saveValuation(acctId, { valuedOn: '2026-05-31', items: [{ holding_id: a.id, price: 110 }] });
    await svc.saveValuation(acctId, { valuedOn: '2026-06-30', items: [] });
    await svc.saveValuation(acctId, { valuedOn: '2026-06-30', items: [{ holding_id: a.id, price: 120 }] });
    const rows = await mtmRows();
    expect(rows).toHaveLength(2);
    expect(rows[1]).toEqual({ d: '2026-06-30', amount: 300 }); // 2380 − 2080
    expect(await ledger('2026-06-30')).toBeCloseTo(2380, 2);

    await expect(svc.saveValuation(acctId, { valuedOn: '2026-05-31', items: [] })).rejects.toThrow(/dated 2026-06-30 already exists/);
    await expect(svc.deleteValuation(acctId, '2026-05-31')).rejects.toThrow(/only the latest/);

    const d = await svc.deleteValuation(acctId, '2026-06-30');
    expect(d.deleted).toEqual({ snapshots: 1, balances: 1, mtm_rows: 1 });
    expect(await ledger('2026-06-30')).toBeCloseTo(2080, 2);
  });

  test('a cost gap over the threshold blocks the save and writes nothing', async () => {
    await example();
    await svc.createHolding(acctId, {
      name: `${SEC_PREFIX}C`, currency: 'USD', kind: 'amount', cost_local: 500, acquired_on: '2026-01-10',
    }); // no matching contribution → gap 500 > max(50, 2% × 2460)
    const before = await counts();
    const p = await svc.previewValuation(acctId, { valuedOn: '2026-05-31', items: [] });
    expect(p.cost.gap).toBeCloseTo(500, 2);
    // The unmatched 500 is also a +620 mark (24%) — a preview lists every block at once.
    expect(p.blocked.map((b) => b.code)).toEqual(['COST_GAP', 'IMPLAUSIBLE']);
    await expect(svc.saveValuation(acctId, { valuedOn: '2026-05-31', items: [] }))
      .rejects.toMatchObject({ code: 'VALUATION_BLOCKED' });
    expect(await counts()).toEqual(before);
  });

  test('a stale FX rate blocks until acknowledged', async () => {
    await example();
    const p = await svc.previewValuation(acctId, { valuedOn: '2026-08-31', items: [] });
    expect(p.stale_fx).toEqual([{ currency: 'XTT', rate_date: '2026-06-30', days: 62 }]);
    expect(p.blocked.map((b) => b.code)).toEqual(['FX_STALE']);
    const ok = await svc.saveValuation(acctId, { valuedOn: '2026-08-31', items: [], ackStaleFx: true });
    expect(ok.applied).toBe(true);
  });

  test('the 15% guard blocks without force; an apply whose figures moved is PREVIEW_STALE', async () => {
    const { a } = await example();
    const big = { valuedOn: '2026-05-31', items: [{ holding_id: a.id, price: 200 }] }; // 2600 + 650 − 1960 = +1290 on 3250
    const p = await svc.previewValuation(acctId, big);
    expect(p.blocked.map((b) => b.code)).toEqual(['IMPLAUSIBLE']);
    await expect(svc.saveValuation(acctId, big)).rejects.toMatchObject({ code: 'VALUATION_BLOCKED' });
    expect((await counts()).mtm).toBe(0);

    await expect(svc.saveValuation(acctId, { ...big, force: true, expect: { mtm_amount: 1, total: p.total } }))
      .rejects.toMatchObject({ code: 'PREVIEW_STALE' });
    expect((await counts()).snaps).toBe(0);

    const ok = await svc.saveValuation(acctId, { ...big, force: true, expect: { mtm_amount: p.mtm_amount, total: p.total } });
    expect(ok.mtm_amount).toBeCloseTo(1290, 2);
  });

  test('a failed holding is worth 0 and its cumulative split freezes at −cost / 0', async () => {
    const { a, b } = await example();
    await svc.updateHolding(acctId, b.id, { status: 'failed' });
    const p = await svc.previewValuation(acctId, { valuedOn: '2026-05-31', items: [{ holding_id: a.id, price: 100 }] });
    const lb = p.lines.find((l) => l.holding_id === b.id);
    expect(lb.value_acct).toBe(0);
    expect(lb.price_cum).toBeCloseTo(-660, 2);
    expect(lb.fx_cum).toBeCloseTo(0, 2);
    expect(p.mtm_amount).toBeCloseTo(-660, 2); // 1300 + 0 − 1960
  });

  test('a valued holding cannot be deleted; a foreign holding id is refused', async () => {
    const { a } = await example();
    await svc.saveValuation(acctId, { valuedOn: '2026-05-31', items: [{ holding_id: a.id, price: 100 }] });
    await expect(svc.deleteHolding(acctId, a.id)).rejects.toThrow(/exited or failed/);
    await expect(svc.previewValuation(acctId, { valuedOn: '2026-06-30', items: [{ holding_id: -1, price: 1 }] }))
      .rejects.toThrow(/not on account/);
  });
});

describe('X-ray readers ignore register snapshots (static)', () => {
  // Register snapshots are source = 'manual'. Every X-ray query over the snapshot
  // table must filter to the feed, or a typed private holding would enter
  // exposure, risk and income as if a custodian had reported it.
  const files = ['exposure.js', 'risk.js', 'income.js', 'securityChart.js'];
  test.each(files)('%s filters every snapshot query to bank-feed', (f) => {
    const src = fs.readFileSync(path.join(__dirname, '../../../services', f), 'utf8');
    const queries = src.match(/`[^`]*security_position_snapshots[^`]*`/g) || [];
    expect(queries.length).toBeGreaterThan(0);
    for (const q of queries) expect(q).toMatch(/source\s*=\s*'bank-feed'/);
  });
});
