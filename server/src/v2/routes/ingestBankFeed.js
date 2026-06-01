/**
 * V2 Bank Feed Ingest Routes (CR022 Phase C).
 *
 * Additive parallel-import surface that mirrors ingestPs.js shape for symmetry.
 * Pulls from the bank-feed /v1/* contract, stages, and promotes into the shared
 * `transactions` table with source='bank-feed'. PS routes are untouched.
 *
 *   POST /api/v2/ingest-bank-feed/refresh              full pipeline (ingest+promote)
 *   POST /api/v2/ingest-bank-feed/ingest               STAGE ONLY (cron path — no promote)
 *   POST /api/v2/ingest-bank-feed/sync-to-transactions promote staging→canonical only
 *   POST /api/v2/ingest-bank-feed/review-new-transactions  unaccepted rows (any source)
 *   GET  /api/v2/ingest-bank-feed/count                staged row count
 */

const express = require('express');
const router = express.Router();

const refreshBankFeed = require('../services/refreshBankFeedV2');
const staging = require('../repositories/bankfeedStaging');
const bankFeedClient = require('../services/bankFeedClient');

// Map a bank-feed client error to an HTTP status + the CR021 Phase 7 envelope.
function sendUpstreamError(res, error, context) {
  const msg = error && error.message ? error.message : String(error);
  const isTimeout = /timed out/i.test(msg) || error.name === 'AbortError';
  const status = isTimeout ? 504 : (error.status && error.status >= 500 ? 502 : (error.status || 502));
  console.error(`[v2/ingest-bank-feed] ${context} failed:`, msg);
  return res.status(status).json({
    error: msg,
    bank_feed_url: bankFeedClient.baseUrl,
  });
}

/**
 * POST /refresh  — full ingest + promote.
 * Body: { sinceDays?: number (default 14), since?: 'YYYY-MM-DD' }
 */
router.post('/refresh', async (req, res) => {
  const { sinceDays, since } = req.body || {};
  try {
    const result = await refreshBankFeed.refresh({
      sinceDays: sinceDays != null ? Number(sinceDays) : undefined,
      since,
    });
    res.json(result);
  } catch (error) {
    return sendUpstreamError(res, error, 'refresh');
  }
});

/**
 * POST /ingest — STAGE ONLY (fetch + stage to bankfeed_staging, no promote).
 * The scheduled/cron path (G1): unattended runs stage but never touch the
 * ledger — promotion stays behind the "Import now" button (human in the loop).
 * Body: { sinceDays?: number (default 14), since?: 'YYYY-MM-DD' }
 */
router.post('/ingest', async (req, res) => {
  const { sinceDays, since } = req.body || {};
  try {
    const ingest = await refreshBankFeed.ingest({
      sinceDays: sinceDays != null ? Number(sinceDays) : undefined,
      since,
    });
    res.json({ ingest });
  } catch (error) {
    return sendUpstreamError(res, error, 'ingest');
  }
});

/**
 * POST /sync-to-transactions — promote already-staged rows only (no fetch).
 */
router.post('/sync-to-transactions', async (req, res, next) => {
  try {
    const sync = await refreshBankFeed.promote();
    res.json({ sync });
  } catch (error) {
    console.error('[v2/ingest-bank-feed] sync-to-transactions failed:', error);
    next(error);
  }
});

/**
 * POST /review-new-transactions — unaccepted rows for review (source-agnostic).
 * Bank-feed rows surface in the same queue as PS; this is a convenience alias
 * that returns only bank-feed rows for a dedicated refresh page if wanted.
 */
router.post('/review-new-transactions', async (req, res) => {
  try {
    const db = require('../db');
    const result = await db.query(`
      SELECT t.id, t.transaction_date, t.description1, t.description2,
             t.amount, t.currency, t.base_amount, t.base_currency,
             COALESCE(a.name, '') AS account_name,
             t.account_id, t.bank_feed_external_id, t.source
      FROM transactions t
      LEFT JOIN accounts a ON t.account_id = a.id
      WHERE t.accepted IS NOT TRUE AND t.source = 'bank-feed'
      ORDER BY t.transaction_date DESC, t.id DESC
    `);
    res.json({ data: result.rows });
  } catch (error) {
    console.error('[v2/ingest-bank-feed] review-new-transactions failed:', error);
    res.status(500).json({ error: 'Unable to load bank-feed review transactions' });
  }
});

/**
 * GET /count — staged row count (diagnostic).
 */
router.get('/count', async (req, res, next) => {
  try {
    const count = await staging.count();
    res.json({ count });
  } catch (error) {
    console.error('[v2/ingest-bank-feed] count failed:', error);
    next(error);
  }
});

module.exports = router;
