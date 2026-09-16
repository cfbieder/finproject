'use strict';
/**
 * CR087 P1 — `resetOpeningBalance` must not be approvable on figures it did not
 * compute (DB).
 *
 * `/manual-calibration`'s **Reset** zeroes `opening_balance`, which moves every
 * balance on the account — today's included — by one constant. It had a confirm
 * dialog with figures in it, and that was the defect: the figures were computed
 * in the BROWSER while the write is computed on the server, and the apply
 * carried no expectation, so a row that moved between render and click was
 * written anyway. P0c settled the same question for the feed path; this is the
 * last instance in the page family.
 *
 * Two properties, both testable:
 *   1. A dry run changes NOTHING — no write, and no audit row from migration
 *      074's trigger.
 *   2. An apply whose figures have moved is REFUSED, with nothing written.
 *
 * Self-managed fixtures: one throwaway account, removed afterwards.
 */

const db = require('../../db');
const { resetOpeningBalance } = require('../reconcileManual');

const dbDescribe = process.env.SKIP_DB_TESTS ? describe.skip : describe;
const TAG = '__test_cr087_reset_opening__';

dbDescribe('resetOpeningBalance preview (DB, CR087 P1)', () => {
  let accountId;

  const openingOf = async () => Number((await db.query(
    `SELECT opening_balance FROM accounts WHERE id = $1`, [accountId])).rows[0].opening_balance);

  const auditRows = async () => Number((await db.query(
    `SELECT COUNT(*)::int n FROM audit_log WHERE table_name = 'accounts' AND record_id = $1`,
    [accountId])).rows[0].n);

  async function cleanup() {
    if (accountId) {
      await db.query(`DELETE FROM transactions WHERE account_id = $1`, [accountId]);
      await db.query(`DELETE FROM audit_log WHERE table_name = 'accounts' AND record_id = $1`, [accountId]);
    }
    await db.query(`DELETE FROM accounts WHERE name = $1`, [TAG]);
  }

  beforeEach(async () => {
    await cleanup();
    const { rows } = await db.query(
      `INSERT INTO accounts (name, account_type, section, currency, opening_balance,
                             opening_balance_date, manual_reconcile_mode, is_active)
       VALUES ($1, 'asset', 'balance_sheet', 'USD', 1000.00, '2020-01-01', 'calibrate', FALSE)
       RETURNING id`,
      [TAG]
    );
    accountId = rows[0].id;
    await db.query(
      `INSERT INTO transactions (transaction_date, description1, amount, currency, base_amount,
                                 base_currency, account_id)
       VALUES ('2026-03-15', $1, 250.00, 'USD', 250.00, 'USD', $2)`,
      [`${TAG} tx`, accountId]
    );
  });

  afterAll(async () => {
    await cleanup();
    await db.close();
  });

  test('the preview computes the whole move and writes nothing', async () => {
    const preview = await resetOpeningBalance(accountId, { dryRun: true });

    expect(preview.old_opening).toBe(1000);
    expect(preview.new_opening).toBe(0);
    expect(preview.sum_tx).toBe(250);
    expect(preview.computed_before).toBe(1250);
    expect(preview.computed_after).toBe(250);
    // The figure the owner actually needs: every balance drops by this.
    expect(preview.shift).toBe(-1000);
    expect(preview.applied).toBe(false);

    expect(await openingOf()).toBe(1000);
    // 🔴 And no audit row: migration 074 fires on the COLUMN, so a preview that
    // wrote would leave a trail here even if `applied` said otherwise.
    expect(await auditRows()).toBe(0);
  });

  test('an apply carrying the previewed figures writes, and is audited once', async () => {
    const preview = await resetOpeningBalance(accountId, { dryRun: true });
    const applied = await resetOpeningBalance(accountId, {
      expect: { old_opening: preview.old_opening, sum_tx: preview.sum_tx },
    });

    expect(applied.applied).toBe(true);
    expect(await openingOf()).toBe(0);
    expect(await auditRows()).toBe(1);
  });

  test('🔴 an apply whose opening balance moved since the preview is refused, and writes nothing', async () => {
    const preview = await resetOpeningBalance(accountId, { dryRun: true });
    // Someone else re-anchored it in between — a calibrate Reconcile does exactly
    // this, and the runbook has the owner clicking both on the same page.
    await db.query(`UPDATE accounts SET opening_balance = 1750.00 WHERE id = $1`, [accountId]);
    const auditsBefore = await auditRows();

    await expect(
      resetOpeningBalance(accountId, {
        expect: { old_opening: preview.old_opening, sum_tx: preview.sum_tx },
      })
    ).rejects.toMatchObject({ code: 'PREVIEW_STALE' });

    expect(await openingOf()).toBe(1750);
    expect(await auditRows()).toBe(auditsBefore);
  });

  test('🔴 a refusal carries the CURRENT figures, so the owner can approve those', async () => {
    const preview = await resetOpeningBalance(accountId, { dryRun: true });
    await db.query(`UPDATE accounts SET opening_balance = 1750.00 WHERE id = $1`, [accountId]);

    let err = null;
    try {
      await resetOpeningBalance(accountId, {
        expect: { old_opening: preview.old_opening, sum_tx: preview.sum_tx },
      });
    } catch (e) { err = e; }

    expect(err.code).toBe('PREVIEW_STALE');
    expect(err.summary.old_opening).toBe(1750);
    expect(err.summary.shift).toBe(-1750);
    expect(err.summary.expected_by_client.old_opening).toBe(1000);
  });

  test('a transaction landing between preview and apply is refused too', async () => {
    const preview = await resetOpeningBalance(accountId, { dryRun: true });
    await db.query(
      `INSERT INTO transactions (transaction_date, description1, amount, currency, base_amount,
                                 base_currency, account_id)
       VALUES ('2026-04-01', $1, 99.00, 'USD', 99.00, 'USD', $2)`,
      [`${TAG} tx2`, accountId]
    );

    // `sum_tx` decides `computed_after`, which is the figure the owner reads as
    // "what this account will show" — so it is part of what was approved.
    await expect(
      resetOpeningBalance(accountId, {
        expect: { old_opening: preview.old_opening, sum_tx: preview.sum_tx },
      })
    ).rejects.toMatchObject({ code: 'PREVIEW_STALE' });
    expect(await openingOf()).toBe(1000);
  });

  test('an apply with no expectation still writes — scripts and the API are unaffected', async () => {
    const applied = await resetOpeningBalance(accountId, {});
    expect(applied.applied).toBe(true);
    expect(await openingOf()).toBe(0);
  });
});
