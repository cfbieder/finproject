'use strict';
/**
 * forecast.audittrail.test.js
 *
 * Regression test for the module audit-trail route. It was broken in two ways
 * at once and always 500'd with `The "path" argument must be of type string.
 * Received undefined`:
 *   1. it read from `dataPaths.fcAuditTrail || path.join(dataPaths.baseDir, …)`,
 *      but neither key exists on `dataPaths` — so path.join(undefined) threw;
 *   2. its filename sanitizer lowercased and collapsed `_+`, while the writers
 *      (fcbuilder-module / fcbuilder-incexp) preserve case and repeats — so even
 *      with a valid dir it could never match a real file on a case-sensitive FS.
 *
 * Filesystem-backed only (no DB): writes a throwaway CSV into the real audit-trail
 * dir using the WRITERS' naming convention, then asserts the route reads it back.
 * If the route's sanitizer ever drifts from the writers' again, this fails.
 */

const fs = require('fs');
const path = require('path');
const { makeApp, request } = require('./_httpApp');
const router = require('../forecast');
const { PATHS } = require('../../../services/forecast/constants');

const app = makeApp('/forecast', router);
const req = (m, p) => request(app, m, `/forecast${p}`);

// Deliberately exercises the sharp edges: spaces, mixed case, and a '.' that
// sanitizes to a DOUBLE underscore (the old collapsing sanitizer broke on this).
const SCENARIO = 'AT Test Scenario';
const MODULE = 'Acme Sp. z o.o.';

// The writers' convention (fcbuilder-module.js / fcbuilder-incexp.js).
const sanitize = (v) => (v || '').replace(/[^a-z0-9]/gi, '_');
const fileName = `${sanitize(SCENARIO)}_${sanitize(MODULE)}_entries.csv`;
const filePath = path.join(PATHS.AUDIT_TRAIL_DIR, fileName);

describe('GET /forecast/audittrail/:scenario/:module', () => {
  beforeAll(() => {
    fs.mkdirSync(PATHS.AUDIT_TRAIL_DIR, { recursive: true });
    fs.writeFileSync(filePath, 'index,2026,2027\nBank Accounts,10,20\nTaxes,-1,-2\n', 'utf8');
  });

  afterAll(() => {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  });

  it('reads back a CSV written with the writers\' naming convention', async () => {
    const res = await req(
      'get',
      `/audittrail/${encodeURIComponent(SCENARIO)}/${encodeURIComponent(MODULE)}`
    );
    expect(res.status).toBe(200);
    expect(res.body.headers).toEqual(['index', '2026', '2027']);
    expect(res.body.rows).toHaveLength(2);
    expect(res.body.rows[0]).toEqual({ index: 'Bank Accounts', 2026: '10', 2027: '20' });
  });

  it('404s (not 500s) for a module with no audit trail', async () => {
    const res = await req(
      'get',
      `/audittrail/${encodeURIComponent(SCENARIO)}/${encodeURIComponent('No Such Module')}`
    );
    expect(res.status).toBe(404);
  });
});
