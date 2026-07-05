/**
 * manualStatementImport — CR036 P1 orchestration for the stale-feed fallback.
 *
 * When a live feed goes stale, the owner uploads that bank's own statement
 * export. The bank-feed service owns PARSING (the format layer / profiles); this
 * module owns everything that needs fin's ledger + per-account sign flags:
 *
 *   preview()  parse → classify each row (new / already-in-ledger) → compute the
 *              hypothetical reconciled drift. NO writes. This is the gate.
 *   commit()   parse → align signs to feed-native → write to the service
 *              (feed_transactions + feed_balances) → ingest+promote (the
 *              generalized any-source dedup imports ONLY new rows) → reconcile.
 *
 * SIGN MODEL (the footgun — see CR036 §3.3):
 *   - The profile emits transaction `amount` in fin convention (outflow negative)
 *     and a positive balance MAGNITUDE. It does NOT know the account's flags.
 *   - fin stores a liability's balance negative and applies `feed_sign` at recon,
 *     and applies `feed_negate_tx` at promote. So to make the stored data line up
 *     with the LIVE feed's convention (which those flags were tuned for), we:
 *       feed-native tx amount = feed_negate_tx ? -finAmount : finAmount
 *       fin balance           = liability ? -magnitude : magnitude
 *       stored feed balance   = finBalance * effFeedSign
 *     where effFeedSign = feed_sign ?? (liability ? -1 : 1).
 *   The drift gate is the safety net: any sign error shows as a large, visible
 *   drift in preview before commit — nothing is silently mis-booked.
 */

const db = require('../db');
const client = require('./bankFeedClient');
const refreshBankFeed = require('./refreshBankFeedV2');
const bankFeedReconciliation = require('../repositories/bankFeedReconciliation');
const { findPsMatch } = require('../converters/bankFeedToCanonical');

const TOLERANCE = 0.01;

// ---- pure sign helpers (unit-tested) --------------------------------------

function effFeedSign(feedSign, accountType) {
  if (feedSign === 0 || feedSign) return Number(feedSign);
  return accountType === 'liability' ? -1 : 1;
}

function finBalanceFromMagnitude(magnitude, accountType) {
  if (magnitude == null) return null;
  return accountType === 'liability' ? -Math.abs(magnitude) : Math.abs(magnitude);
}

function feedNativeAmount(finAmount, feedNegateTx) {
  return feedNegateTx ? -Number(finAmount) : Number(finAmount);
}

function round2(n) { return Math.round(Number(n) * 100) / 100; }

// ---- shared context -------------------------------------------------------

async function loadAccountContext(accountExternalId) {
  const { rows } = await db.query(
    `SELECT m.account_id, m.feed_sign, m.feed_negate_tx, m.ignored, m.promote_from_date::text AS promote_from_date,
            a.name, a.account_type, a.opening_balance
     FROM account_source_mappings m
     JOIN accounts a ON a.id = m.account_id
     WHERE m.source = 'bank-feed' AND m.external_name = $1`,
    [accountExternalId]
  );
  return rows[0] || null;
}

async function currentComputedBalance(accountId) {
  const { rows } = await db.query(
    `SELECT ROUND(a.opening_balance + COALESCE(SUM(t.amount), 0), 2) AS computed
     FROM accounts a LEFT JOIN transactions t ON t.account_id = a.id
     WHERE a.id = $1 GROUP BY a.opening_balance`,
    [accountId]
  );
  return rows[0] ? Number(rows[0].computed) : null;
}

// Classify parsed rows against the existing ledger for this account. Returns the
// same dedup semantics promote() will apply, so the preview matches the commit.
async function classifyRows(accountId, parsedRows) {
  if (!parsedRows.length) return { rows: [], newSum: 0, counts: { parsed: 0, new: 0, exactDuplicate: 0, ledgerDuplicate: 0 } };
  const dates = parsedRows.map((r) => r.transaction_date).sort();
  const minDate = dates[0];
  const maxDate = dates[dates.length - 1];

  const { rows: candidates } = await db.query(
    `SELECT id, account_id, amount, currency, transaction_date::text AS transaction_date,
            description1 AS description, source, bank_feed_external_id
     FROM transactions
     WHERE account_id = $1 AND transaction_date BETWEEN $2::date - 1 AND $3::date + 1`,
    [accountId, minDate, maxDate]
  );
  const existingExtIds = new Set(candidates.filter((c) => c.bank_feed_external_id).map((c) => c.bank_feed_external_id));

  let newSum = 0;
  const counts = { parsed: parsedRows.length, new: 0, exactDuplicate: 0, ledgerDuplicate: 0 };
  const rows = parsedRows.map((r) => {
    let classification;
    let matched = null;
    if (existingExtIds.has(r.external_id)) {
      classification = 'exact-duplicate';
      counts.exactDuplicate++;
    } else {
      const m = findPsMatch(
        { account_id: accountId, amount: r.amount, currency: r.currency, transaction_date: r.transaction_date, description: r.description },
        candidates
      );
      if (m) {
        classification = 'ledger-duplicate';
        counts.ledgerDuplicate++;
        matched = { id: m.id, source: m.source, transaction_date: m.transaction_date, amount: Number(m.amount), description: m.description };
      } else {
        classification = 'new';
        counts.new++;
        newSum = round2(newSum + Number(r.amount));
      }
    }
    return { ...r, classification, matched };
  });
  return { rows, newSum, counts, minDate, maxDate };
}

// ---- preview --------------------------------------------------------------

