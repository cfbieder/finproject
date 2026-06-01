/**
 * Quicken Promote + Rollback Tests (Phase E vertical slice)
 *
 * Runs against the dev Postgres on localhost:5434 (matching the existing
 * convention in parser tests). Creates sentinel COA accounts (prefixed
 * `_qpr_test_`) for the duration of the test suite, tears them down at the
 * end.
 *
 * Scope: cash-only promote (§6.4 steps 0, 2, 4, 8, 9, 10) + rollback.
 * Investment-side promote is deferred to a later sub-phase.
 */

const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { Pool } = require('pg');

const { runParse } = require('../quicken-import');
const { runPromote, runRollback, resolveTransferCategoryId, findRoleInvalidMappings } = require('../quicken-promote');

const TEST_DB_URL = 'postgres://fin:findev123@localhost:5434/fin';
const FIXTURES_DIR = path.resolve(__dirname, '../../../../../Samples/quicken/fixtures');
const SENTINEL_PREFIX = '_qpr_test_';

// Skip the whole suite if dev DB isn't available
const dbDescribe = process.env.SKIP_DB_TESTS ? describe.skip : describe;

dbDescribe('runPromote + runRollback (cash-only, DB-backed)', () => {
  let pool;
  let batchId;
  let testCoaIds; // map of sentinel name → accounts.id

  beforeAll(async () => {
    pool = new Pool({ connectionString: TEST_DB_URL });

    // Clean any leftover sentinels from prior failed runs
    await pool.query(
      `DELETE FROM accounts WHERE name LIKE $1`,
      [`${SENTINEL_PREFIX}%`]
    );

    // Create sentinel COA accounts
    const sentinels = [
      { name: `${SENTINEL_PREFIX}cash_origin`,    section: 'balance_sheet', account_type: 'asset' },
      { name: `${SENTINEL_PREFIX}mortgage_target`, section: 'balance_sheet', account_type: 'liability' },
      { name: `${SENTINEL_PREFIX}bank_fees`,      section: 'profit_loss',   account_type: 'expense' },
      { name: `${SENTINEL_PREFIX}int_inc`,        section: 'profit_loss',   account_type: 'income' },
      { name: `${SENTINEL_PREFIX}int_exp`,        section: 'profit_loss',   account_type: 'expense' },
      { name: `${SENTINEL_PREFIX}deposit`,        section: 'profit_loss',   account_type: 'income' },
    ];
    testCoaIds = {};
    for (const a of sentinels) {
      const { rows } = await pool.query(
        `INSERT INTO accounts (name, section, account_type, currency, is_active, opening_balance)
           VALUES ($1, $2, $3, 'USD', TRUE, 0) RETURNING id`,
        [a.name, a.section, a.account_type]
      );
      testCoaIds[a.name] = rows[0].id;
    }
  });

  beforeEach(async () => {
    batchId = randomUUID();

    // Parse cash_isolated.QIF into this batch (USD to bypass FX path). This
    // fixture uses `_qpr `-namespaced category/transfer names (and a distinct
    // account name) so the mappings authored below never collide with real
    // global `quicken` mappings on the shared dev DB — the suite's cleanup used
    // to clobber same-named real mappings (e.g. "Bank Fees", "Int Inc").
    await runParse({
      files: [{ path: path.join(FIXTURES_DIR, 'cash_isolated.QIF'), currency: 'USD' }],
      batchId,
      pool,
    });

    // Author mappings (Phase 2 work that the admin UI will eventually do)
    const mappingPairs = [
      ['cash_isolated',     testCoaIds[`${SENTINEL_PREFIX}cash_origin`]],
      ['_qpr Mortgage',     testCoaIds[`${SENTINEL_PREFIX}mortgage_target`]],
      ['_qpr Bank Fees',    testCoaIds[`${SENTINEL_PREFIX}bank_fees`]],
      ['_qpr Int Inc',      testCoaIds[`${SENTINEL_PREFIX}int_inc`]],
      ['_qpr Int Exp',      testCoaIds[`${SENTINEL_PREFIX}int_exp`]],
      ['_qpr Deposit',      testCoaIds[`${SENTINEL_PREFIX}deposit`]],
    ];
    for (const [name, accountId] of mappingPairs) {
      await pool.query(
        `INSERT INTO account_source_mappings (account_id, source, external_name)
           VALUES ($1, 'quicken', $2)
         ON CONFLICT (source, external_name) DO UPDATE SET account_id = EXCLUDED.account_id`,
        [accountId, name]
      );
    }
  });

  afterEach(async () => {
    // Clean batch artifacts
    await pool.query(
      `DELETE FROM transfer_match_group_members
         WHERE group_id IN (SELECT id FROM transfer_match_groups WHERE import_batch_id = $1)`,
      [batchId]
    );
    await pool.query(`DELETE FROM transfer_match_groups WHERE import_batch_id = $1`, [batchId]);
    await pool.query(`DELETE FROM transactions WHERE import_batch_id = $1`, [batchId]);
    await pool.query(`DELETE FROM quicken_calibration_audit WHERE import_batch_id = $1`, [batchId]);
    await pool.query(`DELETE FROM quicken_staging WHERE import_batch_id = $1`, [batchId]);
    await pool.query(`DELETE FROM quicken_import_batches WHERE id = $1`, [batchId]);
    await pool.query(
      `DELETE FROM account_source_mappings WHERE source = 'quicken' AND external_name = ANY($1::text[])`,
      [['cash_isolated', '_qpr Mortgage', '_qpr Bank Fees', '_qpr Int Inc', '_qpr Int Exp', '_qpr Deposit']]
    );
    // Reset opening_balance on sentinels so each test starts from zero
    await pool.query(
      `UPDATE accounts SET opening_balance = 0 WHERE id = ANY($1::int[])`,
      [Object.values(testCoaIds)]
    );
  });

  afterAll(async () => {
    // Clean up sentinel accounts + any transfer leaves the resolver auto-created
    await pool.query(`DELETE FROM accounts WHERE name LIKE $1`, [`${SENTINEL_PREFIX}%`]);
    await pool.end();
  });

  // ────────────────────────────────────────────────────────────────────────
  // Promote tests
  // ────────────────────────────────────────────────────────────────────────

  test('inserts the right number of rows from cash_isolated.QIF (1→1 model)', async () => {
    const result = await runPromote({ batchId, pool });
    // Fixture breakdown under 1→1:
    //   row 1: Opening Balance transfer to Mortgage → 1 transfer row (origin only)
    //   row 2: -22,500 Bank Fees standalone → 1 standalone
    //   row 3: 0.58 Int Inc standalone → 1 standalone
    //   row 4: split parent (skipped) + 2 children:
    //          child A: -10,769.59 Int Exp → 1 split-child
    //          child B: -3,348.84 to Mortgage → 1 transfer row (origin only; split-child path)
    //   row 5: 10,000 Deposit standalone → 1 standalone
    //   row 6: 500 Deposit standalone → 1 standalone
    expect(result.standaloneInserted).toBe(4);
    expect(result.splitChildrenInserted).toBe(1);
    expect(result.transferRowsInserted).toBe(2);
    expect(result.droppedByCutoff).toBe(0);

    // Total rows: 4 standalone + 1 split-child + 2 transfer rows = 7 (under 1→1, no fanout)
    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS n FROM transactions WHERE import_batch_id = $1`,
      [batchId]
    );
    expect(rows[0].n).toBe(7);
  });

  test('transfer rows land on origin only (1→1 model — no target-side fanout)', async () => {
    await runPromote({ batchId, pool });
    // Under 1→1: the Opening Balance transfer (1,500,000) produces a single row
    // on cash_origin with the staging amount. No target-side row on mortgage_target.
    const { rows } = await pool.query(
      `SELECT account_id, amount FROM transactions
         WHERE import_batch_id = $1 AND ABS(amount) = 1500000.00
         ORDER BY amount DESC`,
      [batchId]
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].account_id).toBe(testCoaIds[`${SENTINEL_PREFIX}cash_origin`]);
    expect(parseFloat(rows[0].amount)).toBe(1500000);

    // Confirm mortgage_target received zero rows from this batch
    const targetRows = (await pool.query(
      `SELECT COUNT(*)::int AS n FROM transactions
         WHERE import_batch_id = $1 AND account_id = $2`,
      [batchId, testCoaIds[`${SENTINEL_PREFIX}mortgage_target`]]
    )).rows[0].n;
    expect(targetRows).toBe(0);
  });

  test('PS-anchored: today pins to the PocketSmith closing_balance (§22.1)', async () => {
    const originId = testCoaIds[`${SENTINEL_PREFIX}cash_origin`];
    // Give the origin a PS anchor: a pocketsmith row carrying the bank's
    // authoritative closing_balance. Calibration must pin today to it.
    const PS_CLOSE = 5000.0;
    await pool.query(
      `INSERT INTO transactions
         (account_id, transaction_date, amount, currency, base_amount, base_currency,
          description1, source, accepted, closing_balance)
       VALUES ($1, '2024-01-15', 100, 'USD', 100, 'USD', 'PS anchor', 'pocketsmith', TRUE, $2)`,
      [originId, PS_CLOSE]
    );

    await runPromote({ batchId, pool });

    const bal = parseFloat((await pool.query(
      `SELECT a.opening_balance + COALESCE((
                SELECT SUM(t.amount) FROM transactions t
                  WHERE t.account_id = a.id AND t.transaction_date >= a.opening_balance_date
              ), 0) AS balance
         FROM accounts a WHERE a.id = $1`,
      [originId]
    )).rows[0].balance);
    // Today's computed balance equals the PS closing_balance regardless of how
    // much imported history flowed through the account.
    expect(Math.abs(bal - PS_CLOSE)).toBeLessThan(0.01);

    // Clean up the injected anchor (afterEach only clears this batch's rows).
    await pool.query(
      `DELETE FROM transactions WHERE account_id = $1 AND source = 'pocketsmith' AND description1 = 'PS anchor'`,
      [originId]
    );
  });

  test('no-PS account anchors to pure reconstruction (opening_balance = 0)', async () => {
    // cash_origin has no PS coverage in this case → newOb must be 0 and today =
    // sum of imported flows (reconstruction), not a neutralized 0.
    await runPromote({ batchId, pool });
    const row = (await pool.query(
      `SELECT a.opening_balance,
              COALESCE((SELECT SUM(t.amount) FROM transactions t
                 WHERE t.account_id = a.id AND t.transaction_date >= a.opening_balance_date), 0) AS flows
         FROM accounts a WHERE a.id = $1`,
      [testCoaIds[`${SENTINEL_PREFIX}cash_origin`]]
    )).rows[0];
    expect(parseFloat(row.opening_balance)).toBe(0);
    // today = ob(0) + flows = the reconstructed value (non-zero for an imported account)
    expect(parseFloat(row.flows)).not.toBe(0);
  });

  test('calibration audit recorded with non-zero deltas on BS accounts only', async () => {
    await runPromote({ batchId, pool });
    const { rows } = await pool.query(
      `SELECT qca.account_id, qca.delta_amount, a.section
         FROM quicken_calibration_audit qca
         JOIN accounts a ON a.id = qca.account_id
         WHERE qca.import_batch_id = $1
         ORDER BY qca.account_id`,
      [batchId]
    );
    // Under 1→1, only cash_origin gets rows (mortgage_target gets no target-side
    // fanout). Cash_origin is the only sentinel BS account that's calibrated.
    // P&L sentinels (bank_fees, int_inc, etc.) appear via category_id but
    // calibration sums by account_id which is always BS here.
    expect(rows.length).toBeGreaterThanOrEqual(1);
    const cashOriginRow = rows.find((r) => r.account_id === testCoaIds[`${SENTINEL_PREFIX}cash_origin`]);
    expect(cashOriginRow).toBeTruthy();
    for (const r of rows) {
      expect(r.section).toBe('balance_sheet');
    }
  });

  test('batch status moves to promoted; mappings remain', async () => {
    await runPromote({ batchId, pool });
    const batch = (await pool.query(
      `SELECT status, promoted_at FROM quicken_import_batches WHERE id = $1`,
      [batchId]
    )).rows[0];
    expect(batch.status).toBe('promoted');
    expect(batch.promoted_at).not.toBeNull();

    const mappings = (await pool.query(
      `SELECT COUNT(*)::int AS n FROM account_source_mappings WHERE source = 'quicken'`
    )).rows[0].n;
    expect(mappings).toBeGreaterThanOrEqual(6);
  });

  test('1→1 model does NOT auto-create transfer_match_groups at promote', async () => {
    await runPromote({ batchId, pool });
    // Under the 1→1 pivot, promote no longer creates transfer_match_groups
    // (those are reserved for user-curated manual pairings in Transfer Analysis).
    const groups = (await pool.query(
      `SELECT COUNT(*)::int AS n FROM transfer_match_groups WHERE import_batch_id = $1`,
      [batchId]
    )).rows[0].n;
    expect(groups).toBe(0);

    // Promote no longer auto-matches (matching is deferred to Transfer
    // Analysis), so the inserted transfer rows stay transfer_matched=FALSE.
    const matched = (await pool.query(
      `SELECT COUNT(*)::int AS n FROM transactions
         WHERE import_batch_id = $1 AND transfer_matched = TRUE`,
      [batchId]
    )).rows[0].n;
    expect(matched).toBe(0);
  });

  test('promote is additive + reversible: does NOT auto-match or touch non-batch rows', async () => {
    // Design guard: promote must stay cleanly reversible by runRollback, which
    // only touches this batch's rows. So promote must NOT run the global
    // Transfer Analysis matcher — that matcher flips transfer_matched=TRUE on
    // unrelated PS-era rows in the date window that rollback can't restore.
    // Matching is deferred to /api/v2/transactions/transfer-analysis.
    const cashOriginId = testCoaIds[`${SENTINEL_PREFIX}cash_origin`];
    const mortgageTargetId = testCoaIds[`${SENTINEL_PREFIX}mortgage_target`];

    // The Opening Balance transfer (1,500,000 → Mortgage) resolves here.
    const catId = await resolveTransferCategoryId(pool, cashOriginId, mortgageTargetId);

    const stg = (await pool.query(
      `SELECT transaction_date FROM quicken_staging
         WHERE import_batch_id = $1 AND ABS(amount) = 1500000 LIMIT 1`,
      [batchId]
    )).rows;
    expect(stg).toHaveLength(1);
    const openingDate = stg[0].transaction_date;

    // A perfect non-batch mirror leg (opposite sign, same date + category) that
    // WOULD pair with the promoted +1.5M row if promote auto-matched. It must be
    // left untouched.
    const mirrorId = (await pool.query(
      `INSERT INTO transactions
         (account_id, category_id, transaction_date, amount, currency,
          base_amount, base_currency, description1, source, accepted, transfer_matched)
       VALUES ($1, $2, $3, -1500000, 'USD', -1500000, 'USD', 'mirror leg', 'test-mirror', TRUE, NULL)
       RETURNING id`,
      [mortgageTargetId, catId, openingDate]
    )).rows[0].id;

    try {
      const result = await runPromote({ batchId, pool });

      // Promote reports no match counts — matching isn't its job.
      expect(result.autoMatched).toBeUndefined();
      expect(result.unmatched).toBeUndefined();

      // The non-batch mirror is untouched (still NULL — promote never reached it).
      const mirror = (await pool.query(
        `SELECT transfer_matched FROM transactions WHERE id = $1`,
        [mirrorId]
      )).rows[0];
      expect(mirror.transfer_matched).toBeNull();

      // Inserted transfer rows land additive + unmatched (FALSE), so a later
      // Transfer Analysis run can pick them up. None auto-matched at promote.
      const promotedTrue = (await pool.query(
        `SELECT COUNT(*)::int AS n FROM transactions
           WHERE import_batch_id = $1 AND transfer_matched = TRUE`,
        [batchId]
      )).rows[0].n;
      expect(promotedTrue).toBe(0);
    } finally {
      await pool.query(`DELETE FROM transactions WHERE id = $1`, [mirrorId]);
    }
  });

  test('flags + blocks promote on a role-corrupting stored mapping (category → BS leaf)', async () => {
    // Repoint a category name at a Balance Sheet leaf — promote would put a BS
    // account_id in category_id on a P&L row. findRoleInvalidMappings must flag
    // it and runPromote must refuse. (target_only→BS is NOT flagged — that's
    // handled by §8.2.3 derivation — but category→BS corrupts.)
    await pool.query(
      `UPDATE account_source_mappings SET account_id = $1
         WHERE source = 'quicken' AND external_name = '_qpr Bank Fees'`,
      [testCoaIds[`${SENTINEL_PREFIX}cash_origin`]]
    );
    const invalid = await findRoleInvalidMappings(pool, batchId);
    expect(invalid.some((r) => r.name === '_qpr Bank Fees' && r.role === 'category')).toBe(true);
    // A correctly-mapped target_only→BS (the _qpr Mortgage fixture mapping) is NOT flagged.
    expect(invalid.some((r) => r.name === '_qpr Mortgage')).toBe(false);
    await expect(runPromote({ batchId, pool })).rejects.toThrow(/violate role rules/);
  });

  test('promote rejects unmapped Quicken names with fail-loud error', async () => {
    // Delete one mapping to simulate incomplete authoring
    await pool.query(
      `DELETE FROM account_source_mappings WHERE source = 'quicken' AND external_name = '_qpr Bank Fees'`
    );
    await expect(runPromote({ batchId, pool })).rejects.toThrow(/unmapped Quicken names/);

    // Batch should be in 'failed' status
    const status = (await pool.query(
      `SELECT status, failure_reason FROM quicken_import_batches WHERE id = $1`,
      [batchId]
    )).rows[0];
    expect(status.status).toBe('failed');
    expect(status.failure_reason).toMatch(/unmapped/i);
  });

  test('promote refuses to re-run on already-promoted batch', async () => {
    await runPromote({ batchId, pool });
    await expect(runPromote({ batchId, pool })).rejects.toThrow(/already promoted/);
  });

  test('investment rows: trades neutral, income synthesizes a cash leg (§22 value-only)', async () => {
    // Inject onto the mapped origin account (cash_isolated → _qpr_test_cash_origin):
    // a Buy (neutral, no row) and a Div (income → Dividend leaf cash leg).
    await pool.query(
      `INSERT INTO quicken_securities_staging
         (import_batch_id, source_file, quicken_account_name, transaction_date,
          quicken_action, quicken_security_name, gross_amount)
       VALUES
         ($1, 'synthetic.QIF', 'cash_isolated', '2018-03-01', 'Buy', 'ACME', 1000),
         ($1, 'synthetic.QIF', 'cash_isolated', '2018-04-01', 'Div', 'ACME', 42.50)`,
      [batchId]
    );

    const result = await runPromote({ batchId, pool });
    expect(result.investmentNeutralSkipped).toBe(1); // the Buy
    expect(result.investmentIncomeInserted).toBe(1); // the Div

    // Div → one income transaction categorized to Financial Income - Dividend.
    const div = (await pool.query(
      `SELECT t.amount, a.name AS cat
         FROM transactions t JOIN accounts a ON a.id = t.category_id
        WHERE t.import_batch_id = $1 AND t.description2 = 'Quicken Div'`,
      [batchId]
    )).rows[0];
    expect(Number(div.amount)).toBeCloseTo(42.5, 2);
    expect(div.cat).toBe('Financial Income - Dividend');

    // Buy produced no ledger row.
    const buyN = (await pool.query(
      `SELECT COUNT(*)::int AS n FROM transactions
        WHERE import_batch_id = $1 AND description2 = 'Quicken Buy'`,
      [batchId]
    )).rows[0];
    expect(buyN.n).toBe(0);

    // Clean up injected securities rows so afterEach can tear down.
    await pool.query(
      `DELETE FROM quicken_securities_staging WHERE import_batch_id = $1`,
      [batchId]
    );
  });

  // ────────────────────────────────────────────────────────────────────────
  // Rollback tests
  // ────────────────────────────────────────────────────────────────────────

  test('rollback deletes inserted transactions and reverses calibration', async () => {
    // Capture pre-PROMOTE state — rollback must restore exactly this (PS-anchored
    // rollback returns today to the pre-import value, not the post-promote value).
    const prePromote = (await pool.query(
      `SELECT a.id,
              a.opening_balance + COALESCE((
                SELECT SUM(t.amount) FROM transactions t WHERE t.account_id = a.id
                  AND t.transaction_date >= a.opening_balance_date
              ), 0) AS balance,
              a.opening_balance
         FROM accounts a WHERE a.id = ANY($1::int[])`,
      [Object.values(testCoaIds)]
    )).rows;

    await runPromote({ batchId, pool });

    const result = await runRollback({ batchId, pool });
    expect(result.deleted.transactions).toBe(7); // 1→1: 4 standalone + 1 split-child + 2 transfer rows
    expect(result.deleted.transfer_match_groups).toBe(0); // none auto-created under 1→1
    expect(result.calibrationRowsReversed).toBeGreaterThanOrEqual(1); // cash_origin (only origin BS leaf)

    // No remnant transactions
    const remnant = (await pool.query(
      `SELECT COUNT(*)::int AS n FROM transactions WHERE import_batch_id = $1`,
      [batchId]
    )).rows[0].n;
    expect(remnant).toBe(0);

    // No remnant audit rows
    const audit = (await pool.query(
      `SELECT COUNT(*)::int AS n FROM quicken_calibration_audit WHERE import_batch_id = $1`,
      [batchId]
    )).rows[0].n;
    expect(audit).toBe(0);

    // Today's balance should be unchanged from pre-rollback (which was also pre-promote)
    const postRollback = (await pool.query(
      `SELECT a.id,
              a.opening_balance + COALESCE((
                SELECT SUM(t.amount) FROM transactions t WHERE t.account_id = a.id
                  AND t.transaction_date >= a.opening_balance_date
              ), 0) AS balance
         FROM accounts a WHERE a.id = ANY($1::int[])`,
      [Object.values(testCoaIds)]
    )).rows;
    for (const post of postRollback) {
      const pre = prePromote.find((r) => r.id === post.id);
      const diff = Math.abs(parseFloat(post.balance) - parseFloat(pre.balance));
      expect(diff).toBeLessThan(0.01);
    }

    // Batch status = rolled_back
    const status = (await pool.query(
      `SELECT status, rolled_back_at FROM quicken_import_batches WHERE id = $1`,
      [batchId]
    )).rows[0];
    expect(status.status).toBe('rolled_back');
    expect(status.rolled_back_at).not.toBeNull();
  });

  test('rollback preserves staging rows (intentional per §6.5.4) and mappings', async () => {
    await runPromote({ batchId, pool });
    await runRollback({ batchId, pool });

    const stagingRemain = (await pool.query(
      `SELECT COUNT(*)::int AS n FROM quicken_staging WHERE import_batch_id = $1`,
      [batchId]
    )).rows[0].n;
    expect(stagingRemain).toBe(8); // all 8 staging rows still present

    const mappingsRemain = (await pool.query(
      `SELECT COUNT(*)::int AS n FROM account_source_mappings
         WHERE source = 'quicken' AND external_name = ANY($1::text[])`,
      [['cash_isolated', '_qpr Mortgage', '_qpr Bank Fees', '_qpr Int Inc', '_qpr Int Exp', '_qpr Deposit']]
    )).rows[0].n;
    expect(mappingsRemain).toBe(6);
  });

  test('re-promote after rollback works (§6.5.6)', async () => {
    await runPromote({ batchId, pool });
    await runRollback({ batchId, pool });

    // Manually flip status from rolled_back back to parsed so promote will accept it
    // (the §6.5.6 re-promote path will need a small tweak to runPromote's pre-check; for
    // now we exercise the underlying logic by resetting status)
    await pool.query(
      `UPDATE quicken_import_batches SET status = 'parsed', promoted_at = NULL, rolled_back_at = NULL WHERE id = $1`,
      [batchId]
    );

    const result = await runPromote({ batchId, pool });
    expect(result.transferRowsInserted).toBe(2);
    expect(result.standaloneInserted + result.splitChildrenInserted).toBe(5);
  });

  test('rollback refuses on a batch that is not in promoted state', async () => {
    // Batch is 'parsed' but not 'promoted' yet
    await expect(runRollback({ batchId, pool })).rejects.toThrow(/must be 'promoted'/);
  });
});
