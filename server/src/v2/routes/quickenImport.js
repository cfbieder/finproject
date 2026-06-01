/**
 * Quicken Import Admin Routes (CR019 Phase E)
 *
 * Mounted at /api/v2/quicken-import.
 *
 * Drives the admin UI: create (parse), list batches, inspect one, author
 * mappings, run pre-flight diff, promote, rollback.
 *
 * `POST /parse` accepts uploaded QIF text (one batch per file) so the whole
 * flow is UI-driven; the CLI parser (quicken-import.js) remains available for
 * scripted use. The parse handler writes each upload to a temp file and calls
 * the same runParse() the CLI uses.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const router = express.Router();

const db = require('../db');
const { runPromote, runRollback, findRoleInvalidMappings } = require('../scripts/quicken-promote');
const { runParse } = require('../scripts/quicken-import');

// Convenience: pool object the route handlers query against. The v2 db
// wrapper exposes the pg pool via getPool(). Calling getPool() lazily on
// every handler ensures we use the same pool the rest of the server uses.
const pool = {
  query: (...args) => db.getPool().query(...args),
  connect: (...args) => db.getPool().connect(...args),
};

// Generous JSON body limit for QIF uploads — multi-year exports easily exceed
// express's default 100kb. Applied only to the parse route.
const qifJson = express.json({ limit: '25mb' });

// The filename basename (minus extension) becomes the Quicken account name in
// account_source_mappings, so keep it readable but free of path separators /
// traversal. Falls back to a safe default if the client sends nothing usable.
function safeBaseName(name) {
  const base = path
    .basename(String(name || ''))
    .replace(/[^\w.\- ]/g, '_')
    .trim();
  return base || 'import.QIF';
}

// ───────────────────────────────────────────────────────────────────────────
// POST /api/v2/quicken-import/parse
// Body: { files: [{ name, currency, content }] }. Creates ONE batch per file
// (CR019 backfill granularity: per-account rollback + verify). Returns a
// per-file result array; HTTP 200 if any file parsed, 422 if all failed.
// ───────────────────────────────────────────────────────────────────────────
router.post('/parse', qifJson, async (req, res) => {
  const files = Array.isArray(req.body && req.body.files) ? req.body.files : null;
  if (!files || files.length === 0) {
    return res.status(400).json({ error: 'files[] is required' });
  }

  const results = [];
  for (const f of files) {
    const name = safeBaseName(f.name);
    const currency = String(f.currency || 'USD').toUpperCase().trim();
    const content = typeof f.content === 'string' ? f.content : '';
    if (!content) {
      results.push({ name, ok: false, error: 'empty file content' });
      continue;
    }

    const batchId = crypto.randomUUID();
    let tmpDir;
    try {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qimport-'));
      const tmpPath = path.join(tmpDir, name);
      fs.writeFileSync(tmpPath, content, 'utf8');

      const r = await runParse({
        files: [{ path: tmpPath, currency }],
        batchId,
        label: name.replace(/\.[^.]+$/, ''),
        pool,
      });

      // Store the friendly "name:CCY" (matching the CLI convention) rather than
      // the throwaway temp path in source_files. The column is jsonb, so write
      // a JSON-stringified array with an explicit ::jsonb cast (mirrors
      // upsertBatch); a raw JS array would be sent as a Postgres array literal.
      await pool.query(
        `UPDATE quicken_import_batches SET source_files = $2::jsonb WHERE id = $1`,
        [batchId, JSON.stringify([`${name}:${currency}`])]
      );

      results.push({
        name,
        batchId,
        currency,
        ok: true,
        totalStaged: r.totalStaged,
        totalSkipped: r.totalSkipped,
      });
    } catch (err) {
      results.push({ name, batchId, ok: false, error: err.message });
    } finally {
      if (tmpDir) {
        try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) { /* ignore */ }
      }
    }
  }

  res.status(results.some((r) => r.ok) ? 200 : 422).json({ results });
});

