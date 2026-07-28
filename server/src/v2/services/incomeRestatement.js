'use strict';
/**
 * incomeRestatement.js — CR057 "Book Income at Source".
 *
 * Investment income is recorded on the account where the CASH LANDED, not on the
 * holding that EARNED it. United Beverages' 5 dividends and Barkeria's 2 payments
 * all post to PKO, so /investment-returns — which scopes strictly to
 * "transactions on the selected account" — reports UB at a confident 0.00%
 * against ~25M PLN of average capital.
 *
 * The fix is a THREE-LEG booking, which records what actually happened:
 *
 *   leg 1 (new)   holding   +A / +B   the original income category
 *   leg 2 (new)   holding   -A / -B   Transfer - Distributions
 *   leg 3 (edit)  cash row  untouched amounts, category -> Transfer - Distributions
 *
 * Legs 1+2 are same-account, same-date, equal-and-opposite, so the holding's book
 * value DOES NOT MOVE — which is what keeps every existing `Unrealized G/L` mark
 * valid (each was written as `target - book`), and what leaves the balance sheet,
 * net worth, forecast module re-basing and manual calibration untouched.
 *
 * Why this is legitimate where CR056 said it was not: CR056 rejected moving the
 * income to the holding as identity-breaking, but that objection only ever covered
 * a ONE-legged change. With the transfer leg,
 *     Δ totalReturn = Δ(EMV-BMV) - Δ netFlows = 0 - (-A) = +A = Δ income,
 * and investmentReturns.bucketOf has no fall-through, so leg 1 lands in `income`
 * and leg 2 in `flow` by construction.
 *
 * The invariants below are ENFORCED, not asserted — CR057 pass 1 rejected an
 * earlier draft precisely for asserting them. In particular invariant 5: if the
 * transfer category arrived with is_transfer = FALSE, leg 2 would bucket as
 * `income`, income would net to zero, the report would still read 0.00%, and the
 * reconciliation identity would STILL close (fxEffect is a plug). Nothing
 * downstream would surface it, so it is checked here.
 */

const db = require('../db');
const AppError = require('../utils/AppError');

const RESTATEMENT_SOURCE = 'restatement';
const TRANSFER_CATEGORY_NAME = 'Transfer - Distributions';

/** Fields compared field-by-field on undo. A divergence means "refuse". */
const SNAPSHOT_FIELDS = ['account_id', 'transaction_date', 'amount', 'base_amount', 'category_id'];

/** Money comparison on the 2dp scale the columns store. */
const cents = (v) => Math.round(parseFloat(v) * 100);

/** ISO date, tolerating both a pg DATE (Date object) and a string. */
function isoDate(value) {
  if (value instanceof Date) {
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
  }
  return String(value).slice(0, 10);
}

function snapshotOf(row) {
  return {
    account_id: row.account_id,
    transaction_date: isoDate(row.transaction_date),
    amount: parseFloat(row.amount).toFixed(2),
    base_amount: row.base_amount === null ? null : parseFloat(row.base_amount).toFixed(2),
    category_id: row.category_id,
  };
}

function snapshotsMatch(a, b) {
  return SNAPSHOT_FIELDS.every((f) => {
    if (a[f] === null || b[f] === null) return a[f] === b[f];
    return String(a[f]) === String(b[f]);
  });
}

/**
 * Resolve + validate the `Transfer - Distributions` category.
 *
 * Invariant 5. Migration 041 creates the row with the right flags; this re-checks
 * at call time so a hand-edited or hand-created row cannot silently mis-bucket
 * leg 2.
 */
async function resolveTransferCategory(client = db) {
  const { rows } = await client.query(
    `SELECT id, name, is_transfer, section, account_type
       FROM accounts WHERE name = $1`,
    [TRANSFER_CATEGORY_NAME]
  );
  const cat = rows[0];
  if (!cat) {
    throw AppError.badRequest(
      `Category "${TRANSFER_CATEGORY_NAME}" not found. Apply migration 041 before using this action.`
    );
  }
  if (cat.is_transfer !== true || cat.section !== 'profit_loss') {
    throw AppError.badRequest(
      `Category "${TRANSFER_CATEGORY_NAME}" is mis-flagged (is_transfer=${cat.is_transfer}, ` +
      `section=${cat.section}) — expected (true, profit_loss). Fix it in COA Management; ` +
      `with is_transfer=false the restatement would silently net the income to zero.`
    );
  }
  return cat;
}

