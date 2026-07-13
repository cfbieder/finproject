'use strict';
/**
 * util.js — index for the /api/v2/util routes.
 *
 * This used to be a 651-line file holding FOUR unrelated concerns behind one router — the
 * dashboard attention summary, FX/currencies, the appdata document, the whole Chart of
 * Accounts CRUD, and a database backup — with five require()s buried inside handlers and
 * **no tests at all** (CR043 §2.2: "util.js NOT extracted — deliberately").
 *
 * It is now four cohesive routers, mounted here. **Every URL is unchanged** (/api/v2/util/*):
 * this is a file split, not an API change, so nothing on the frontend moves.
 *
 * The split came SECOND, on purpose. These endpoints had no tests — including the COA
 * add/update/delete writes the Chart of Accounts page depends on — and moving untested code
 * is how you find out later. `__tests__/util.routes.test.js` came first, and writing it
 * immediately found a real bug: POST /coa/update destructured `type` and never used it, so
 * changing an account's type returned 200 and silently changed nothing.
 *
 * Note what did NOT need doing: CR043 proposed extracting a COA *service*. The COA handlers
 * contain no SQL — they already go through the accounts repository — so there was no service
 * to extract. The missing thing was tests, not layers.
 */

const express = require('express');
const router = express.Router();

router.use(require('./util/ops'));      // attention summary, database backup
router.use(require('./util/fx'));       // currencies, exchange rates
router.use(require('./util/appdata'));  // the appdata key/value document
router.use(require('./util/coa'));      // Chart of Accounts read/write

module.exports = router;
