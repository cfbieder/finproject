/**
 * quicken-promote.js — Phase E cash-only promote (CR019 §6.4)
 *
 * Implements the cash-side subset of the §6.4 11-step promote sequence:
 *   step 0  — Snapshot pre-promote balances
 *   step 2  — Insert direct cash transactions (with split-child expansion
 *             and transfer 1→2 fanout)
 *   step 4  — Wire transfer_match_groups for fanout pairs
 *   step 8  — Recalibrate accounts.opening_balance per touched account;
 *             write quicken_calibration_audit
 *   step 9  — Verify balance invariant: today's calculated balance equals
 *             the step-0 snapshot within 1¢
 *   step 10 — Finalize batch row: status='promoted', promoted_at=NOW()
 *
 * Skipped (investment-side, requires investment lot walker — separate sub-phase):
 *   step 1  — Reconcile securities master
 *   step 3  — Synthesize investment cash legs
 *   step 5  — Build security events, lots, disposals
 *   step 6  — Mark handoff_marker on lots
 *   step 7  — Insert price history
 *
 * Transaction model: the work transaction wraps steps 0–10 atomically. On
 * failure inside the work transaction, a SEPARATE small transaction sets
 * batch status='failed' with failure_reason, so the failure trail survives
 * the work rollback (CR §6.4 preamble).
 *
 * Mapping inputs: `account_source_mappings` rows with source='quicken' for
 * every distinct Quicken account name AND every distinct quicken_category AND
 * every distinct transfer_target_account in the batch. Phase 2 authoring of
 * those rows happens via the admin UI in this same vertical slice.
 *
 * Tests: server/src/v2/scripts/__tests__/quicken-promote.test.js
 */

'use strict';

const { Pool } = require('pg');

const CONN_STR =
  process.env.DATABASE_URL || 'postgres://fin:findev123@localhost:5434/fin';

// ═══════════════════════════════════════════════════════════════════════════
// MAPPING RESOLUTION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Load the mapping (quicken external_name → COA accounts) for every distinct
 * Quicken name in this batch. Returns Map<name, {account_id, section, is_transfer}>.
 *
 * The richer payload (vs. just account_id) is needed by the 1→1 transfer
 * model: when a transfer_target's mapping is itself a transfer-category leaf
 * (is_transfer=TRUE, the user explicitly picked the category for a
 * target-only name), promote uses it directly. When it's a BS leaf
 * (is_transfer=FALSE, name had its own QIF or maps to an existing BS
 * account), promote derives the transfer category via §8.2.3 from branches.
 */
async function loadMappings(client, batchId) {
  // Collect every Quicken name we need to resolve.
  const { rows: namesRows } = await client.query(
    `WITH names AS (
       SELECT DISTINCT quicken_account_name AS name FROM quicken_staging WHERE import_batch_id = $1
       UNION
       SELECT DISTINCT transfer_target_account AS name FROM quicken_staging
         WHERE import_batch_id = $1 AND transfer_target_account IS NOT NULL
       UNION
       SELECT DISTINCT quicken_category AS name FROM quicken_staging
         WHERE import_batch_id = $1 AND quicken_category IS NOT NULL
     )
     SELECT name FROM names ORDER BY name`,
    [batchId]
  );
  const names = namesRows.map((r) => r.name);
  if (names.length === 0) return new Map();

  const { rows: mapped } = await client.query(
    `SELECT asm.external_name, asm.account_id, a.section, a.is_transfer
       FROM account_source_mappings asm
       JOIN accounts a ON a.id = asm.account_id
       WHERE asm.source = 'quicken' AND asm.external_name = ANY($1::text[])`,
    [names]
  );
  const m = new Map();
  for (const r of mapped) {
    m.set(r.external_name, {
      account_id: r.account_id,
      section: r.section,
      is_transfer: r.is_transfer,
    });
  }
  return m;
}

/**
 * Identify any Quicken names with no mapping. Returns array of names.
 */
