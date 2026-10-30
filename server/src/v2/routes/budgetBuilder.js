'use strict';
/**
 * /api/v2/budget-builder — CR098, next year's budget from this year's finalised Latest Estimate.
 * The logic lives in services/budgetBuilder.js; this file is HTTP only.
 */

const express = require('express');
const svc = require('../../services/budgetBuilder');

const router = express.Router();

const handle = (fn) => async (req, res, next) => {
  try {
    await fn(req, res);
  } catch (error) {
    if (error.status && error.status < 500) return res.status(error.status).json({ error: error.message });
    console.error(`[budget-builder] ${req.method} ${req.originalUrl} failed:`, error);
    next(error);
  }
};
const id = (req) => {
  const n = parseInt(req.params.id, 10);
  if (!n) throw Object.assign(new Error('Invalid build id'), { status: 400 });
  return n;
};

// GET / — finalised LEs, base scenarios, and every build (newest first)
router.get('/', handle(async (req, res) => res.json({ data: await svc.listSources() })));

// POST / — { sourceLeId, scenarioName, targetYear?, parentBuildId?, note? } → a new draft
router.post('/', handle(async (req, res) => {
  const { sourceLeId, scenarioName, targetYear, parentBuildId, note } = req.body || {};
  res.status(201).json({ data: await svc.createBuild({ sourceLeId, scenarioName, targetYear, parentBuildId, note }) });
}));

// GET /:id — the build: lines, annual figures, rates and where each rate came from
router.get('/:id', handle(async (req, res) => res.json({ data: await svc.getBuild(id(req)) })));

// PATCH /:id — { note }
router.patch('/:id', handle(async (req, res) => {
  await svc.setNote(id(req), req.body?.note);
  res.json({ data: await svc.getBuild(id(req)) });
}));

// DELETE /:id — a draft only
router.delete('/:id', handle(async (req, res) => {
  await svc.deleteDraft(id(req));
  res.json({ data: { deleted: true } });
}));

// PATCH /:id/lines/:lineId — { policy?, fixedAmount?, inflationPct?, splitMethod?, splitMonth? }
router.patch('/:id/lines/:lineId', handle(async (req, res) => {
  await svc.updateLine(id(req), parseInt(req.params.lineId, 10), req.body || {});
  res.json({ data: await svc.getBuild(id(req)) });
}));

// GET /:id/preview — the month split, what Publish deletes and writes, blockers, checksum
router.get('/:id/preview', handle(async (req, res) => res.json({ data: await svc.previewPublish(id(req)) })));

// POST /:id/publish — { checksum } from the preview. Publishes a draft, or restores an earlier build.
router.post('/:id/publish', handle(async (req, res) => {
  res.json({ data: await svc.publish(id(req), { checksum: req.body?.checksum }) });
}));

// POST /:id/unpublish — puts back what this build's most recent publish replaced
router.post('/:id/unpublish', handle(async (req, res) => res.json({ data: await svc.unpublish(id(req)) })));

module.exports = router;
