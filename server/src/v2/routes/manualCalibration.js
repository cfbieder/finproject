/**
 * /api/v2/manual-calibration/* — CR033 Manual Calibration for non-fed accounts.
 *
 * The non-fed twin of the bank-feed reconcile endpoints (CR023, in bankFeed.js).
 * Same workflow — computed-vs-target drift + a source-aware reconcile action —
 * but the target balance is a figure the user TYPES in (manual_balances), not a
 * feed value. No upstream sync (there is no feed); writes are confirm-gated in
 * the UI and idempotent server-side.
 */

const express = require('express');
const router = express.Router();

const manualReconciliation = require('../repositories/manualReconciliation');
const { reconcileManual, setManualBalance } = require('../services/reconcileManual');
const db = require('../db');

/**
 * GET /api/v2/manual-calibration/recon?asOf=YYYY-MM-DD
 * Per non-fed balance-sheet account: computed balance vs the user-entered current
 * balance, drift, and reconcile mode. Read-only.
 */
router.get('/recon', async (req, res, next) => {
  try {
    const asOf = req.query.asOf || null;
    const result = await manualReconciliation.manualBalanceReconcile({ asOf });
    res.json(result);
  } catch (err) {
    console.error('[v2/manual-calibration] recon failed:', err.message);
    next(err);
  }
});

/**
 * PUT /api/v2/manual-calibration/balance/:accountId  body: { balance, balanceDate?, note? }
 * Record/overwrite the user-entered current balance (fin's signed convention).
 */
router.put('/balance/:accountId', async (req, res, next) => {
  try {
    const accountId = Number(req.params.accountId);
    if (!Number.isInteger(accountId)) return res.status(400).json({ error: 'invalid accountId' });
    const { balance, balanceDate = null, note = null } = req.body || {};
    if (balance == null || !Number.isFinite(Number(balance))) {
      return res.status(400).json({ error: 'balance must be a finite number' });
    }
    const row = await setManualBalance(accountId, { balance: Number(balance), balanceDate, note });
    res.json({ data: row });
  } catch (err) {
    console.error('[v2/manual-calibration] set balance failed:', err.message);
    res.status(400).json({ error: err.message });
  }
});

/**
 * PATCH /api/v2/manual-calibration/reconcile-mode/:accountId  body: { mode }
 * Set how a non-fed account reconciles — 'calibrate' (re-anchor opening_balance)
 * or 'mtm' (post an Unrealized-G/L entry). Harmless on its own.
 */
router.patch('/reconcile-mode/:accountId', async (req, res, next) => {
  try {
    const accountId = Number(req.params.accountId);
    const { mode } = req.body || {};
    if (!Number.isInteger(accountId)) return res.status(400).json({ error: 'invalid accountId' });
    if (!['calibrate', 'mtm'].includes(mode)) {
      return res.status(400).json({ error: "mode must be 'calibrate' or 'mtm'" });
    }
    const r = await db.query(
      `UPDATE accounts SET manual_reconcile_mode = $2
       WHERE id = $1 AND section = 'balance_sheet'
       RETURNING id AS account_id, manual_reconcile_mode AS reconcile_mode`,
      [accountId, mode]
    );
    if (!r.rows[0]) return res.status(404).json({ error: 'no balance-sheet account with that id' });
    res.json({ data: r.rows[0] });
  } catch (err) {
    console.error('[v2/manual-calibration] set reconcile-mode failed:', err.message);
    next(err);
  }
});

/**
 * POST /api/v2/manual-calibration/reconcile/:accountId  body: { asOf?, dryRun?, force? }
 * The source-aware reconcile action: brokerage posts an Unrealized-G/L (MTM)
 * entry, cash re-anchors opening_balance — both against the entered balance.
 */
router.post('/reconcile/:accountId', async (req, res, next) => {
  try {
    const accountId = Number(req.params.accountId);
    if (!Number.isInteger(accountId)) return res.status(400).json({ error: 'invalid accountId' });
    const { asOf = null, dryRun = false, force = false } = req.body || {};
    const result = await reconcileManual(accountId, {
      asOf, dryRun: dryRun === true, force: force === true,
    });
    res.json(result);
  } catch (err) {
    console.error('[v2/manual-calibration] reconcile failed:', err.message);
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