async function findUnmappedNames(client, batchId) {
  const { rows } = await client.query(
    `WITH names AS (
       SELECT DISTINCT quicken_account_name AS name FROM quicken_staging WHERE import_batch_id = $1
       UNION
       SELECT DISTINCT transfer_target_account AS name FROM quicken_staging
         WHERE import_batch_id = $1 AND transfer_target_account IS NOT NULL
       UNION
       SELECT DISTINCT quicken_category AS name FROM quicken_staging
         WHERE import_batch_id = $1 AND quicken_category IS NOT NULL
     )
     SELECT n.name FROM names n
       LEFT JOIN account_source_mappings asm
         ON asm.source = 'quicken' AND asm.external_name = n.name
       WHERE asm.account_id IS NULL
       ORDER BY n.name`,
    [batchId]
  );
  return rows.map((r) => r.name);
}

// ═══════════════════════════════════════════════════════════════════════════
// CUTOFFS (CR §8.1)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Compute the per-account cutoff: the earliest existing PocketSmith-era
 * transaction date per account that's a target of this batch. Returns a
 * Map<account_id, Date|null>. NULL means "no PS coverage; import everything."
 * Honors `quicken_import_batches.cutoff_overrides` (JSONB) when set.
 */
async function computeCutoffs(client, batchId, mappings) {
  const targetAccountIds = [...new Set([...mappings.values()].map((m) => m.account_id))];
  if (targetAccountIds.length === 0) return new Map();

  const { rows } = await client.query(
    `SELECT account_id, MIN(transaction_date) AS cutoff
       FROM transactions
       WHERE account_id = ANY($1::int[])
         AND source IN ('pocketsmith', 'auto-offset')
       GROUP BY account_id`,
    [targetAccountIds]
  );

  const auto = new Map(); // account_id → Date | null
  for (const id of targetAccountIds) auto.set(id, null);
  for (const r of rows) auto.set(r.account_id, r.cutoff);

  // Apply overrides (later date wins per CR §8.1.1: MAX(auto, override))
  const { rows: batchRow } = await client.query(
    `SELECT cutoff_overrides FROM quicken_import_batches WHERE id = $1`,
    [batchId]
  );
  const overrides = batchRow[0] && batchRow[0].cutoff_overrides;
  if (overrides) {
    for (const [accountId, dateStr] of Object.entries(overrides)) {
      const id = parseInt(accountId, 10);
      const overrideDate = new Date(dateStr);
      const autoDate = auto.get(id);
      if (autoDate == null || overrideDate > autoDate) {
        auto.set(id, overrideDate);
      }
    }
  }
  return auto;
}

function isBeyondCutoff(transactionDate, cutoff) {
  if (cutoff == null) return false;
  return new Date(transactionDate) >= new Date(cutoff);
}

// ═══════════════════════════════════════════════════════════════════════════
// TRANSFER CATEGORY RESOLUTION (CR §8.2.3)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Walk an account's parent chain and collect the names along the way.
 * Used to detect "branch" membership (Mortgages, Securities, etc.) per the
 * §8.2.3 resolution table.
 */
async function accountAncestry(client, accountId) {
  const { rows } = await client.query(
    `WITH RECURSIVE chain AS (
       SELECT id, name, parent_id, account_type, currency, 1 AS depth
         FROM accounts WHERE id = $1
       UNION ALL
       SELECT a.id, a.name, a.parent_id, a.account_type, a.currency, c.depth + 1
         FROM accounts a JOIN chain c ON a.id = c.parent_id
     )
     SELECT id, name, account_type, currency FROM chain ORDER BY depth`,
    [accountId]
  );
  return rows;
}

/**
 * Find or create a transfer leaf by name under the 'Transfers' parent.
 * Returns the leaf's account_id. Idempotent.
 */
async function getOrCreateTransferLeaf(client, leafName) {
  const existing = await client.query(
    `SELECT id FROM accounts WHERE name = $1 LIMIT 1`,
    [leafName]
  );
  if (existing.rows.length > 0) return existing.rows[0].id;

  const { rows: parent } = await client.query(
    `SELECT id FROM accounts WHERE name = 'Transfers' LIMIT 1`
  );
  if (parent.length === 0) {
    throw new Error(`getOrCreateTransferLeaf: 'Transfers' parent not found in COA`);
  }
  const { rows: created } = await client.query(
    `INSERT INTO accounts (name, parent_id, account_type, section, is_transfer, currency, is_active)
       VALUES ($1, $2, 'expense', 'profit_loss', TRUE, 'USD', TRUE)
       RETURNING id`,
    [leafName, parent[0].id]
  );
  return created[0].id;
}

