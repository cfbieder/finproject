#!/usr/bin/env node
/**
 * quicken-import.js — Phase B parser skeleton (CR019)
 *
 * Reads one or more QIF files and stages cash-account rows into
 * `quicken_staging`. Investment-type files are skipped (Phase D will
 * extend this script to handle them).
 *
 * Currently supported (Phase B):
 *   - Headers: !Type:Cash | Bank | CCard | Oth A | Oth L
 *   - Tags:    D (date), T/U (amount), P (payee), M (memo),
 *              L (category or [transfer]), C (cleared), N (check#),
 *              S/E/$ (split lines)
 *   - Date formats: both M/D'YY and M/D/YY, with leading-space single
 *                   digits and a year pivot of 50 (00-49 → 20xx, 50-99 → 19xx).
 *
 * Not yet supported (later phases):
 *   - !Type:Invst, !Type:Security, !Type:Prices  — Phase D
 *   - Cross-file transfer dedupe                — Phase E (promote step 2)
 *
 * Usage:
 *   node quicken-import.js parse \
 *     --files <path>[:CURRENCY][,<path>[:CURRENCY]...] \
 *     --batch <uuid> [--label "<text>"]
 *
 * Tests: server/src/v2/scripts/__tests__/quicken-import.test.js
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { Pool } = require('pg');

const CONN_STR =
  process.env.DATABASE_URL || 'postgres://fin:findev123@localhost:5434/fin';

const CASH_TYPES = new Set(['Cash', 'Bank', 'CCard', 'Oth A', 'Oth L']);

// ═══════════════════════════════════════════════════════════════════════════
// PURE PARSING (no DB) — exported for tests
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Parse a Quicken QIF date. Two formats coexist within one file:
 *   M/D'YY    e.g. "6/19'14"  (PKO sample)
 *   M/D/YY    e.g. "3/21/98"  (Fidelity sample)
 * Single-digit months/days may have a leading space ("7/ 1'14" or "10/10' 1").
 * Year pivot at 50: 00-49 → 20xx, 50-99 → 19xx. 4-digit years pass through.
 * Returns ISO YYYY-MM-DD or null on parse failure.
 */