/**
 * Read the source row + its category + the target holding, and apply every
 * pre-write guard. Shared by the dry-run preview and the write so the preview
 * cannot drift from what actually happens.
 */
async function loadAndValidate(id, holdingAccountId, client = db) {
  const { rows: srcRows } = await client.query(
    `SELECT t.*, c.name AS category_name, c.account_type AS category_account_type,
            a.name AS account_name
       FROM transactions t
       LEFT JOIN accounts c ON c.id = t.category_id
       LEFT JOIN accounts a ON a.id = t.account_id
      WHERE t.id = $1`,
    [id]
  );
  const source = srcRows[0];
  if (!source) throw AppError.notFound('Transaction not found');

  // Checked FIRST, and it has to be: booking rewrites this row's category to the
  // transfer category, so every later guard sees an *expense* row. Ordered after
  // the type check, a second attempt reported "only income can be booked at
  // source" — true but misleading, and it hid the real answer (already booked).
  const existing = await client.query(
    `SELECT id FROM income_restatements WHERE source_transaction_id = $1`,
    [id]
  );
  if (existing.rows.length > 0) {
    throw AppError.conflict('This transaction has already been booked at source');
  }

  if (!Number.isInteger(holdingAccountId)) {
    throw AppError.badRequest('holding_account_id must be an integer');
  }
  if (Number(holdingAccountId) === Number(source.account_id)) {
    throw AppError.badRequest('The holding must differ from the account the cash landed in');
  }
  if (source.category_id === null) {
    throw AppError.badRequest('This transaction has no category — categorize it before booking it at source');
  }
  if (source.category_account_type !== 'income') {
    throw AppError.badRequest(
      `Only income can be booked at source; "${source.category_name}" is ${source.category_account_type}. ` +
      `A missing transfer counter-leg is a different repair.`
    );
  }

  const { rows: holdRows } = await client.query(
    `SELECT id, name, currency, section FROM accounts WHERE id = $1`,
    [holdingAccountId]
  );
  const holding = holdRows[0];
  if (!holding) throw AppError.badRequest('Holding account not found');
  if (holding.section !== 'balance_sheet') {
    throw AppError.badRequest(`"${holding.name}" is not a balance-sheet account`);
  }
  // Invariant 4. Unexercised by the CR057 scope (all PLN→PLN) but it is what makes
  // the deferred cross-currency sets (CVC: USD rows, EUR funds) safe-to-refuse
  // rather than silently mishandled.
  if ((holding.currency || '').trim() !== (source.currency || '').trim()) {
    throw AppError.badRequest(
      `Currency mismatch: the transaction is ${source.currency} but "${holding.name}" is ` +
      `${holding.currency}. A cross-currency leg needs a rate policy this action does not take.`
    );
  }

  const category = await resolveTransferCategory(client);
  return { source, holding, category };
}

/** The two legs we would write, derived once and used by both preview and write. */
function buildLegs(source, holding, categoryId) {
  const amount = parseFloat(source.amount);
  const baseAmount = source.base_amount === null ? null : parseFloat(source.base_amount);
  const date = isoDate(source.transaction_date);

  const common = {
    account_id: holding.id,
    transaction_date: date,
    currency: source.currency,
    base_currency: source.base_currency || 'USD',
    source: RESTATEMENT_SOURCE,
  };

  return {
    // Invariant 1: copied and negated EXACTLY. Never re-derived from an FX table —
    // a one-cent divergence would accrue a permanent USD residual on the holding
    // and surface as noise in CR056's `FX effect` row.
    income: {
      ...common,
      amount,
      base_amount: baseAmount,
      category_id: source.category_id,
      description1: source.description1,
      description2: `CR057 restatement of tx ${source.id}`,
    },
    transfer: {
      ...common,
      amount: -amount,
      base_amount: baseAmount === null ? null : -baseAmount,
      category_id: categoryId,
      description1: `Distribution to ${source.account_name || 'cash account'}`,
      description2: `CR057 restatement of tx ${source.id}`,
    },
  };
}