// ───────────────────────────────────────────────────────────────────────────
// GET /api/v2/quicken-import/batches
// List all batches, newest first.
// ───────────────────────────────────────────────────────────────────────────
router.get('/batches', async (req, res, next) => {
  try {
    // staged_count   = records parsed from the QIF — cash rows PLUS investment
    //                  events (brokerage batches stage into quicken_securities_staging)
    // imported_count = rows that actually landed in `transactions`
    // (skipped = staged − imported: already-in-PS via the cutoff, split parents
    //  expanded into children, and neutral investment trades. Frontend derives it.)
    const { rows } = await pool.query(
      `SELECT b.id, b.label, b.status, b.source_files,
              b.parsed_at, b.mapped_at, b.promoted_at, b.rolled_back_at,
              b.failure_reason, b.created_at, b.updated_at,
              ((SELECT COUNT(*)::int FROM quicken_staging s
                 WHERE s.import_batch_id = b.id)
               + (SELECT COUNT(*)::int FROM quicken_securities_staging q
                   WHERE q.import_batch_id = b.id)) AS staged_count,
              (SELECT COUNT(*)::int FROM transactions t
                WHERE t.import_batch_id = b.id) AS imported_count
         FROM quicken_import_batches b
         ORDER BY b.created_at DESC`
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// ───────────────────────────────────────────────────────────────────────────
// GET /api/v2/quicken-import/batches/:id
// Detail view: batch + staging summary + distinct Quicken names with their
// current mapping status. The admin UI uses this to populate the mapping
// panels.
// ───────────────────────────────────────────────────────────────────────────
router.get('/batches/:id', async (req, res, next) => {
  try {
    const { id } = req.params;

    const batchRows = (await pool.query(
      `SELECT id, label, status, source_files, cutoff_overrides,
              parsed_at, mapped_at, promoted_at, rolled_back_at,
              failure_reason, created_at, updated_at
         FROM quicken_import_batches WHERE id = $1`,
      [id]
    )).rows;
    if (batchRows.length === 0) return res.status(404).json({ error: 'batch not found' });
    const batch = batchRows[0];

    // Staging counts
    const counts = (await pool.query(
      `SELECT
         (SELECT COUNT(*)::int FROM quicken_staging WHERE import_batch_id = $1)              AS cash,
         (SELECT COUNT(*)::int FROM quicken_securities_staging WHERE import_batch_id = $1)   AS invst,
         (SELECT COUNT(*)::int FROM quicken_security_master_staging WHERE import_batch_id = $1) AS securities,
         (SELECT COUNT(*)::int FROM quicken_price_staging WHERE import_batch_id = $1)        AS prices`,
      [id]
    )).rows[0];

    // Distinct Quicken names with mapping status + role classification.
    // Each name's `role` controls what kind of COA leaf it can be mapped to:
    //   origin       — name appears only as quicken_account_name; map to BS leaf
    //   target_only  — name appears only as transfer_target_account (no own QIF parsed); map to Transfer category leaf
    //   both         — appears as both origin and target; map to BS leaf (origin's needs win;
    //                  promote derives transfer category via §8.2.3 from BS branches)
    //   category     — Quicken category (L tag value, not a bracketed transfer); map to P&L leaf
    // Currency is set for names with origin rows (one Quicken account = one currency
    // stamped by the parser); target_only names get null currency.
    const { rows: names } = await pool.query(
      `WITH origins AS (
         SELECT DISTINCT quicken_account_name AS name
           FROM quicken_staging WHERE import_batch_id = $1
       ),
       targets AS (
         SELECT DISTINCT transfer_target_account AS name
           FROM quicken_staging
           WHERE import_batch_id = $1 AND transfer_target_account IS NOT NULL
       ),
       categories AS (
         SELECT DISTINCT quicken_category AS name
           FROM quicken_staging
           WHERE import_batch_id = $1 AND quicken_category IS NOT NULL
             AND quicken_category <> ''
       ),
       account_names AS (
         SELECT
           COALESCE(o.name, t.name) AS name,
           'account' AS kind,
           CASE
             WHEN o.name IS NOT NULL AND t.name IS NOT NULL THEN 'both'
             WHEN o.name IS NOT NULL THEN 'origin'
             ELSE 'target_only'
           END AS role
         FROM origins o
         FULL OUTER JOIN targets t ON o.name = t.name
       ),
       all_names AS (
         SELECT name, kind, role FROM account_names
         UNION ALL
         SELECT name, 'category' AS kind, 'category' AS role FROM categories
       ),
       origin_currencies AS (
         SELECT quicken_account_name AS name, MIN(currency) AS currency
           FROM quicken_staging
           WHERE import_batch_id = $1
           GROUP BY quicken_account_name
       )
       SELECT n.name, n.kind, n.role,
              oc.currency AS quicken_currency,
              asm.account_id AS mapped_account_id,
              a.name AS mapped_account_name,
              a.section AS mapped_section,
              a.currency AS mapped_account_currency,
              a.is_transfer AS mapped_is_transfer
         FROM all_names n
         LEFT JOIN origin_currencies oc ON oc.name = n.name
         LEFT JOIN account_source_mappings asm
           ON asm.source = 'quicken' AND asm.external_name = n.name
         LEFT JOIN accounts a ON a.id = asm.account_id
         ORDER BY (asm.account_id IS NULL) DESC, n.kind, n.name`,
      [id]
    );

    res.json({ batch, counts, names });
  } catch (err) {
    next(err);
  }
});

// ───────────────────────────────────────────────────────────────────────────
// POST /api/v2/quicken-import/batches/:id/mappings
// Body: { external_name, account_id }
// Idempotent upsert of one mapping row (source='quicken').
// ───────────────────────────────────────────────────────────────────────────
router.post('/batches/:id/mappings', async (req, res, next) => {
  try {
    const { external_name, account_id } = req.body || {};
    if (!external_name || !account_id) {
      return res.status(400).json({ error: 'external_name and account_id required' });
    }
    // Target must be a leaf (no other account has it as parent). Transactions
    // can only land on terminal asset/liability/income/expense accounts, not
    // organizational containers.
    const { rows: childCheck } = await pool.query(
      `SELECT 1 FROM accounts WHERE parent_id = $1 LIMIT 1`,
      [account_id]
    );
    if (childCheck.length > 0) {
      const { rows: parentRows } = await pool.query(
        `SELECT name FROM accounts WHERE id = $1`,
        [account_id]
      );
      const parentName = parentRows[0]?.name || `id=${account_id}`;
      return res.status(400).json({
        error: `Cannot map to "${parentName}" — it is a container with child accounts. Pick a leaf account instead.`,
      });
    }
    // Role-based target validation (Q2 strict filter):
    //   origin / both → BS leaf (non-transfer)
    //   target_only   → Transfer category leaf (is_transfer=TRUE)
    //   category      → P&L leaf (non-transfer)
    // Look up the name's role from staging and target's classification, then check.
    const { rows: roleRows } = await pool.query(
      `WITH origins AS (
         SELECT 1 FROM quicken_staging
         WHERE import_batch_id = $1 AND quicken_account_name = $2 LIMIT 1
       ),
       targets AS (
         SELECT 1 FROM quicken_staging
         WHERE import_batch_id = $1 AND transfer_target_account = $2 LIMIT 1
       ),
       cats AS (
         SELECT 1 FROM quicken_staging
         WHERE import_batch_id = $1 AND quicken_category = $2 LIMIT 1
       )
       SELECT
         EXISTS(SELECT 1 FROM origins) AS is_origin,
         EXISTS(SELECT 1 FROM targets) AS is_target,
         EXISTS(SELECT 1 FROM cats)    AS is_cat`,
      [req.params.id, external_name]
    );
    const role = (() => {
      const r = roleRows[0] || {};
      if (r.is_cat) return 'category';
      if (r.is_origin && r.is_target) return 'both';
      if (r.is_origin) return 'origin';
      if (r.is_target) return 'target_only';
      return null;
    })();
    const { rows: targetRows } = await pool.query(
      `SELECT name, section, is_transfer FROM accounts WHERE id = $1`,
      [account_id]
    );
    if (targetRows.length === 0) {
      return res.status(400).json({ error: `Target account id=${account_id} not found` });
    }
    const target = targetRows[0];
    if (role === 'origin' || role === 'both') {
      if (target.section !== 'balance_sheet' || target.is_transfer) {
        return res.status(400).json({
          error: `"${external_name}" is an origin account — must be mapped to a Balance Sheet leaf. ` +
                 `"${target.name}" is ${target.is_transfer ? 'a transfer category' : 'a P&L leaf'}.`,
        });
      }
    } else if (role === 'target_only') {
      if (!target.is_transfer) {
        return res.status(400).json({
          error: `"${external_name}" appears only as a transfer target — must be mapped to a Transfer category leaf ` +
                 `(under the Transfers parent, with is_transfer=TRUE). "${target.name}" isn't a transfer category.`,
        });
      }
    } else if (role === 'category') {
      if (target.section !== 'profit_loss' || target.is_transfer) {
        return res.status(400).json({
          error: `"${external_name}" is a category — must be mapped to a P&L leaf (income or expense). ` +
                 `"${target.name}" is ${target.is_transfer ? 'a transfer category' : 'a Balance Sheet leaf'}.`,
        });
      }
    }
    await pool.query(
      `INSERT INTO account_source_mappings (account_id, source, external_name)
         VALUES ($1, 'quicken', $2)
       ON CONFLICT (source, external_name) DO UPDATE SET account_id = EXCLUDED.account_id`,
      [account_id, external_name]
    );
    // Update batch.mapped_at to reflect ongoing mapping work
    await pool.query(
      `UPDATE quicken_import_batches SET mapped_at = NOW(), status = CASE
         WHEN status IN ('parsed', 'mapped') THEN 'mapped' ELSE status END
         WHERE id = $1`,
      [req.params.id]
    );
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// ───────────────────────────────────────────────────────────────────────────
// DELETE /api/v2/quicken-import/batches/:id/mappings?external_name=…
// Remove one mapping row (admin only — useful for fixing typos).
// ───────────────────────────────────────────────────────────────────────────
router.delete('/batches/:id/mappings', async (req, res, next) => {
  try {
    const { external_name } = req.query || {};
    if (!external_name) return res.status(400).json({ error: 'external_name required' });
    await pool.query(
      `DELETE FROM account_source_mappings WHERE source = 'quicken' AND external_name = $1`,
      [external_name]
    );
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// ───────────────────────────────────────────────────────────────────────────
// GET /api/v2/quicken-import/batches/:id/preflight
// Pre-flight diff: per-account cutoff, rows kept/dropped, count of transfer
// pairs, sample of dropped rows. Surfaces what would happen on promote.
// ───────────────────────────────────────────────────────────────────────────
router.get('/batches/:id/preflight', async (req, res, next) => {
  try {
    const { id } = req.params;

    // Re-load mappings for this batch (subset of all 'quicken' mappings that
    // actually appear in this batch's staging)
    const { rows: mappingRows } = await pool.query(
      `WITH names AS (
         SELECT DISTINCT quicken_account_name AS name FROM quicken_staging WHERE import_batch_id = $1
         UNION
         SELECT DISTINCT transfer_target_account FROM quicken_staging
           WHERE import_batch_id = $1 AND transfer_target_account IS NOT NULL
       )
       SELECT n.name, asm.account_id
         FROM names n
         LEFT JOIN account_source_mappings asm
           ON asm.source = 'quicken' AND asm.external_name = n.name
         WHERE asm.account_id IS NOT NULL`,
      [id]
    );
    const accountMapping = new Map(mappingRows.map((r) => [r.name, r.account_id]));

    // Unmapped names (block promote)
    const { rows: unmapped } = await pool.query(
      `WITH names AS (
         SELECT DISTINCT quicken_account_name AS name FROM quicken_staging WHERE import_batch_id = $1
         UNION
         SELECT DISTINCT transfer_target_account FROM quicken_staging
           WHERE import_batch_id = $1 AND transfer_target_account IS NOT NULL
         UNION
         SELECT DISTINCT quicken_category FROM quicken_staging
           WHERE import_batch_id = $1 AND quicken_category IS NOT NULL
             AND quicken_category <> ''
       )
       SELECT n.name FROM names n
         LEFT JOIN account_source_mappings asm
           ON asm.source = 'quicken' AND asm.external_name = n.name
         WHERE asm.account_id IS NULL`,
      [id]
    );

    // Per-account cutoff (only mapped accounts)
    const accountIds = [...new Set(accountMapping.values())];
    let cutoffs = [];
    if (accountIds.length > 0) {
      const { rows } = await pool.query(
        `SELECT a.id AS account_id, a.name AS account_name,
                (SELECT MIN(transaction_date) FROM transactions
                   WHERE account_id = a.id AND source IN ('pocketsmith', 'auto-offset')) AS auto_cutoff
           FROM accounts a WHERE a.id = ANY($1::int[])`,
        [accountIds]
      );
      cutoffs = rows.map((r) => ({
        account_id: r.account_id,
        account_name: r.account_name,
        auto_cutoff: r.auto_cutoff,
      }));
    }

    // Per-Quicken-account row counts (so user can see scope)
    const { rows: perQuickenAccount } = await pool.query(
      `SELECT quicken_account_name, COUNT(*)::int AS rows
         FROM quicken_staging WHERE import_batch_id = $1
         GROUP BY quicken_account_name
         ORDER BY rows DESC`,
      [id]
    );

    // Transfer pair count (one per row with transfer_target_account)
    const { rows: transfers } = await pool.query(
      `SELECT COUNT(*)::int AS pairs FROM quicken_staging
         WHERE import_batch_id = $1 AND transfer_target_account IS NOT NULL`,
      [id]
    );

    // Stale/role-invalid stored mappings (global table survives model pivots) —
    // block promote so they don't silently route through the wrong category path.
    const roleInvalid = await findRoleInvalidMappings(pool, id);

    res.json({
      batchId: id,
      unmapped: unmapped.map((u) => u.name),
      roleInvalid,
      canPromote: unmapped.length === 0 && roleInvalid.length === 0 && perQuickenAccount.length > 0,
      perQuickenAccount,
      cutoffs,
      transferPairs: transfers[0].pairs,
    });
  } catch (err) {
    next(err);
  }
});

// ───────────────────────────────────────────────────────────────────────────
// POST /api/v2/quicken-import/batches/:id/promote
// Run the cash-only promote (per CR §6.4 + this CR's Phase E vertical slice).
// Returns the result counts or a 4xx/500 if promote failed.
// ───────────────────────────────────────────────────────────────────────────
router.post('/batches/:id/promote', async (req, res, next) => {
  try {
    const result = await runPromote({ batchId: req.params.id, pool });
    res.json(result);
  } catch (err) {
    // The CLI re-throws after recording status='failed' — return 422 so the
    // UI can surface the error message rather than treating it as a server fault.
    res.status(422).json({ error: err.message });
  }
});

// ───────────────────────────────────────────────────────────────────────────
// POST /api/v2/quicken-import/batches/:id/rollback
// Roll back a previously-promoted batch (per CR §6.5).
// ───────────────────────────────────────────────────────────────────────────
router.post('/batches/:id/rollback', async (req, res, next) => {
  try {
    const result = await runRollback({ batchId: req.params.id, pool });
    res.json(result);
  } catch (err) {
    res.status(422).json({ error: err.message });
  }
});

// ───────────────────────────────────────────────────────────────────────────
// DELETE /api/v2/quicken-import/batches/:id
// Hard-delete an UNPROMOTED batch (parsed / mapped / failed / parsing) and its
// parse-phase staging rows. Promoted or in-flight batches have ledger rows and
// MUST go through rollback first — refuse them (409). account_source_mappings
// are global (keyed by source + name) and intentionally preserved, so deleting
// a batch never loses mapping work.
// ───────────────────────────────────────────────────────────────────────────
const DELETABLE_STATUSES = ['parsing', 'parsed', 'mapped', 'failed'];
const STAGING_TABLES = [
  'quicken_staging',
  'quicken_securities_staging',
  'quicken_security_master_staging',
  'quicken_price_staging',
];

router.delete('/batches/:id', async (req, res, next) => {
  const { id } = req.params;
  try {
    const { rows } = await pool.query(
      'SELECT status FROM quicken_import_batches WHERE id = $1',
      [id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: 'batch not found' });
    }
    const { status } = rows[0];
    if (!DELETABLE_STATUSES.includes(status)) {
      return res.status(409).json({
        error: `cannot delete a '${status}' batch — roll it back first`,
      });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const t of STAGING_TABLES) {
        await client.query(`DELETE FROM ${t} WHERE import_batch_id = $1`, [id]);
      }
      await client.query('DELETE FROM quicken_import_batches WHERE id = $1', [id]);
      await client.query('COMMIT');
    } catch (e) {
      try { await client.query('ROLLBACK'); } catch (_) { /* ignore */ }
      throw e;
    } finally {
      client.release();
    }
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