/**
 * Pick the right Transfer-* category leaf given the two mapped accounts.
 * Per CR §8.2.3 priority order.
 */
async function resolveTransferCategoryId(client, originId, targetId) {
  const [originChain, targetChain] = await Promise.all([
    accountAncestry(client, originId),
    accountAncestry(client, targetId),
  ]);

  const hasInChain = (chain, predicate) => chain.some(predicate);
  const matchName = (re) => (row) => re.test(row.name);

  const eitherIs = (predicate) =>
    hasInChain(originChain, predicate) || hasInChain(targetChain, predicate);

  // Order matters — first match wins (CR §8.2.3 priority).
  if (eitherIs(matchName(/mortgage|loan/i))) {
    return await getOrCreateTransferLeaf(client, 'Transfer - Mortgage');
  }
  if (eitherIs(matchName(/securities|brokerage|fidelity|cvc/i))) {
    return await getOrCreateTransferLeaf(client, 'Transfer - Securities Trades');
  }
  // FX: different base currencies on the actual accounts (top of chain — leaf).
  const originCurrency = originChain[0] && originChain[0].currency;
  const targetCurrency = targetChain[0] && targetChain[0].currency;
  if (originCurrency && targetCurrency && originCurrency !== targetCurrency) {
    return await getOrCreateTransferLeaf(client, 'Transfer - FX');
  }
  if (eitherIs(matchName(/business/i))) {
    return await getOrCreateTransferLeaf(client, 'Transfer - Business');
  }
  return await getOrCreateTransferLeaf(client, 'Transfer - Bank');
}

// ═══════════════════════════════════════════════════════════════════════════
// FX RESOLUTION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Compute base_amount for a native-currency amount on a given date.
 * USD → returns the amount unchanged.
 * Non-USD → looks up budget_fx_rates(currency, year, month) and divides.
 * Throws if rate is missing — promote should fail-loud per §12.1.
 */
async function resolveBaseAmount(client, amount, currency, transactionDate) {
  if (currency === 'USD') return amount;
  const d = new Date(transactionDate);
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth() + 1;
  const { rows } = await client.query(
    `SELECT rate FROM budget_fx_rates WHERE currency = $1 AND year = $2 AND month = $3`,
    [currency, year, month]
  );
  if (rows.length === 0) {
    throw new Error(
      `Missing FX rate for ${currency} ${year}-${String(month).padStart(2, '0')} ` +
        `(needed for transaction dated ${transactionDate}). Run seed-fx first.`
    );
  }
  const rate = parseFloat(rows[0].rate);
  return Math.round((amount / rate) * 10000) / 10000; // round to 4 decimals
}

// ═══════════════════════════════════════════════════════════════════════════
// PROMOTE STEPS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Step 0: capture today's calculated balance for every BS account into a temp
 * table. Used by step 9 to verify post-promote balance equality.
 */
async function snapshotBalances(client) {
  await client.query(`
    CREATE TEMP TABLE _pre_promote_balances ON COMMIT DROP AS
      SELECT
        a.id AS account_id,
        a.opening_balance + COALESCE(SUM(t.amount), 0) AS balance
      FROM accounts a
      LEFT JOIN transactions t
        ON t.account_id = a.id
        AND t.transaction_date >= a.opening_balance_date
      WHERE a.section = 'balance_sheet'
      GROUP BY a.id, a.opening_balance
  `);
}

/**
 * Step 2 — 1→1 promote model (CR §6.4 pivot).
 *
 * Inserts cash transactions from `quicken_staging`. Every staging row becomes
 * exactly one transaction on its mapped origin BS leaf. For transfer rows
 * (transfer_target_account NOT NULL), the category is a transfer leaf
 * resolved per:
 *   - If the target's mapping is itself a transfer-category leaf
 *     (is_transfer=TRUE — the user explicitly picked a transfer category
 *     because the target is "target-only" with no own QIF), use it directly.
 *   - Otherwise the target maps to a BS leaf (its own QIF was parsed, or it
 *     resolves to an existing BS account), and we derive the transfer
 *     category via §8.2.3 (branch comparison + cross-currency check).
 *
 * No fanout. No transfer_match_groups creation at promote time. No transfer
 * matching at promote at all — transfer rows land transfer_matched=FALSE and
 * are paired later by a manual Transfer Analysis run (removed 2026-05-30; the
 * old promote-time matcher had global scope and made promote irreversible).
 *
 * Cutoff applies per-row to the ORIGIN account only — the target side
 * doesn't get a row, so target cutoff is irrelevant.
 *
 * Returns counts for the report.
 */
