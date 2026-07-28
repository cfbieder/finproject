'use strict';
/**
 * incomeRestatement.test.js — CR057 "Book income at source".
 *
 * Two suites:
 *  - pure: the leg construction and the net-to-zero assertion, no DB.
 *  - DB-backed (skip with SKIP_DB_TESTS=1; needs dev Postgres on :5434 via
 *    DATABASE_URL): the guards, the round-trip, and the two properties the
 *    whole CR rests on — the holding's book value must not move, and undo must
 *    REFUSE once a created leg has been edited.
 *
 * Every fixture is seeded under unique names and torn down by them; never
 * TRUNCATE, and nothing touches the real United Beverages / PKO rows.
 */

const svc = require('../incomeRestatement');
const db = require('../../db');

describe('incomeRestatement — leg construction (pure)', () => {
  const source = {
    id: 42,
    amount: '690874.27',
    base_amount: '191656.32',
    currency: 'PLN',
    base_currency: 'USD',
    transaction_date: '2026-01-07',
    category_id: 73,
    description1: 'Zaliczka na dywidendę',
    account_name: 'PKO',
  };
  const holding = { id: 43, name: 'United Beverages', currency: 'PLN' };

  test('copies and negates amount AND base_amount exactly', () => {
    const { income, transfer } = svc.buildLegs(source, holding, 228);
    expect(income.amount).toBe(690874.27);
    expect(transfer.amount).toBe(-690874.27);
    expect(income.base_amount).toBe(191656.32);
    expect(transfer.base_amount).toBe(-191656.32);
    // Never re-derived from an FX table: a one-cent divergence would accrue a
    // permanent USD residual on the holding and show up in CR056's FX effect.
    expect(income.base_amount + transfer.base_amount).toBe(0);
  });

  test('both legs land on the holding, on the source date', () => {
    const { income, transfer } = svc.buildLegs(source, holding, 228);
    expect(income.account_id).toBe(43);
    expect(transfer.account_id).toBe(43);
    expect(income.transaction_date).toBe('2026-01-07');
    expect(transfer.transaction_date).toBe('2026-01-07');
  });

  test('income leg keeps the original category; transfer leg takes the transfer category', () => {
    const { income, transfer } = svc.buildLegs(source, holding, 228);
    expect(income.category_id).toBe(73);
    expect(transfer.category_id).toBe(228);
  });

  test('both legs are tagged source=restatement', () => {
    const { income, transfer } = svc.buildLegs(source, holding, 228);
    // Not only an audit tag: reconcileManual deletes prior marks by
    // (account_id, source, date), so a distinct source keeps a same-dated MTM
    // re-run from eating a restatement leg.
    expect(income.source).toBe('restatement');
    expect(transfer.source).toBe('restatement');
  });

  test('assertNetsToZero throws when the pair does not cancel', () => {
    expect(() => svc.assertNetsToZero(
      { amount: 100, base_amount: 25 },
      { amount: -99.99, base_amount: -25 },
      'x'
    )).toThrow(/do not net to zero on amount/);

    expect(() => svc.assertNetsToZero(
      { amount: 100, base_amount: 25 },
      { amount: -100, base_amount: -24.99 },
      'x'
    )).toThrow(/do not net to zero on base amount/);

    expect(() => svc.assertNetsToZero(
      { amount: 100, base_amount: 25 },
      { amount: -100, base_amount: -25 },
      'x'
    )).not.toThrow();
  });

  test('snapshotsMatch detects an edited leg', () => {
    const a = { account_id: 1, transaction_date: '2026-01-07', amount: '10.00', base_amount: '2.00', category_id: 5 };
    expect(svc.snapshotsMatch(a, { ...a })).toBe(true);
    expect(svc.snapshotsMatch(a, { ...a, amount: '10.01' })).toBe(false);
    expect(svc.snapshotsMatch(a, { ...a, category_id: 6 })).toBe(false);
    expect(svc.snapshotsMatch(a, { ...a, base_amount: null })).toBe(false);
  });
});

const dbDescribe = process.env.SKIP_DB_TESTS ? describe.skip : describe;

