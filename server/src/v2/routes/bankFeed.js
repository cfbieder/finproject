/**
 * /api/v2/bank-feed/* — read-only proxy to the bank-feed microservice (CR021).
 *
 * Phase 7 spike: exposes bank-feed's /v1/* data through fin's API so the
 * BankFeedDiagnostic page can fetch it without the API key going to the
 * browser. No mutations — diagnostic / verification only.
 *
 * v3 cutover (planned CR022) will swap PocketSmith calls in fin's data
 * pipelines for these. For now this is purely additive.
 */

const express = require('express');
const router = express.Router();

const client = require('../services/bankFeedClient');
const accountSourceMappings = require('../repositories/accountSourceMappings');
const db = require('../db');

// Wrap a client call so any error becomes a clean JSON 502.
function proxy(fn) {
  return async (req, res) => {
    try {
      const data = await fn(req);
      res.json(data);
    } catch (err) {
      const status = err.status && err.status >= 400 && err.status < 600 ? err.status : 502;
      res.status(status).json({
        error: err.message,
        bank_feed_url: client.baseUrl,
      });
    }
  };
}

router.get('/health',         proxy(() => client.health()));
router.get('/health/feeds',   proxy(() => client.feedsHealth()));
router.get('/connections',    proxy(() => client.connections()));
router.get('/accounts',       proxy(() => client.accounts()));
router.get('/balances',       proxy((req) => client.balances(req.query.as_of)));
router.get('/transactions',   proxy((req) => client.transactions({
  since:     req.query.since,
  until:     req.query.until,
  accountId: req.query.account_id,
  limit:     req.query.limit,
  offset:    req.query.offset,
})));

// Diagnostic: aggregate everything BankFeedDiagnostic.jsx needs in one call.
router.get('/diagnostic', async (req, res) => {
  const out = {
    bank_feed_url: client.baseUrl,
    fetched_at: new Date().toISOString(),
  };
  const safe = async (key, fn) => {
    try { out[key] = await fn(); }
    catch (err) { out[key] = { error: err.message }; }
  };
  await Promise.all([
    safe('health',           () => client.health()),
    safe('feeds_health',     () => client.feedsHealth()),
    safe('accounts',         () => client.accounts()),
    safe('balances',         () => client.balances()),
    safe('recent_transactions',
      () => client.transactions({ limit: 20 })),
  ]);
  res.json(out);
});

// ---------------------------------------------------------------------------
// CR022 R1 — per-account mapping + ignore management (drives the diagnostic UI)
// ---------------------------------------------------------------------------

/**
 * GET /api/v2/bank-feed/account-mappings
 * Each bank-feed account joined with its fin mapping (source='bank-feed') + the
 * R1 ignore flag + its unpromoted staged count, so the UI shows what needs action.
 */
router.get('/account-mappings', async (req, res) => {
  try {
    const acctResp = await client.accounts();
    const feedAccounts = Array.isArray(acctResp) ? acctResp : (acctResp && acctResp.accounts) || [];

    const mappings = await accountSourceMappings.listBySource('bank-feed');
    const byExternal = new Map(mappings.map((m) => [m.external_name, m]));

    // Selectable fin accounts (active) + id→name map for display. Queried
    // directly: the accounts repo doesn't export a flat list method.
    const finRows = (await db.query(
      `SELECT id, name, section, account_type FROM accounts WHERE is_active = TRUE ORDER BY section, name`
    )).rows;
    const finNameById = new Map(finRows.map((a) => [a.id, a.name]));

    // unpromoted staged counts per feed account UUID
    const staged = await db.query(`
      SELECT feed_account_external_id AS uuid, COUNT(*)::int AS n
      FROM bankfeed_staging
      WHERE promoted_transaction_id IS NULL AND feed_account_external_id IS NOT NULL
      GROUP BY feed_account_external_id
    `);
    const stagedByUuid = new Map(staged.rows.map((r) => [r.uuid, r.n]));

    const rows = feedAccounts.map((a) => {
      const m = byExternal.get(a.external_id) || null;
      return {
        external_id: a.external_id,
        name: a.name,
        currency: a.currency,
        type: a.type,
        mapped_account_id: m ? m.account_id : null,
        mapped_account_name: m ? finNameById.get(m.account_id) || null : null,
        ignored: m ? m.ignored === true : false,
        status: !m ? 'pending' : (m.ignored ? 'ignored' : 'mapped'),
        staged_unpromoted: stagedByUuid.get(a.external_id) || 0,
      };
    });

    res.json({ accounts: rows, fin_accounts: finRows });
  } catch (err) {
    const status = err.status && err.status >= 400 && err.status < 600 ? err.status : 502;
    res.status(status).json({ error: err.message, bank_feed_url: client.baseUrl });
  }
});

/**
 * PUT /api/v2/bank-feed/account-mappings/:externalId
 * Body: { accountId, ignored }. accountId null/omitted → unmap (delete the row,
 * back to pending). Otherwise upsert the mapping with the R1 ignore flag.
 */
router.put('/account-mappings/:externalId', async (req, res, next) => {
  try {
    const { externalId } = req.params;
    const { accountId, ignored } = req.body || {};

    if (accountId == null) {
      const removed = await accountSourceMappings.removeBySourceAndName('bank-feed', externalId);
      return res.json({ external_id: externalId, status: 'pending', removed: !!removed });
    }

    const row = await accountSourceMappings.setBankFeedMapping(externalId, accountId, ignored === true);
    res.json({
      external_id: externalId,
      mapped_account_id: row.account_id,
      ignored: row.ignored === true,
      status: row.ignored ? 'ignored' : 'mapped',
    });
  } catch (err) {
    console.error('[v2/bank-feed] set account-mapping failed:', err.message);
    next(err);
  }
});

module.exports = router;
