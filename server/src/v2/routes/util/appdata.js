'use strict';
/**
 * util/appdata.js — the appdata key/value document. Split out of routes/util.js; paths
 * unchanged (/api/v2/util/appdata).
 */

const express = require('express');
const router = express.Router();
const fs = require('fs');
const { dataPaths } = require('../../../utils/dataPaths');
// Hoisted out of the handlers (CR043 N13).
const psdata = require('../../repositories').psdata;

/**
 * This endpoint returns the WHOLE appdata document to any caller, and v3 has no auth — so
 * everything in it is readable by anything that can reach the app. It was serving a live
 * `anthropic_api_key` (found 2026-08-05, 108 chars, non-empty, reachable over the Tailscale
 * origin), which nothing in `server/` or `frontend/src` reads: AI Review goes through the
 * ocr-llm gateway. A dead credential, leaked on every page load that touches appdata.
 *
 * The value is deleted from the store in the same change, and the key rotated. This filter is
 * the second half of that: deleting one secret does not stop the next one being pasted into the
 * same document, and a blanket key-name filter costs nothing to keep correct.
 *
 * Matched on the NAME, not a fixed list, because the failure mode is a key nobody thought to
 * add to a list. `lastIngest` / `lastRefresh` / `moduleTypes` and the budget FX rows do not
 * match and are unaffected.
 */
const SECRET_KEY_RE = /(^|_)(api_?key|secret|token|password|passwd|credential)s?($|_)/i;

/** Strip anything that looks like a credential. Returns a copy; the source is untouched. */
function redactSecrets(doc) {
  if (!doc || typeof doc !== 'object') return doc;
  const out = {};
  for (const [k, v] of Object.entries(doc)) {
    if (SECRET_KEY_RE.test(k)) continue;   // omitted entirely — not masked, which still leaks length
    out[k] = v;
  }
  return out;
}

/**
 * GET /api/v2/util/appdata
 * Get application data (budget exchange rates, etc.)
 */
router.get('/appdata', async (req, res, next) => {
  try {

    // Read from JSON file
    const appDataPath = dataPaths.appData;
    let appData = {};

    try {
      if (fs.existsSync(appDataPath)) {
        const content = fs.readFileSync(appDataPath, 'utf8');
        const parsed = JSON.parse(content);
        appData = Array.isArray(parsed) && parsed.length > 0 ? parsed[0] : parsed;
      }
    } catch (readError) {
      console.warn('[v2/util/appdata] Could not read appData file:', readError.message);
    }

    // Merge with database app_data (lastIngest, lastRefresh are stored there)
    try {
      const dbData = await psdata.getAllAppData();
      Object.assign(appData, dbData);
    } catch (dbError) {
      console.warn('[v2/util/appdata] Could not read app_data from DB:', dbError.message);
    }

    res.json([redactSecrets(appData)]);
  } catch (error) {
    console.error('[v2/util/appdata] Failed to fetch appdata:', error);
    next(error);
  }
});

/**
 * POST /api/v2/util/appdata
 * Update application data (budget exchange rates, etc.)
 */
router.post('/appdata', async (req, res, next) => {
  try {

    const payload = req.body ?? {};
    const updates = Array.isArray(payload.updates)
      ? payload.updates
      : Array.isArray(payload.entries)
      ? payload.entries
      : [];

    const setFields = {};
    for (const update of updates) {
      if (!update || typeof update !== 'object') continue;
      const { key, value } = update;
      if (typeof key === 'string' && key.trim()) {
        setFields[key.trim()] = value;
      }
    }

    if (Object.keys(setFields).length === 0) {
      return res.status(400).json({
        error: 'No valid appdata entries were provided',
      });
    }

    const appDataPath = dataPaths.appData;
    let existing = {};

    try {
      if (fs.existsSync(appDataPath)) {
        const content = fs.readFileSync(appDataPath, 'utf8');
        const parsed = JSON.parse(content);
        existing = Array.isArray(parsed) && parsed.length > 0 ? parsed[0] : parsed;
      }
    } catch (readError) {
      console.warn('[v2/util/appdata POST] Could not read existing file:', readError.message);
    }

    // Merge updates
    const merged = { ...existing, ...setFields };
    fs.writeFileSync(appDataPath, JSON.stringify([merged], null, 2), 'utf8');

    res.json({
      updatedKeys: Object.keys(setFields),
    });
  } catch (error) {
    console.error('[v2/util/appdata POST] Failed to persist appdata:', error);
    next(error);
  }
});

module.exports = router;