/**
 * Invariant 1 + 2, checked as arithmetic rather than trusted. Runs immediately
 * before the write AND immediately before an undo's delete — an undo that removed
 * legs which no longer net to zero would move the holding's book value, silently
 * invalidating every subsequent mark.
 */
function assertNetsToZero(incomeLeg, transferLeg, context) {
  const amt = cents(incomeLeg.amount) + cents(transferLeg.amount);
  if (amt !== 0) {
    throw AppError.conflict(`${context}: the two legs do not net to zero on amount (${amt / 100})`);
  }
  const a = incomeLeg.base_amount;
  const b = transferLeg.base_amount;
  if (a === null || b === null) {
    if (a !== b) throw AppError.conflict(`${context}: one leg has a base amount and the other does not`);
    return;
  }
  const base = cents(a) + cents(b);
  if (base !== 0) {
    throw AppError.conflict(`${context}: the two legs do not net to zero on base amount (${base / 100})`);
  }
}

const INSERT_LEG = `
  INSERT INTO transactions (
    transaction_date, description1, description2,
    amount, currency, base_amount, base_currency,
    account_id, category_id, source, accepted
  ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, TRUE)
  RETURNING *`;

/**
 * Book an income transaction at the holding that earned it.
 *
 * @param {number} id transaction id (the row on the cash account)
 * @param {number} holdingAccountId the balance-sheet account that earned it
 * @param {{dryRun?: boolean}} opts
 */
async function bookAtSource(id, holdingAccountId, { dryRun = false } = {}) {
  if (dryRun) {
    const { source, holding, category } = await loadAndValidate(id, holdingAccountId);
    const legs = buildLegs(source, holding, category.id);
    assertNetsToZero(legs.income, legs.transfer, 'Preview');
    const book = await holdingBook(holding.id);
    return {
      dryRun: true,
      source: {
        id: source.id,
        transaction_date: isoDate(source.transaction_date),
        description1: source.description1,
        amount: parseFloat(source.amount).toFixed(2),
        base_amount: source.base_amount === null ? null : parseFloat(source.base_amount).toFixed(2),
        currency: source.currency,
        account_name: source.account_name,
        category_name: source.category_name,
      },
      holding: { id: holding.id, name: holding.name, currency: holding.currency },
      create: [legs.income, legs.transfer],
      update: {
        transaction_id: source.id,
        from_category_id: source.category_id,
        from_category_name: source.category_name,
        to_category_id: category.id,
        to_category_name: category.name,
      },
      holding_book_before: book,
      holding_book_after: book, // legs net to zero — asserted above, not hoped for
    };
  }

  return db.transaction(async (client) => {
    const { source, holding, category } = await loadAndValidate(id, holdingAccountId, client);
    const legs = buildLegs(source, holding, category.id);
    assertNetsToZero(legs.income, legs.transfer, 'Refusing to write');

    const toParams = (leg) => [
      leg.transaction_date, leg.description1, leg.description2,
      leg.amount, leg.currency, leg.base_amount, leg.base_currency,
      leg.account_id, leg.category_id, leg.source,
    ];

    // Transfer leg first so the Ledger's same-day running balance never displays a
    // spurious positive spike on the holding before the offset lands (N4).
    const transferRow = (await client.query(INSERT_LEG, toParams(legs.transfer))).rows[0];
    const incomeRow = (await client.query(INSERT_LEG, toParams(legs.income))).rows[0];

    const updated = (await client.query(
      `UPDATE transactions SET category_id = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
      [category.id, source.id]
    )).rows[0];

    const snapshot = { income: snapshotOf(incomeRow), transfer: snapshotOf(transferRow) };

    const restatement = (await client.query(
      `INSERT INTO income_restatements (
         source_transaction_id, holding_account_id, original_category_id,
         income_leg_id, transfer_leg_id, leg_snapshot
       ) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [source.id, holding.id, source.category_id, incomeRow.id, transferRow.id, JSON.stringify(snapshot)]
    )).rows[0];

    return {
      restatement_id: restatement.id,
      created: [incomeRow, transferRow],
      updated,
      holding: { id: holding.id, name: holding.name },
    };
  });
}

