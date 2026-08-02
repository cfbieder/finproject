/**
 * Transactions Repository
 *
 * Database operations for the transactions table.
 */

const db = require('../db');

/**
 * Get all transactions with optional filtering
 */
async function findAll({ startDate, endDate, categoryId, accountId, limit = 1000, offset = 0 } = {}) {
  const conditions = [];
  const params = [];
  let paramIndex = 1;

  if (startDate) {
    conditions.push(`t.transaction_date >= $${paramIndex++}`);
    params.push(startDate);
  }
  if (endDate) {
    conditions.push(`t.transaction_date <= $${paramIndex++}`);
    params.push(endDate);
  }
  if (categoryId) {
    conditions.push(`t.category_id = $${paramIndex++}`);
    params.push(categoryId);
  }
  if (accountId) {
    conditions.push(`t.account_id = $${paramIndex++}`);
    params.push(accountId);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const sql = `
    SELECT
      t.id, t.ps_id, t.transaction_date, t.description1, t.description2,
      t.amount, t.currency, t.base_amount, t.base_currency,
      t.transaction_type, t.closing_balance, t.labels, t.memo, t.note, t.bank, t.source,
      t.transfer_matched,
      t.account_id, a.name as account_name,
      t.category_id, c.name as category_name
    FROM transactions t
    LEFT JOIN accounts a ON t.account_id = a.id
    LEFT JOIN accounts c ON t.category_id = c.id
    ${whereClause}
    ORDER BY t.transaction_date DESC, t.id DESC
    LIMIT $${paramIndex++} OFFSET $${paramIndex}
  `;

  params.push(limit, offset);
  const result = await db.query(sql, params);
  return result.rows;
}

/**
 * Get all transactions with extended filtering (currency, description, amount range)
 * Supports both ID-based and name-based filtering for accounts/categories
 */
async function findAllExtended({
  startDate, endDate, categoryId, accountId,
  categoryNames, accountNames,  // Support name-based filtering for v1 compatibility
  currency, description, minAmount, maxAmount,
  transferMatched,
  limit = 1000, offset = 0
} = {}) {
  const conditions = [];
  const params = [];
  let paramIndex = 1;

  if (startDate) {
    conditions.push(`t.transaction_date >= $${paramIndex++}`);
    params.push(startDate);
  }
  if (endDate) {
    conditions.push(`t.transaction_date <= $${paramIndex++}`);
    params.push(endDate);
  }
  if (categoryId) {
    conditions.push(`t.category_id = $${paramIndex++}`);
    params.push(categoryId);
  }
  if (accountId) {
    conditions.push(`t.account_id = $${paramIndex++}`);
    params.push(accountId);
  }
  // Name-based filtering (for v1 API compatibility)
  if (categoryNames && categoryNames.length > 0) {
    const placeholders = categoryNames.map(() => `$${paramIndex++}`).join(', ');
    conditions.push(`c.name IN (${placeholders})`);
    params.push(...categoryNames);
  }
  if (accountNames && accountNames.length > 0) {
    const placeholders = accountNames.map(() => `$${paramIndex++}`).join(', ');
    conditions.push(`a.name IN (${placeholders})`);
    params.push(...accountNames);
  }
  if (currency) {
    conditions.push(`t.currency = $${paramIndex++}`);
    params.push(currency);
  }
  if (description) {
    conditions.push(`(t.description1 ILIKE $${paramIndex} OR t.description2 ILIKE $${paramIndex})`);
    params.push(`%${description}%`);
    paramIndex++;
  }
  if (minAmount !== undefined && minAmount !== null) {
    conditions.push(`t.base_amount >= $${paramIndex++}`);
    params.push(minAmount);
  }
  if (maxAmount !== undefined && maxAmount !== null) {
    conditions.push(`t.base_amount <= $${paramIndex++}`);
    params.push(maxAmount);
  }
  if (transferMatched !== undefined && transferMatched !== null && transferMatched !== '') {
    if (transferMatched === 'true') {
      conditions.push(`t.transfer_matched = TRUE`);
    } else if (transferMatched === 'false') {
      conditions.push(`t.transfer_matched = FALSE`);
    }
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const sql = `
    SELECT
      t.id, t.ps_id, t.transaction_date, t.description1, t.description2,
      t.amount, t.currency, t.base_amount, t.base_currency,
      t.transaction_type, t.closing_balance, t.labels, t.memo, t.note, t.bank, t.source,
      t.transfer_matched,
      t.account_id, a.name as account_name,
      t.category_id, c.name as category_name
    FROM transactions t
    LEFT JOIN accounts a ON t.account_id = a.id
    LEFT JOIN accounts c ON t.category_id = c.id
    ${whereClause}
    ORDER BY t.transaction_date DESC, t.id DESC
    LIMIT $${paramIndex++} OFFSET $${paramIndex}
  `;

  params.push(limit, offset);
  const result = await db.query(sql, params);
  return result.rows;
}

/**
 * Ledger view: transactions for ONE account, each row carrying its true
 * running balance (opening_balance + Σ amount up to and including that row),
 * computed over the account's FULL history via a window function.
 *
 * Unlike a client-side cumulative sum, this is correct regardless of the
 * date window or pagination limit — the seed is the real account balance,
 * not zero — so the newest displayed row ties out to the Balance Calibration
 * page (CR023: opening_balance + Σ all tx). Only valid for a single account
 * with at most a date range; any other filter (category/amount/etc.) would
 * make a per-row running balance meaningless, so the route falls back to
 * findAllExtended in those cases.
 */
/**
 * Distinct category names present on an account (optionally within a date range).
 *
 * The Ledger's category filter used to derive its options from the rows already
 * LOADED, which is only the first page — 500 rows. On PKO (4,572 rows) that meant
 * the filter could only ever offer categories from the most recent ~11% of the
 * account, and silently omitted the rest: `Financial Income - UB Dividend` sits at
 * position 532 and was unofferable, so the five United Beverages dividends could
 * not be found at all. Sourcing the options here makes the list complete
 * regardless of how much has been paged in.
 */
async function distinctCategoryNames({ accountName, startDate, endDate } = {}) {
  const params = [];
  const conditions = ['t.category_id IS NOT NULL'];
  let paramIndex = 1;

  if (accountName) {
    conditions.push(`a.name = $${paramIndex++}`);
    params.push(accountName);
  }
  if (startDate) {
    conditions.push(`t.transaction_date >= $${paramIndex++}`);
    params.push(startDate);
  }
  if (endDate) {
    conditions.push(`t.transaction_date <= $${paramIndex++}`);
    params.push(endDate);
  }

  const { rows } = await db.query(`
    SELECT DISTINCT c.name
      FROM transactions t
      JOIN accounts c ON c.id = t.category_id
      LEFT JOIN accounts a ON a.id = t.account_id
     WHERE ${conditions.join(' AND ')}
     ORDER BY c.name
  `, params);

  return rows.map((r) => r.name);
}

async function findLedgerWithRunningBalance({
  accountName, startDate, endDate, limit = 1000, offset = 0
} = {}) {
  const params = [accountName];
  let paramIndex = 2;
  const dateConditions = [];
  if (startDate) {
    dateConditions.push(`t.transaction_date >= $${paramIndex++}`);
    params.push(startDate);
  }
  if (endDate) {
    dateConditions.push(`t.transaction_date <= $${paramIndex++}`);
    params.push(endDate);
  }
  const dateClause = dateConditions.length > 0 ? `AND ${dateConditions.join(' AND ')}` : '';

  const sql = `
    WITH acct AS (
      SELECT id, opening_balance FROM accounts WHERE name = $1 ORDER BY id LIMIT 1
    ),
    hist AS (
      SELECT t.id,
             (SELECT opening_balance FROM acct)
               + SUM(t.amount) OVER (ORDER BY t.transaction_date, t.id) AS running_balance
      FROM transactions t
      WHERE t.account_id = (SELECT id FROM acct)
    )
    SELECT
      t.id, t.ps_id, t.transaction_date, t.description1, t.description2,
      t.amount, t.currency, t.base_amount, t.base_currency,
      t.transaction_type, t.closing_balance, t.labels, t.memo, t.note, t.bank, t.source,
      t.transfer_matched,
      t.account_id, a.name as account_name,
      t.category_id, c.name as category_name,
      h.running_balance
    FROM transactions t
    JOIN hist h ON h.id = t.id
    LEFT JOIN accounts a ON t.account_id = a.id
    LEFT JOIN accounts c ON t.category_id = c.id
    WHERE t.account_id = (SELECT id FROM acct) ${dateClause}
    ORDER BY t.transaction_date DESC, t.id DESC
    LIMIT $${paramIndex++} OFFSET $${paramIndex}
  `;

  params.push(limit, offset);
  const result = await db.query(sql, params);
  return result.rows;
}

/**
 * Get transaction by ID
 */
async function findById(id) {
  const sql = `
    SELECT
      t.*, a.name as account_name, c.name as category_name
    FROM transactions t
    LEFT JOIN accounts a ON t.account_id = a.id
    LEFT JOIN accounts c ON t.category_id = c.id
    WHERE t.id = $1
  `;
  const result = await db.query(sql, [id]);
  return result.rows[0] || null;
}

/**
 * Get transaction by PocketSmith ID
 */
async function findByPsId(psId) {
  const sql = `SELECT * FROM transactions WHERE ps_id = $1`;
  const result = await db.query(sql, [psId]);
  return result.rows[0] || null;
}

/**
 * Count transactions with optional filters
 */
async function count({ startDate, endDate, categoryId, accountId } = {}) {
  const conditions = [];
  const params = [];
  let paramIndex = 1;

  if (startDate) {
    conditions.push(`transaction_date >= $${paramIndex++}`);
    params.push(startDate);
  }
  if (endDate) {
    conditions.push(`transaction_date <= $${paramIndex++}`);
    params.push(endDate);
  }
  if (categoryId) {
    conditions.push(`category_id = $${paramIndex++}`);
    params.push(categoryId);
  }
  if (accountId) {
    conditions.push(`account_id = $${paramIndex++}`);
    params.push(accountId);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const sql = `SELECT COUNT(*)::int as count FROM transactions ${whereClause}`;

  const result = await db.query(sql, params);
  return result.rows[0].count;
}

/**
 * Get transactions grouped by category for a date range
 */
async function sumByCategory({ startDate, endDate, section } = {}) {
  const conditions = ['t.category_id IS NOT NULL'];
  const params = [];
  let paramIndex = 1;

  if (startDate) {
    conditions.push(`t.transaction_date >= $${paramIndex++}`);
    params.push(startDate);
  }
  if (endDate) {
    conditions.push(`t.transaction_date <= $${paramIndex++}`);
    params.push(endDate);
  }
  if (section) {
    conditions.push(`a.section = $${paramIndex++}`);
    params.push(section);
  }

  const sql = `
    SELECT
      c.id as category_id,
      c.name as category_name,
      a.name as account_name,
      a.account_type,
      SUM(t.base_amount) as total_amount,
      COUNT(*)::int as transaction_count
    FROM transactions t
    JOIN accounts c ON t.category_id = c.id
    LEFT JOIN accounts a ON c.parent_id = a.id
    WHERE ${conditions.join(' AND ')}
    GROUP BY c.id, c.name, a.name, a.account_type
    ORDER BY ABS(SUM(t.base_amount)) DESC
  `;

  const result = await db.query(sql, params);
  return result.rows;
}

/**
 * Get monthly totals for a date range
 */
async function sumByMonth({ startDate, endDate, categoryId } = {}) {
  const conditions = [];
  const params = [];
  let paramIndex = 1;

  if (startDate) {
    conditions.push(`transaction_date >= $${paramIndex++}`);
    params.push(startDate);
  }
  if (endDate) {
    conditions.push(`transaction_date <= $${paramIndex++}`);
    params.push(endDate);
  }
  if (categoryId) {
    conditions.push(`category_id = $${paramIndex++}`);
    params.push(categoryId);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const sql = `
    SELECT
      DATE_TRUNC('month', transaction_date)::date as month,
      SUM(base_amount) as total_amount,
      COUNT(*)::int as transaction_count
    FROM transactions
    ${whereClause}
    GROUP BY DATE_TRUNC('month', transaction_date)
    ORDER BY month
  `;

  const result = await db.query(sql, params);
  return result.rows;
}

/**
 * Create a new transaction
 */
async function create(data) {
  const source = data.source || 'manual';
  // CR025: manual entries must be accepted (else a feed refresh could sweep them).
  // Honour an explicit `accepted`; otherwise default TRUE for manual, FALSE for
  // other sources (preserving the prior column-default behavior for importers).
  const accepted = data.accepted !== undefined ? !!data.accepted : source === 'manual';
  const sql = `
    INSERT INTO transactions (
      ps_id, transaction_date, description1, description2,
      amount, currency, base_amount, base_currency,
      transaction_type, account_id, closing_balance,
      category_id, labels, memo, note, bank, source, accepted
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
    RETURNING *
  `;

  const result = await db.query(sql, [
    data.ps_id || null,
    data.transaction_date,
    data.description1 || null,
    data.description2 || null,
    data.amount,
    data.currency || 'USD',
    data.base_amount || data.amount,
    data.base_currency || 'USD',
    data.transaction_type || null,
    data.account_id || null,
    data.closing_balance || null,
    data.category_id || null,
    data.labels || null,
    data.memo || null,
    data.note || null,
    data.bank || null,
    source,
    accepted
  ]);

  return result.rows[0];
}

/**
 * Update a transaction
 */
async function update(id, data) {
  const fields = [];
  const params = [];
  let paramIndex = 1;

  const allowedFields = [
    'transaction_date', 'description1', 'description2', 'amount', 'currency',
    'base_amount', 'base_currency', 'transaction_type', 'account_id',
    'closing_balance', 'category_id', 'labels', 'memo', 'note', 'bank',
    'accepted'
  ];

  for (const field of allowedFields) {
    if (data[field] !== undefined) {
      fields.push(`${field} = $${paramIndex++}`);
      params.push(data[field]);
    }
  }

  if (fields.length === 0) return null;

  fields.push(`updated_at = NOW()`);
  params.push(id);

  const sql = `
    UPDATE transactions
    SET ${fields.join(', ')}
    WHERE id = $${paramIndex}
    RETURNING *
  `;

  const result = await db.query(sql, params);
  return result.rows[0] || null;
}

/**
 * Delete a transaction.
 *
 * A bank-feed-promoted row is pointed at by `bankfeed_staging.promoted_transaction_id`,
 * an FK with NO ACTION — so the bare DELETE raised a constraint violation and no fed
 * transaction could be deleted from the UI at all. Releasing the pointer is not enough:
 * `promote()` re-promotes any staging row where `promoted_transaction_id IS NULL AND
 * suppressed = FALSE`, so the row would come straight back on the next refresh.
 * Deleting a fed transaction means "I do not want this row" — record that as
 * `suppressed = TRUE`, in the same transaction as the delete.
 */
async function remove(id) {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE bankfeed_staging
       SET promoted_transaction_id = NULL, suppressed = TRUE
       WHERE promoted_transaction_id = $1`,
      [id]
    );
    const result = await client.query(
      `DELETE FROM transactions WHERE id = $1 RETURNING id`,
      [id]
    );
    await client.query('COMMIT');
    return result.rowCount > 0;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Split a transaction into multiple entries.
 * Updates the original with the first split's amount and creates new rows for the rest.
 * Account is always preserved from the original; each split can have a different category.
 *
 * @param {number} id - Original transaction ID
 * @param {Array<{amount: number, category_id?: number}>} splits - 2-5 split entries
 * @returns {Promise<{updated: object, created: object[]}>}
 */
async function split(id, splits) {
  const original = await findById(id);
  if (!original) throw new Error('Transaction not found');

  const originalAmount = parseFloat(original.amount);
  const originalBaseAmount = parseFloat(original.base_amount);

  // CR037 P6: the legs must redistribute the original amount, not change the
  // account total — the UI enforces this to the cent; hold the server to it.
  const splitSum = splits.reduce((sum, s) => sum + Number(s.amount), 0);
  if (!Number.isFinite(splitSum) || Math.abs(splitSum - originalAmount) > 0.011) {
    const err = new Error(
      `splits must sum to the original amount (${originalAmount.toFixed(2)}); got ${splitSum.toFixed(2)}`
    );
    err.status = 400;
    throw err;
  }

  // Distribute base_amount proportionally, then push the rounding residual
  // into the first leg so the legs always sum exactly to the original —
  // independent per-leg rounding can otherwise leak a cent into recon drift.
  const baseAmounts = splits.map((s) =>
    parseFloat((originalBaseAmount * (s.amount / originalAmount)).toFixed(2))
  );
  const roundedSum = baseAmounts.reduce((sum, v) => sum + v, 0);
  const residual = parseFloat((originalBaseAmount - roundedSum).toFixed(2));
  baseAmounts[0] = parseFloat((baseAmounts[0] + residual).toFixed(2));

  return db.transaction(async (client) => {
    // Update original transaction with first split
    const first = splits[0];
    const firstBaseAmount = baseAmounts[0];
    const firstCategoryId = first.category_id !== undefined ? first.category_id : original.category_id;

    const updateSql = `
      UPDATE transactions
      SET amount = $1, base_amount = $2, category_id = $3, updated_at = NOW()
      WHERE id = $4
      RETURNING *
    `;
    const updatedResult = await client.query(updateSql, [
      first.amount, firstBaseAmount, firstCategoryId, id
    ]);

    // Create new transactions for remaining splits
    const created = [];
    for (let i = 1; i < splits.length; i++) {
      const s = splits[i];
      const baseAmount = baseAmounts[i];
      const categoryId = s.category_id !== undefined ? s.category_id : original.category_id;

      const insertSql = `
        INSERT INTO transactions (
          ps_id, transaction_date, description1, description2,
          amount, currency, base_amount, base_currency,
          transaction_type, account_id, closing_balance,
          category_id, labels, memo, note, bank, source
        )
        VALUES (NULL, $1, $2, $3, $4, $5, $6, $7, $8, $9, NULL, $10, $11, $12, $13, $14, $15)
        RETURNING *
      `;
      const result = await client.query(insertSql, [
        original.transaction_date,
        original.description1,
        original.description2,
        s.amount,
        original.currency,
        baseAmount,
        original.base_currency,
        original.transaction_type,
        original.account_id,
        categoryId,
        original.labels,
        original.memo,
        original.note,
        original.bank,
        'split'
      ]);
      created.push(result.rows[0]);
    }

    return { updated: updatedResult.rows[0], created };
  });
}

/**
 * Neutralize a transaction so it doesn't distort P&L / the balance — for
 * brokerage security trades where cash is exchanged for shares (a transfer,
 * not income/expense).
 *
 * Smart behaviour:
 *  - If an OFFSETTING row already exists in the same account (the opposite
 *    amount, within a few days — e.g. the SPAXX "redemption from core" that
 *    funds an assigned-puts buy), PAIR them: set BOTH to "Transfer - Securities
 *    Trades" + accepted, create NO new entry. This is the case where the feed
 *    already delivered both legs — creating a mirror would double-count.
 *  - Otherwise (single-leg trade, no offset present) create the offsetting
 *    mirror entry with the negated amount, both categorized + accepted.
 *
 * Works from either leg (pairing matches the opposite amount, sign-agnostic).
 *
 * @param {number} id - Original transaction ID
 * @param {number} categoryId - Category ID for "Transfer - Securities Trades"
 * @returns {Promise<{original: object, offset: object, paired: boolean}>}
 */
const NEUTRALIZE_PAIR_DAYS = 3;

// CR065: how many times to re-look for a candidate when another transaction wins
// the race and claims the one we picked. Two concurrent neutralizes can compete
// for the same counter-leg; each lost race removes exactly one candidate from the
// pool, so a small bound is enough and cannot spin.
const NEUTRALIZE_CLAIM_ATTEMPTS = 3;

// The candidate predicate — ONE definition, used by both the preview and the
// apply, so the two can never drift apart and promise something the write does
// not deliver.
//
// CR032 guard: only pair with a row that is itself a neutralize candidate —
// uncategorized, or already in the same transfer category. A row the user
// deliberately categorized as a real trade (e.g. an assigned-puts buy →
// "Option Trade") must NOT be consumed as a sweep's offset just because it
// happens to be the same magnitude; that mislabels the trade and leaves the
// sweep un-mirrored (the exact CR028 mis-pairing).
//
// CR065 adds the two clauses that make "already spoken for" expressible at all:
//
//   paired_with_id IS NULL — the row has not already been claimed as someone
//     else's counter-leg. Before 053 this was unrepresentable, so the SAME leg
//     could be claimed by any number of originals: two identical -150,000 CD
//     purchases on 2026-07-30 both paired against one +150,000 mirror and the
//     account ran $150k light. Note this is NOT `accepted = FALSE` — accepting a
//     row in the review queue means "I have looked at this", not "this is spent",
//     and conflating them would refuse legitimate pairs and mirror instead,
//     which double-counts in the other direction.
//
//   source <> 'auto-offset' — a synthetic mirror is never a pair candidate. It
//     was created to answer exactly one leg; an unclaimed one is an orphan to be
//     removed (Transfer Analysis), not a leg to pair with. This also covers
//     pre-053 mirrors, which carry no link to reconstruct.
const NEUTRALIZE_CANDIDATE_SQL = `
  SELECT * FROM transactions
   WHERE account_id = $1 AND id <> $2
     AND amount = $3
     AND transaction_date BETWEEN $4::date - $5::int AND $4::date + $5::int
     AND (category_id IS NULL OR category_id = $6)
     AND paired_with_id IS NULL
     AND source <> 'auto-offset'
   ORDER BY ABS(transaction_date - $4::date), id
   LIMIT 1`;

/**
 * Neutralize a transaction so it doesn't distort P&L / the balance.
 *
 * 'pair'          → an unclaimed opposite leg exists nearby → categorize both and
 *                   link them. No new row (the feed already delivered both legs;
 *                   a mirror here would double-count).
 * 'mirror'        → none found → INSERT the offsetting entry and link it.
 * 'already-paired'→ this row is already half of a pair → no-op. Re-clicking, or a
 *                   double-submit, must never produce a second counter-leg.
 *
 * Every path leaves the pair recorded symmetrically in `paired_with_id`, which a
 * partial unique index (migration 053) holds to one claimant per row.
 */
async function neutralize(id, categoryId, { dryRun = false } = {}) {
  const original = await findById(id);
  if (!original) throw new Error('Transaction not found');

  const negatedAmount = parseFloat((-parseFloat(original.amount)).toFixed(2));
  const negatedBaseAmount = parseFloat((-parseFloat(original.base_amount)).toFixed(2));
  const candidateParams = [
    original.account_id, id, negatedAmount,
    original.transaction_date, NEUTRALIZE_PAIR_DAYS, categoryId,
  ];

  if (dryRun) {
    if (original.paired_with_id != null) {
      return { action: 'already-paired', dryRun: true, paired: true, offset_id: original.paired_with_id, offset_description: null };
    }
    const preview = (await db.query(NEUTRALIZE_CANDIDATE_SQL, candidateParams)).rows[0];
    return {
      action: preview ? 'pair' : 'mirror', dryRun: true, paired: !!preview,
      offset_id: preview ? preview.id : null,
      offset_description: preview ? preview.description1 : null,
    };
  }

  return db.transaction(async (client) => {
    // Lock the original before deciding anything. Two concurrent neutralizes of
    // the SAME row would otherwise both see "unpaired" and both insert a mirror.
    const locked = (await client.query(
      `SELECT id, paired_with_id FROM transactions WHERE id = $1 FOR UPDATE`, [id]
    )).rows[0];
    if (!locked) throw new Error('Transaction not found');
    if (locked.paired_with_id != null) {
      const [self, partner] = await Promise.all([
        client.query(`SELECT * FROM transactions WHERE id = $1`, [id]),
        client.query(`SELECT * FROM transactions WHERE id = $1`, [locked.paired_with_id]),
      ]);
      return {
        original: self.rows[0], offset: partner.rows[0] || null,
        paired: true, action: 'already-paired',
      };
    }

    // Claim a counter-leg by compare-and-swap rather than by locking it: the
    // UPDATE only takes a row that is STILL unclaimed, so a racing neutralize
    // that got there first loses the swap instead of silently sharing the leg.
    // A lost race means the pool shrank by one — look again rather than falling
    // straight to a mirror, which would double-count against the leg we lost.
    let offset = null;
    for (let attempt = 0; attempt < NEUTRALIZE_CLAIM_ATTEMPTS && !offset; attempt++) {
      const candidate = (await client.query(NEUTRALIZE_CANDIDATE_SQL, candidateParams)).rows[0];
      if (!candidate) break;
      const claimed = await client.query(
        `UPDATE transactions
            SET category_id = $1, accepted = TRUE, paired_with_id = $2, updated_at = NOW()
          WHERE id = $3 AND paired_with_id IS NULL
          RETURNING *`,
        [categoryId, id, candidate.id]
      );
      offset = claimed.rows[0] || null;
    }

    if (!offset) {
      // No unclaimed counter-leg → inject the missing one. This is the only path
      // that can create an orphan, which is why the UI warns before it runs.
      offset = (await client.query(`
        INSERT INTO transactions (
          ps_id, transaction_date, description1, description2,
          amount, currency, base_amount, base_currency,
          transaction_type, account_id, closing_balance,
          category_id, labels, memo, note, bank, source, accepted, paired_with_id
        )
        VALUES (NULL, $1, $2, $3, $4, $5, $6, $7, $8, $9, NULL, $10, $11, $12, $13, $14, 'auto-offset', TRUE, $15)
        RETURNING *
      `, [
        original.transaction_date,
        original.description1,
        original.description2,
        negatedAmount,
        original.currency,
        negatedBaseAmount,
        original.base_currency,
        original.transaction_type,
        original.account_id,
        categoryId,
        original.labels,
        original.memo,
        original.note,
        original.bank,
        id,
      ])).rows[0];
    }

    const updated = await client.query(
      `UPDATE transactions
          SET category_id = $1, accepted = TRUE, paired_with_id = $2, updated_at = NOW()
        WHERE id = $3
        RETURNING *`,
      [categoryId, offset.id, id]
    );

    const paired = offset.source !== 'auto-offset';
    return { original: updated.rows[0], offset, paired, action: paired ? 'pair' : 'mirror' };
  });
}

/**
 * Record a transaction as a transfer to another tracked account (CR022).
 * Marks the original accepted (keeping its category) and creates an offsetting
 * entry in the target account with the negated amount + base_amount, same date
 * and category, source='auto-offset', accepted. Net effect on USD net worth is
 * zero (the two base_amounts cancel) — e.g. a -3000 PLN PKO outflow funding the
 * OCME business account creates a +3000 PLN entry on OCME.
 *
 * V1 carries the original's currency to the offset (correct for same-currency
 * transfers, the common case); the USD balance sheet nets regardless via the
 * negated base_amount.
 *
 * @param {number} id - original transaction id
 * @param {number} targetAccountId - account to receive the offsetting entry
 * @returns {Promise<{original: object, offset: object}>}
 */
async function transferToAccount(id, targetAccountId) {
  const original = await findById(id);
  if (!original) throw new Error('Transaction not found');
  if (Number(targetAccountId) === Number(original.account_id)) {
    throw new Error('Transfer target must differ from the source account');
  }

  const negatedAmount = parseFloat((-parseFloat(original.amount)).toFixed(2));
  const negatedBaseAmount = original.base_amount != null
    ? parseFloat((-parseFloat(original.base_amount)).toFixed(2))
    : null;

  return db.transaction(async (client) => {
    const updated = await client.query(
      `UPDATE transactions SET accepted = TRUE, updated_at = NOW() WHERE id = $1 RETURNING *`,
      [id]
    );
    if (updated.rows.length === 0) throw new Error('Transaction not found');

    const offset = await client.query(`
      INSERT INTO transactions (
        ps_id, transaction_date, description1, description2,
        amount, currency, base_amount, base_currency,
        transaction_type, account_id, closing_balance,
        category_id, labels, memo, note, bank, source, accepted
      )
      VALUES (NULL, $1, $2, $3, $4, $5, $6, $7, $8, $9, NULL, $10, $11, $12, $13, $14, 'auto-offset', TRUE)
      RETURNING *
    `, [
      original.transaction_date,
      original.description1,
      original.description2,
      negatedAmount,
      original.currency,
      negatedBaseAmount,
      original.base_currency || 'USD',
      original.transaction_type,
      targetAccountId,
      original.category_id,
      original.labels,
      original.memo,
      original.note,
      original.bank,
    ]);

    return { original: updated.rows[0], offset: offset.rows[0] };
  });
}

/**
 * Fetch all transfer-category transactions for a date range.
 * Returns rows joined with account/category names, filtered to categories
 * where is_transfer = TRUE and skip_transfer_analysis = FALSE. The latter
 * column (added by CR019 migration 022) excludes transfer-flagged leaves
 * that don't have a matching pair — notably "Return of Capital" — which
 * would otherwise surface as perpetually-unmatched in /transfer-analysis.
 */
async function findTransfers({ startDate, endDate } = {}) {
  const conditions = ['c.is_transfer = TRUE', 'c.skip_transfer_analysis = FALSE'];
  const params = [];
  let paramIndex = 1;

  if (startDate) {
    conditions.push(`t.transaction_date >= $${paramIndex++}`);
    params.push(startDate);
  }
  if (endDate) {
    conditions.push(`t.transaction_date <= $${paramIndex++}`);
    params.push(endDate);
  }

  const sql = `
    SELECT
      t.id, t.transaction_date, t.description1, t.description2,
      t.amount, t.currency, t.base_amount, t.base_currency,
      t.account_id, a.name as account_name,
      t.category_id, c.name as category_name, t.source
    FROM transactions t
    LEFT JOIN accounts a ON t.account_id = a.id
    JOIN accounts c ON t.category_id = c.id
    WHERE ${conditions.join(' AND ')}
    ORDER BY c.name, t.transaction_date, t.id
  `;

  const result = await db.query(sql, params);
  return result.rows;
}

/**
 * Find the implied FX rate for a given currency on (or near) a specific date.
 * Looks for another transaction with the same currency where both amount and
 * base_amount are non-zero, then derives rate = amount / base_amount.
 * Searches exact date first, then widens to ±1, ±2, ±3 days.
 * Picks the transaction with the largest absolute amount for a stable ratio.
 *
 * @param {string} currency - e.g. "EUR"
 * @param {string} targetDate - YYYY-MM-DD
 * @param {number} excludeId - transaction ID to exclude from lookup
 * @returns {Promise<{rate: number, source_date: string, source_id: number} | null>}
 */
async function findImpliedRate(currency, targetDate, excludeId) {
  const sql = `
    SELECT id, transaction_date, amount, base_amount,
           ABS(transaction_date::date - $1::date) AS day_diff
    FROM transactions
    WHERE currency = $2
      AND id != $3
      AND amount != 0
      AND base_amount != 0
      AND ABS(transaction_date::date - $1::date) <= 3
    ORDER BY
      ABS(transaction_date::date - $1::date) ASC,
      ABS(amount) DESC
    LIMIT 1
  `;
  const result = await db.query(sql, [targetDate, currency, excludeId]);
  if (result.rows.length === 0) return null;

  const row = result.rows[0];
  const amount = parseFloat(row.amount);
  const baseAmount = parseFloat(row.base_amount);
  if (!Number.isFinite(amount) || !Number.isFinite(baseAmount) || baseAmount === 0) return null;

  return {
    rate: amount / baseAmount,
    source_date: row.transaction_date,
    source_id: row.id,
  };
}

/**
 * Bulk-update the transfer_matched flag for transfer-category transactions.
 * Sets matched=true for matchedIds, matched=false for unmatchedIds,
 * and NULL for any transfer transactions outside the given date range.
 */
async function updateTransferMatchedFlags({ matchedIds, unmatchedIds, startDate, endDate }) {
  // Ensure IDs are integers (pg returns bigint as string)
  const matchedInts = matchedIds.map(id => parseInt(id));
  const unmatchedInts = unmatchedIds.map(id => parseInt(id));

  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    // Set matched = true
    if (matchedInts.length > 0) {
      await client.query(
        `UPDATE transactions SET transfer_matched = TRUE WHERE id = ANY($1::bigint[])`,
        [matchedInts]
      );
    }

    // Set matched = false
    if (unmatchedInts.length > 0) {
      await client.query(
        `UPDATE transactions SET transfer_matched = FALSE WHERE id = ANY($1::bigint[])`,
        [unmatchedInts]
      );
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  findAll,
  findAllExtended,
  findLedgerWithRunningBalance,
  distinctCategoryNames,
  findById,
  findByPsId,
  count,
  sumByCategory,
  sumByMonth,
  create,
  update,
  remove,
  split,
  neutralize,
  transferToAccount,
  findTransfers,
  findImpliedRate,
  updateTransferMatchedFlags
};