async function insertCashRows(client, batchId, mappings, cutoffs) {
  const { rows: stagingRows } = await client.query(
    `SELECT id, source_file, source_line, quicken_account_name,
            transaction_date, amount, currency, payee, memo,
            quicken_category, transfer_target_account, cleared_status,
            split_parent_id,
            (SELECT COUNT(*) FROM quicken_staging c
               WHERE c.split_parent_id = quicken_staging.id) AS child_count
       FROM quicken_staging WHERE import_batch_id = $1
       ORDER BY transaction_date, id`,
    [batchId]
  );

  let standaloneInserted = 0;
  let splitChildrenInserted = 0;
  let transferRowsInserted = 0;
  let droppedByCutoff = 0;

  for (const row of stagingRows) {
    // Skip split PARENTS (have child_count > 0). They're metadata-only.
    if (parseInt(row.child_count, 10) > 0) continue;

    const originMapping = mappings.get(row.quicken_account_name);
    if (!originMapping) {
      throw new Error(
        `insertCashRows: no mapping for Quicken account '${row.quicken_account_name}'`
      );
    }
    const originAccountId = originMapping.account_id;

    // Cutoff check (origin side only — target gets no row in 1→1 model)
    if (isBeyondCutoff(row.transaction_date, cutoffs.get(originAccountId))) {
      droppedByCutoff += 1;
      continue;
    }

    const amount = parseFloat(row.amount);
    const baseAmount = await resolveBaseAmount(
      client,
      amount,
      row.currency,
      row.transaction_date
    );

    let categoryId;
    let description2;

    if (row.transfer_target_account) {
      // Transfer row: resolve category from target's mapping
      const targetMapping = mappings.get(row.transfer_target_account);
      if (!targetMapping) {
        throw new Error(
          `insertCashRows: no mapping for transfer target ` +
            `'${row.transfer_target_account}' on staging row ${row.id}`
        );
      }

      if (targetMapping.is_transfer) {
        // Target-only name explicitly mapped to a transfer leaf — use directly.
        categoryId = targetMapping.account_id;
      } else {
        // Target maps to a BS leaf (origin or both role) — derive category via §8.2.3.
        categoryId = await resolveTransferCategoryId(
          client,
          originAccountId,
          targetMapping.account_id
        );
      }
      description2 = `Quicken transfer → ${row.transfer_target_account}`;
      transferRowsInserted += 1;
    } else {
      // Non-transfer cash row — category from quicken_category mapping
      if (row.quicken_category) {
        const catMapping = mappings.get(row.quicken_category);
        if (!catMapping) {
          throw new Error(
            `insertCashRows: no mapping for category ` +
              `'${row.quicken_category}' on staging row ${row.id}`
          );
        }
        categoryId = catMapping.account_id;
      } else {
        categoryId = null;
      }
      description2 = row.quicken_category;
      if (row.split_parent_id !== null) splitChildrenInserted += 1;
      else standaloneInserted += 1;
    }

    const description = row.payee || row.memo || row.quicken_category || 'Quicken import';

    await client.query(
      `INSERT INTO transactions
         (account_id, category_id, transaction_date, amount, currency,
          base_amount, base_currency, description1, description2, memo,
          source, accepted, import_batch_id, transfer_matched)
       VALUES ($1, $2, $3, $4, $5, $6, 'USD', $7, $8, $9, 'quicken-import', TRUE, $10, FALSE)`,
      [
        originAccountId,
        categoryId,
        row.transaction_date,
        amount,
        row.currency,
        baseAmount,
        description,
        description2,
        row.memo,
        batchId,
      ]
    );
  }

  return {
    standaloneInserted,
    splitChildrenInserted,
    transferRowsInserted,
    droppedByCutoff,
  };
}

/**
 * Step 8: per-account, set
 *   opening_balance := opening_balance - SUM(imported amounts for this account)
 * and record one row per touched account in quicken_calibration_audit.
 */
