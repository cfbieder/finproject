'use strict';
/**
 * reconcileAccrue.test.js — CR080 `accrue` reconcile mode.
 *
 * DB-backed (skip with SKIP_DB_TESTS=1); needs dev Postgres on :5434 via
 * DATABASE_URL. Seeds its own throwaway account + mapping + balances and cleans
 * up by unique name/uuid — never TRUNCATE.
 *
 * The suite is organised around what can LIE, not around what works:
 *
 *   - the guard must REFUSE a missing transaction (the whole safety argument —
 *     a guard that has never refused anything has not been tested);
 *   - an unsettled observation must not be markable (booking against a feed row
 *     taken before its own day ended turns fin's own transactions into "yield");
 *   - a NULL category must refuse rather than default (defaulting to Unrealized
 *     G/L is the exact defect CR080 exists to fix);
 *   - an unknown mode must not fall through to `calibrate`, which rewrites
 *     opening_balance.
 */

const {
  reconcileToFeed, ACCRUAL_SOURCE, ACCRUAL_MAX_APY,
} = require('../reconcileToFeed');
const db = require('../../db');

const dbDescribe = process.env.SKIP_DB_TESTS ? describe.skip : describe;

dbDescribe('reconcileToFeed — accrue (DB)', () => {
  const ACCT = 'TestAccrueAcct';
  const UUID = 'test-accrue-uuid';
  // Resolved by NAME, never hardcoded: the id differs per database (74 on dev,
  // 11 on a CI database built from the migration chain + ci-seed.sql), and a
  // borrowed id turns the whole suite red on the FK to accounts(id).
  let INTEREST_INCOME;
  let acctId;

  async function cleanup() {
    await db.query(`DELETE FROM transactions WHERE account_id IN (SELECT id FROM accounts WHERE name = $1)`, [ACCT]);
    await db.query(`DELETE FROM account_source_mappings WHERE external_name = $1`, [UUID]);
    await db.query(`DELETE FROM bankfeed_balances WHERE feed_account_external_id = $1`, [UUID]);
    await db.query(`DELETE FROM accounts WHERE name = $1`, [ACCT]);
  }

  async function freshAccount({ currency = 'USD', opening = 0, mode = 'accrue', categoryId = INTEREST_INCOME } = {}) {
    await cleanup();
    const a = await db.query(
      `INSERT INTO accounts (name, account_type, section, currency, opening_balance, opening_balance_date)
       VALUES ($1, 'asset', 'balance_sheet', $2, $3, '1990-01-01') RETURNING id`,
      [ACCT, currency, opening]
    );
    acctId = a.rows[0].id;
    await db.query(
      `INSERT INTO account_source_mappings
         (account_id, source, external_name, ignored, reconcile_mode, accrual_category_id)
       VALUES ($1, 'bank-feed', $2, FALSE, $3, $4)`,
      [acctId, UUID, mode, categoryId]
    );
  }

  /**
   * @param date       the date the feed LABELS this observation with
   * @param settledOn  the date the feed SYNCED it. The day the observation can
   *   speak for is LEAST(date, settledOn - 1) — see the header comment on
   *   `accrue`. Measured on the real feed, settledOn is never AFTER date.
   */
  async function seedFeed(balance, date, settledOn, currency = 'USD') {
    await db.query(
      `INSERT INTO bankfeed_balances
         (feed_account_external_id, balance, currency, balance_date, source, source_synced_at)
       VALUES ($1, $2, $3, $4, 'fintable', $5::timestamptz)
       ON CONFLICT (feed_account_external_id, balance_date, source)
       DO UPDATE SET balance = EXCLUDED.balance, source_synced_at = EXCLUDED.source_synced_at`,
      [UUID, balance, currency, date, `${settledOn} 04:00:00+00`]
    );
  }

  async function tx(date, amount, source = 'bank-feed') {
    await db.query(
      `INSERT INTO transactions (transaction_date, amount, currency, account_id, source, accepted)
       VALUES ($1, $2, 'USD', $3, $4, TRUE)`,
      [date, amount, acctId, source]
    );
  }

  beforeAll(async () => {
    const r = await db.query(`SELECT id FROM accounts WHERE name = 'Interest Income' LIMIT 1`);
    if (!r.rows[0]) {
      // Say what is missing. Left to the FK, this arrives as an opaque
      // constraint violation from freshAccount — the failure this fixed.
      throw new Error("'Interest Income' account missing — apply server/db/ci-seed.sql");
    }
    INTEREST_INCOME = r.rows[0].id;
  });

  afterAll(async () => { await cleanup(); });

  // ── The happy path, on the real shape of the problem ────────────────────────

  test('books the gap to the mapped income category, dated the observation it marked', async () => {
    await freshAccount({ opening: 10000 });
    // 30 days at ~3.6%/yr on 10,000 ≈ 29.59. Prior accrual row sets the period.
    await db.query(
      `INSERT INTO transactions (transaction_date, amount, currency, account_id, category_id, source, accepted)
       VALUES ('2026-06-01', 0.01, 'USD', $1, $2, $3, TRUE)`,
      [acctId, INTEREST_INCOME, ACCRUAL_SOURCE]);
    await seedFeed(10029.60, '2026-07-01', '2026-07-02');

    const out = await reconcileToFeed(acctId, { asOf: '2026-07-05', dryRun: false });

    expect(out.mode).toBe('accrue');
    expect(out.book_date).toBe('2026-07-01');       // LEAST(07-02 label, 07-02 sync - 1)
    expect(out.period_days).toBe(30);
    expect(out.accrual_amount).toBeCloseTo(29.59, 2);
    expect(out.implied_apy).toBeGreaterThan(0.03);
    expect(out.implied_apy).toBeLessThan(0.04);
    expect(out.implausible).toBe(false);
    expect(out.refused).toBe(false);
    expect(out.applied).toBe(true);

    const rows = (await db.query(
      `SELECT transaction_date::text AS d, amount, category_id, base_amount
         FROM transactions WHERE account_id=$1 AND source=$2 AND transaction_date='2026-07-01'`,
      [acctId, ACCRUAL_SOURCE])).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0].category_id).toBe(INTEREST_INCOME);
    // USD must carry base_amount = amount. Migration 066 exists because an inline
    // copy of the conversion rule wrote NULL here.
    expect(Number(rows[0].base_amount)).toBeCloseTo(29.59, 2);
  });

  // ── Falsification: the guard must refuse a missing transaction ──────────────

  test('REFUSES a gap that does not accrue like yield (a missing transaction)', async () => {
    await freshAccount({ opening: 10000 });
    await db.query(
      `INSERT INTO transactions (transaction_date, amount, currency, account_id, category_id, source, accepted)
       VALUES ('2026-06-01', 0.01, 'USD', $1, $2, $3, TRUE)`,
      [acctId, INTEREST_INCOME, ACCRUAL_SOURCE]);
    // The Wise-USD shape exactly: a 500 deposit fin never recorded, on a balance
    // where 500 is 5% — well INSIDE mtm's 15% implausibility threshold, which is
    // precisely why that test cannot do this job.
    await seedFeed(10529.60, '2026-07-01', '2026-07-02');

    const out = await reconcileToFeed(acctId, { asOf: '2026-07-05', dryRun: false });

    expect(out.implausible).toBe(true);
    expect(out.refused).toBe(true);
    expect(out.applied).toBe(false);
    expect(out.note).toMatch(/MISSING TRANSACTION/);
    expect(out.implied_apy).toBeGreaterThan(ACCRUAL_MAX_APY);
    const n = (await db.query(
      `SELECT COUNT(*)::int AS n FROM transactions
        WHERE account_id=$1 AND source=$2 AND transaction_date='2026-07-01'`,
      [acctId, ACCRUAL_SOURCE])).rows[0].n;
    expect(n).toBe(0); // nothing written
  });

  test('force overrides the rate guard (and only force)', async () => {
    await freshAccount({ opening: 10000 });
    await db.query(
      `INSERT INTO transactions (transaction_date, amount, currency, account_id, category_id, source, accepted)
       VALUES ('2026-06-01', 0.01, 'USD', $1, $2, $3, TRUE)`,
      [acctId, INTEREST_INCOME, ACCRUAL_SOURCE]);
    await seedFeed(10529.60, '2026-07-01', '2026-07-02');

    const out = await reconcileToFeed(acctId, { asOf: '2026-07-05', dryRun: false, force: true });
    expect(out.implausible).toBe(true);   // still REPORTED as implausible…
    expect(out.refused).toBe(false);      // …not refused…
    expect(out.applied).toBe(true);       // …and written, because force was explicit
  });

  // The PREVIEW must carry the refusal too. This is the whole point of the flag:
  // the dry run is what the confirm dialog renders, and while it came back with
  // `refused` undefined the dialog showed the figures as a proposal and offered
  // an Apply that could only ever be declined (Wise - USD, 2026-09-01).
  test('a dry run of a refused accrual reports refused (so the preview can say so)', async () => {
    await freshAccount({ opening: 10000 });
    await db.query(
      `INSERT INTO transactions (transaction_date, amount, currency, account_id, category_id, source, accepted)
       VALUES ('2026-06-01', 0.01, 'USD', $1, $2, $3, TRUE)`,
      [acctId, INTEREST_INCOME, ACCRUAL_SOURCE]);
    await seedFeed(10529.60, '2026-07-01', '2026-07-02');

    const out = await reconcileToFeed(acctId, { asOf: '2026-07-05', dryRun: true });
    expect(out.refused).toBe(true);
    expect(out.applied).toBe(false);
    expect(out.note).toMatch(/MISSING TRANSACTION/);
  });

  // ── Which day an observation may speak for (CR065 §11 / Known Issue #14) ───
  //
  // Measured across the real Wise feed, `synced_on - balance_date` is 0, -1 or -2
  // and NEVER positive: a row is labelled with its sync date or a date AHEAD of
  // it. An earlier draft of this mode required `synced_on > balance_date` to call
  // an observation usable, which no row in that feed has ever satisfied — the
  // mode would have refused every account forever. These pin the rule that
  // replaced it: bookDate = LEAST(balance_date, synced_on - 1).

  test('a row labelled with its own sync date speaks for the day BEFORE', async () => {
    await freshAccount({ opening: 10000 });
    await db.query(
      `INSERT INTO transactions (transaction_date, amount, currency, account_id, category_id, source, accepted)
       VALUES ('2026-06-01', 0.01, 'USD', $1, $2, $3, TRUE)`,
      [acctId, INTEREST_INCOME, ACCRUAL_SOURCE]);
    await tx('2026-07-01', -500); // fin recorded this on 07-01; the feed has not seen it
    await seedFeed(10029.60, '2026-07-01', '2026-07-01');

    const out = await reconcileToFeed(acctId, { asOf: '2026-07-05', dryRun: true });
    // Booking on 07-01 would compare the feed against a balance already 500 lower
    // and book +529.60 of "yield". Pairing against 06-30 is what prevents it.
    expect(out.book_date).toBe('2026-06-30');
    expect(out.computed_excl_accrual).toBeCloseTo(10000.01, 2);
    expect(out.accrual_amount).toBeCloseTo(29.59, 2);
  });

  test('a row labelled AHEAD of its sync speaks for the day before the sync', async () => {
    await freshAccount({ opening: 10000 });
    await db.query(
      `INSERT INTO transactions (transaction_date, amount, currency, account_id, category_id, source, accepted)
       VALUES ('2026-06-01', 0.01, 'USD', $1, $2, $3, TRUE)`,
      [acctId, INTEREST_INCOME, ACCRUAL_SOURCE]);
    await seedFeed(10029.60, '2026-07-03', '2026-07-02'); // labelled 2 days ahead of reality
    const out = await reconcileToFeed(acctId, { asOf: '2026-07-05', dryRun: true });
    expect(out.book_date).toBe('2026-07-01');            // NOT 07-03
  });

  test('a genuinely settled row speaks for its own labelled date, losing nothing', async () => {
    await freshAccount({ opening: 10000 });
    await db.query(
      `INSERT INTO transactions (transaction_date, amount, currency, account_id, category_id, source, accepted)
       VALUES ('2026-06-01', 0.01, 'USD', $1, $2, $3, TRUE)`,
      [acctId, INTEREST_INCOME, ACCRUAL_SOURCE]);
    await seedFeed(10029.60, '2026-07-01', '2026-07-03'); // synced AFTER 07-01 ended
    const out = await reconcileToFeed(acctId, { asOf: '2026-07-05', dryRun: true });
    expect(out.book_date).toBe('2026-07-01');            // not 07-02 — LEAST() caps it
  });

  test('picks the observation that can speak for the LATEST day', async () => {
    await freshAccount({ opening: 10000 });
    await db.query(
      `INSERT INTO transactions (transaction_date, amount, currency, account_id, category_id, source, accepted)
       VALUES ('2026-06-01', 0.01, 'USD', $1, $2, $3, TRUE)`,
      [acctId, INTEREST_INCOME, ACCRUAL_SOURCE]);
    await seedFeed(10029.60, '2026-07-01', '2026-07-02'); // speaks for 07-01
    await seedFeed(10030.00, '2026-07-03', '2026-07-03'); // speaks for 07-02 — newer
    const out = await reconcileToFeed(acctId, { asOf: '2026-07-05', dryRun: true });
    expect(out.book_date).toBe('2026-07-02');
    expect(out.feed_balance).toBeCloseTo(10030.00, 2);
  });

  test('an observation with NO sync time cannot be placed and is excluded', async () => {
    await freshAccount({ opening: 10000 });
    await db.query(
      `INSERT INTO bankfeed_balances
         (feed_account_external_id, balance, currency, balance_date, source, source_synced_at)
       VALUES ($1, 10029.60, 'USD', '2026-07-01', 'fintable', NULL)`, [UUID]);
    await expect(reconcileToFeed(acctId, { asOf: '2026-07-05', dryRun: true }))
      .rejects.toThrow(/no usable feed balance/i);
  });

  // ── Double-count guard ─────────────────────────────────────────────────────

  test('REFUSES when an accrual is already booked past the day the feed can speak for', async () => {
    await freshAccount({ opening: 10000 });
    // Exactly prod's WISE-EUR state after migration 065: an accrual dated 08-09
    // while the newest observation can only speak for 08-08. The later row sits
    // OUTSIDE the `<= bookDate` base, so booking here would recognise it twice.
    await db.query(
      `INSERT INTO transactions (transaction_date, amount, currency, account_id, category_id, source, accepted)
       VALUES ('2026-07-05', 20.00, 'USD', $1, $2, $3, TRUE)`,
      [acctId, INTEREST_INCOME, ACCRUAL_SOURCE]);
    await seedFeed(10029.60, '2026-07-03', '2026-07-03'); // speaks for 07-02 only

    await expect(reconcileToFeed(acctId, { asOf: '2026-07-10', dryRun: true }))
      .rejects.toThrow(/already has an accrual dated 2026-07-05/i);
  });

  // ── Category is required, never defaulted ──────────────────────────────────

  test('REFUSES when accrual_category_id is NULL (never defaults to Unrealized G/L)', async () => {
    await freshAccount({ opening: 10000, categoryId: null });
    await seedFeed(10029.60, '2026-07-01', '2026-07-02');
    await expect(reconcileToFeed(acctId, { asOf: '2026-07-05', dryRun: true }))
      .rejects.toThrow(/no accrual_category_id/i);
  });

  // ── Idempotency ────────────────────────────────────────────────────────────

  test('re-running supersedes the same-date row rather than duplicating it', async () => {
    await freshAccount({ opening: 10000 });
    await db.query(
      `INSERT INTO transactions (transaction_date, amount, currency, account_id, category_id, source, accepted)
       VALUES ('2026-06-01', 0.01, 'USD', $1, $2, $3, TRUE)`,
      [acctId, INTEREST_INCOME, ACCRUAL_SOURCE]);
    await seedFeed(10029.60, '2026-07-01', '2026-07-02');

    const a = await reconcileToFeed(acctId, { asOf: '2026-07-05', dryRun: false });
    const b = await reconcileToFeed(acctId, { asOf: '2026-07-05', dryRun: false });
    expect(b.accrual_amount).toBeCloseTo(a.accrual_amount, 2);

    const rows = (await db.query(
      `SELECT amount FROM transactions
        WHERE account_id=$1 AND source=$2 AND transaction_date='2026-07-01'`,
      [acctId, ACCRUAL_SOURCE])).rows;
    expect(rows).toHaveLength(1);
  });

  test('an EARLIER accrual row is part of the base, not part of the gap', async () => {
    await freshAccount({ opening: 10000 });
    // 20.00 already booked as yield on 2026-06-01. The next run must measure
    // against 10,020 — counting it again would re-book income already recognised.
    await db.query(
      `INSERT INTO transactions (transaction_date, amount, currency, account_id, category_id, source, accepted)
       VALUES ('2026-06-01', 20.00, 'USD', $1, $2, $3, TRUE)`,
      [acctId, INTEREST_INCOME, ACCRUAL_SOURCE]);
    await seedFeed(10049.59, '2026-07-01', '2026-07-02');

    const out = await reconcileToFeed(acctId, { asOf: '2026-07-05', dryRun: true });
    expect(out.computed_excl_accrual).toBeCloseTo(10020, 2);
    expect(out.accrual_amount).toBeCloseTo(29.59, 2);
  });

  // ── The fall-through that would have rewritten opening_balance ─────────────

  test('an UNKNOWN mode throws instead of silently calibrating', async () => {
    await freshAccount({ opening: 10000, mode: 'calibrate' });
    await seedFeed(12345.67, '2026-07-01', '2026-07-02');
    await db.query(
      `UPDATE account_source_mappings SET reconcile_mode = 'some-future-mode' WHERE external_name = $1`,
      [UUID]);

    await expect(reconcileToFeed(acctId, { asOf: '2026-07-05', dryRun: true }))
      .rejects.toThrow(/does not implement/i);

    // The point of the guard: opening_balance is untouched. Pre-fix, this mapping
    // reached calibrate and re-anchored the account to the feed.
    const ob = (await db.query(`SELECT opening_balance FROM accounts WHERE id=$1`, [acctId])).rows[0];
    expect(Number(ob.opening_balance)).toBeCloseTo(10000, 2);
  });

  test('calibrate and mtm are untouched by the new dispatch', async () => {
    await freshAccount({ opening: 1000, mode: 'calibrate', categoryId: null });
    await seedFeed(1500, '2026-07-01', '2026-07-02');
    const out = await reconcileToFeed(acctId, { asOf: '2026-07-05', dryRun: true });
    expect(out.mode).toBe('calibrate');
    expect(out.new_opening).toBeCloseTo(1500, 2);
  });
});