function parseDate(qifDate) {
  if (typeof qifDate !== 'string') return null;
  const cleaned = qifDate.replace(/\s+/g, '');
  const m = /^(\d{1,2})\/(\d{1,2})['/](\d{1,4})$/.exec(cleaned);
  if (!m) return null;
  const month = parseInt(m[1], 10);
  const day = parseInt(m[2], 10);
  let year = parseInt(m[3], 10);
  if (year < 100) year = year < 50 ? 2000 + year : 1900 + year;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function parseAmount(s) {
  if (typeof s !== 'string') return null;
  const v = parseFloat(s.replace(/,/g, ''));
  return Number.isFinite(v) ? v : null;
}

/**
 * Parse a single ^-delimited QIF block (without the trailing ^).
 * Returns a staging-row-shaped object.
 */
function parseQifBlock(blockText, sourceFile, sourceLine, currency = 'USD') {
  const lines = blockText.split(/\r?\n/).filter((l) => l.length > 0);
  const row = {
    source_file: sourceFile,
    source_line: sourceLine,
    transaction_date: null,
    amount: null,
    currency,
    payee: null,
    memo: null,
    quicken_category: null,
    transfer_target_account: null,
    cleared_status: null,
    splits: [],
    raw_payload: {},
  };

  let currentSplit = null;

  for (const ln of lines) {
    const tag = ln[0];
    const val = ln.slice(1);
    row.raw_payload[tag] = (row.raw_payload[tag] || []).concat([val]);

    switch (tag) {
      case 'D':
        row.transaction_date = parseDate(val);
        break;
      case 'T':
      case 'U':
        // T and U both carry the amount; prefer the first one seen.
        if (row.amount === null) row.amount = parseAmount(val);
        break;
      case 'P':
        row.payee = val;
        break;
      case 'M':
        row.memo = row.memo ? `${row.memo} ${val}` : val;
        break;
      case 'L':
        if (val === '--Split--') {
          // Marker: subsequent S/E/$ tags define children.
        } else if (val.startsWith('[') && val.endsWith(']')) {
          row.transfer_target_account = val.slice(1, -1);
        } else if (val.trim().length > 0) {
          row.quicken_category = val;
        }
        // Empty L (e.g., "L\n") stays null — Quicken's "uncategorized" marker.
        break;
      case 'C':
        row.cleared_status = val[0] || null;
        break;
      case 'N':
        row.memo = row.memo ? `${row.memo} check#${val}` : `check#${val}`;
        break;
      case 'S':
        if (currentSplit) row.splits.push(currentSplit);
        currentSplit = {
          category: null,
          transfer_target_account: null,
          memo: null,
          amount: null,
        };
        if (val.startsWith('[') && val.endsWith(']')) {
          currentSplit.transfer_target_account = val.slice(1, -1);
        } else if (val.trim().length > 0) {
          currentSplit.category = val;
        }
        // Empty S tag (e.g., zero-amount split-adjustment rows Quicken inserts)
        // leaves both fields null — matches main-row 'L' behavior on line 120.
        break;
      case 'E':
        if (currentSplit) currentSplit.memo = val;
        break;
      case '$':
        if (currentSplit) currentSplit.amount = parseAmount(val);
        break;
      // Unknown tags fall through to raw_payload only.
    }
  }

  if (currentSplit) row.splits.push(currentSplit);
  return row;
}

// ───────────────────────────────────────────────────────────────────────────
// Investment block parser (!Type:Invst). Different tag set from cash blocks.
// Returns shape suitable for either quicken_securities_staging or, for
// cash-only actions (XIn/XOut/Cash/MargInt), a cash-row shape.
// Action-routing decisions live in stageInvstRows — this just extracts.
// ───────────────────────────────────────────────────────────────────────────
function parseInvstBlock(blockText, sourceFile, sourceLine, currency = 'USD') {
  const lines = blockText.split(/\r?\n/).filter((l) => l.length > 0);
  const row = {
    source_file: sourceFile,
    source_line: sourceLine,
    transaction_date: null,
    action: null,
    security_name: null,
    shares: null,
    price: null,
    fees: null,
    amount: null,            // total transaction value (T or U)
    transfer_amount: null,   // for X-suffix actions ($ tag)
    transfer_target_account: null,
    payee: null,
    memo: null,
    cleared_status: null,
    currency,
    raw_payload: {},
  };

  for (const ln of lines) {
    const tag = ln[0];
    const val = ln.slice(1);
    row.raw_payload[tag] = (row.raw_payload[tag] || []).concat([val]);

    switch (tag) {
      case 'D':
        row.transaction_date = parseDate(val);
        break;
      case 'N':
        row.action = val.trim();
        break;
      case 'Y':
        row.security_name = val.trim();
        break;
      case 'I':
        row.price = parseAmount(val);
        break;
      case 'Q':
        row.shares = parseAmount(val);
        break;
      case 'O':
        row.fees = parseAmount(val);
        break;
      case 'T':
      case 'U':
        if (row.amount === null) row.amount = parseAmount(val);
        break;
      case 'P':
        row.payee = val;
        break;
      case 'M':
        row.memo = row.memo ? `${row.memo} ${val}` : val;
        break;
      case 'L':
        if (val.startsWith('[') && val.endsWith(']')) {
          row.transfer_target_account = val.slice(1, -1);
        }
        // Non-bracketed L in invst context is uncommon — record in raw_payload only.
        break;
      case '$':
        // Secondary amount on X-suffix transfers (XIn/XOut/BuyX/SellX/etc.).
        row.transfer_amount = parseAmount(val);
        break;
      case 'C':
        row.cleared_status = val[0] || null;
        break;
    }
  }

  return row;
}

// ───────────────────────────────────────────────────────────────────────────
// Security master block parser (!Type:Security). One block per security.
// ───────────────────────────────────────────────────────────────────────────
function parseSecurityBlock(blockText, sourceFile, sourceLine) {
  const lines = blockText.split(/\r?\n/).filter((l) => l.length > 0);
  const row = {
    source_file: sourceFile,
    source_line: sourceLine,
    quicken_security_name: null,
    ticker: null,
    quicken_type: null,
    quicken_goal: null,
    raw_payload: {},
  };

  for (const ln of lines) {
    const tag = ln[0];
    const val = ln.slice(1);
    row.raw_payload[tag] = (row.raw_payload[tag] || []).concat([val]);

    switch (tag) {
      case 'N':
        row.quicken_security_name = val.trim();
        break;
      case 'S':
        row.ticker = val.trim();
        break;
      case 'T':
        row.quicken_type = val.trim();
        break;
      case 'G':
        row.quicken_goal = val.trim();
        break;
    }
  }
  return row;
}

// ───────────────────────────────────────────────────────────────────────────
// Parse a price value. Quicken's historical prices use two formats:
//   - Decimal:      36.75
//   - Fractional:   36 3/4         (pre-2001 Wall Street 8ths/16ths notation)
//   - Pure fraction: 3/8          (rare; price < $1)
// Returns a Number or null.
// ───────────────────────────────────────────────────────────────────────────
function parsePrice(s) {
  if (typeof s !== 'string') return null;
  const t = s.trim();
  if (t === '') return null;

  // Decimal: "36.75" or "36"
  const dec = /^(\d+(?:\.\d+)?)$/.exec(t);
  if (dec) {
    const v = parseFloat(dec[1]);
    return Number.isFinite(v) ? v : null;
  }

  // Whole + fraction: "36 3/4"
  const wholeFrac = /^(\d+)\s+(\d+)\/(\d+)$/.exec(t);
  if (wholeFrac) {
    const w = parseInt(wholeFrac[1], 10);
    const n = parseInt(wholeFrac[2], 10);
    const d = parseInt(wholeFrac[3], 10);
    if (d === 0) return null;
    return w + n / d;
  }

  // Pure fraction: "3/8"
  const frac = /^(\d+)\/(\d+)$/.exec(t);
  if (frac) {
    const n = parseInt(frac[1], 10);
    const d = parseInt(frac[2], 10);
    if (d === 0) return null;
    return n / d;
  }

  return null;
}

// ───────────────────────────────────────────────────────────────────────────
// Price block parser (!Type:Prices). Single-line CSV-ish: "TICKER",rate,"DATE"
// Decimal example:    "ABT",20.0241," 4/30' 9"
// Fractional example: "ABT",36 3/4," 8/ 2'13"  (pre-decimalization-era price)
// ───────────────────────────────────────────────────────────────────────────
function parsePriceBlock(blockText, sourceFile, sourceLine) {
  const dataLine = blockText.split(/\r?\n/).find((l) => l.trim().length > 0);
  if (!dataLine) return null;

  // Greedy comma-splitting that tolerates a space in the price field.
  // Format: <maybe-quoted-ticker>,<price-with-optional-fraction>,<maybe-quoted-date>
  const m = /^"?([^",]+)"?\s*,\s*([^,]+?)\s*,\s*"?([^"]+?)"?\s*$/.exec(dataLine);
  if (!m) return null;

  const close = parsePrice(m[2]);
  const price_date = parseDate(m[3]);
  if (close === null || price_date === null) return null;

  return {
    source_file: sourceFile,
    source_line: sourceLine,
    ticker: m[1].trim(),
    close,
    price_date,
  };
}

/**
 * Parse a whole QIF file. Returns:
 *   {
 *     firstHeader,   // first !Type: seen (kept for back-compat with Phase B tests)
 *     header,        // alias of firstHeader
 *     rows,          // cash rows (back-compat with Phase B)
 *     cashRows,      // alias of rows
 *     invstRows,     // investment-event rows
 *     securityRows,  // !Type:Security blocks
 *     priceRows,     // !Type:Prices blocks
 *   }
 *
 * Each !Type: line switches the active type for subsequent blocks until the
 * next !Type: line. This handles both styles seen in user samples:
 *   - One !Type:Invst at top with all blocks following (fidelity_stk.QIF)
 *   - Per-block !Type:Security / !Type:Prices (fidelity_stk_w_sec.QIF)
 */
function parseQif(text, sourceFile, currency = 'USD') {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  const CASH_HEADERS = new Set(['Cash', 'Bank', 'CCard', 'Oth A', 'Oth L']);
  const lines = text.split(/\r?\n/);
  let firstHeader = null;
  let activeType = null;
  let buf = [];
  let blockStartLine = 1;
  const cashRows = [];
  const invstRows = [];
  const securityRows = [];
  const priceRows = [];

  function flush() {
    if (buf.filter((l) => l.length > 0).length === 0) return;
    const blockText = buf.join('\n');
    if (CASH_HEADERS.has(activeType)) {
      cashRows.push(parseQifBlock(blockText, sourceFile, blockStartLine, currency));
    } else if (activeType === 'Invst') {
      invstRows.push(parseInvstBlock(blockText, sourceFile, blockStartLine, currency));
    } else if (activeType === 'Security') {
      securityRows.push(parseSecurityBlock(blockText, sourceFile, blockStartLine));
    } else if (activeType === 'Prices') {
      const p = parsePriceBlock(blockText, sourceFile, blockStartLine);
      if (p) priceRows.push(p);
    }
    // Unknown types are silently dropped (raw text preserved in nothing — that's fine for skeleton).
  }

  for (let i = 0; i < lines.length; i++) {
    const cursorLine = i + 1;
    const ln = lines[i];
    if (ln.startsWith('!Type:')) {
      // Any buffered content from a previous type goes to that previous type.
      if (buf.length > 0 && activeType) flush();
      activeType = ln.slice(6).trim();
      if (firstHeader === null) firstHeader = activeType;
      buf = [];
      blockStartLine = cursorLine + 1;
      continue;
    }
    if (ln === '^') {
      if (activeType) flush();
      buf = [];
      blockStartLine = cursorLine + 1;
      continue;
    }
    buf.push(ln);
  }
  // Trailing buffer without a closing ^ (rare).
  if (buf.length > 0 && activeType) flush();

  return {
    firstHeader,
    header: firstHeader, // back-compat alias for Phase B tests
    cashRows,
    rows: cashRows, // back-compat alias for Phase B tests
    invstRows,
    securityRows,
    priceRows,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// DATABASE LAYER (uses pg pool injected by caller — easier to test)
// ═══════════════════════════════════════════════════════════════════════════

async function upsertBatch(pool, batchId, label, sourceFiles) {
  await pool.query(
    `INSERT INTO quicken_import_batches (id, label, status, source_files)
       VALUES ($1, $2, 'parsing', $3::jsonb)
     ON CONFLICT (id) DO UPDATE
       SET label = COALESCE(EXCLUDED.label, quicken_import_batches.label),
           status = 'parsing',
           source_files = EXCLUDED.source_files,
           updated_at = NOW()`,
    [batchId, label, JSON.stringify(sourceFiles)]
  );
}

async function wipeBatchStaging(pool, batchId) {
  // Order matters only if there are FKs between staging tables; there aren't,
  // so any order works. Listed in dependency-ish order for clarity.
  await pool.query('DELETE FROM quicken_price_staging WHERE import_batch_id = $1', [batchId]);
  await pool.query('DELETE FROM quicken_security_master_staging WHERE import_batch_id = $1', [batchId]);
  await pool.query('DELETE FROM quicken_securities_staging WHERE import_batch_id = $1', [batchId]);
  await pool.query('DELETE FROM quicken_staging WHERE import_batch_id = $1', [batchId]);
}

async function finalizeBatch(pool, batchId) {
  await pool.query(
    `UPDATE quicken_import_batches
       SET status = 'parsed', parsed_at = NOW(), updated_at = NOW()
       WHERE id = $1`,
    [batchId]
  );
}

async function failBatch(pool, batchId, reason) {
  await pool.query(
    `UPDATE quicken_import_batches
       SET status = 'failed',
           failure_reason = LEFT($2, 8000),
           updated_at = NOW()
       WHERE id = $1`,
    [batchId, String(reason)]
  );
}

// Actions whose cash side lands in `quicken_staging` (not `quicken_securities_staging`)
// per CR §5.3 — these have no security-side event.
const CASH_ONLY_INVST_ACTIONS = new Set(['XIn', 'XOut', 'Cash', 'MargInt']);

/**
 * Stage parsed rows for one file. Routes by header:
 *   Cash / Bank / CCard / Oth A / Oth L → quicken_staging
 *   Invst                                 → mix of quicken_staging (cash-only actions)
 *                                           and quicken_securities_staging
 *   Security blocks                       → quicken_security_master_staging
 *   Prices blocks                         → quicken_price_staging
 *
 * The Quicken account name comes from the QIF filename (the user convention
 * is one QIF per account). Phase 2 mapping resolves `quicken_account_name`
 * → COA account_id.
 */
async function stageFileRows(pool, batchId, parsed, sourceFile, accountName) {
  let staged = 0;
  const buckets = {
    cash: 0,
    invst: 0,
    securities: 0,
    prices: 0,
    skippedNoAmount: 0, // Quicken's no-op cash-only markers (no T/U tag) — see CR §5.3 reconciliation
  };

  // Cash rows
  for (const row of parsed.cashRows) {
    staged += await stageCashRow(pool, batchId, row, sourceFile, accountName);
    buckets.cash += 1;
  }

  // Investment rows — split between cash table and securities table by action
  for (const row of parsed.invstRows) {
    if (row.action && CASH_ONLY_INVST_ACTIONS.has(row.action)) {
      // Quicken occasionally emits Cash/XIn/etc. blocks with no amount field — these are
      // no-op bookkeeping markers (often just date+action+cleared-status with no economic
      // content). 9 such rows in the user's fidelity_stk_w_sec.QIF sample. Skip silently
      // but count for the reconciliation report.
      if (row.amount === null) {
        buckets.skippedNoAmount += 1;
        continue;
      }
      await stageInvstAsCash(pool, batchId, row, sourceFile, accountName);
      buckets.cash += 1;
      staged += 1;
    } else {
      await stageInvstAsSecurity(pool, batchId, row, sourceFile, accountName);
      buckets.invst += 1;
      staged += 1;
    }
  }

  // Security master blocks
  for (const row of parsed.securityRows) {
    await stageSecurityMaster(pool, batchId, row, sourceFile);
    buckets.securities += 1;
    staged += 1;
  }

  // Price blocks
  if (parsed.priceRows.length > 0) {
    await stagePricesBulk(pool, batchId, parsed.priceRows, sourceFile);
    buckets.prices += parsed.priceRows.length;
    staged += parsed.priceRows.length;
  }

  // Files that didn't match any of the supported types end up with all-zero
  // buckets. Caller can detect that via `staged === 0`.
  if (staged === 0) {
    return {
      staged: 0,
      skipped: parsed.cashRows.length + parsed.invstRows.length,
      buckets,
      skipReason: `header '${parsed.firstHeader || 'unknown'}' has no recognized blocks`,
    };
  }
  return { staged, skipped: 0, buckets };
}

/**
 * Insert one cash row into `quicken_staging`. If the row has splits, inserts
 * the parent (metadata-only, no amount distortion of children) plus N child
 * rows linked via `split_parent_id`. Returns the number of staging rows inserted.
 */
async function stageCashRow(pool, batchId, row, sourceFile, accountName) {
  if (row.splits && row.splits.length > 0) {
    const parentRes = await pool.query(
      `INSERT INTO quicken_staging
         (import_batch_id, source_file, source_line, quicken_account_name,
          transaction_date, amount, currency, payee, memo, quicken_category,
          transfer_target_account, cleared_status, split_parent_id, raw_payload)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NULL,$13::jsonb)
       RETURNING id`,
      [
        batchId,
        sourceFile,
        row.source_line,
        accountName,
        row.transaction_date,
        row.amount,
        row.currency,
        row.payee,
        row.memo,
        row.quicken_category,
        row.transfer_target_account,
        row.cleared_status,
        JSON.stringify(row.raw_payload),
      ]
    );
    const parentId = parentRes.rows[0].id;

    for (const split of row.splits) {
      await pool.query(
        `INSERT INTO quicken_staging
           (import_batch_id, source_file, source_line, quicken_account_name,
            transaction_date, amount, currency, payee, memo, quicken_category,
            transfer_target_account, split_parent_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [
          batchId,
          sourceFile,
          row.source_line,
          accountName,
          row.transaction_date,
          split.amount,
          row.currency,
          row.payee,
          split.memo,
          split.category,
          split.transfer_target_account,
          parentId,
        ]
      );
    }
    return 1 + row.splits.length;
  }

  await pool.query(
    `INSERT INTO quicken_staging
       (import_batch_id, source_file, source_line, quicken_account_name,
        transaction_date, amount, currency, payee, memo, quicken_category,
        transfer_target_account, cleared_status, raw_payload)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb)`,
    [
      batchId,
      sourceFile,
      row.source_line,
      accountName,
      row.transaction_date,
      row.amount,
      row.currency,
      row.payee,
      row.memo,
      row.quicken_category,
      row.transfer_target_account,
      row.cleared_status,
      JSON.stringify(row.raw_payload),
    ]
  );
  return 1;
}

/**
 * Insert a cash-only investment action (XIn/XOut/Cash/MargInt) into
 * `quicken_staging`. Action name is preserved in `quicken_category` so the
 * Phase 2 mapping panel can route XIn/XOut to the right transfer leaf and
 * Cash/MargInt to the appropriate income/expense category.
 */
async function stageInvstAsCash(pool, batchId, row, sourceFile, accountName) {
  // For XIn/XOut, the transfer target lives in row.transfer_target_account.
  // For Cash/MargInt, there's no transfer target; the action name itself
  // is what mapping uses (e.g., 'MargInt' → 'Margin Interest' expense leaf).
  await pool.query(
    `INSERT INTO quicken_staging
       (import_batch_id, source_file, source_line, quicken_account_name,
        transaction_date, amount, currency, payee, memo, quicken_category,
        transfer_target_account, cleared_status, raw_payload)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb)`,
    [
      batchId,
      sourceFile,
      row.source_line,
      accountName,
      row.transaction_date,
      row.amount,
      row.currency,
      row.payee,
      row.memo,
      row.action, // store action name in category for mapping resolution
      row.transfer_target_account,
      row.cleared_status,
      JSON.stringify(row.raw_payload),
    ]
  );
}

/**
 * Insert an investment-event row (Buy/Sell/Div/etc.) into
 * `quicken_securities_staging`.
 */
async function stageInvstAsSecurity(pool, batchId, row, sourceFile, accountName) {
  await pool.query(
    `INSERT INTO quicken_securities_staging
       (import_batch_id, source_file, source_line, quicken_account_name,
        transaction_date, quicken_action, quicken_security_name,
        shares, price, fees, gross_amount,
        cleared_status, memo, raw_payload)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb)`,
    [
      batchId,
      sourceFile,
      row.source_line,
      accountName,
      row.transaction_date,
      row.action,
      row.security_name,
      row.shares,
      row.price,
      row.fees,
      row.amount,
      row.cleared_status,
      row.memo,
      JSON.stringify(row.raw_payload),
    ]
  );
}

/**
 * Insert a !Type:Security master block into `quicken_security_master_staging`.
 * Idempotent on (import_batch_id, quicken_security_name) UNIQUE — re-parsing
 * the same file doesn't duplicate.
 */
async function stageSecurityMaster(pool, batchId, row, sourceFile) {
  if (!row.quicken_security_name) return; // skip malformed
  await pool.query(
    `INSERT INTO quicken_security_master_staging
       (import_batch_id, source_file, quicken_security_name,
        ticker, quicken_type, quicken_goal, raw_payload)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)
     ON CONFLICT (import_batch_id, quicken_security_name) DO UPDATE
       SET ticker = EXCLUDED.ticker,
           quicken_type = EXCLUDED.quicken_type,
           quicken_goal = EXCLUDED.quicken_goal,
           raw_payload = EXCLUDED.raw_payload`,
    [
      batchId,
      sourceFile,
      row.quicken_security_name,
      row.ticker,
      row.quicken_type,
      row.quicken_goal,
      JSON.stringify(row.raw_payload),
    ]
  );
}

/**
 * Bulk-insert price rows into `quicken_price_staging` using a single
 * multi-VALUES statement per BATCH_SIZE chunk. 384k rows from
 * fidelity_stk_w_sec.QIF benefits significantly from this vs one INSERT
 * per row.
 */
async function stagePricesBulk(pool, batchId, priceRows, sourceFile) {
  const BATCH_SIZE = 5000;
  for (let i = 0; i < priceRows.length; i += BATCH_SIZE) {
    const chunk = priceRows.slice(i, i + BATCH_SIZE);
    const placeholders = [];
    const values = [];
    let p = 1;
    for (const r of chunk) {
      if (!r.ticker || !r.price_date || !Number.isFinite(r.close)) continue;
      placeholders.push(`($${p++},$${p++},$${p++},$${p++},$${p++})`);
      values.push(batchId, sourceFile, r.ticker, r.price_date, r.close);
    }
    if (placeholders.length === 0) continue;
    await pool.query(
      `INSERT INTO quicken_price_staging
         (import_batch_id, source_file, ticker, price_date, close)
       VALUES ${placeholders.join(',')}`,
      values
    );
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// FX SEEDING — Phase C
//
// Input CSV format (simple — header row, then year/month/rate):
//   year,month,rate
//   2014,6,3.0436
//   2014,7,3.0488
//   ...
// where rate = foreign currency per 1 USD (matches the existing
// budget_fx_rates convention from migration 004: `base_amount = amount / rate`).
//
// The user obtains rate data from ECB or another source and pre-processes it
// once into this simple format. Doing the ECB-raw-CSV-with-cross-currency math
// in this script would expand its scope significantly for one-time use.
// ═══════════════════════════════════════════════════════════════════════════

function parseFxCsv(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];

  // Header detection: first row must contain 'year', 'month', 'rate' (any order)
  const header = lines[0].split(',').map((c) => c.trim().toLowerCase());
  const yi = header.indexOf('year');
  const mi = header.indexOf('month');
  const ri = header.indexOf('rate');
  if (yi < 0 || mi < 0 || ri < 0) {
    throw new Error(
      `parseFxCsv: header row must contain 'year', 'month', 'rate' columns; got: ${lines[0]}`
    );
  }

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',').map((c) => c.trim());
    const year = parseInt(cols[yi], 10);
    const month = parseInt(cols[mi], 10);
    const rate = parseFloat(cols[ri]);
    if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(rate)) {
      throw new Error(`parseFxCsv: bad row at line ${i + 1}: "${lines[i]}"`);
    }
    if (month < 1 || month > 12) {
      throw new Error(`parseFxCsv: month out of range at line ${i + 1}: ${month}`);
    }
    if (rate <= 0) {
      throw new Error(`parseFxCsv: rate must be positive at line ${i + 1}: ${rate}`);
    }
    rows.push({ year, month, rate });
  }
  return rows;
}

async function seedFxRates(pool, currency, rows) {
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new Error(`seedFxRates: currency must be 3 uppercase letters, got: ${currency}`);
  }
  let upserted = 0;
  for (const r of rows) {
    await pool.query(
      `INSERT INTO budget_fx_rates (currency, year, month, rate, updated_at)
         VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (currency, year, month) DO UPDATE
         SET rate = EXCLUDED.rate, updated_at = NOW()`,
      [currency, r.year, r.month, r.rate]
    );
    upserted += 1;
  }
  return { upserted };
}

// ───────────────────────────────────────────────────────────────────────────
// Yahoo Finance historical FX fetch (CR019 §12)
// Reuses Yahoo's chart endpoint but always asks for daily and aggregates to
// monthly close ourselves — Yahoo's interval=1mo response emits inconsistent
// timestamps near DST transitions that mis-bucket the rate.
// ───────────────────────────────────────────────────────────────────────────
async function fetchYahooDailyFx({ baseCurrency, quoteCurrency, startEpoch, endEpoch }) {
  const https = require('https');
  const symbol = `${baseCurrency.toUpperCase()}${quoteCurrency.toUpperCase()}=X`;
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&period1=${startEpoch}&period2=${endEpoch}`;
  const data = await new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`Yahoo API returned ${res.statusCode} for ${symbol}`));
        res.resume();
        return;
      }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (body += c));
      res.on('end', () => {
        try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
  const result = data?.chart?.result?.[0];
  if (!result) throw new Error(`Yahoo: no chart data returned for ${symbol}`);
  const timestamps = result.timestamp || [];
  const closes = result.indicators?.quote?.[0]?.close || [];
  const out = [];
  for (let i = 0; i < timestamps.length; i++) {
    if (typeof closes[i] === 'number' && Number.isFinite(closes[i])) {
      out.push({ timestamp: timestamps[i], close: closes[i] });
    }
  }
  return out;
}

// Group daily observations by (year, month) and keep the LAST timestamp's
// close — equivalent to "last trading day of the month" close.
function aggregateMonthlyClose(daily) {
  const byMonth = new Map();
  for (const r of daily) {
    const d = new Date(r.timestamp * 1000);
    const key = `${d.getUTCFullYear()}-${d.getUTCMonth() + 1}`;
    const prev = byMonth.get(key);
    if (!prev || r.timestamp > prev.timestamp) byMonth.set(key, r);
  }
  return [...byMonth.entries()]
    .map(([key, r]) => {
      const [year, month] = key.split('-').map(Number);
      return { year, month, rate: r.close };
    })
    .sort((a, b) => (a.year - b.year) || (a.month - b.month));
}

async function runSeedFxYahoo({ currency, start, end, pool }) {
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new Error(`Invalid currency: ${currency}`);
  }
  if (!start) throw new Error('--start YYYY-MM is required');
  const [sy, sm] = start.split('-').map(Number);
  let ey, em;
  if (end) {
    [ey, em] = end.split('-').map(Number);
  } else {
    const now = new Date();
    ey = now.getUTCFullYear();
    em = now.getUTCMonth() + 1;
  }
  if (!Number.isFinite(sy) || !Number.isFinite(sm) || sm < 1 || sm > 12) {
    throw new Error(`Bad --start: ${start}`);
  }
  if (!Number.isFinite(ey) || !Number.isFinite(em) || em < 1 || em > 12) {
    throw new Error(`Bad --end: ${end}`);
  }
  const startEpoch = Math.floor(Date.UTC(sy, sm - 1, 1) / 1000);
  // End epoch: a few days past the end-month boundary so the last close lands
  // in the response.
  const endEpoch = Math.floor(Date.UTC(ey, em, 7) / 1000);

  const ownsPool = !pool;
  if (ownsPool) pool = new Pool({ connectionString: CONN_STR });
  try {
    const daily = await fetchYahooDailyFx({
      baseCurrency: 'USD',
      quoteCurrency: currency,
      startEpoch,
      endEpoch,
    });
    const monthly = aggregateMonthlyClose(daily);
    if (monthly.length === 0) {
      throw new Error(`Yahoo returned no data for USD${currency}=X between ${start} and ${end || 'now'}`);
    }
    const { upserted } = await seedFxRates(pool, currency, monthly);
    return {
      currency,
      symbol: `USD${currency}=X`,
      requestedRange: { from: start, to: end || `${ey}-${String(em).padStart(2, '0')}` },
      from: `${monthly[0].year}-${String(monthly[0].month).padStart(2, '0')}`,
      to: `${monthly[monthly.length - 1].year}-${String(monthly[monthly.length - 1].month).padStart(2, '0')}`,
      dailyPoints: daily.length,
      monthlyPoints: monthly.length,
      upserted,
    };
  } finally {
    if (ownsPool) await pool.end();
  }
}

