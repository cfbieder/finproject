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

### Frontend tests

None today. Closing this gap is tracked in [CR016 — Frontend Test Framework](../CRs/CR016_FRONTEND_TEST_FRAMEWORK.md).

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
| Frontend helper / hook | Once Vitest lands (CR016), `frontend/src/<path>/__tests__/<thing>.test.js`. |
| Manual UI verification | `Documentation/Testing/TEST_MANUAL_<feature>.md`. |

## Running everything before a release

```bash
cd server && npm test                          # Jest unit/route tests
node server/src/scripts/smoke-after-021.js     # HTTP smoke against live server
```

Migration testing: take a `pg_dump` first, run on `fin-postgres-dev` (port 5434), validate, then apply to `fin-postgres` (port 5433).
