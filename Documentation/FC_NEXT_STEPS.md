# Development Plan (FC_NEXT_STEPS.md)

Living plan for the Fin project — open Change Requests, known issues, ongoing improvement themes, and a chronological history. Companion to [FC_PROJECT_STRUCTURE.md](FC_PROJECT_STRUCTURE.md), which describes the *current* state of the project.

**Single-source rule (2026-06-12):** each CR's full spec, as-built detail, and decision log live **only in its CR file** under [CRs/](CRs/). This document carries status + sequencing + open items (a few lines per CR); [CRs/CR_INDEX.md](CRs/CR_INDEX.md) carries the one-line roll-up. Don't restate CR detail here. (The pre-restructure full text is archived at [Archive/FC_NEXT_STEPS_FULL_2026-06-12.md](Archive/FC_NEXT_STEPS_FULL_2026-06-12.md).)

---

## 1. Change Requests

### 1.1 Open / In-Progress

<a id="cr034"></a>
- **CR034 — [Security Hardening & CI Baseline](CRs/CR034_SECURITY_HARDENING_CI.md)** — *SHIPPED on main 2026-06-12 (commit-level; deploy pending).* Untracked all env/secret files (`git rm --cached`), rotated the Postgres password (dev+prod), removed every `findev123`/PS-key default from compose+scripts, `execFile`'d the backup `pg_dump`, pinned CORS, bound Postgres to localhost+Tailscale, fixed migration 022 for fresh installs, added `ci-seed.sql` + GitHub Actions CI (backend tests on fresh DB / frontend build / secret-scan gate). **Open:** rotate `BANK_FEED_API_KEY` (coordinate with OCME consumer), revoke the old PocketSmith key upstream, optional git-history scrub.

<a id="cr027"></a>
- **CR027 — [Multi-Tenancy & Final-Release Readiness](CRs/CR027_MULTI_TENANCY_FINAL_RELEASE.md)** — *PLANNED — umbrella/program doc; direction approved, split into CR027A–E (tenancy foundation / auth / owner cutover / onboarding+demo / release cleanup).* v4 track: flag-gated (`FIN_MULTI_TENANT`/`AUTH_ENABLED`, default OFF), schema-per-tenant, isolated v4 stack (`docker-compose.v4.yml`, :3205). Largest prerequisite: a real **migration runner** (Phase 0). Hard gates and owner decisions: see the CR. Sequenced after CR025 (done); coordinates with CR023 (PS removal).

<a id="cr029"></a>
- **CR029 — [Fintable Sheet Pruning (bank-feed admin action)](CRs/CR029_FINTABLE_SHEET_PRUNING.md)** — *PLANNED (scoped 2026-06-06, implement later).* Guarded prune of old Transactions-tab rows in the bank-feed service's Google Sheet (Postgres is the archive). Phase 0 prereqs (Editor share + manual deletion-tolerance test) in the CR.

<a id="cr023"></a>
- **CR023 — [PocketSmith Removal & PS→Feeds Cutover](CRs/CR023_POCKETSMITH_REMOVAL.md)** — *Engine live in prod; migration ongoing per-account.* Feed side complete (28 fed / 2 manual). **Open:** the 13 still-PS-dependent accounts (8 US → Fintable feeds; Wise/Revolut best-effort; OCME 45 + dormant holdings → manual/CR025) and the deferred PS-removal tail. Tracker: [CR023_PS_MIGRATION_TRACKER.md](CRs/CR023_PS_MIGRATION_TRACKER.md); exit gate: `ps-exit-monitor.js`.

<a id="cr032"></a>
- **CR032 — [Fidelity Core-Cash Sweep Auto-Neutralization](CRs/CR032_CORE_CASH_SWEEP_NEUTRALIZATION.md)** — *Released v3.0.27 (2026-06-10); forward fix shipped.* **Open:** owner decision on the 1 lone + 4 needs-review backfill rows (history otherwise left as-is per owner).