// CR036 P2: mapper-built profiles carry no preamble balance regex, so the user
// may type the statement's stated balance + as-of date; that override wins
// over (the usually-absent) parsed balance.
function resolveStatedBalance(parsedBalance, statedBalance) {
  if (statedBalance && statedBalance.magnitude != null && statedBalance.date &&
      Number.isFinite(Number(statedBalance.magnitude))) {
    return {
      magnitude: Math.abs(Number(statedBalance.magnitude)),
      balance_date: String(statedBalance.date),
      currency: statedBalance.currency || (parsedBalance && parsedBalance.currency) || 'USD',
    };
  }
  return parsedBalance;
}

async function preview({ accountExternalId, csv, profileId, profile, statedBalance } = {}) {
  const parsed = await client.manualParse({ accountExternalId, csv, profileId, profile });
  parsed.balance = resolveStatedBalance(parsed.balance, statedBalance);
  const ctx = await loadAccountContext(accountExternalId);
  if (!ctx) {
    const e = new Error(`no bank-feed mapping for account ${accountExternalId} — map it before uploading a statement`);
    e.status = 409;
    throw e;
  }

  const { rows, newSum, counts } = await classifyRows(ctx.account_id, parsed.rows);
  const computed = await currentComputedBalance(ctx.account_id);

  const magnitude = parsed.balance ? parsed.balance.magnitude : null;
  const finBalance = finBalanceFromMagnitude(magnitude, ctx.account_type);
  const hypothetical = computed != null ? round2(computed + newSum) : null;
  const drift = (finBalance != null && hypothetical != null) ? round2(hypothetical - finBalance) : null;

  return {
    account: {
      external_id: accountExternalId,
      account_id: ctx.account_id,
      name: ctx.name,
      account_type: ctx.account_type,
      feed_sign: ctx.feed_sign,
      feed_negate_tx: ctx.feed_negate_tx === true,
      ignored: ctx.ignored === true,
      promote_from_date: ctx.promote_from_date,
    },
    profileId: parsed.profileId,
    warnings: parsed.warnings || [],
    balance: parsed.balance ? { ...parsed.balance, fin_balance: finBalance } : null,
    counts,
    rows,
    reconcile: {
      current_computed: computed,
      new_rows_sum: newSum,
      hypothetical_computed: hypothetical,
      fin_balance: finBalance,
      drift,
      reconciles: drift == null ? null : Math.abs(drift) < TOLERANCE,
      tolerance: TOLERANCE,
    },
  };
}

// ---- commit ---------------------------------------------------------------

async function commit({ accountExternalId, csv, profileId, profile, statedBalance } = {}) {
  const parsed = await client.manualParse({ accountExternalId, csv, profileId, profile });
  parsed.balance = resolveStatedBalance(parsed.balance, statedBalance);
  const ctx = await loadAccountContext(accountExternalId);
  if (!ctx) {
    const e = new Error(`no bank-feed mapping for account ${accountExternalId} — map it before uploading a statement`);
    e.status = 409;
    throw e;
  }
  if (!parsed.rows.length) {
    const e = new Error('statement parsed to zero rows');
    e.status = 422;
    throw e;
  }

  // Align to feed-native so the shared promote/recon path (feed_negate_tx /
  // feed_sign) lands on fin's convention.
  const feedNativeRows = parsed.rows.map((r) => ({
    external_id: r.external_id,
    transaction_date: r.transaction_date,
    amount: feedNativeAmount(r.amount, ctx.feed_negate_tx === true),
    currency: r.currency,
    description: r.description,
    category_hint: r.category_hint,
    raw: r.raw,
  }));

  let balancePayload = null;
  if (parsed.balance && parsed.balance.magnitude != null && parsed.balance.balance_date) {
    const finBalance = finBalanceFromMagnitude(parsed.balance.magnitude, ctx.account_type);
    const stored = round2(finBalance * effFeedSign(ctx.feed_sign, ctx.account_type));
    balancePayload = { balance: stored, balance_date: parsed.balance.balance_date, currency: parsed.balance.currency };
  }

  const commitResp = await client.manualCommit({ accountExternalId, rows: feedNativeRows, balance: balancePayload });

  // Pull the new manual feed_transactions into staging and promote them. The
  // generalized dedup (scoped to source='manual') imports only rows not already
  // in the ledger. `since` = earliest statement date.
  const minDate = feedNativeRows.map((r) => r.transaction_date).sort()[0];
  const ingestResult = await refreshBankFeed.ingest({ since: minDate });
  const promoteSummary = await refreshBankFeed.promote();

  const asOf = parsed.balance ? parsed.balance.balance_date : undefined;
  const recon = await bankFeedReconciliation.balanceReconcile({ asOf });
  const reconRow = recon.accounts.find((a) => a.account_id === ctx.account_id) || null;

  return {
    account: { external_id: accountExternalId, account_id: ctx.account_id, name: ctx.name },
    profileId: parsed.profileId,
    warnings: parsed.warnings || [],
    committed: commitResp,
    ingest: { staged: ingestResult.staged, insertedCount: ingestResult.insertedCount },
    promote: {
      inserted: promoteSummary.inserted,
      linked: promoteSummary.linked,
      skippedDup: promoteSummary.skippedDup,
    },
    reconcile: reconRow,
  };
}

module.exports = {
  preview,
  commit,
  // pure helpers exposed for tests
  effFeedSign,
  finBalanceFromMagnitude,
  feedNativeAmount,
};