async function recalibrate(client, batchId) {
  const { rows: deltas } = await client.query(
    `SELECT account_id, SUM(amount) AS delta
       FROM transactions
       WHERE import_batch_id = $1
       GROUP BY account_id`,
    [batchId]
  );

  for (const r of deltas) {
    const delta = parseFloat(r.delta);
    await client.query(
      `UPDATE accounts SET opening_balance = opening_balance - $2 WHERE id = $1`,
      [r.account_id, delta]
    );
    await client.query(
      `INSERT INTO quicken_calibration_audit (import_batch_id, account_id, delta_amount)
         VALUES ($1, $2, $3)`,
      [batchId, r.account_id, delta]
    );
  }
  return deltas.length;
}

/**
 * Step 9: assert today's calculated balance for every BS account equals the
 * step-0 snapshot within 1¢. Throws on mismatch (caller's catch triggers
 * work-tx rollback per the two-tx model).
 */
async function verifyBalances(client) {
  const { rows: mismatches } = await client.query(`
    WITH post AS (
      SELECT a.id AS account_id,
             a.opening_balance + COALESCE(SUM(t.amount), 0) AS balance
        FROM accounts a
        LEFT JOIN transactions t
          ON t.account_id = a.id
          AND t.transaction_date >= a.opening_balance_date
        WHERE a.section = 'balance_sheet'
        GROUP BY a.id, a.opening_balance
    )
    SELECT pre.account_id, pre.balance AS pre, post.balance AS post,
           (post.balance - pre.balance) AS diff
      FROM _pre_promote_balances pre
      JOIN post ON post.account_id = pre.account_id
      WHERE ABS(post.balance - pre.balance) > 0.01
  `);
  if (mismatches.length > 0) {
    const sample = mismatches.slice(0, 5).map(
      (m) => `acct=${m.account_id} pre=${m.pre} post=${m.post} diff=${m.diff}`
    );
    throw new Error(
      `Balance verification failed for ${mismatches.length} account(s): ${sample.join('; ')}`
    );
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// ORCHESTRATION (two-transaction wrapper per CR §6.4 preamble)
// ═══════════════════════════════════════════════════════════════════════════

async function runPromote({ batchId, pool }) {
  const ownsPool = !pool;
  if (ownsPool) pool = new Pool({ connectionString: CONN_STR });

  let workError = null;
  let result = null;

  try {
    // Check batch status before locking a connection
    const { rows: batchRows } = await pool.query(
      `SELECT status FROM quicken_import_batches WHERE id = $1`,
      [batchId]
    );
    if (batchRows.length === 0) {
      throw new Error(`runPromote: batch ${batchId} not found`);
    }
    if (batchRows[0].status === 'promoted') {
      throw new Error(`runPromote: batch ${batchId} is already promoted`);
    }
    if (batchRows[0].status === 'rolled_back') {
      // Allowed — re-promote semantics per §6.5.6
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Pre-flight: fail-loud if this batch has investment-side rows that
      // the cash-only promote would silently ignore. Investment-side promote
      // (lot walker per §6.4 steps 1/3/5/6/7) is a separate sub-phase; until
      // it ships, refuse to promote any batch with rows in
      // `quicken_securities_staging` / `_security_master_staging` / `_price_staging`.
      const { rows: invstCount } = await client.query(
        `SELECT
           (SELECT COUNT(*)::int FROM quicken_securities_staging WHERE import_batch_id = $1) AS invst,
           (SELECT COUNT(*)::int FROM quicken_security_master_staging WHERE import_batch_id = $1) AS securities,
           (SELECT COUNT(*)::int FROM quicken_price_staging WHERE import_batch_id = $1) AS prices`,
        [batchId]
      );
      const { invst, securities, prices } = invstCount[0];
      if (invst > 0 || securities > 0 || prices > 0) {
        throw new Error(
          `runPromote: batch contains ${invst} investment event(s), ${securities} security master row(s), ` +
            `${prices} price row(s). Cash-only promote would silently drop them. ` +
            `Investment-side promote is not yet implemented (CR §6.4 steps 1/3/5/6/7).`
        );
      }

      // Pre-flight: fail-loud if any Quicken names are unmapped
      const unmapped = await findUnmappedNames(client, batchId);
      if (unmapped.length > 0) {
        throw new Error(
          `runPromote: ${unmapped.length} unmapped Quicken names (sample: ${unmapped.slice(0, 5).join(', ')})`
        );
      }

      // Step 0
      await snapshotBalances(client);

      // Mark batch as 'promoting' (within work tx — visible only after commit)
      await client.query(
        `UPDATE quicken_import_batches SET status='promoting', updated_at=NOW() WHERE id=$1`,
        [batchId]
      );

      // Resolve mappings + cutoffs
      const mappings = await loadMappings(client, batchId);
      const cutoffs = await computeCutoffs(client, batchId, mappings);

      // Step 2: 1→1 cash row insertion
      const insertResult = await insertCashRows(client, batchId, mappings, cutoffs);

      // Step 8: recalibrate (skip if zero rows inserted — nothing to calibrate)
      const calibrated = await recalibrate(client, batchId);

      // Step 9: verify
      await verifyBalances(client);

      // Transfer matching is intentionally NOT run here. Promote is purely
      // additive and must stay cleanly reversible by runRollback (which only
      // touches this batch's rows). The Transfer Analysis matcher has global
      // scope (every transfer txn in the date window, all sources) and would
      // flip transfer_matched=TRUE on unrelated PS-era rows that rollback can't
      // restore. Inserted transfer rows land with transfer_matched=FALSE; the
      // user runs Transfer Analysis (/api/v2/transactions/transfer-analysis)
      // post-promote when ready — it is idempotent and re-runnable.

      // Step 10: finalize
      await client.query(
        `UPDATE quicken_import_batches SET status='promoted', promoted_at=NOW(), updated_at=NOW() WHERE id=$1`,
        [batchId]
      );

      await client.query('COMMIT');
      result = {
        batchId,
        ...insertResult,
        accountsRecalibrated: calibrated,
      };
    } catch (err) {
      try { await client.query('ROLLBACK'); } catch (_) { /* swallow */ }
      workError = err;
    } finally {
      client.release();
    }

    if (workError) {
      // Separate failure-status transaction
      try {
        await pool.query(
          `UPDATE quicken_import_batches
             SET status = 'failed',
                 failure_reason = LEFT($2, 8000),
                 updated_at = NOW()
             WHERE id = $1`,
          [batchId, String(workError.message || workError)]
        );
      } catch (_) { /* swallow */ }
      throw workError;
    }

    return result;
  } finally {
    if (ownsPool) await pool.end();
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// ROLLBACK (CR §6.5)
// ═══════════════════════════════════════════════════════════════════════════

async function runRollback({ batchId, pool }) {
  const ownsPool = !pool;
  if (ownsPool) pool = new Pool({ connectionString: CONN_STR });

  try {
    // Pre-flight: batch must be in 'promoted' state
    const { rows: batchRows } = await pool.query(
      `SELECT status FROM quicken_import_batches WHERE id = $1`,
      [batchId]
    );
    if (batchRows.length === 0) {
      throw new Error(`runRollback: batch ${batchId} not found`);
    }
    if (batchRows[0].status !== 'promoted') {
      throw new Error(
        `runRollback: batch ${batchId} is in status '${batchRows[0].status}', must be 'promoted'`
      );
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Pre-flight: no external references to this batch's lots
      // (cash-only Phase E doesn't write lots, but check anyway for forward compat)
      const { rows: externalDisposals } = await client.query(
        `SELECT d.id FROM security_lot_disposals d
           JOIN security_lots l ON l.id = d.lot_id
           WHERE l.import_batch_id = $1 AND d.import_batch_id IS DISTINCT FROM $1
           LIMIT 5`,
        [batchId]
      );
      if (externalDisposals.length > 0) {
        throw new Error(
          `runRollback: ${externalDisposals.length}+ external disposals reference this batch's lots — refusing rollback (per CR §6.5.1)`
        );
      }

      // Q4 pre-flight: no MANUAL transfer_match_groups reference this batch's
      // transactions (groups created post-promote in Transfer Analysis pair
      // Quicken rows with PS rows or with each other). Promote no longer
      // auto-matches, so any group here is genuine user-curated work — refuse
      // rollback rather than orphan a user's pairing.
      const { rows: externalGroups } = await client.query(
        `SELECT DISTINCT g.id, g.note
           FROM transfer_match_groups g
           JOIN transfer_match_group_members m ON m.group_id = g.id
           JOIN transactions t ON t.id = m.transaction_id
           WHERE t.import_batch_id = $1
             AND g.import_batch_id IS DISTINCT FROM $1
           LIMIT 10`,
        [batchId]
      );
      if (externalGroups.length > 0) {
        const sample = externalGroups
          .slice(0, 3)
          .map((g) => `id=${g.id}${g.note ? ` "${g.note}"` : ''}`)
          .join('; ');
        throw new Error(
          `runRollback: ${externalGroups.length}+ manual transfer_match_groups reference this batch's transactions. ` +
            `Delete those groups in Transfer Analysis first, then re-run rollback. ` +
            `Sample: ${sample}`
        );
      }

      // Snapshot pre-rollback balances for the same verification as promote
      await snapshotBalances(client);

      // Deletions in dependency order (§6.5.2)
      await client.query(
        `DELETE FROM transfer_match_group_members
           WHERE group_id IN (SELECT id FROM transfer_match_groups WHERE import_batch_id = $1)`,
        [batchId]
      );
      const tmg = await client.query(
        `DELETE FROM transfer_match_groups WHERE import_batch_id = $1`,
        [batchId]
      );
      const lotDisp = await client.query(
        `DELETE FROM security_lot_disposals WHERE import_batch_id = $1`,
        [batchId]
      );
      const lots = await client.query(
        `DELETE FROM security_lots WHERE import_batch_id = $1`,
        [batchId]
      );
      const secTx = await client.query(
        `DELETE FROM security_transactions WHERE import_batch_id = $1`,
        [batchId]
      );
      const prices = await client.query(
        `DELETE FROM security_prices WHERE import_batch_id = $1`,
        [batchId]
      );
      const tx = await client.query(
        `DELETE FROM transactions WHERE import_batch_id = $1`,
        [batchId]
      );

      // Calibration reversal (§6.5.3)
      const { rows: deltas } = await client.query(
        `SELECT account_id, delta_amount FROM quicken_calibration_audit WHERE import_batch_id = $1`,
        [batchId]
      );
      for (const d of deltas) {
        await client.query(
          `UPDATE accounts SET opening_balance = opening_balance + $2 WHERE id = $1`,
          [d.account_id, d.delta_amount]
        );
      }
      await client.query(
        `DELETE FROM quicken_calibration_audit WHERE import_batch_id = $1`,
        [batchId]
      );

      // Verify (same invariant as promote: today's balance per account matches pre-rollback snapshot)
      // Pre-rollback balance + delta = original (post-promote) balance, which equals pre-promote balance.
      // After all deletes + opening_balance reversal: today's balance returns to pre-promote.
      // Snapshot was taken AFTER all the promoted rows existed, BEFORE deletion.
      // So check: today's calculated balance == snapshot - sum_of_rolled_back_amounts + opening_balance_reversal
      // Since opening_balance_reversal = +delta and rolled_back_amounts = delta, they cancel — balance unchanged.
      await verifyBalances(client);

      // Finalize batch row (§6.5.5)
      await client.query(
        `UPDATE quicken_import_batches
           SET status = 'rolled_back', rolled_back_at = NOW(), updated_at = NOW()
           WHERE id = $1`,
        [batchId]
      );

      await client.query('COMMIT');

      return {
        batchId,
        deleted: {
          transfer_match_groups: tmg.rowCount,
          security_lot_disposals: lotDisp.rowCount,
          security_lots: lots.rowCount,
          security_transactions: secTx.rowCount,
          security_prices: prices.rowCount,
          transactions: tx.rowCount,
        },
        calibrationRowsReversed: deltas.length,
      };
    } catch (err) {
      try { await client.query('ROLLBACK'); } catch (_) {}
      throw err;
    } finally {
      client.release();
    }
  } finally {
    if (ownsPool) await pool.end();
  }
}

module.exports = {
  // Public API
  runPromote,
  runRollback,
  // Helpers exported for tests
  loadMappings,
  findUnmappedNames,
  computeCutoffs,
  resolveBaseAmount,
  resolveTransferCategoryId,
  snapshotBalances,
};