async function runSeedFx({ csvPath, currency, pool }) {
  const ownsPool = !pool;
  if (ownsPool) pool = new Pool({ connectionString: CONN_STR });
  try {
    const text = fs.readFileSync(csvPath, 'utf8');
    const rows = parseFxCsv(text);
    const { upserted } = await seedFxRates(pool, currency, rows);
    return {
      currency,
      csvPath,
      parsed: rows.length,
      upserted,
      coverage: rows.length
        ? {
            from: `${rows[0].year}-${String(rows[0].month).padStart(2, '0')}`,
            to: `${rows[rows.length - 1].year}-${String(rows[rows.length - 1].month).padStart(2, '0')}`,
          }
        : null,
    };
  } finally {
    if (ownsPool) await pool.end();
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// CLI HARNESS
// ═══════════════════════════════════════════════════════════════════════════

async function runParse({ files, batchId, label, pool }) {
  const ownsPool = !pool;
  if (ownsPool) pool = new Pool({ connectionString: CONN_STR });
  try {
    await upsertBatch(pool, batchId, label, files.map((f) => f.path));
    await wipeBatchStaging(pool, batchId);

    let totalStaged = 0;
    let totalSkipped = 0;
    const perFile = [];
    for (const f of files) {
      const text = fs.readFileSync(f.path, 'utf8');
      const accountName = path.basename(f.path, path.extname(f.path));
      const parsed = parseQif(text, path.basename(f.path), f.currency);
      const r = await stageFileRows(
        pool,
        batchId,
        parsed,
        path.basename(f.path),
        accountName
      );
      const parsedBlocks =
        parsed.cashRows.length +
        parsed.invstRows.length +
        parsed.securityRows.length +
        parsed.priceRows.length;
      perFile.push({
        file: f.path,
        header: parsed.header,
        parsedBlocks,
        ...r,
      });
      totalStaged += r.staged;
      totalSkipped += r.skipped;
    }

    await finalizeBatch(pool, batchId);
    return { batchId, totalStaged, totalSkipped, perFile };
  } catch (err) {
    try {
      await failBatch(pool, batchId, err && err.message);
    } catch (_) { /* swallow */ }
    throw err;
  } finally {
    if (ownsPool) await pool.end();
  }
}

function parseArgs(argv) {
  const args = {
    command: argv[0],
    files: [],
    batchId: null,
    label: null,
    csvPath: null,
    currency: null,
  };
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--files') {
      const spec = argv[++i];
      for (const item of spec.split(',')) {
        const [filePath, currency] = item.split(':');
        args.files.push({ path: filePath, currency: currency || 'USD' });
      }
    } else if (a === '--batch') {
      args.batchId = argv[++i];
    } else if (a === '--label') {
      args.label = argv[++i];
    } else if (a === '--csv') {
      args.csvPath = argv[++i];
    } else if (a === '--currency') {
      args.currency = argv[++i];
    } else if (a === '--start') {
      args.start = argv[++i];
    } else if (a === '--end') {
      args.end = argv[++i];
    }
  }
  return args;
}

