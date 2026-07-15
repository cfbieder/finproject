# Test Overview

How testing is organised across the project, what's automated, and where to run each layer.

## Automated tests

### Backend Jest tests — `cd server && npm test`

**394 tests across 31 suites** (counts as of v3.1.0, 2026-07-14). Two flavors: pure/mocked suites, and **DB-backed suites** that self-seed throwaway rows by unique name against `DATABASE_URL` (dev Postgres :5434) and clean up after themselves — never TRUNCATE. Skip the DB-backed ones with `SKIP_DB_TESTS=1`. Run with `npx env-cmd -e development -- npm test` so `DATABASE_URL` is set.

| File | Tests | Coverage |
|------|-------|----------|
| `services/forecast/__tests__/fcbuilder-module.test.js` | 21 | BS module engine (equity / property / fixed-income / liability / FX / tax). |
| `services/forecast/__tests__/cash-sweep.test.js` | 10 | Cash sweep pure-compute (CR005/CR017). |
| `services/forecast/__tests__/e2e-engine.test.js` | 8 | End-to-end engine scenarios. |
| `services/forecast/__tests__/fcbuilder-incexp.test.js` | 4 | Income/expense engine. |
| `v2/scripts/__tests__/quicken-import.test.js` | 44 | CR019 Quicken mapping/backfill. |
| `v2/scripts/__tests__/quicken-promote.test.js` | 16 | CR019 promote guards. |
| `v2/services/__tests__/bankFeedImport.test.js` | 36 | CR021/22 feed import + converter. |
| `v2/services/__tests__/cr024Categorizer.test.js` | 15 | Fidelity investment-activity categorizer. |
| `v2/services/__tests__/reconcileManual.test.js` | 14 | CR033 manual calibration engine (DB). |
| `v2/services/__tests__/reconcileToFeed.test.js` | 12 | Feed reconcile engine (DB). |
| `v2/services/__tests__/manualStatementImport.test.js` | 9 | CR036 statement upload preview/commit. |
| `v2/services/__tests__/aiReviewCompare.test.js` | 5 | CR040 compare context/persistence (DB; gateway stubbed via `global.fetch`). |
| `v2/services/__tests__/cr024FidelityBalances.test.js` + `cr024IngestBalances.test.js` + `syncUpstream.test.js` | 10 | Balance read-override, ingest, upstream sync. |
| `v2/routes/__tests__/fc-lines.test.js` | 16 | FC Lines routes (mocked repo). |
| `v2/routes/__tests__/ingestBankFeed.test.js` | 10 | Feed ingest route. |
| `v2/repositories/__tests__/` (4 files) | 15 | createTransaction, ledger running balance, neutralize, split residual (CR037). |
| `v2/utils/__tests__/validate.test.js` | 7 | CR037 field-whitelist validation. |

Naming: Jest convention `*.test.js`. Test files are colocated with the modules under test in `__tests__/` subdirectories. (This table is a snapshot — `npx jest --listTests` is the live source of truth.)

### Backend HTTP smoke tests — `node server/src/scripts/smoke-after-021.js`

17 endpoint checks against a live server. Hits every JOIN that was rewritten when `categories` was collapsed into `accounts` (CR013). Asserts HTTP 200, response shape, and invariants (e.g. all 9 transfer leaves visible, FK round-trip integrity). Override target with `BASE_URL=http://...`. Exits non-zero on failure.

Naming convention for new smoke scripts: `server/src/scripts/smoke-<topic>.js`. Run them ad hoc — they're not part of `npm test`.

### Frontend Vitest tests — `cd frontend && npm test`

**195 tests across 21 files** (as of v3.1.0). Pure-function helpers plus component render tests (Modal/DataTable) in `jsdom`; no network, no real DB. Established under [CR016 — Frontend Test Framework](../cr/cr-016-frontend-test-framework.md) (closed 2026-05-20).

| File | Tests | Coverage |
|------|-------|----------|
| `src/utils/__tests__/formatters.test.js` | 27 | All 7 exports of `formatters.js` (accountant-style `formatCurrency`, `formatPercentage` vs `formatRate`, `formatFxRate`, compact K/M/B, `parseCurrency` fail-loud round-trip). |
| `src/utils/__tests__/dateHelpers.test.js` | 26 | All exports of `dateHelpers.js` (timezone-safe formatting incl. CR037 `formatDateOnly`, leap-year month-end, `parseMonthYear` round-trip, range generators). |
| `src/utils/__tests__/forecastHelpers.test.js` | 20 | `parseLevelAccounts` (tree + legacy formats), `aggregateForecastEntries` rollup, `calculateNetCashFlow`, `formatTableCell`. |
| `src/utils/__tests__/treeTraversal.test.js` | 17 | All 4 exports of `treeTraversal.js` (collapsible paths, value maps, leaf flattening, path lookup). |
| `src/features/Forecast/utils/__tests__/fcCompareUtils.test.js` | 14 | CR040 compare diff engine — Review-parity pivot (Expense-net-of-Transfers, Cash Flow/Net, bank running balance), base-year filtering, year-union alignment, one-scenario-only accounts → zero-not-null deltas, structural diffs, deterministic commentary (movers, crossovers, self-compare). |
| `src/utils/__tests__/cashFlowHelpers.test.js` | 13 | `addNetCashFlowCategory` (idempotent, case-insensitive), `buildCashFlowValueMap`. |

Naming: Vitest convention `*.test.{js,jsx}` under `__tests__/`. `npm run test:watch` for watch mode.

## Manual QA

For UI changes that automated tests can't cover, write a brief manual checklist alongside the CR. Naming convention: `docs/current/TEST_MANUAL_<feature>.md` (KEBAB or SNAKE feature name).

A checklist should include:
- The user-visible flow being tested (one sentence).
- Step-by-step actions in the browser.
- Expected outcomes per step.
- Edge cases worth touching.

## Adding tests

| When | Where |
|------|-------|
| Pure backend logic (engine, calculations) | `server/src/<module>/__tests__/<module>.test.js` (Jest). |
| Backend route + DB integration | DB-backed Jest suite that self-seeds throwaway rows by unique name against `DATABASE_URL` and cleans up after itself (pattern: `reconcileManual.test.js`); guard with `SKIP_DB_TESTS`. Don't try to mock Postgres. Smoke scripts (`smoke-<topic>.js`) for ad-hoc live-server checks. |
| Frontend helper / hook | `frontend/src/<path>/__tests__/<thing>.test.js` (Vitest, jsdom). |
| Manual UI verification | `docs/current/TEST_MANUAL_<feature>.md`. |

## Running everything before a release

```bash
cd server && npm test                          # Jest unit/route tests
cd frontend && npm test                        # Vitest helper tests
node server/src/scripts/smoke-after-021.js     # HTTP smoke against live server
```

Migration testing: take a `pg_dump` first, run on `fin-postgres-dev` (port 5434), validate, then apply to `fin-postgres` (port 5433).
