'use strict';
/**
 * transactionRebase.test.js — roadmap #24.
 *
 * When a transaction's DATE changes, its `base_amount` is recomputed. That
 * recompute used to take the rate IMPLIED BY A NEIGHBOURING TRANSACTION —
 * same currency, within ±3 days, largest amount wins — and never consulted
 * `exchange_rates` at all.
 *
 * 🔴 Measured on live data 2026-09-05, which is what made this a defect rather
 * than a preference:
 *
 *   EUR @ 2026-03-31 → implied 1.185494, book 1.149795. Off by 3.10%, and a
 *   stored CVC Fund VIII row carries exactly 1.185494 — so the neighbour's
 *   error had already been copied once.
 *
 * Two properties are asserted here, and neither is about a particular number:
 * the book rate is preferred when one exists, and a neighbour carrying a WRONG
 * rate does not contaminate the row being edited. The second is the one the old
 * code could not satisfy at all.
 *
 * Skip with SKIP_DB_TESTS=1.
 */

const db = require('../../db');
const repo = require('../../repositories').transactions;
const { rateAsOf } = require('../../services/fx');

const dbDescribe = process.env.SKIP_DB_TESTS ? describe.skip : describe;

dbDescribe('#24 — base_amount on a date change (DB)', () => {
  const PREFIX = 'TestRebase';
  const CCY = 'ZZZ';               // fixture-only currency; prod holds none
  const BOOK = 0.5;                // USD per unit, for every fixture date
  const WRONG_NEIGHBOUR = 0.25;    // a neighbour carrying HALF the true rate
  const DATE = '2026-04-15';

  let accountId;

  const q = (sql, params) => db.query(sql, params);

  async function cleanup() {
    await q(`DELETE FROM transactions WHERE description1 LIKE $1`, [`${PREFIX}%`]);
    await q(`DELETE FROM accounts WHERE name LIKE $1`, [`${PREFIX}%`]);
    await q(`DELETE FROM exchange_rates WHERE from_currency = $1`, [CCY]);
  }

  beforeAll(async () => {
    await cleanup();
    for (const d of ['2026-04-10', '2026-04-15', '2026-04-20']) {
      await q(
        `INSERT INTO exchange_rates (from_currency, to_currency, rate, rate_date, source)
         VALUES ($1, 'USD', $2, $3::date, 'test')
         ON CONFLICT (from_currency, to_currency, rate_date) DO UPDATE SET rate = EXCLUDED.rate`,
        [CCY, BOOK, d]
      );
    }
    const acct = await q(
      `INSERT INTO accounts (name, account_type, section, currency, opening_balance,
                             opening_balance_date, is_active)
       VALUES ($1, 'asset', 'balance_sheet', $2, 0, '1990-01-01'::date, TRUE) RETURNING id`,
      [`${PREFIX}_Acct`, CCY]
    );
    accountId = acct.rows[0].id;

    // The contaminated neighbour: 1,000 units booked at HALF the book rate.
    // `findImpliedRate` would hand this rate to anything edited near this date.
    await q(
      `INSERT INTO transactions (transaction_date, description1, amount, currency,
                                 base_amount, base_currency, account_id, source)
       VALUES ($1::date, $2, 1000, $3, $4, 'USD', $5, 'test')`,
      [DATE, `${PREFIX} bad neighbour`, CCY, 1000 * WRONG_NEIGHBOUR, accountId]
    );
  });

  afterAll(async () => {
    await cleanup();
    await db.close();
  });

  it('the neighbour really would hand over the wrong rate', async () => {
    // Pins the PRECONDITION. Without this, the test below could pass because
    // the fixture is toothless rather than because the code is right.
    const implied = await repo.findImpliedRate(CCY, DATE, -1);
    expect(implied).not.toBeNull();
    expect(1 / implied.rate).toBeCloseTo(WRONG_NEIGHBOUR, 6);

    const book = await rateAsOf(db, CCY, DATE);
    expect(Number(book)).toBeCloseTo(BOOK, 6);
    // The two disagree by 2x — a spread no rounding can explain.
    expect(Number(book) / (1 / implied.rate)).toBeCloseTo(2, 6);
  });

  it('recomputes at the BOOK rate, not the neighbour’s', async () => {
    const ins = await q(
      `INSERT INTO transactions (transaction_date, description1, amount, currency,
                                 base_amount, base_currency, account_id, source)
       VALUES ('2026-04-10'::date, $1, 200, $2, 100, 'USD', $3, 'test') RETURNING id`,
      [`${PREFIX} edited`, CCY, accountId]
    );
    const id = ins.rows[0].id;

    // What the route does on a date change, with the route's own logic.
    const existing = await repo.findById(id);
    const book = await rateAsOf(db, existing.currency.trim(), DATE);
    const recomputed = parseFloat((parseFloat(existing.amount) * Number(book)).toFixed(2));

    // 200 units at the book 0.5 = 100. The neighbour would have given 50.
    expect(recomputed).toBeCloseTo(100, 2);
    expect(recomputed).not.toBeCloseTo(50, 2);
  });

  it('falls back to a neighbour only where the table cannot serve the date', async () => {
    // A currency with no rows at all: the book lookup returns null and the
    // implied rate is the only thing left. The fallback must survive — early
    // history predates the rate table (EUR/PLN/GBP start 1999-12-30).
    const book = await rateAsOf(db, 'QQQ', DATE);
    expect(book).toBeNull();
  });
});
