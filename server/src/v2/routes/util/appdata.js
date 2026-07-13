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

    res.json([appData]);
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
