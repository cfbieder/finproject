# CR037 — Correctness Hardening (money & date handling)

**Status:** ✅ RELEASED v3.0.54 (2026-07-03) — all six items shipped same day as scoping. Full suites green (backend 247 Jest / frontend 103 Vitest / vite build), live-verified end-to-end on dev (`:3105`, rebuilt `fin-server-dev` image). No DB migration.
**Track:** v3
**Anchor in FC_NEXT_STEPS.md:** [cr037](../FC_NEXT_STEPS.md#cr037)

## Summary

A batch of **silent-wrong-number defects** found in the 2026-07-03 whole-project design review. None is a feature; each can corrupt or misstate money/dates without any visible error, which for a finance app outranks every structural backlog item. Scoped as one CR because the items are individually small (hours, not days) but should ship as a verified batch with regression tests, ahead of any refactor work that would churn the same files.

## Items

### P1 — Timezone date-pattern sweep + lint guard
Known Issue #3 forbids `.toISOString().split("T")[0]` (returns the *previous* day west of UTC), yet the exact pattern is live at ~8 sites:

- `frontend/src/features/BudgetEntry/BudgetEntriesBudgetPopup.jsx:76,105`
- `frontend/src/features/BudgetEntry/BudgetEntriesAtualPopup.jsx:47`
- `frontend/src/features/CashFlow/TransactionModal.jsx:50`
- `frontend/src/pages/BalanceChart.jsx:257,269` *(constructs UTC dates first — verify intent; may be deliberate UTC math)*
- `frontend/src/pages/CategoryTrend.jsx:69,78`

Fix: replace with the existing `formatLocalDate` helper (`utils/dateHelpers.js`) where local-day semantics are intended; leave (and comment) any genuinely-UTC site. **Then add an eslint `no-restricted-syntax` rule banning the pattern** — the rule is the real deliverable; the sweep just clears the ground so it can be enforced (advisory→blocking like the lint-debt plan).

### P2 — Transaction split penny leakage
`server/src/v2/repositories/transactions.js:445-508` computes each split leg's `base_amount` as `parseFloat((originalBaseAmount * ratio).toFixed(2))` **independently**, so the legs can sum a cent or two off the original — permanent, invisible recon drift created by a normal UI action. Fix: round n−1 legs, assign the residual to the last leg (same for `amount` if proportional there too). Add a Jest test asserting `Σ legs === original` for adversarial ratios (e.g. 3-way splits of 100.00, 0.01).

### P3 — `parseCurrency` silent-to-zero
`frontend/src/utils/formatters.js:148` returns `0` for any string it can't parse — a typo in an amount field becomes a saved `0.00`. Fix: return `NaN` (or throw) on unparseable input; audit the call sites so forms surface a validation error instead of accepting the value. Vitest cases for malformed inputs.

### P4 — Global React error boundary
There is no `ErrorBoundary` anywhere; one render-time throw in any lazy page blanks the whole app under the single `Suspense` in `frontend/src/App.jsx`. Fix: an `<ErrorBoundary>` wrapping the route outlet (desktop + mobile shells) rendering a token-styled fallback with a reload affordance; keep the existing `EmptyState` visual language.

### P5 — Non-transactional multi-step writes
`server/src/v2/routes/forecast.js:262-274` (scenario-copy path) loops per-module `UPDATE forecast_modules …` with no `BEGIN/COMMIT` — mid-loop failure leaves a half-copied scenario. Fix: wrap in the existing `transaction()` helper (`v2/db/postgres.js:103`); prefer collapsing the loop to one set-based `UPDATE … FROM` (also fixes the N+1). While in there, sweep the other repositories/routes for the same pattern (`repositories/forecast.js:147-216` per-row delete/insert loops are the known second case).

### P6 — Field-whitelist validation on money-writing endpoints
Deliberately **not** the full zod/joi adoption from the backlog (§5.2) — just the 80/20 slice on endpoints that write money and currently trust the raw body:

- `POST /transactions` — `routes/transactions.js:305-307` passes `req.body` wholesale to `repo.create`.
- `PATCH /transactions/:id` — `:318-322` forwards renamed body fields unchecked.
- Split / neutralize / transfer, budget-entry create/batch, both reconcile POSTs.

Fix: per-endpoint explicit field whitelist + type/shape checks (hand-rolled, matching the good in-file precedent at `transactions.js:386-392`), rejecting unknown fields with 400. Full schema-library adoption stays a backlog item.

## Non-goals
- No refactors/splits of the touched God-files (`routes/forecast.js`, `repositories/transactions.js`) — smallest-diff fixes only, so this CR stays reviewable and ships fast.
- No zod/joi dependency (see P6).
- No float→decimal-library migration for money math generally — the engine-wide float question is real but out of scope; P2 fixes the one case that *creates* drift from a user action.

## Verification
- New Jest/Vitest tests per item (split residual, parseCurrency, validation 400s).
- Full suites green (`cd server && npm test`, `cd frontend && npm test && npm run build`).
- Manual: create + split a non-USD transaction, confirm ledger and recon tie out to the cent.

## As-built (2026-07-03)

- **P1 — TZ sweep + eslint guard.** 8 live sites in 5 files fixed. New shared helper `formatDateOnly()` in `frontend/src/utils/dateHelpers.js` (date-only strings taken verbatim — never routed through `new Date()`; Date objects → `formatLocalDate`) now backs the popup/modal date formatters (`BudgetEntriesBudgetPopup`, `BudgetEntriesAtualPopup`, CashFlow `TransactionModal`). `BudgetEntriesBudgetPopup`'s constructed-date helper builds the string directly. **`BalanceChart.jsx` had a real bug beyond the pattern** — its local `getYearStart`/`getMonthEnd` seeded from `getUTCFullYear()/getUTCMonth()` of *now*, picking the wrong month near local month boundaries; replaced with the existing shared helpers from `dateHelpers.js`. `CategoryTrend.jsx` now uses `formatLocalDate`. **Guard:** `no-restricted-syntax` rule in `frontend/eslint.config.js` bans `*.toISOString().split(...)` with a message pointing at the helpers; sweep of `src/` confirms 0 remaining. +5 Vitest cases for `formatDateOnly`.
- **P2 — split residual.** `repositories/transactions.js` `split()` pre-computes all leg `base_amount`s, sums the rounded legs, and adds the residual to leg 0 — Σ legs now always equals the original exactly. New DB-backed suite `repositories/__tests__/splitResidual.test.js` (drifting thirds on 99.99, adversarial 5-way micro-split, clean-ratio proportionality); the first case leaked +0.01 pre-fix.
- **P3 — parseCurrency fail-loud.** `utils/formatters.js` returns `NaN` (never 0) for unparseable input, requires the full remainder to be a plain decimal (kills `parseFloat`'s partial parses: `'12abc'` → NaN), and only honors a single balanced wrapping paren pair. Call-site audit: **zero callers existed** — the dangerous default was fixed before its first adopter. Tests updated + malformed-input cases added.
- **P4 — error boundary.** New `components/ErrorBoundary.jsx` (class component, EmptyState visual language, "Try again" reset) wrapping the route outlet in **both** shells in `App.jsx`, keyed by `location.pathname` so navigation auto-clears a crash.
- **P5 — transactional writes.** The scenario-copy refresh-from-actuals block (`routes/forecast.js`) collapsed from a per-module UPDATE loop into **one set-based `UPDATE … FROM`** (atomic + N+1 gone). Sweep found the worse sibling: **`PUT /modules/:id`'s replace-all blocks (Invest/Dispose/IncomePct) did DELETE-then-reinsert non-transactionally** — a mid-reinsert failure permanently wiped the module's schedule; now one `db.transaction` around all three, with `addInvestment`/`addDisposal`/`setIncomePct` gaining an optional `client` param. (`copyScenario` itself was already transactional — no change.)
- **P6 — money-endpoint validation.** New `v2/utils/validate.js` (badRequest-with-status-400, assertPlainObject/AllowedFields/FiniteNumber/Integer/DateString/Boolean; numeric strings accepted, `''`/booleans/NaN/∞ rejected) + pure-unit test suite. Wired into: `POST /transactions` (whitelist + required date/amount), `PATCH /transactions/:id` (post-transform whitelist incl. `*_name`, type checks, unknown fields now 400 instead of silently dropped), `repo.split` (**legs must sum to the original amount** — 400 otherwise; tolerance 0.011 matches the UI's cent check), `POST/PATCH /budget/entries` (per-entry whitelist + types; **the batch "all months" POST now validates everything first and inserts inside one transaction** — no more partially-saved year), and date-format guards on both reconcile POSTs + manual balance PUT. Bonus fix while there: budget `create()`'s `budget_year` fallback used `new Date(entry_date).getFullYear()` (UTC parse — wrong year for Jan-1 dates on a west-of-UTC server); now derives from the string prefix.
- **Verified:** backend 21 suites / 247 tests, frontend 5 files / 103 tests, `vite build` green; 10-step live curl matrix on dev (`:3105`) — bad payloads 400 with named fields, real UI payload shapes (manual entry POST, v1-name PATCH, summing split, worksheet-style budget entry) all pass; verification rows deleted. Note: `fin-server-dev` copies source at image build (no src volume mount) — live verification required `docker compose -f docker-compose.dev.yml build server-dev`; remember this when verifying backend changes.

**Deploy note:** no DB migration; backend + frontend rebuild only. The 4 pre-existing lint errors in touched files (setState-in-effect ×2, unused vars ×2) are part of the documented 160-error advisory-lint debt, not introduced here.
