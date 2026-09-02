/**
 * CR087 P0c — the preview must not write, and the apply must refuse a stale one (DB).
 *
 * `calibrate()` re-anchors `opening_balance`, shifting every historical date on
 * the account by one constant. P0c puts a preview in front of that write. Two
 * properties make the preview worth having, and both are testable:
 *
 *   1. A dry run changes NOTHING. Pass 1 found the draft's "the preview is free"
 *      claim was false — the route synced upstream and UPSERTED
 *      `bankfeed_balances` before `dryRun` was even consulted. That is fixed in
 *      the route; here we assert the service half.
 *
 *   2. An apply whose figures have moved since the preview is REFUSED. Preview
 *      and apply are two round trips and the apply path re-syncs, so a feed row
 *      landing in that window changes the number written. Approving one figure
 *      and writing another is strictly worse than no preview, because it looks
 *      verified.
 *
 * Fixtures are self-managed: one throwaway account plus one feed row, both
 * removed afterwards. It never touches a real account.
 */
const db = require('../../db');
const { reconcileToFeed } = require('../reconcileToFeed');

const TAG = '__test_p0c_preview__';
const FEED_UUID = '__test_p0c_feed_uuid__';

describe('reconcile preview (DB, CR087 P0c)', () => {
  let accountId;

  beforeAll(async () => {
    const { rows } = await db.query(
      `INSERT INTO accounts (name, account_type, section, currency, opening_balance, is_active)
       VALUES ($1, 'asset', 'balance_sheet', 'USD', 1000.00, FALSE)
       RETURNING id`,
      [TAG]
    );
    accountId = rows[0].id;
    await db.query(
      `INSERT INTO account_source_mappings (account_id, source, external_name, reconcile_mode, ignored)
       VALUES ($1, 'bank-feed', $2, 'calibrate', FALSE)`,
      [accountId, FEED_UUID]
    );
    await db.query(
      `INSERT INTO bankfeed_balances (feed_account_external_id, balance, currency, balance_date, source)
       VALUES ($1, 250.00, 'USD', DATE '2026-08-01', 'fintable')
       ON CONFLICT (feed_account_external_id, balance_date, source) DO UPDATE SET balance = EXCLUDED.balance`,
      [FEED_UUID]
    );
  });

  afterAll(async () => {
    await db.query(`DELETE FROM bankfeed_balances WHERE feed_account_external_id = $1`, [FEED_UUID]);
    await db.query(`DELETE FROM account_source_mappings WHERE external_name = $1`, [FEED_UUID]);
    if (accountId) {
      await db.query(`DELETE FROM audit_log WHERE table_name = 'accounts' AND record_id = $1`, [accountId]);
      await db.query(`DELETE FROM accounts WHERE id = $1`, [accountId]);
    }
    await db.close();
  });

  beforeEach(async () => {
    await db.query(`UPDATE accounts SET opening_balance = 1000.00 WHERE id = $1`, [accountId]);
    await db.query(`DELETE FROM audit_log WHERE table_name = 'accounts' AND record_id = $1`, [accountId]);
  });

  const openingOf = async () => {
    const { rows } = await db.query(`SELECT opening_balance FROM accounts WHERE id = $1`, [accountId]);
    return Number(rows[0].opening_balance);
  };
  const auditCount = async () => {
    const { rows } = await db.query(
      `SELECT count(*)::int AS n FROM audit_log
        WHERE table_name = 'accounts' AND record_id = $1 AND action = 'opening_balance'`,
      [accountId]
    );
    return rows[0].n;
  };

  test('a dry run returns the figures and writes NOTHING', async () => {
    const before = await openingOf();
    const res = await reconcileToFeed(accountId, { asOf: '2026-08-24', dryRun: true });

    expect(res.mode).toBe('calibrate');
    expect(res.applied).toBe(false);
    expect(res.old_opening).toBe(1000);
    expect(res.feed_balance).toBe(250);
    expect(res.feed_date).toBe('2026-08-01');
    // No transactions on this account, so new_opening is simply the expected balance.
    expect(res.new_opening).toBe(250);

    // The whole point: byte-identical afterwards, and no audit row, because a
    // preview that writes is not a preview.
    expect(await openingOf()).toBe(before);
    expect(await auditCount()).toBe(0);
  });

  test('an apply whose expectation still matches writes, and leaves ONE audit row', async () => {
    const preview = await reconcileToFeed(accountId, { asOf: '2026-08-24', dryRun: true });
    const res = await reconcileToFeed(accountId, {
      asOf: '2026-08-24',
      dryRun: false,
      expect: { new_opening: preview.new_opening, feed_date: preview.feed_date },
    });

    expect(res.applied).toBe(true);
    expect(await openingOf()).toBe(250);
    // The trigger from migration 074 records it — the two halves of CR087's P0
    // meeting: the preview shows the move, the trail records that it happened.
    expect(await auditCount()).toBe(1);
  });

  test('an apply whose new_opening has MOVED is refused, and writes nothing', async () => {
    const before = await openingOf();
    await expect(
      reconcileToFeed(accountId, {
        asOf: '2026-08-24',
        dryRun: false,
        expect: { new_opening: 999.99, feed_date: '2026-08-01' },
      })
    ).rejects.toMatchObject({ code: 'PREVIEW_STALE' });

    expect(await openingOf()).toBe(before);
    expect(await auditCount()).toBe(0);
  });

  test('an apply whose FEED OBSERVATION has moved is refused, even when the figure agrees', async () => {
    // ⚠️ Both fields matter. The same `new_opening` derived from a different
    // feed row is a coincidence, not a match — and the apply path re-syncs, so
    // a newer row arriving between preview and apply is the normal case.
    const before = await openingOf();
    await expect(
      reconcileToFeed(accountId, {
        asOf: '2026-08-24',
        dryRun: false,
        expect: { new_opening: 250, feed_date: '2026-07-01' },
      })
    ).rejects.toMatchObject({ code: 'PREVIEW_STALE' });

    expect(await openingOf()).toBe(before);
    expect(await auditCount()).toBe(0);
  });

  test('the refusal carries the CURRENT figures, so the caller can show what moved', async () => {
    let caught;
    try {
      await reconcileToFeed(accountId, {
        asOf: '2026-08-24',
        dryRun: false,
        expect: { new_opening: 111.11, feed_date: '2026-08-01' },
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeDefined();
    // Without this the UI can only say "it failed" and the owner has no way to
    // see what the server would actually have written.
    expect(caught.summary.new_opening).toBe(250);
    expect(caught.summary.expected_by_client.new_opening).toBe(111.11);
  });

  test('an apply with NO expectation still writes — expect is opt-in, not a new gate', async () => {
    // Scripts and the cron path call this without a preview; P0c must not have
    // silently made them all fail.
    const res = await reconcileToFeed(accountId, { asOf: '2026-08-24', dryRun: false });
    expect(res.applied).toBe(true);
    expect(await openingOf()).toBe(250);
  });
});

/**
 * CR087 P0c, the half that was missing — `expect` on the MTM path (DB).
 *
 * ⚠️ P0c shipped threading `expect` into `calibrate()` and NOT into `mtm()`. So
 * the mode carrying the largest figures on the page — six-figure brokerage marks
 * — had none of the protection, while the apply path re-syncs and re-ingests
 * before computing. The owner approved one number and could have written another,
 * with no 409 and nothing to say it had moved: the exact "looks verified" failure
 * P0c exists to prevent, left open on the mode most worth guarding.
 *
 * Found by the CR089 pass-1 review, 2026-09-02, in shipped code.
 */
const TAG_MTM = '__test_p0c_mtm__';
const FEED_UUID_MTM = '__test_p0c_mtm_uuid__';

describe('reconcile preview — the mtm branch (DB, CR087 P0c)', () => {
  let accountId;

  const bookedCount = async () =>
    Number((await db.query(
      `SELECT COUNT(*)::int AS n FROM transactions WHERE account_id = $1 AND source = 'mtm'`,
      [accountId]
    )).rows[0].n);

  beforeAll(async () => {
    const { rows } = await db.query(
      `INSERT INTO accounts (name, account_type, section, currency, opening_balance, is_active)
       VALUES ($1, 'asset', 'balance_sheet', 'USD', 1000.00, FALSE)
       RETURNING id`,
      [TAG_MTM]
    );
    accountId = rows[0].id;
    await db.query(
      `INSERT INTO account_source_mappings (account_id, source, external_name, reconcile_mode, ignored)
       VALUES ($1, 'bank-feed', $2, 'mtm', FALSE)`,
      [accountId, FEED_UUID_MTM]
    );
    // Synced the day AFTER the month-end it is marked against, or the staleness
    // guard fires first and we never reach the expectation check.
    await db.query(
      `INSERT INTO bankfeed_balances (feed_account_external_id, balance, currency, balance_date, source, source_synced_at)
       VALUES ($1, 1100.00, 'USD', DATE '2026-07-31', 'fintable', TIMESTAMPTZ '2026-08-01 04:00:00+00')
       ON CONFLICT (feed_account_external_id, balance_date, source)
       DO UPDATE SET balance = EXCLUDED.balance, source_synced_at = EXCLUDED.source_synced_at`,
      [FEED_UUID_MTM]
    );
  });

  afterAll(async () => {
    await db.query(`DELETE FROM transactions WHERE account_id = $1`, [accountId]);
    await db.query(`DELETE FROM bankfeed_balances WHERE feed_account_external_id = $1`, [FEED_UUID_MTM]);
    await db.query(`DELETE FROM account_source_mappings WHERE external_name = $1`, [FEED_UUID_MTM]);
    if (accountId) await db.query(`DELETE FROM accounts WHERE id = $1`, [accountId]);
  });

  test('an apply whose expectation still matches writes the entry', async () => {
    const p = await reconcileToFeed(accountId, { bookDate: '2026-07-31', dryRun: true });
    expect(p.mtm_amount).toBeCloseTo(100, 2);

    const res = await reconcileToFeed(accountId, {
      bookDate: '2026-07-31',
      dryRun: false,
      expect: { mtm_amount: p.mtm_amount, feed_balance: p.feed_balance, feed_date: p.feed_date },
    });
    expect(res.applied).toBe(true);
    expect(await bookedCount()).toBe(1);
  });

  test('an apply whose MTM AMOUNT has moved is refused, and writes nothing', async () => {
    await db.query(`DELETE FROM transactions WHERE account_id = $1 AND source = 'mtm'`, [accountId]);
    await expect(
      reconcileToFeed(accountId, {
        bookDate: '2026-07-31',
        dryRun: false,
        expect: { mtm_amount: 99999, feed_balance: 1100, feed_date: '2026-07-31' },
      })
    ).rejects.toMatchObject({ code: 'PREVIEW_STALE' });
    expect(await bookedCount()).toBe(0);
  });

  test('an apply whose FEED BALANCE moved is refused even when the amount agrees', async () => {
    // The same mark derived from a different balance is a coincidence, not a
    // match — and the apply re-ingests, so a restated row is the normal case.
    await db.query(`DELETE FROM transactions WHERE account_id = $1 AND source = 'mtm'`, [accountId]);
    await expect(
      reconcileToFeed(accountId, {
        bookDate: '2026-07-31',
        dryRun: false,
        expect: { mtm_amount: 100, feed_balance: 999.99, feed_date: '2026-07-31' },
      })
    ).rejects.toMatchObject({ code: 'PREVIEW_STALE' });
    expect(await bookedCount()).toBe(0);
  });

  test('an apply carrying NO expectation still writes — the guard is opt-in', async () => {
    // Cron and scripts pass none, and must be unaffected.
    await db.query(`DELETE FROM transactions WHERE account_id = $1 AND source = 'mtm'`, [accountId]);
    const res = await reconcileToFeed(accountId, { bookDate: '2026-07-31', dryRun: false });
    expect(res.applied).toBe(true);
    expect(await bookedCount()).toBe(1);
  });
});
