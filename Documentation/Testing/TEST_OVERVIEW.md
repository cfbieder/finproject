# Test Overview

How testing is organised across the project, what's automated, and where to run each layer.

## Automated tests

### Backend Jest tests — `cd server && npm test`

73 tests across 6 files. Engine tests use mocked data; route tests mock the repository layer (so they don't exercise real SQL).

| File | Coverage |
|------|----------|
| `server/src/services/forecast/__tests__/fcbuilder-module.test.js` | 19 BS module engine tests (equity / property / fixed-income / liability / FX / tax / Phase 5 work). |
| `server/src/services/forecast/__tests__/fcbuilder-incexp.test.js` | 6 income/expense engine tests. |
| `server/src/services/forecast/__tests__/cash-sweep.test.js` | Cash sweep pure-compute tests (CR005). |
| `server/src/services/forecast/__tests__/e2e-engine.test.js` | 8 end-to-end engine scenarios. |
| `server/src/v2/routes/__tests__/fc-lines.test.js` | 16 FC Lines route tests with mocked repo. |
| `server/src/v2/routes/__tests__/calibration.test.js` | 16 balance calibration route tests with mocked repo. |

Naming: Jest convention `*.test.js`. Test files are colocated with the modules under test in `__tests__/` subdirectories.

### Backend HTTP smoke tests — `node server/src/scripts/smoke-after-021.js`

17 endpoint checks against a live server. Hits every JOIN that was rewritten when `categories` was collapsed into `accounts` (CR013). Asserts HTTP 200, response shape, and invariants (e.g. all 9 transfer leaves visible, FK round-trip integrity). Override target with `BASE_URL=http://...`. Exits non-zero on failure.

Naming convention for new smoke scripts: `server/src/scripts/smoke-<topic>.js`. Run them ad hoc — they're not part of `npm test`.

### Frontend Vitest tests — `cd frontend && npm test`

96 tests across 5 files. Pure-function helpers tested in `jsdom`; no network, no real DB. Established under [CR016 — Frontend Test Framework](../CRs/CR016_FRONTEND_TEST_FRAMEWORK.md) (closed 2026-05-20).

| File | Coverage |
|------|----------|
| `frontend/src/utils/__tests__/dateHelpers.test.js` | 21 tests covering all 10 exports of `dateHelpers.js` (timezone-safe formatting, leap-year month-end, `parseMonthYear` ↔ `buildDateFromMonthYear` round-trip, year/month range generators). |
| `frontend/src/utils/__tests__/formatters.test.js` | 25 tests covering all 7 exports of `formatters.js` (accountant-style `formatCurrency`, `formatPercentage` vs `formatRate` distinction, `formatFxRate`, thousands separators, compact K/M/B notation, `parseCurrency` round-trip with `formatCurrency`). |
| `frontend/src/utils/__tests__/treeTraversal.test.js` | 17 tests covering all 4 exports of `treeTraversal.js` (`collectCollapsiblePaths` path joining with `>`, `buildAccountValueMap` with custom valueKey, `collectLeafNames` leaf flattening, `findNodeByPath` multi-segment lookup). |
| `frontend/src/utils/__tests__/forecastHelpers.test.js` | 20 tests covering all 4 exports of `forecastHelpers.js` — `parseLevelAccounts` (both tree `{name, children}` and legacy `[{Income: [{Salary: [...]}]}]` formats), `aggregateForecastEntries` level1/2/3 rollup with string-coercion, `calculateNetCashFlow`, `formatTableCell` negative-paren + `--negative` modifier. |
| `frontend/src/utils/__tests__/cashFlowHelpers.test.js` | 13 tests covering all 2 exports of `cashFlowHelpers.js` — `addNetCashFlowCategory` (case-insensitive Income/Expense(s), idempotent re-append, missing-bucket → 0), `buildCashFlowValueMap` (deep path traversal, nullish-node skipping). |

Naming: Vitest convention `*.test.{js,jsx}` under `__tests__/`. `npm run test:watch` for watch mode.

## Manual QA

For UI changes that automated tests can't cover, write a brief manual checklist alongside the CR. Naming convention: `Documentation/Testing/TEST_MANUAL_<feature>.md` (KEBAB or SNAKE feature name).

A checklist should include:
- The user-visible flow being tested (one sentence).
- Step-by-step actions in the browser.
- Expected outcomes per step.
- Edge cases worth touching.

## Adding tests

| When | Where |
|------|-------|
| Pure backend logic (engine, calculations) | `server/src/<module>/__tests__/<module>.test.js` (Jest). |
| Backend route + DB integration | Add to `smoke-after-021.js` or a new `smoke-<topic>.js` script. Don't try to mock Postgres. |
| Frontend helper / hook | `frontend/src/<path>/__tests__/<thing>.test.js` (Vitest, jsdom). |
| Manual UI verification | `Documentation/Testing/TEST_MANUAL_<feature>.md`. |

## Running everything before a release

```bash
cd server && npm test                          # Jest unit/route tests
cd frontend && npm test                        # Vitest helper tests
node server/src/scripts/smoke-after-021.js     # HTTP smoke against live server
```

Migration testing: take a `pg_dump` first, run on `fin-postgres-dev` (port 5434), validate, then apply to `fin-postgres` (port 5433).