<a id="cr024"></a>
- **CR024 — [Fidelity Feeds](CRs/CR024_FIDELITY_FEEDS.md)** — *Both phases on prod (v2.11.0 / v2.13.0).* **Open:** review-queue triage of promoted rows. Lot/cost-basis stays CR020.

<a id="cr022"></a>
- **CR022 — [Bank Feed Parallel Import](CRs/CR022_BANK_FEED_PARALLEL_IMPORT.md)** — *Phase G (observation) — Phases A–F done; prod parallel run live since 2026-06-02.* **Open:** weekly `GET /reconciliation?sinceDays=30` check (`ps_only` must hold 0 ≥1 month); review-queue triage.

<a id="cr021"></a>
- **CR021 — [Bank Feed Service](CRs/CR021_BANK_FEED_SERVICE.md)** — *IN-PROGRESS.* Standalone microservice (fintable.io via Google Sheets), live with 3 institutions, 2 consumers (fin + OCME). **Open:** Phase 4 (Excel/CSV upload), Phase 5 (gap detection/stale alerts), Phase 6 (admin UI).

<a id="cr019"></a>
- **CR019 — [Quicken Historical Import](CRs/CR019_QUICKEN_IMPORT.md)** — *IN-PROGRESS.* Cash side shipped (dev+prod); investment side descoped to value-only promote. **Open:** prod cutover continuation per the §24 live loop; PKO/Chase real-export backfill (needs user QIFs). Blocks CR020.

<a id="cr020"></a>
- **CR020 — [Stock Investment Module](CRs/CR020_STOCK_INVESTMENT_MODULE.md)** — *OPEN (planning skeleton).* Lot-level holdings + analytics on the CR019 schema.

<a id="cr030"></a>
- **CR030 — [Retire automated PocketSmith](CRs/CR030_AUTOMATED_PS_RETIREMENT.md)** — *Released v3.0.11 (2026-06-06).* Follow-up **done 2026-06-12 (CR034):** unused `PS_API_KEY`/`PS_USER_ID` env removed everywhere.

<a id="cr026-ui-revamp"></a><a id="cr026"></a>
- **CR026 — [UI Revamp](CRs/CR026_UI_REVAMP.md)** — *✅ COMPLETED — shipped & ON in prod (v3.0.0+).* Carried to CR027: P5 onboarding, per-section help, brand-affecting WCAG (§15). Backlog: glossary tooltips, actionable empty states, mobile microinteractions.

<a id="cr033"></a>
- **CR033 — [Manual Calibration (non-fed accounts)](CRs/CR033_MANUAL_CALIBRATION.md)** — *Released v3.0.29–v3.0.33 (2026-06-11); migration 032 on dev+prod.* Complete; no open items.

<a id="cr025"></a>
- **CR025 — [Manual Transaction Entry](CRs/CR025_MANUAL_TRANSACTION_ENTRY.md)** — *SHIPPED v3.0.4 (2026-06-05).* Complete.

<a id="cr017"></a>
- **CR017 — [Cash Sweep Phase C](CRs/CR017_CASH_SWEEP_PHASE_C.md)** — *✅ COMPLETED v3.0.25 (2026-06-09); migration 031 dev+prod.* Known limitation: yield convergence recomputes only the primary module.

