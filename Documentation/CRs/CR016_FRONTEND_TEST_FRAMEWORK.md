**Status:** OPEN — [Plan](../NEXT_STEPS.md#cr016)

# CR016 — Frontend Test Framework (Vitest)

All 73 automated tests today are backend-only (Jest). Frontend has zero unit/integration coverage. This CR introduces Vitest for frontend forecast helpers and shared utilities.

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
