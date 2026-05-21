**Status:** COMPLETED 2026-05-20 — [Plan](../FC_NEXT_STEPS.md#cr016)

# CR016 — Frontend Test Framework (Vitest)

All 73 automated tests today were backend-only (Jest). Frontend had zero unit/integration coverage. This CR introduced Vitest for frontend forecast helpers and shared utilities.

## What landed

- **Infrastructure** — `vitest@^2.1.9` + `jsdom@^25` added to `frontend/devDependencies`; `npm test` / `npm run test:watch` scripts; standalone [`vitest.config.js`](../../frontend/vitest.config.js) (jsdom env, mirrors Vite path aliases). Exits non-zero on failure.
- **Helper suites — 5 of 5 acceptance modules covered, 96 tests total, all green:**
  - [`src/utils/__tests__/dateHelpers.test.js`](../../frontend/src/utils/__tests__/dateHelpers.test.js) — 21 tests covering all 10 exports of `dateHelpers.js` (timezone-safe formatting, leap-year month-end, month/year round-trip, range generators).
  - [`src/utils/__tests__/formatters.test.js`](../../frontend/src/utils/__tests__/formatters.test.js) — 25 tests covering all 7 exports of `formatters.js` (accountant-style `formatCurrency`, `formatPercentage` vs `formatRate` distinction, `formatFxRate`, thousands separators, compact K/M/B notation, `parseCurrency` round-trip).
  - [`src/utils/__tests__/treeTraversal.test.js`](../../frontend/src/utils/__tests__/treeTraversal.test.js) — 17 tests covering all 4 exports of `treeTraversal.js` (`collectCollapsiblePaths`, `buildAccountValueMap`, `collectLeafNames`, `findNodeByPath`) — path joining with `>`, defensive nullish-node handling, custom valueKey, multi-segment lookup.
  - [`src/utils/__tests__/forecastHelpers.test.js`](../../frontend/src/utils/__tests__/forecastHelpers.test.js) — 20 tests covering all 4 exports of `forecastHelpers.js` (`parseLevelAccounts` both tree + legacy formats, `aggregateForecastEntries` level1/2/3 rollup with string-coercion, `calculateNetCashFlow`, `formatTableCell` negative-paren + `--negative` modifier).
  - [`src/utils/__tests__/cashFlowHelpers.test.js`](../../frontend/src/utils/__tests__/cashFlowHelpers.test.js) — 13 tests covering all 2 exports of `cashFlowHelpers.js` (`addNetCashFlowCategory` case-insensitive Income/Expense(s), idempotent re-append, `buildCashFlowValueMap` deep path traversal).

## Acceptance criteria

| Criterion | Status |
|---|---|
| `npm test` runs Vitest in `frontend/`, exits non-zero on failure | ✓ |
| ≥ 5 helper modules covered to start | ✓ (5) |
| CI-ready: deterministic, no network, no real DB | ✓ (jsdom, `vi.useFakeTimers()` where time-sensitive) |

## Out of scope (future work)

- **Phase 2 — Playwright E2E:** PocketSmith sync → review → accept, budget entry, forecast module creation. Tracked as a separate future CR.
- **Component-level React tests** — deliberately skipped per the original scope; they tend to test implementation details and break on refactors.
- **Hook tests** for `frontend/src/features/Forecast/hooks/` — the 14 hooks are stateful and depend on React Context + network fetches; a separate CR with React Testing Library can address them if/when needed.
- **DRY prerequisites** still on the backlog (`collectCollapsiblePaths` duplicated in `Balance.jsx` + `BalanceChart.jsx`; FX rate lookup duplicated in BudgetInput + transaction modals). These are tracked in [FC_NEXT_STEPS.md](../FC_NEXT_STEPS.md) §2 / §4.1; the test framework is in place to cover them once extracted.

## Scope — Phase 1 (unit tests)

High-value targets:
- Forecast calculation helpers (whatever lives in `frontend/src/features/Forecast/hooks/`).
- Currency conversion / FX rate lookup helpers.
- Date utilities (`dateHelpers.js` — already burned us once with timezone bug).
- Data transformations (`buildCoaRows`, tree flatteners, etc.).

## Scope — Phase 2 (E2E later, separate CR)

Critical user flows via Playwright:
- PocketSmith sync → review → accept transactions.
- Budget entry and editing.
- Forecast module creation and review.

Skip component-level tests — they often test implementation details and break on refactors.

## Acceptance criteria

- `npm test` runs Vitest in `frontend/`, exits non-zero on failure.
- ≥ 5 helper modules covered to start.
- CI-ready: deterministic, no network, no real DB.

## Related

Per the post-migration-021 audit (CR013), backend route tests mock the repo layer. The frontend test gap is now the largest blind spot.