<a id="cr014"></a>
- **CR014 — [PocketSmith Replacement](CRs/CR014_POCKETSMITH_REPLACEMENT.md)** — *SUPERSEDED by [CR021](#cr021).*

<a id="cr015"></a>
- **CR015 — [Re-export to PocketSmith](CRs/CR015_PS_REEXPORT.md)** — *OBSOLETE (PS being removed).*

### 1.2 Completed (chronological, latest first)

Release-level history; detail in the linked CR file or [§7 Migration History](#7-migration-history).

- **v3.0.42** (2026-06-24) — **Amount/Currency now editable** in the shared transaction edit modal, on both **Ledger** and **Actuals** (previously the modal only edited Date/Description/Category — amounts were treated as PS/feed-authoritative and had *no* UI edit path anywhere). `editFields` in [LEDGER_EDIT_CONFIG](../frontend/src/pages/Ledger.jsx) and [ACTUAL_CONFIG](../frontend/src/features/Transaction/transactionConfig.js) gain `Amount` (number), `Currency` (constrained select), and a **read-only `USD Amount`** that auto-derives from amount × FX. The modal, [useTransactionEdit](../frontend/src/features/Transaction/hooks/useTransactionEdit.js) hook, PATCH route, and repo already supported amount/base writes — only the configs had withheld the fields. **Safety gate:** `base_amount` recompute is now keyed off the user actually *touching* amount/currency, so a category-only edit on a non-USD row no longer silently re-rates its stored `base_amount` at today's FX (the trap that naively exposing the fields would have created). Motivation: lets the owner self-correct the foreign-currency-dividend feed rows (Known Issue #7) instead of needing a DB patch each time. Frontend-only; no flags/DB. Trivial-ish UI enhancement — no CR.
- **v3.0.41** (2026-06-23) — Mobile-shell detection and touch tap-target sizing both switched from **pointer-based to width-based**. Root cause found via console probe on the owner's touchscreen laptop: it reports `pointer:coarse`, `fine:false`, **`any-pointer:fine:false`** — i.e. no fine pointer advertised anywhere, so it is *indistinguishable from a phone by any pointer media query*. The v3.0.38–40 fixes all keyed off `any-pointer:fine` and therefore never applied on this device (installed PWA stayed in the mobile shell; checkboxes stayed inflated). Now: [useIsMobile.js](../frontend/src/mobile/useIsMobile.js) drops the `standalone`/`any-pointer` logic entirely — an installed PWA follows the same width rule as a browser tab (`narrow || (coarse && ≤ TOUCH_BREAKPOINT)`), so a wide window renders desktop regardless of how the device reports its pointer; and [index.css](../frontend/src/index.css) gates the 44px WCAG tap-target block on `(pointer: coarse) and (max-width: 900px)` (removing the dead `any-pointer:fine` reset from v3.0.40), so wide windows get normal desktop-sized controls. Real phones/tablets (narrow) are unchanged. **Trade-off / known limitation:** a *wide touch-only tablet* installed as a PWA now gets the desktop (hover-sidebar) layout — it reports identically to a touchscreen laptop and the two cannot be told apart; laptops are the case that must work. Frontend-only; no flags/DB. Trivial fix — no CR.
- **v3.0.40** (2026-06-23) — Global tap-target fix: a new `@media (pointer: coarse) and (any-pointer: fine)` block in `index.css` resets the 44px WCAG min-sizes (on `button`, `a.navlink`, `select`, `input[type=checkbox]`, `input[type=radio]`, `.form-input`) back to desktop sizing. A touchscreen **laptop** reports a coarse *primary* pointer but also exposes a fine pointer (touchpad), so the `@media (pointer: coarse)` tap-target rule was inflating every checkbox/button app-wide there — the v3.0.39 per-table opt-outs only patched two tables. This is the global counterpart to the touch-only logic in [useIsMobile.js](../frontend/src/mobile/useIsMobile.js): genuine touch-only phones/tablets (no fine pointer) keep the 44px targets; anything with a precise pointer gets desktop sizing. Concretely fixes the oversized "flip tx" checkboxes on Balance Reconciliation and any other coarse-inflated control. Written as a separate query so a browser without `any-pointer` support just keeps the safe 44px default. Frontend-only; no flags/DB. Trivial fix — no CR.
- **v3.0.39** (2026-06-23) — Mobile-shell detection keys off **touch-only** (`pointer: coarse` AND no `any-pointer: fine`) instead of coarse pointer alone. A touchscreen *laptop* reports a coarse primary pointer but also exposes a fine pointer (touchpad), so it was being misread as a phone/tablet: the v3.0.38 `standalone && coarse` clause still pinned its installed PWA to mobile, and shrinking a window tripped the `touchRail` clause. Now both the `standalone` and `touchRail` clauses (and the `forceDesktop` escape-hatch guard) require touch-only, so a touchscreen laptop gets the desktop layout in the installed app and at narrow widths, while genuine phones/tablets (no fine pointer) still get the bottom-tab shell. Also fixes oversized checkboxes in the "Review & Edit New Transactions" table on coarse-pointer devices: the `@media (pointer: coarse)` 44px WCAG tap-target rule inflated the `.trans-budget-table` checkboxes; extended the existing `.fc-review-table` opt-out (the clickable row provides the tap area) to `.trans-budget-table`. Frontend-only; no flags/DB. Trivial fix — no CR.
- **v3.0.38** (2026-06-23) — Installed PWA no longer forced to the mobile shell on a fine-pointer desktop/laptop. `useIsMobile`'s `detect()` previously returned mobile for *any* `display-mode: standalone` window regardless of width/pointer; now `standalone` only pins mobile when combined with a coarse (touch) pointer, so a wide installed window on a mouse device tracks the same width rules as a browser tab and renders desktop. Phones/tablets installed to the home screen still get the bottom-tab shell (standalone+coarse, or the existing width/touch-rail clauses). Symptom this fixes: a laptop's installed app flipping to mobile after its service worker finally picked up a post-2026-04-09 bundle. Frontend-only; no flags/DB. Also bundles the build-only `design-sync` tooling scaffold (commit 8389b0d). Trivial fix — no CR.
- **v3.0.37** (2026-06-22) — Report-toolbar expand/collapse-level controls keep both chevron buttons mounted at all times (Balance Sheet + its period variant, Budget vs Actual + balance panel, Cash Flow month-year + one-period variants). The inapplicable button is now `disabled` at the fully-expanded/fully-collapsed boundary instead of being unmounted, so the toolbar no longer shifts width when a button appears/disappears. Cosmetic, frontend-only.
- **v3.0.36** (2026-06-19) — Ops/maintenance: `deploy-on-vm.sh` points at the renamed `finproject` repo (old URL still redirects). No app/runtime change. Also documents the foreign-currency dividend feed edge case (Known Issue #7) and records its first in-place correction.
- **v3.0.35** (2026-06-12) — Mobile Refresh Feeds now lists the imported transactions waiting for review below the summary (read-only `.m-tx` list, first 15 + Show-all, date · account · category per row); PWA icons renamed to `-v2` filenames so installed apps pick up the Jun-6 icon redesign (a changed manifest URL is what triggers Chrome's icon refresh — reinstall still the instant path).
- **v3.0.34** (2026-06-12) — [CR034](CRs/CR034_SECURITY_HARDENING_CI.md) security hardening + CI baseline shipped to prod (secrets untracked + DB password rotated, CORS allowlist, execFile pg_dump, localhost+Tailscale DB ports, migration-022 fresh-install fix, GitHub Actions CI, docs restructure).
- **v3.0.33** (2026-06-11) — Manual-calibration balance-cell polish ([CR033](CRs/CR033_MANUAL_CALIBRATION.md)).
- **v3.0.32** (2026-06-11) — Manual balance as-of date entry + reset ([CR033](CRs/CR033_MANUAL_CALIBRATION.md)).
- **v3.0.31** (2026-06-11) — Non-USD MTM via shared `services/fx.js`; recon header cleanup ([CR033](CRs/CR033_MANUAL_CALIBRATION.md)).
- **v3.0.30** (2026-06-11) — Manual-calibration leaf-only list + MTM `bookDate` (feed & manual) ([CR033](CRs/CR033_MANUAL_CALIBRATION.md)).
- **v3.0.29** (2026-06-11) — [CR033](CRs/CR033_MANUAL_CALIBRATION.md) Manual Calibration shipped (migration 032).
- **v3.0.28** (2026-06-10) — Ledger Balance column = true account balance (`findLedgerWithRunningBalance`, server-side window function); sibling MobileLedger left open (Known Issue #5).
- **v3.0.27** (2026-06-10) — [CR032](CRs/CR032_CORE_CASH_SWEEP_NEUTRALIZATION.md) core-cash sweep auto-neutralization.
- **v3.0.26** (2026-06-09) — CR017 sweep-priority picker hardening (dropdown of free ranks; 409 on duplicates).
- **v3.0.25** (2026-06-09) — [CR017](CRs/CR017_CASH_SWEEP_PHASE_C.md) multi-module priority cash sweep (migration 031).
- **v3.0.24** (2026-06-08) — Recon panel two-axis sign explainer (copy-only).
- **v3.0.23** (2026-06-08) — "flip tx" caption surfaces the transaction-sign axis.
- **v3.0.22** (2026-06-08) — Bank-recon Status filter (Reconciled/Drift/MTM gap/No feed, live counts).
- **v3.0.21** (2026-06-08) — Transfer picker = balance-sheet accounts only; row-gutter vertical-align fix.
- **v3.0.20** (2026-06-08) — Kebab moved into the left checkbox gutter (sticky-left); dead CSS removed.
- **v3.0.19** (2026-06-08) — Review-queue per-row actions → kebab (⋮) menu (`RowActionMenu`, portaled).
- **v3.0.18** (2026-06-08) — Per-row busy state for Neutralize/Accept (locks row actions in flight).
- **v3.0.17** (2026-06-08) — Sticky review-queue action column; `.gitignore` adds `backups/`+`logs/`.
- **v3.0.16** (2026-06-08) — Dropped redundant "Accept Bank Feed" button (bank feed = sole queue source).
- **v3.0.15** (2026-06-07) — Mobile Refresh Feeds page (`/m/refresh-feeds`, refresh+status scope).
- **v3.0.14** (2026-06-07) — Mobile "Switch to desktop" trap fix (`forceDesktop` honored only on fine pointer).
- **v3.0.13** (2026-06-07) — Mobile nav touch dead-band fix (coarse pointer ≤900px → mobile shell).
- **v3.0.12** (2026-06-06) — [CR031](CRs/CR031_LEDGER_FILTER_PARITY_YEAR_RANGE.md) Ledger filter parity + period year-range.
- **v3.0.11** (2026-06-06) — [CR030](CRs/CR030_AUTOMATED_PS_RETIREMENT.md) automated-PS retirement + COA feed badge.
- **v3.0.10** (2026-06-06) — Per-feed (institution) filter on Balance Reconciliation (fail-open enrichment).
- **v3.0.8–9** (2026-06-06) — Frozen-column bleed-through fixes (Balance/Trends/Cash-Flow tables).
- **v3.0.2–7** (2026-06-05/06) — Period-selector rollouts (Net-Worth chart), layout fixes, CR023/CR028 flip-tx + Chase cutover (migration 030), CR026 rail flyouts.
- **v3.0.0–v3.0.1** (2026-06-05) — CR026 sidebar/dark/⌘K **ON in prod**; [CR028](CRs/CR028_SECURITIES_TRADE_NEUTRALIZATION.md) neutralization rework.
- Older completed CRs: see [CRs/CR_INDEX.md](CRs/CR_INDEX.md) (CR001–CR013, CR016, CR018 et al.) and §7.

<a id="cr016"></a><a id="cr013"></a><a id="cr012"></a><a id="cr011"></a><a id="cr010"></a><a id="cr009"></a><a id="cr008"></a><a id="cr007"></a><a id="cr006"></a><a id="cr005"></a><a id="cr004"></a><a id="cr003"></a><a id="cr002"></a><a id="cr001"></a><a id="cr018"></a><a id="cr028"></a><a id="cr031"></a>

---

## 2. Open Backlog (non-CR items)

Small fixes, refactors, and one-off cleanups that don't warrant their own CR file. New work that grows beyond a line item gets promoted to a CR.

- [ ] **Frontend lint debt:** 160 eslint errors across ~40 files (as of 2026-06-12; includes the TransactionTable react-refresh co-export cluster). CI runs lint **advisory** (`continue-on-error`) until cleared — then flip it blocking in `.github/workflows/ci.yml`.
- [ ] **TransactionTable module extraction** — co-exports 8 hooks/constants used by 6 files; split hooks into `features/Transaction/hooks/` (fixes the react-refresh lint cluster).
- [ ] **`useCoa` caching** — the hook refetches 3 endpoints per consuming component (14+ pages); wrap in a provider or module-level cache.
- [ ] **Forecast: `baseYears` workaround cleanup** — `value == null` detection pattern still in `FCReviewTable`. Cosmetic.
- [ ] **Frontend DRY items** (full list in §4): `collectCollapsiblePaths()` duplicated; month-options arrays; FX-rate lookup duplication.
- [ ] **Shared components missing** (per §4.2): `<Modal>`, `<DataTable>`, `<FormField>`, `<ErrorMessage>`, `<ConfirmDialog>` (partially done), `<CurrencyInput>`.
- [ ] **Backend service layer simplification** (per §5): break up `fcbuilder-module.js` (835 lines), `cashFlowFetcher.js` (619 lines); `AppError` class.
- [ ] **Repo cleanup:** delete tracked Mongo-era debris (`old/`, `psAPI/`, `mongo/`, `Scripts/*-mongo.sh`), resolve `backups/` vs `Backups/` duplication, clarify root `package.json` (only declares axios).
- [ ] **TypeScript migration** (per §4.4) — gradual: utilities → hooks/components → pages.
- [ ] **API design pass**: consistent `{ success, data, meta }` envelope, pagination, structured logging via Pino.

---

## 3. Known Issues

1. **Test coverage:** 226 backend Jest tests (run on every CI push against a fresh migrations+seed DB) + 96 frontend Vitest helper tests ([CR016](#cr016)); component/hook tests + Playwright E2E still deferred. Route-level coverage is thin (2 of 17 route files). Layout: [Testing/TEST_OVERVIEW.md](Testing/TEST_OVERVIEW.md).
2. **Cloud-init ISO** still attached to the VM as a CD-ROM. Harmless; eject with `virsh --connect qemu:///system change-media fin sda --eject`.
3. **Timezone-sensitive date handling:** DATE columns return plain `YYYY-MM-DD` strings (`types.setTypeParser(1082)` in `postgres.js`). Frontend must use local-time `getFullYear()`/`getMonth()`/`getDate()` — never `.toISOString().split("T")[0]`.
4. ~~Fidelity brokerage balances wrong~~ — *Resolved by CR024* (feed_balances read-override).
5. **Mobile ledger running balance still seeds at 0.** v3.0.28 fixed desktop; `MobileLedger.jsx` still sums client-side from 0 and fetches by `accountId`, bypassing the server `running_balance` path. Fix: extend the route gate to a lone `accountId`, or consume `running_balance` when present.
6. **Secrets remediation tail (CR034):** `BANK_FEED_API_KEY` is still the pre-2026-06-12 value in git history — rotate it (requires updating the bank-feed service + the OCME consumer); revoke the leaked PocketSmith API key at pocketsmith.com (the integration is retired, the key may still be live upstream); optional `git filter-repo` history scrub once rotated.
7. **Foreign-currency dividend conversions arrive mislabeled from the feed.** When Fidelity auto-converts a foreign dividend to USD (e.g. EUR div → "ADJUST WIRE TRANSFER (Cash)" + "YOU EXCHANGED (Cash)"), the feed delivers a *single* row carrying the **foreign** numeric amount tagged `USD`, with the wrong sign and magnitude — the real post-conversion USD value (Fidelity's fill rate, not mid-market) exists only on the statement and never arrives structured. Auto-FX via `exchange_rates` would inject permanent recon drift on a USD cash account, so do **not** reinterpret as the foreign currency. Handling: accept the row, then on the **Ledger** (or Actuals) open the edit modal and set the correct USD `Amount` from the statement + recategorize (amount editing shipped v3.0.42 — the review-queue grid is still read-only on amount). For a USD row the read-only `USD Amount` mirrors the amount automatically. The row stays feed-linked via `bank_feed_external_id` and balance recon ties out. Corrected occurrences: 2026-06-19 (tx 2700481, EUR 1,891.09 → USD 2,146.29) and 2026-06-22 (tx 2700544, −30,887.00 → statement USD value), both Fidelity Bond. **Optional, not built:** flag `ADJUST WIRE TRANSFER (Cash)` rows in USD investment accounts as "verify USD value" so one can't be accepted on autopilot.

---

## 4. Frontend Improvement Themes (ongoing)

### 4.1 DRY Violations (remaining)

1. ~~Transaction filter logic duplicated~~ — *Resolved* (CR002).
2. `collectCollapsiblePaths()` duplicated in `Balance.jsx` and `BalanceChart.jsx` — move to shared `treeHelpers.js`.
3. ~~Date initialization logic in BudgetInput~~ — *Resolved* via `PeriodSelector`.
4. Month options array recreated in multiple components — move to shared constants.
5. FX rate lookup duplicated in BudgetInput and transaction modals — move to shared `currency.js`.

### 4.2 Missing Shared Components

| Component | Used in | Current state |
|-----------|---------|---------------|
| `<Modal>` | 5+ places | Each modal custom-built |
| `<DataTable>` | 6+ places | Tables custom each time |
| ~~`<FilterPanel>`~~ | 4+ places | Partially via `HierarchyFilter` (CR008) and `PeriodSelector` |
| `<FormField>` | 10+ places | Inputs custom per form |
| `<LoadingSpinner>` | All pages | "Loading..." text varies |
| `<ErrorMessage>` | All pages | Error display inconsistent |
| `<ConfirmDialog>` | 5+ places | Partially via `components/ConfirmModal/` (CR028) |
| ~~`<DateRangePicker>`~~ | 4+ places | Partially via `PeriodSelector` |
| `<CurrencyInput>` | 3+ places | Amount inputs inconsistent |

### 4.3 UI/UX Improvements

| Issue | State | Proposed |
|-------|-------|----------|
| Loading states | Mix of "Loading...", spinners | Unified `<LoadingSkeleton>` |
| Error display | Different per page | Unified `<ErrorBanner>` with retry |
| ~~Empty states~~ | — | *Resolved:* `EmptyState` with 8 unDraw variants, 14 pages |
| Button styles | `.btn` family canonical; legacy `*-btn` families migrating | `Scripts/check-button-css.sh` guardrail |
| Form validation | Scattered | Centralized validation with error messages |
| Date selection | Different controls per page | Partially via `PeriodSelector`; other pages pending |

### 4.4 Performance & TypeScript

- Component memoization for expensive components; virtual scrolling for 1000+ row tables.
- Debounced filters; SWR-style caching for API reads (start with `useCoa`).
- TypeScript migration: utilities → hooks/components → pages.

### 4.5 Decisions Made

| Decision | Choice |
|----------|--------|
| Component library | Radix UI + custom styling |
| Charting | Recharts |
| Mobile support | Responsive breakpoints + dedicated `/m/*` shell |
| State | Enhanced React Context (upgrade to Zustand if complexity grows) |

---

## 5. Backend Improvement Themes (ongoing)

### 5.1 Service Layer Complexity

| Service | Lines | Notes |
|---------|-------|-------|
| `fcbuilder-module.js` | 835 | Monolithic; mixes data access with business logic |
| `fcbuilder-incexp.js` | 436 | Duplicated patterns from module builder |
| `cashFlowFetcher.js` | 619 | Complex aggregation, hard to maintain |
| `balanceSheetFetcher.js` | 324 | Could be simplified with SQL views |

Also oversized: `routes/forecast.js` (1,441), `routes/budget.js` (912), `repositories/transactions.js` (826) — split opportunistically when touched.

### 5.2 Missing Abstractions

- **Repository pattern** — partially adopted; continue extracting where services still embed SQL.
- **Input validation** — no schema layer (zod/joi); routes trust `req.body`/`req.query`. Add validation on mutating endpoints.
- **Error handling** — centralize with an `AppError` class.

### 5.3 API Design

- Consistent response envelope `{ success, data, meta }` or `{ success, error }`.
- Pagination on list endpoints; standardize `sortBy`/`sortOrder`/`fromDate`/`toDate`.
- Structured logging via Pino.

---

## 6. Testing Strategy

See [Testing/TEST_OVERVIEW.md](Testing/TEST_OVERVIEW.md) for the inventory and run commands.

- **Phase 1 — Backend unit/DB tests (Jest, in place):** 226 tests; CI runs them on a fresh migrations+`ci-seed.sql` database (`.github/workflows/ci.yml`).
- **Phase 2 — HTTP smoke tests (in place):** `smoke-after-021.js`; add new smoke scripts for major schema changes.
- **Phase 3 — Frontend unit tests (Vitest, [CR016](#cr016)):** 96 helper tests; hook/component tests deferred.
- **Phase 4 — E2E (Playwright, future):** feed refresh + accept, budget entry, forecast module creation.

---

## 7. Migration History

Chronological log of substantive infrastructure / behavioural changes (one line each — detail in the CR file named, or in git history / the archived full doc).

| Date | Event |
|------|-------|
| 2026-06-12 | **CR034 security hardening + CI baseline** — secrets untracked + DB password rotated (dev+prod), compose defaults removed, Postgres bound localhost+Tailscale, `execFile` pg_dump, CORS pinned, migration 022 fresh-install fix, `ci-seed.sql`, GitHub Actions CI, docs restructure (this slimming + [MIGRATIONS.md](MIGRATIONS.md)). |
| 2026-06-09–11 | v3.0.25–v3.0.33 — CR017 priority sweep (migration 031), CR032 sweep auto-neutralization, v3.0.28 true ledger running balance, CR033 manual calibration (migration 032) + follow-ups. |
| 2026-06-05–08 | v3.0.0–v3.0.24 — CR026 UI ON in prod; CR028 neutralization rework; CR025 manual entry; CR030 automated-PS retirement; CR031 ledger filter parity; review-queue kebab/gutter/busy-state series; recon sign-axis surfacing; Chase cutover (migration 030). |
| 2026-06-02–04 | v2.9.0–v2.16.2 — CR024 Fidelity feeds both phases (migrations 025–027); CR022 prod parallel run (Phase F); CR023 cutover engine live (migrations 028–029) + sync-before-reconcile; category suggestions; Balance Trends transpose + currency modes; CR019 cutover scripting. |
| 2026-05-28–31 | CR021 bank-feed service live (fintable.io upstream, 3 institutions); CR022 opened + R1/R2; v2.8.0; version scripts stop clobbering `.env`. |
| 2026-05-19–22 | CR016 frontend tests closed (96); CR018 Balance Trends; CR019 Quicken phases A–E to dev+prod. |
| 2026-04-27–05-04 | CR006 AI review via local gateway + async; migration 021 categories collapse (CR013); docs reorganization (this file split out); forecast copy fixes; transfer-analysis FX fuzzy-match fix. |
| 2026-02–04 | v2.x era — CR001 Mongo→Postgres; CR002 frontend refactor; CR003–CR005 forecast module + cash sweep; CR007 PWA/mobile shell; CR008–CR013 filters/COA/source-mappings/calibration; global DATE timezone fix; VM provisioning. |

---

*Last updated: 2026-06-12*