dbDescribe('incomeRestatement (DB)', () => {
  const CASH = 'TestBASCashAcct';
  const HOLD = 'TestBASHolding';
  const HOLD_EUR = 'TestBASHoldingEur';
  const INCOME_CAT = 'TestBASIncomeCat';
  const DATE = '2026-03-31';

  let cashId, holdId, holdEurId, incomeCatId, txId;

  async function cleanup() {
    await db.query(
      `DELETE FROM income_restatements WHERE source_transaction_id IN (
         SELECT id FROM transactions WHERE account_id IN (
           SELECT id FROM accounts WHERE name = ANY($1::text[])))`,
      [[CASH, HOLD, HOLD_EUR]]
    );
    await db.query(
      `DELETE FROM transactions WHERE account_id IN (
         SELECT id FROM accounts WHERE name = ANY($1::text[]))`,
      [[CASH, HOLD, HOLD_EUR]]
    );
    await db.query(`DELETE FROM accounts WHERE name = ANY($1::text[])`,
      [[CASH, HOLD, HOLD_EUR, INCOME_CAT]]);
  }

  async function account(name, { type, section, currency }) {
    const { rows } = await db.query(
      `INSERT INTO accounts (name, account_type, section, currency)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [name, type, section, currency]
    );
    return rows[0].id;
  }

  beforeAll(async () => {
    await cleanup();
    cashId = await account(CASH, { type: 'asset', section: 'balance_sheet', currency: 'PLN' });
    holdId = await account(HOLD, { type: 'asset', section: 'balance_sheet', currency: 'PLN' });
    holdEurId = await account(HOLD_EUR, { type: 'asset', section: 'balance_sheet', currency: 'EUR' });
    incomeCatId = await account(INCOME_CAT, { type: 'income', section: 'profit_loss', currency: 'PLN' });
  });

  beforeEach(async () => {
    await db.query(`DELETE FROM income_restatements WHERE source_transaction_id IN (
      SELECT id FROM transactions WHERE account_id = $1)`, [cashId]);
    await db.query(`DELETE FROM transactions WHERE account_id IN ($1, $2, $3)`,
      [cashId, holdId, holdEurId]);
    // The holding carries an opening position, so "book value unchanged" is a
    // real assertion rather than 0 === 0.
    await db.query(
      `INSERT INTO transactions (transaction_date, amount, currency, base_amount, base_currency, account_id, source)
       VALUES ($1, 1000000, 'PLN', 250000, 'USD', $2, 'test')`,
      [DATE, holdId]
    );
    const { rows } = await db.query(
      `INSERT INTO transactions (transaction_date, description1, amount, currency, base_amount,
                                 base_currency, account_id, category_id, source)
       VALUES ($1, 'Dywidenda', 690874.27, 'PLN', 191656.32, 'USD', $2, $3, 'test') RETURNING id`,
      [DATE, cashId, incomeCatId]
    );
    txId = Number(rows[0].id);
  });

  afterAll(async () => {
    await cleanup();
    await db.end?.();
  });

  const book = async (id) => svc.holdingBook(id);

  test('the transfer category exists with the flags the bucketing depends on', async () => {
    const cat = await svc.resolveTransferCategory();
    // If is_transfer were false, leg 2 would bucket as `income`, income would net
    // to zero, the report would still read 0.00% — and the reconciliation identity
    // would STILL close, because fxEffect is a plug. Nothing would surface it.
    expect(cat.is_transfer).toBe(true);
    expect(cat.section).toBe('profit_loss');
  });

  test('dry run writes nothing and reports the book value unchanged', async () => {
    const before = await book(holdId);
    const preview = await svc.bookAtSource(txId, holdId, { dryRun: true });
    const after = await book(holdId);

    expect(preview.dryRun).toBe(true);
    expect(preview.create).toHaveLength(2);
    expect(preview.holding_book_before).toEqual(preview.holding_book_after);
    expect(after).toEqual(before);

    const { rows } = await db.query(
      `SELECT COUNT(*)::int AS n FROM transactions WHERE source = 'restatement'
        AND account_id = $1`, [holdId]);
    expect(rows[0].n).toBe(0);
  });

  test('booking leaves the holding book value byte-identical in BOTH currencies', async () => {
    const before = await book(holdId);
    await svc.bookAtSource(txId, holdId);
    const after = await book(holdId);
    expect(after.amount).toBe(before.amount);
    expect(after.base_amount).toBe(before.base_amount);
  });

  test('booking moves the income to the holding and re-categorizes the cash row', async () => {
    const res = await svc.bookAtSource(txId, holdId);
    expect(res.created).toHaveLength(2);

    const cat = await svc.resolveTransferCategory();
    const { rows } = await db.query(
      `SELECT account_id, category_id, amount FROM transactions
        WHERE id = ANY($1::bigint[]) OR id = $2 ORDER BY amount DESC`,
      [[res.created[0].id, res.created[1].id], txId]
    );
    const incomeLeg = rows.find((r) => r.account_id === holdId && r.category_id === incomeCatId);
    const transferLeg = rows.find((r) => r.account_id === holdId && r.category_id === cat.id);
    const cashRow = rows.find((r) => r.account_id === cashId);

    expect(incomeLeg).toBeTruthy();
    expect(transferLeg).toBeTruthy();
    expect(Number(incomeLeg.amount) + Number(transferLeg.amount)).toBe(0);
    // The cash row's AMOUNT is never touched — only its category.
    expect(Number(cashRow.amount)).toBe(690874.27);
    expect(cashRow.category_id).toBe(cat.id);
  });

  test('refuses a second booking with 409, not a misleading "not income"', async () => {
    await svc.bookAtSource(txId, holdId);
    // Booking rewrites the row's category to the transfer category, so a naive
    // ordering reports "only income can be booked at source" — true but
    // misleading, and it hides the real answer.
    await expect(svc.bookAtSource(txId, holdId)).rejects.toMatchObject({
      status: 409,
      message: expect.stringMatching(/already been booked/i),
    });
  });

  test('CONVERTS a cross-currency booking instead of refusing it', async () => {
    // v3.6.2. CR057 refused this. The two legs are equal-and-opposite on the SAME
    // account, so they cancel in the holding's currency AND in USD — the rate only
    // decides what the holding-currency figure reads, and cannot move a balance.
    const preview = await svc.bookAtSource(txId, holdEurId, { dryRun: true });
    expect(preview.conversion).toMatchObject({ from_currency: 'PLN', to_currency: 'EUR' });
    expect(preview.conversion.rate).toBeGreaterThan(0);

    const [income, transfer] = preview.create;
    // Legs carry the HOLDING's currency, not the source row's.
    expect(income.currency).toBe('EUR');
    expect(transfer.currency).toBe('EUR');
    // Cancel in EUR...
    expect(income.amount + transfer.amount).toBe(0);
    // ...and in USD, where base_amount is still an exact copy/negation (invariant 1).
    expect(income.base_amount).toBe(191656.32);
    expect(transfer.base_amount).toBe(-191656.32);
    // The EUR figure is derived from USD at the date's rate, not from the PLN amount.
    expect(income.amount).toBeCloseTo(191656.32 / preview.conversion.rate, 2);
  });

  test('a cross-currency booking leaves the holding book unchanged in BOTH currencies', async () => {
    const before = await book(holdEurId);
    await svc.bookAtSource(txId, holdEurId);
    const after = await book(holdEurId);
    expect(after.amount).toBe(before.amount);
    expect(after.base_amount).toBe(before.base_amount);
  });

  test('refuses a cross-currency booking when no rate exists for the currency', async () => {
    const { rows } = await db.query(
      `INSERT INTO accounts (name, account_type, section, currency)
       VALUES ('TestBASHoldingZzz', 'asset', 'balance_sheet', 'ZZZ') RETURNING id`
    );
    try {
      // Fail loud, never divide by 1 (a silent identity conversion) or by 0 —
      // the CR051 F1 guard, same reasoning.
      await expect(svc.bookAtSource(txId, rows[0].id)).rejects.toMatchObject({
        status: 400,
        message: expect.stringMatching(/No ZZZ.*exchange rate/i),
      });
    } finally {
      await db.query(`DELETE FROM accounts WHERE name = 'TestBASHoldingZzz'`);
    }
  });

  test('refuses a non-income source row', async () => {
    const { rows } = await db.query(
      `INSERT INTO transactions (transaction_date, amount, currency, base_amount, base_currency,
                                 account_id, category_id, source)
       VALUES ($1, 10, 'PLN', 2.5, 'USD', $2, (SELECT id FROM accounts WHERE name = 'Transfer - Historical'), 'test')
       RETURNING id`, [DATE, cashId]);
    await expect(svc.bookAtSource(Number(rows[0].id), holdId)).rejects.toMatchObject({
      status: 400,
      message: expect.stringMatching(/Only income can be booked at source/i),
    });
  });

  test('refuses when the holding is the source account', async () => {
    await expect(svc.bookAtSource(txId, cashId)).rejects.toMatchObject({ status: 400 });
  });

  test('undo restores the original state exactly, leaving no residue', async () => {
    const bookBefore = await book(holdId);
    await svc.bookAtSource(txId, holdId);
    const res = await svc.undoBookAtSource(txId);

    expect(res.restored_category_id).toBe(incomeCatId);
    expect(await book(holdId)).toEqual(bookBefore);

    const { rows: legs } = await db.query(
      `SELECT COUNT(*)::int AS n FROM transactions WHERE source = 'restatement' AND account_id = $1`,
      [holdId]);
    expect(legs[0].n).toBe(0);

    const { rows: recs } = await db.query(
      `SELECT COUNT(*)::int AS n FROM income_restatements WHERE source_transaction_id = $1`, [txId]);
    expect(recs[0].n).toBe(0);

    const { rows: src } = await db.query(
      `SELECT category_id, amount FROM transactions WHERE id = $1`, [txId]);
    expect(src[0].category_id).toBe(incomeCatId);
    expect(Number(src[0].amount)).toBe(690874.27);
  });

  test('undo REFUSES once a created leg has been edited', async () => {
    const res = await svc.bookAtSource(txId, holdId);
    const legId = res.created[0].id;
    await db.query(`UPDATE transactions SET amount = amount + 1 WHERE id = $1`, [legId]);

    // Deleting an edited leg would move the holding's book value, silently
    // invalidating every `Unrealized G/L` mark written after it (each was
    // computed as `target - book`).
    await expect(svc.undoBookAtSource(txId)).rejects.toMatchObject({
      status: 409,
      message: expect.stringMatching(/has been edited/i),
    });

    const { rows } = await db.query(
      `SELECT COUNT(*)::int AS n FROM income_restatements WHERE source_transaction_id = $1`, [txId]);
    expect(rows[0].n).toBe(1); // still booked — the refusal changed nothing
  });

  test('undo on a row that was never booked is a 409, not a silent no-op', async () => {
    await expect(svc.undoBookAtSource(txId)).rejects.toMatchObject({ status: 409 });
  });
});
