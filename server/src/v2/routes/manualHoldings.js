/**
 * /api/v2/manual-holdings/* — CR097 P1a: the holdings register for manually valued
 * accounts. Every write is whitelisted (CR046/CR047 class): unknown fields fail loud,
 * numbers must be finite (never coerced), dates are YYYY-MM-DD, and a holding id must
 * belong to the account in the path. All success responses are enveloped ({ data }).
 */

const express = require('express');
const router = express.Router();

const svc = require('../services/manualHoldings');
const validate = require('../utils/validate');

const HOLDING_FIELDS = [
  'name', 'currency', 'asset_class', 'platform', 'kind', 'status', 'acquired_on',
  'quantity', 'cost_local', 'cost_acct', 'proceeds_acct', 'note',
];
const VALUATION_FIELDS = ['valuedOn', 'items', 'force', 'ackStaleFx', 'expect'];
// Beyond any real holding, and inside NUMERIC(18,4): an overflow would otherwise
// surface as a 500 carrying Postgres' message.
const MAX_AMOUNT = 1e12;

function accountIdOf(req) {
  const id = Number(req.params.accountId);
  if (!Number.isInteger(id)) throw validate.badRequest('invalid accountId');
  return id;
}

function checkHoldingBody(body, { create }) {
  validate.assertPlainObject(body, 'holding');
  // Present-but-null on a field the table requires would reach a NOT NULL column
  // (or `.trim()`) and answer 500. cost_acct and proceeds_acct may be null.
  for (const k of ['name', 'kind', 'status', 'acquired_on', 'cost_local', 'asset_class']) {
    if (k in body && body[k] === null) throw validate.badRequest(`${k} cannot be null`);
  }
  const fields = create ? HOLDING_FIELDS : HOLDING_FIELDS.filter((f) => f !== 'currency');
  validate.assertAllowedFields(body, fields, 'holding');
  validate.assertNonEmptyString(body.name, 'name', { optional: !create });
  validate.assertNonEmptyString(body.currency, 'currency', { optional: !create });
  validate.assertNonEmptyString(body.kind, 'kind', { optional: !create });
  validate.assertDateString(body.acquired_on, 'acquired_on', { optional: !create });
  validate.assertFiniteNumber(body.cost_local, 'cost_local', { optional: !create });
  validate.assertFiniteNumber(body.quantity, 'quantity', { optional: true });
  validate.assertFiniteNumber(body.cost_acct, 'cost_acct', { optional: true });
  validate.assertFiniteNumber(body.proceeds_acct, 'proceeds_acct', { optional: true });
  for (const k of ['platform', 'note', 'asset_class', 'status']) {
    if (body[k] != null && typeof body[k] !== 'string') throw validate.badRequest(`${k} must be a string`);
  }
  if (body.name != null && body.name.length > 200) throw validate.badRequest('name is at most 200 characters');
  if (body.platform != null && body.platform.length > 100) throw validate.badRequest('platform is at most 100 characters');
  for (const k of ['quantity', 'cost_local', 'cost_acct', 'proceeds_acct']) {
    if (body[k] != null && Math.abs(Number(body[k])) >= MAX_AMOUNT) throw validate.badRequest(`${k} is out of range`);
  }
}

function checkValuationBody(body) {
  validate.assertPlainObject(body, 'valuation');
  validate.assertAllowedFields(body, VALUATION_FIELDS, 'valuation');
  validate.assertDateString(body.valuedOn, 'valuedOn');
  validate.assertBoolean(body.force, 'force', { optional: true });
  validate.assertBoolean(body.ackStaleFx, 'ackStaleFx', { optional: true });
  const items = body.items ?? [];
  if (!Array.isArray(items)) throw validate.badRequest('items must be an array');
  const seen = new Set();
  for (const it of items) {
    validate.assertPlainObject(it, 'valuation item');
    validate.assertAllowedFields(it, ['holding_id', 'price', 'value'], 'valuation item');
    validate.assertInteger(it.holding_id, 'holding_id');
    validate.assertFiniteNumber(it.price, 'price', { optional: true });
    validate.assertFiniteNumber(it.value, 'value', { optional: true });
    if (it.price != null && Number(it.price) < 0) throw validate.badRequest('price must be ≥ 0');
    if (it.value != null && Number(it.value) < 0) throw validate.badRequest('value must be ≥ 0');
    if (Math.abs(Number(it.price ?? 0)) >= MAX_AMOUNT || Math.abs(Number(it.value ?? 0)) >= MAX_AMOUNT) {
      throw validate.badRequest('price/value is out of range');
    }
    // Two entries for one holding would silently keep the last.
    if (seen.has(Number(it.holding_id))) throw validate.badRequest(`holding ${it.holding_id} appears twice`);
    seen.add(Number(it.holding_id));
  }
  if (body.expect != null) {
    validate.assertPlainObject(body.expect, 'expect');
    validate.assertAllowedFields(body.expect, ['mtm_amount', 'total'], 'expect');
    validate.assertFiniteNumber(body.expect.mtm_amount, 'expect.mtm_amount');
    validate.assertFiniteNumber(body.expect.total, 'expect.total');
  }
  return {
    valuedOn: body.valuedOn,
    items: items.map((it) => ({
      holding_id: Number(it.holding_id),
      price: it.price == null ? null : Number(it.price),
      value: it.value == null ? null : Number(it.value),
    })),
    force: body.force === true,
    ackStaleFx: body.ackStaleFx === true,
    expect: body.expect || null,
  };
}

