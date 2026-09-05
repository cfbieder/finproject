/**
 * V2 Investments Routes — CR090 P1.
 *
 * HTTP glue only; the shaping lives in services/investments.js (CR043 §2.2).
 *
 * READ-ONLY. There is deliberately no write verb here: this section reports
 * what the custodian holds and books nothing (CR090 §0).
 */

const express = require('express');
const router = express.Router();
const investments = require('../../services/investments');
const exposure = require('../../services/exposure');

/**
 * GET /api/v2/investments/portfolio?asOf=YYYY-MM-DD
 *
 * One entry per tracked account, each reconciling to its custodian balance.
 */
router.get('/portfolio', async (req, res, next) => {
  try {
    const { asOf } = req.query;
    if (asOf && !/^\d{4}-\d{2}-\d{2}$/.test(asOf)) {
      return res.status(400).json({ error: "Invalid 'asOf'; expected YYYY-MM-DD" });
    }
    const data = await investments.buildPortfolio({ asOf });
    res.json({ data, meta: { as_of: asOf || null } });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/v2/investments/exposure
 *
 * CR093 P1 — what the portfolio is EXPOSED to, funds seen through, as opposed to
 * what it holds. Read-only and derived entirely from cached reference data
 * (migration 077); no vendor is called on page load.
 */
router.get('/exposure', async (req, res, next) => {
  try {
    res.json({ data: await exposure.buildExposure() });
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/v2/investments/securities/:id/sectors
 *
 * CR093 P1 — hand-classify a holding no data provider can. The FIRST write in
 * this section (CR090 §0 made it read-only), so it is deliberately narrow: one
 * security, a set of weights that must sum to 100%, and nothing else. It cannot
 * create a security, change a position, or touch a price.
 */
router.put('/securities/:id/sectors', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid security id' });
    const data = await exposure.setSectorWeights(id, (req.body || {}).weights);
    return res.json({ data });
  } catch (err) {
    // The validation errors carry a status because each is a MESSAGE for the
    // owner — "these sum to 90%" is the whole point, not a generic 400.
    if (err.status) return res.status(err.status).json({ error: err.message });
    return next(err);
  }
});

/**
 * GET /api/v2/investments/accounts/:id/history
 */
router.get('/accounts/:id/history', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ error: 'Invalid account id' });
    }
    // The cap bounds the FEED series only; statements are always returned in
    // full (see accountHistory) so a decade of quarterly rows cannot be crowded
    // out by daily polls.
    const limit = Math.min(parseInt(req.query.limit, 10) || 400, 2000);
    const data = await investments.accountHistory(id, { limit });
    res.json({ data, meta: { account_id: id, points: data.length } });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
