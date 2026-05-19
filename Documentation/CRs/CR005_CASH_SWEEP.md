**Status:** COMPLETED — [Plan](../FC_NEXT_STEPS.md#cr005)

# CR005 — Cash Sweep & Auto-Balance

Iterative year-by-year engine feature that sweeps excess cash above a high band into a designated module and withdraws on shortfalls below a low band. Resolves the income↔sweep convergence problem via a fixed-point loop.

## Outcome

- Scenario-level `cash_sweep_low` / `cash_sweep_high` bands replace the old `target_cash` knob (migrations 012–013).
- Module-level `cash_sweep_target` boolean (migration 012) designates the destination.
- Engine creates matching transfer pairs (bank-side + module-side, equal opposite amounts) so entry breakdowns balance.
- Prior-years cumulative MV adjustments written as separate `_sweep_bal` entries.
- Audit CSV per scenario: `Year, Action, Amount, CashBefore, CashAfter, NetModuleEffect`.
- Income-Sweep Convergence: Step 7b iterative loop in `index.js` recalculates yield-based income on sweep-adjusted MVs, updates tax deltas, recomputes cash flow, re-runs sweep until `maxDelta < $100` (~10 iterations).
- Cash Sweep Summary modal on the Review page (green ArrowRightLeft button in toolbar).

## Key references

- Pure compute: `server/src/services/forecast/cash-sweep.js`
- Engine integration: `server/src/services/forecast/index.js` (Step 7, 7b)
- Migrations: `server/db/migrations/012_cash_sweep_target.sql`, `013_cash_sweep_band.sql`
- Tests: `server/src/services/forecast/__tests__/cash-sweep.test.js`
- UI: `frontend/src/features/Forecast/FCCashSweepModal.jsx`

## Open follow-up

Phase C (multi-module priority sweep) → CR017.