/**
 * Reverse a restatement exactly, or refuse.
 *
 * The refusal is the point: if either created leg has been edited since it was
 * written, deleting the pair would move the holding's book value and silently
 * invalidate every `Unrealized G/L` mark that came after it.
 */
async function undoBookAtSource(id) {
  return db.transaction(async (client) => {
    const { rows } = await client.query(
      `SELECT * FROM income_restatements WHERE source_transaction_id = $1`,
      [id]
    );
    const rec = rows[0];
    if (!rec) throw AppError.conflict('This transaction has not been booked at source');

    const legRows = (await client.query(
      `SELECT * FROM transactions WHERE id = ANY($1::bigint[])`,
      [[rec.income_leg_id, rec.transfer_leg_id]]
    )).rows;

    const byId = new Map(legRows.map((r) => [String(r.id), r]));
    const incomeRow = byId.get(String(rec.income_leg_id));
    const transferRow = byId.get(String(rec.transfer_leg_id));
    if (!incomeRow || !transferRow) {
      throw AppError.conflict(
        'Refusing to undo: one of the created legs no longer exists. Repair the ledger by hand.'
      );
    }

    const stored = typeof rec.leg_snapshot === 'string' ? JSON.parse(rec.leg_snapshot) : rec.leg_snapshot;
    if (!snapshotsMatch(stored.income, snapshotOf(incomeRow))
        || !snapshotsMatch(stored.transfer, snapshotOf(transferRow))) {
      throw AppError.conflict(
        'Refusing to undo: a created leg has been edited since it was written. '
        + 'Deleting it now would change the holding\'s book value.'
      );
    }
    assertNetsToZero(incomeRow, transferRow, 'Refusing to undo');

    // Order matters: income_leg_id / transfer_leg_id are plain FKs (NO ACTION), so
    // the legs cannot be deleted while this row still points at them. Drop the
    // restatement record first, then the legs, then restore the category.
    await client.query(`DELETE FROM income_restatements WHERE id = $1`, [rec.id]);

    await client.query(`DELETE FROM transactions WHERE id = ANY($1::bigint[])`,
      [[rec.income_leg_id, rec.transfer_leg_id]]);

    const restored = (await client.query(
      `UPDATE transactions SET category_id = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
      [rec.original_category_id, rec.source_transaction_id]
    )).rows[0];

    return {
      deleted: [rec.income_leg_id, rec.transfer_leg_id],
      restored_category_id: rec.original_category_id,
      restored,
    };
  });
}

/** Book value of a holding, both currencies — the number invariant 2 protects. */
async function holdingBook(accountId, client = db) {
  const { rows } = await client.query(
    `SELECT COALESCE(SUM(amount), 0) AS amount, COALESCE(SUM(base_amount), 0) AS base_amount
       FROM transactions WHERE account_id = $1`,
    [accountId]
  );
  return {
    amount: parseFloat(rows[0].amount).toFixed(2),
    base_amount: parseFloat(rows[0].base_amount).toFixed(2),
  };
}

/** Restatements keyed by source transaction id, for the Ledger to show Undo. */
async function findBySourceIds(ids) {
  if (!Array.isArray(ids) || ids.length === 0) return [];
  const { rows } = await db.query(
    `SELECT r.*, a.name AS holding_name
       FROM income_restatements r
       JOIN accounts a ON a.id = r.holding_account_id
      WHERE r.source_transaction_id = ANY($1::bigint[])`,
    [ids]
  );
  return rows;
}

module.exports = {
  bookAtSource,
  undoBookAtSource,
  findBySourceIds,
  holdingBook,
  resolveTransferCategory,
  // exported for tests
  buildLegs,
  assertNetsToZero,
  snapshotOf,
  snapshotsMatch,
  TRANSFER_CATEGORY_NAME,
  RESTATEMENT_SOURCE,
};