function usage() {
  console.error(
    'Usage:\n' +
      '  quicken-import.js parse         --files <f1>[:CURR][,<f2>[:CURR]...] --batch <uuid> [--label "<text>"]\n' +
      '  quicken-import.js seed-fx       --csv <path> --currency <CCC>\n' +
      '  quicken-import.js seed-fx-yahoo --currency <CCC> --start YYYY-MM [--end YYYY-MM]\n' +
      '  quicken-import.js promote       --batch <uuid>\n' +
      '  quicken-import.js rollback      --batch <uuid>'
  );
}

if (require.main === module) {
  const args = parseArgs(process.argv.slice(2));

  if (args.command === 'parse') {
    if (args.files.length === 0) {
      usage();
      process.exit(1);
    }
    if (!args.batchId) args.batchId = randomUUID();
    runParse(args)
      .then((result) => {
        console.log(`\nBatch ${result.batchId}:`);
        for (const f of result.perFile) {
          if (f.staged > 0) {
            const b = f.buckets || {};
            const parts = [];
            if (b.cash) parts.push(`cash=${b.cash}`);
            if (b.invst) parts.push(`invst=${b.invst}`);
            if (b.securities) parts.push(`securities=${b.securities}`);
            if (b.prices) parts.push(`prices=${b.prices}`);
            console.log(
              `  ${f.file}  header=${f.header}  staged=${f.staged}  (${parts.join(', ')})`
            );
          } else {
            console.log(`  ${f.file}  header=${f.header}  skipped=${f.skipped} (${f.skipReason || 'unknown'})`);
          }
        }
        console.log(`Totals: staged=${result.totalStaged}  skipped=${result.totalSkipped}`);
        process.exit(0);
      })
      .catch((err) => {
        console.error('Parse failed:', err.message);
        console.error(err.stack);
        process.exit(1);
      });
  } else if (args.command === 'seed-fx') {
    if (!args.csvPath || !args.currency) {
      usage();
      process.exit(1);
    }
    runSeedFx(args)
      .then((result) => {
        const cov = result.coverage
          ? `${result.coverage.from} … ${result.coverage.to}`
          : '(no rows)';
        console.log(
          `Seeded ${result.upserted} rates for ${result.currency} from ${result.csvPath} (${cov})`
        );
        process.exit(0);
      })
      .catch((err) => {
        console.error('Seed-fx failed:', err.message);
        process.exit(1);
      });
  } else if (args.command === 'seed-fx-yahoo') {
    if (!args.currency || !args.start) {
      usage();
      process.exit(1);
    }
    runSeedFxYahoo(args)
      .then((result) => {
        console.log(
          `Seeded ${result.upserted} ${result.currency} rates from Yahoo (${result.symbol}): ` +
          `${result.from} … ${result.to} ` +
          `(${result.dailyPoints} daily → ${result.monthlyPoints} monthly closes)`
        );
        process.exit(0);
      })
      .catch((err) => {
        console.error('Seed-fx-yahoo failed:', err.message);
        process.exit(1);
      });
  } else if (args.command === 'promote') {
    if (!args.batchId) {
      usage();
      process.exit(1);
    }
    const { runPromote } = require('./quicken-promote');
    runPromote({ batchId: args.batchId })
      .then((result) => {
        console.log(`\nBatch ${result.batchId} promoted:`);
        console.log(`  standalone cash rows : ${result.standaloneInserted}`);
        console.log(`  split children       : ${result.splitChildrenInserted}`);
        console.log(`  transfer pairs       : ${result.transferPairsInserted}`);
        console.log(`  dropped (by cutoff)  : ${result.droppedByCutoff}`);
        console.log(`  accounts recalibrated: ${result.accountsRecalibrated}`);
        process.exit(0);
      })
      .catch((err) => {
        console.error('Promote failed:', err.message);
        process.exit(1);
      });
  } else if (args.command === 'rollback') {
    if (!args.batchId) {
      usage();
      process.exit(1);
    }
    const { runRollback } = require('./quicken-promote');
    runRollback({ batchId: args.batchId })
      .then((result) => {
        console.log(`\nBatch ${result.batchId} rolled back:`);
        for (const [tbl, n] of Object.entries(result.deleted)) {
          if (n > 0) console.log(`  deleted from ${tbl}: ${n}`);
        }
        console.log(`  calibration reversed for ${result.calibrationRowsReversed} accounts`);
        process.exit(0);
      })
      .catch((err) => {
        console.error('Rollback failed:', err.message);
        process.exit(1);
      });
  } else {
    usage();
    process.exit(1);
  }
}

module.exports = {
  parseDate,
  parseAmount,
  parsePrice,
  parseQifBlock,
  parseInvstBlock,
  parseSecurityBlock,
  parsePriceBlock,
  parseQif,
  stageFileRows,
  runParse,
  parseFxCsv,
  seedFxRates,
  runSeedFx,
  parseArgs,
};