/** A blocked or stale valuation answers with its figures, so the UI can show why. */
function valuationError(err, res, next) {
  if (err.code === 'VALUATION_BLOCKED' || err.code === 'PREVIEW_STALE') {
    return res.status(err.status).json({ error: err.message, code: err.code, current: err.summary });
  }
  return next(err);
}

// The Holdings index (nav entry): registers first, then accounts that could carry one.
router.get('/', async (req, res, next) => {
  try {
    res.json({ data: await svc.listRegisters() });
  } catch (err) { next(err); }
});

router.get('/:accountId', async (req, res, next) => {
  try {
    res.json({ data: await svc.getRegister(accountIdOf(req)) });
  } catch (err) { next(err); }
});

router.post('/:accountId/enable', async (req, res, next) => {
  try {
    res.json({ data: await svc.enableRegister(accountIdOf(req)) });
  } catch (err) { next(err); }
});

router.post('/:accountId/disable', async (req, res, next) => {
  try {
    res.json({ data: await svc.disableRegister(accountIdOf(req)) });
  } catch (err) { next(err); }
});

router.post('/:accountId/holdings', async (req, res, next) => {
  try {
    const accountId = accountIdOf(req);
    checkHoldingBody(req.body, { create: true });
    res.status(201).json({ data: await svc.createHolding(accountId, req.body) });
  } catch (err) { next(err); }
});

router.patch('/:accountId/holdings/:holdingId', async (req, res, next) => {
  try {
    const accountId = accountIdOf(req);
    const holdingId = Number(req.params.holdingId);
    if (!Number.isInteger(holdingId)) throw validate.badRequest('invalid holdingId');
    checkHoldingBody(req.body, { create: false });
    res.json({ data: await svc.updateHolding(accountId, holdingId, req.body) });
  } catch (err) { next(err); }
});

// Buy from cash: the spent share of a cash holding's cost moves into a new holding.
const BUY_FIELDS = ['amount_local', 'name', 'asset_class', 'platform', 'kind', 'quantity', 'acquired_on', 'note'];
router.post('/:accountId/holdings/:holdingId/buy', async (req, res, next) => {
  try {
    const accountId = accountIdOf(req);
    const holdingId = Number(req.params.holdingId);
    if (!Number.isInteger(holdingId)) throw validate.badRequest('invalid holdingId');
    const b = req.body;
    validate.assertPlainObject(b, 'buy');
    validate.assertAllowedFields(b, BUY_FIELDS, 'buy');
    validate.assertFiniteNumber(b.amount_local, 'amount_local');
    validate.assertNonEmptyString(b.name, 'name');
    validate.assertNonEmptyString(b.kind, 'kind');
    validate.assertDateString(b.acquired_on, 'acquired_on');
    validate.assertFiniteNumber(b.quantity, 'quantity', { optional: true });
    for (const k of ['platform', 'note', 'asset_class']) {
      if (b[k] != null && typeof b[k] !== 'string') throw validate.badRequest(`${k} must be a string`);
    }
    if (b.name.length > 200) throw validate.badRequest('name is at most 200 characters');
    if (b.platform != null && b.platform.length > 100) throw validate.badRequest('platform is at most 100 characters');
    for (const k of ['amount_local', 'quantity']) {
      if (b[k] != null && Math.abs(Number(b[k])) >= MAX_AMOUNT) throw validate.badRequest(`${k} is out of range`);
    }
    res.status(201).json({ data: await svc.buyFromCash(accountId, holdingId, b) });
  } catch (err) { next(err); }
});

router.delete('/:accountId/holdings/:holdingId', async (req, res, next) => {
  try {
    const accountId = accountIdOf(req);
    const holdingId = Number(req.params.holdingId);
    if (!Number.isInteger(holdingId)) throw validate.badRequest('invalid holdingId');
    res.json({ data: await svc.deleteHolding(accountId, holdingId) });
  } catch (err) { next(err); }
});

router.post('/:accountId/valuations/preview', async (req, res, next) => {
  try {
    const accountId = accountIdOf(req);
    const input = checkValuationBody(req.body);
    res.json({ data: await svc.previewValuation(accountId, { ...input, expect: null }) });
  } catch (err) { next(err); }
});

router.post('/:accountId/valuations', async (req, res, next) => {
  try {
    const accountId = accountIdOf(req);
    const input = checkValuationBody(req.body);
    res.json({ data: await svc.saveValuation(accountId, input) });
  } catch (err) { valuationError(err, res, next); }
});

router.delete('/:accountId/valuations/:date', async (req, res, next) => {
  try {
    const accountId = accountIdOf(req);
    validate.assertDateString(req.params.date, 'date');
    res.json({ data: await svc.deleteValuation(accountId, req.params.date) });
  } catch (err) { next(err); }
});

module.exports = router;
