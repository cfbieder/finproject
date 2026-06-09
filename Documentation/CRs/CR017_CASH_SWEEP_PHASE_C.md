**Status:** COMPLETED — **Released v3.0.25, picker hardening v3.0.26 (2026-06-09).** Engine + schema + API + UI shipped to dev + prod; migration `031` applied to both. Engine unit tests 10/10; dev end-to-end verified (two-module scenario: forced shortfall drains primary then cascades into the backup, `Modules` audit column populated, clear path works). — [Plan](../FC_NEXT_STEPS.md#cr017)

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

## As built (2026-06-09)

**Design decisions (resolved with owner):** schema = nullable `cash_sweep_priority INT` (not a junction table); shortfall **drains highest-priority first** (priority 1 → 2 → …, per the acceptance criterion); excess **deposits into priority-1 only** (lower priorities are withdrawal-only backups).

- **Schema** — migration [`031_cash_sweep_priority.sql`](../../server/db/migrations/031_cash_sweep_priority.sql): adds `cash_sweep_priority INT NULL` (NULL = not in sweep set; 1 = primary; 2,3,… = backups), backfills `= 1 WHERE cash_sweep_target = TRUE` (existing single-module scenarios keep working, no user action), and a partial-unique index on `(scenario_id, cash_sweep_priority)`. The legacy `cash_sweep_target` boolean is **kept and maintained as `priority == 1`** for the read sites still using it (`aiReview`, `FCModulesTable`, route transforms).
- **Engine** — [`cash-sweep.js`](../../server/src/services/forecast/cash-sweep.js) `computeCashSweepIterative` gains an optional ordered `backupModules[]` ({name, account_name, balanceByYear}). The single-module path is byte-identical (all 8 prior tests unchanged); on shortfall, after the primary's swept + own balance is exhausted it **cascades** into each backup's own balance in order, with per-backup prior-years `_sweep_bal` carry-forward. Records the modules touched per year for the audit trail.
- **Convergence loop** — [`index.js`](../../server/src/services/forecast/index.js) selects the sweep set ordered by `cash_sweep_priority` (fallback to `cash_sweep_target`), loads each backup's builder balance, and passes `backupModules` to both `computeCashSweepIterative` call sites.
- **API** — `cash_sweep_priority` added to the repo `updateModule` allowlist; the PUT route maps `CashSweepPriority` (and back-compat `CashSweepTarget` → priority 1/null), keeps ranks unique within a scenario, and syncs the legacy flag; the GET transform returns `CashSweepPriority`.
- **UI** — [`FCModulesEdit.jsx`](../../frontend/src/features/Forecast/FCModulesEdit.jsx): the "Cash Sweep Target" checkbox → a **Sweep Priority** picker (blank = not in set). [`FCModuleManage.jsx`](../../frontend/src/pages/FCModuleManage.jsx) save payload sends `CashSweepPriority`. [`FCCashSweepModal.jsx`](../../frontend/src/features/Forecast/FCCashSweepModal.jsx) renders the new **Modules** column (source/destination per action) as text.
- **Unique-rank picker (v3.0.26):** the Sweep Priority control is a **dropdown that only offers ranks not already taken** by another module in the scenario (plus "Not in sweep" + the module's own current rank + the next free number) — so two modules can never collide on a rank from the UI; to reassign a taken rank you clear the holder first. Defense-in-depth: the PUT route now **rejects** a duplicate rank with **409** (clear message naming the holder) instead of silently evicting the sibling.
- **Tests** — 2 new engine cases (drains primary before backup; cascades into backup once primary exhausted) → 10/10 green. DB-backed route tests need a live DB (not run here).

**Known limitation (documented):** the income-sweep yield convergence (`index.js` Step 7b) still recomputes only the **primary** module's yield. Backup drawdowns reduce their balances but don't iteratively re-converge their own yield — acceptable since backups are emergency-only and the effect is second-order. Revisit if multi-yield modules become common.

**Shipped (2026-06-09, v3.0.25):** migration `031` applied to dev (backfilled the 1 existing target → priority 1) and prod (backfilled 2 targets across scenarios 47/52); dev rebuilt + end-to-end verified — a forced ~10M shortfall on scenario "2026 Base" drained the primary (Fidelity Cash Mgt −2.07M) then cascaded into the backup (Fidelity Stocks −1.41M) before the residual Cash Shortfall, `Modules` audit column = "Fidelity Cash Mgt | Fidelity Stocks"; dev state restored. Prod deployed via `deploy-to-production.sh` (DB backed up, images rebuilt, health-checked).
