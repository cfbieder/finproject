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

module.exports = router;
