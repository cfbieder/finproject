**Status:** OPEN — [Plan](../FC_NEXT_STEPS.md#cr017)

# CR017 — Cash Sweep Phase C (Multi-Module Priority Sweep)

Today's cash sweep (CR005) supports a single designated module per scenario. Phase C extends this to a priority-ordered list: on shortfall, withdraw from module A first, then module B, etc., until the band is restored or all designated modules are drained.

## Scope

- Schema: replace single `cash_sweep_target` boolean on `forecast_modules` with an ordered list, or add a `cash_sweep_priority INT` column (nullable; NULL means not in the sweep set).
- Engine: extend `cash-sweep.js` `computeCashSweepIterative` to accept a sorted list of modules. Withdraw greedily in priority order on shortfall; deposit into priority-1 module on excess (or split — design decision).
- UI: priority dropdown on the module edit modal; render the sweep order in the Cash Sweep Summary modal.
- Audit CSV: include source/destination module per sweep action.

## Open questions

- Deposit policy on excess: priority-1 only, or split proportionally? Probably priority-1 for simplicity.
- What if no modules left and shortfall persists? Emit `Cash Shortfall` row as today.

## Acceptance criteria

- A scenario with two designated modules drains the higher-priority one before touching the lower-priority one.
- Existing single-module scenarios continue to work without migration of user-set priorities.

## Related

Builds on CR005. Convergence loop in `index.js` needs to handle multi-module sweeps in the iterative income recompute.
