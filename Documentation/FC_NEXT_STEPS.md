# Development Plan (FC_NEXT_STEPS.md)

Living plan for the Fin project — open Change Requests, known issues, ongoing improvement themes, and a chronological history. Companion to [FC_PROJECT_STRUCTURE.md](FC_PROJECT_STRUCTURE.md), which describes the *current* state of the project.

**Single-source rule (2026-06-12):** each CR's full spec, as-built detail, and decision log live **only in its CR file** under [CRs/](CRs/). This document carries status + sequencing + open items (a few lines per CR); [CRs/CR_INDEX.md](CRs/CR_INDEX.md) carries the one-line roll-up. Don't restate CR detail here. (The pre-restructure full text is archived at [Archive/FC_NEXT_STEPS_FULL_2026-06-12.md](Archive/FC_NEXT_STEPS_FULL_2026-06-12.md).)

---

## 1. Change Requests

### 1.1 Open / In-Progress

<a id="cr041"></a>
- **CR041 — [Module Ownership-Gated Expenses/Income + Edit-Form Regrouping](CRs/CR041_MODULE_OWNERSHIP_GATING.md)** — *✅ RELEASED v3.0.62 (2026-07-11); no migration. Complete — detail in the v3.0.62 entry below.* Future-purchase assets (MV 0 + future Invest) no longer accrue `expense_amount`/`income_amount` from base year: streams start at first ownership, 50% in the acquisition year (mirror of Full-disposal); yield-spread income untouched (avg-MV-driven). `FCModulesEdit` regrouped into titled General/Valuation/Expenses/Income/Tax sections. +7 Jest (259) / +4 Vitest (121); verified live on dev (half-year −6,622.88 on a 12k/500k test purchase, purchase-year BS reconciles); no migration; no existing dev/prod module changes numbers. Detail in the CR.

<a id="cr040"></a>
- **CR040 — [Forecast Scenario Compare](CRs/CR040_FORECAST_SCENARIO_COMPARE.md)** — *✅ RELEASED v3.0.60 (2026-07-10) + v3.0.61 fix (2026-07-11); migration 035 on dev+prod. Complete — detail in the v3.0.60/61 entries below.* `/forecast-compare` (FC step 6): delta KPIs/grids reconciling with Review, recharts A-vs-B visuals, deterministic + on-demand local-LLM commentary with follow-ups. **Open:** delete the "CR040 Test B" scenario from dev after browser testing.

<a id="cr037"></a>
- **CR037 — [Correctness Hardening (money & date)](CRs/CR037_CORRECTNESS_HARDENING.md)** — *✅ RELEASED v3.0.54 (2026-07-03); complete, no open items.* All six silent-wrong-number items from the design review: TZ sweep + eslint ban, split penny-leak residual fix, `parseCurrency` fail-loud, route-level ErrorBoundary, transactional forecast writes, money-endpoint whitelist validation. Detail in the CR and the v3.0.54 entry below.

<a id="cr038"></a>
- **CR038 — [Home Dashboard & Attention Surface](CRs/CR038_HOME_DASHBOARD_ATTENTION.md)** — *✅ COMPLETED — P1–P3 v3.0.55, MTM-aware drift v3.0.56, P4 mobile reconcile v3.0.57 (all 2026-07-03); no open items.* Desktop Home shows live KPIs via the shared `useOverview` hook; `GET /util/attention-summary` + `AttentionStrip` pills each linking to their clearing page; next-step prompts; `/m/reconcile` closes the weekly loop on mobile.

<a id="cr039"></a>
- **CR039 — [Forecast Assumptions to Postgres](CRs/CR039_FORECAST_ASSUMPTIONS_TO_DB.md)** — *✅ RELEASED v3.0.58 (2026-07-04); migration 034 + import on dev+prod. Complete — CR027's assumptions-off-disk prerequisite is cleared.* `FCAssump.json` dual source retired: `forecast_assumptions` table (key/JSON/ord), byte-identical API verified, forecast-generate checksum parity, engine loads async from DB. Scope correction: debug-CSV gating dropped — the audit-trail endpoint reads those CSVs (live feature).

<a id="cr034"></a>
- **CR034 — [Security Hardening & CI Baseline](CRs/CR034_SECURITY_HARDENING_CI.md)** — *SHIPPED on main 2026-06-12 (commit-level; deploy pending).* Untracked all env/secret files (`git rm --cached`), rotated the Postgres password (dev+prod), removed every `findev123`/PS-key default from compose+scripts, `execFile`'d the backup `pg_dump`, pinned CORS, bound Postgres to localhost+Tailscale, fixed migration 022 for fresh installs, added `ci-seed.sql` + GitHub Actions CI (backend tests on fresh DB / frontend build / secret-scan gate). **Open:** rotate `BANK_FEED_API_KEY` (coordinate with OCME consumer), revoke the old PocketSmith key upstream, optional git-history scrub.

<a id="cr027"></a>
- **CR027 — [Multi-Tenancy & Final-Release Readiness](CRs/CR027_MULTI_TENANCY_FINAL_RELEASE.md)** — *PLANNED — umbrella/program doc; direction approved, split into CR027A–E (tenancy foundation / auth / owner cutover / onboarding+demo / release cleanup).* v4 track: flag-gated (`FIN_MULTI_TENANT`/`AUTH_ENABLED`, default OFF), schema-per-tenant, isolated v4 stack (`docker-compose.v4.yml`, :3205). Largest prerequisite: a real **migration runner** (Phase 0); the other prerequisite — [CR039](#cr039) (forecast assumptions off disk) — **done v3.0.58 (2026-07-04)**. Hard gates and owner decisions: see the CR. Sequenced after CR025 (done); coordinates with CR023 (PS removal).

<a id="cr029"></a>
- **CR029 — [Fintable Sheet Pruning (bank-feed admin action)](CRs/CR029_FINTABLE_SHEET_PRUNING.md)** — *PLANNED (scoped 2026-06-06, implement later).* Guarded prune of old Transactions-tab rows in the bank-feed service's Google Sheet (Postgres is the archive). Phase 0 prereqs (Editor share + manual deletion-tolerance test) in the CR.

<a id="cr035"></a>
- **CR035 — [Feed Sync Freshness](CRs/CR035_FEED_SYNC_FRESHNESS.md)** — *Released v3.0.44 (2026-07-01); bank-feed migration 003 + fin migration 033 on dev+prod; deployed & verified in prod (Luxury Card = Barclays reads "synced 5 days ago"). Complete; no open items.* Cross-repo: promote fintable's per-connection **"⚡ Last Update"** (clean ISO-8601, populated for all 30 accounts, verified) through the bank-feed service (`feed_balances.source_synced_at` + `/v1/balances`) into fin (`bankfeed_balances.source_synced_at` → `/balance-recon` `feed_synced_at`) so Balance Calibration shows **true** "synced N days ago" (Luxury Card = Barclays, 5 days). Corrects v3.0.43's `fetched_at`-based indicator, which tracked fin's daily poll, not the bank. Realizes the stale-alert slice of [CR021](CRs/CR021_BANK_FEED_SERVICE.md) Phase 5. Deploy order: service migration+deploy first, then fin.

<a id="cr036"></a>
- **CR036 — [Manual Statement Upload (Stale-Feed Fallback)](CRs/CR036_MANUAL_STATEMENT_UPLOAD.md)** — *✅ COMPLETED — P1 2026-07-01 (bank-feed `91c2911` + fin v3.0.45–47); **P2 interactive column-mapper 2026-07-05** (bank-feed `31dd0fc` migration 004 + fin v3.0.59). P3 (ocr-llm mapping-guess, PDF/OCR) stays optional/unscoped.* Upload any bank's CSV: known formats auto-detect (built-in + mapper-saved profiles); unknown ones get "Map columns…" — point at date/amount/description/currency columns, pick date format + sign convention, type the statement balance, preview the drift gate, save as a reusable named format that auto-matches next time. Imports only-new rows; reconciles to the statement's stated balance. Realizes [CR021](CRs/CR021_BANK_FEED_SERVICE.md) Phase 4 fully.

<a id="cr023"></a>
- **CR023 — [PocketSmith Removal & PS→Feeds Cutover](CRs/CR023_POCKETSMITH_REMOVAL.md)** — *Engine live in prod; migration ongoing per-account.* Feed side complete (28 fed / 2 manual). **Open:** the 13 still-PS-dependent accounts (8 US → Fintable feeds; Wise/Revolut best-effort; OCME 45 + dormant holdings → manual/CR025) and the deferred PS-removal tail. Tracker: [CR023_PS_MIGRATION_TRACKER.md](CRs/CR023_PS_MIGRATION_TRACKER.md); exit gate: `ps-exit-monitor.js`.

<a id="cr032"></a>
- **CR032 — [Fidelity Core-Cash Sweep Auto-Neutralization](CRs/CR032_CORE_CASH_SWEEP_NEUTRALIZATION.md)** — *Released v3.0.27 (2026-06-10); forward fix shipped.* **Open:** owner decision on the 1 lone + 4 needs-review backfill rows (history otherwise left as-is per owner).

<a id="cr024"></a>
- **CR024 — [Fidelity Feeds](CRs/CR024_FIDELITY_FEEDS.md)** — *Both phases on prod (v2.11.0 / v2.13.0).* **Open:** review-queue triage of promoted rows. Lot/cost-basis stays CR020.

<a id="cr022"></a>
- **CR022 — [Bank Feed Parallel Import](CRs/CR022_BANK_FEED_PARALLEL_IMPORT.md)** — *Phase G (observation) — Phases A–F done; prod parallel run live since 2026-06-02.* **Open:** weekly `GET /reconciliation?sinceDays=30` check (`ps_only` must hold 0 ≥1 month); review-queue triage.

<a id="cr021"></a>
- **CR021 — [Bank Feed Service](CRs/CR021_BANK_FEED_SERVICE.md)** — *IN-PROGRESS.* Standalone microservice (fintable.io via Google Sheets), live with 3 institutions, 2 consumers (fin + OCME). **Open:** Phase 5 remainder (gap detection), Phase 6 (admin UI). Phase 4 (Excel/CSV upload) **done** — realized as [CR036](CRs/CR036_MANUAL_STATEMENT_UPLOAD.md) P1+P2 (v3.0.45/v3.0.59); Phase 5's stale-alert slice done via CR035.

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

- **v3.0.62** (2026-07-11) — **CR041 Module Ownership Gating + Edit-Form Regrouping ([CR041](CRs/CR041_MODULE_OWNERSHIP_GATING.md) — complete, designed and shipped same day).** Answers the owner's question "how do I keep a future-purchased asset's running costs from starting in the base year?" — previously a module with Market Value 0 and a future Invest transfer (e.g. a 2027 house) accrued its `expense_amount`/`income_amount` from base year. Engine (`fcbuilder-module.js`): amount-based expense/income streams now start at first ownership (`acquisitionIdx` from the first non-zero market value, computed before Full disposals), **zero before acquisition and 50% in the acquisition year** — the exact mirror of the Full-disposal halving; the Period-1 tax on base-year income is skipped when not owned at base. Yield-spread income and legacy `expense_pct` deliberately ungated (avg-MV-driven — already zero pre-purchase and naturally half in the purchase year). Never-owned modules (MV 0, no invest) now generate no expense/income at all — verified zero such modules exist on dev or prod, so **no live scenario changes numbers**. UI: `FCModulesEdit` flat field grid regrouped into titled **General / Valuation / Expenses / Income / Tax** sections (`FIELD_SECTIONS` in new `fcModulesEditSections.js`). +7 Jest (259 backend) / +4 Vitest (121 frontend); live-verified on dev (12k-expense/500k-purchase-in-2030 test module: Property Costs absent pre-2030, exactly −6,622.88 half-year in 2030, purchase-year BS reconciles; test data removed). No migration, no flags.

- **v3.0.61** (2026-07-11) — **Compare-page fix: one-scenario-only accounts no longer hidden.** Found by the owner on the first real prod compare ("2026 with House Purchase" vs base): SP - Properties (−$491K/yr while base still holds the apartment, −$6.4M cumulative) was invisible — an account with engine entries in only one scenario produced all-null deltas, which the hide-unchanged filter read as "unchanged", and the visible rows didn't reconcile to the Assets total. Fix in `fcCompareUtils`: a missing value **inside** a scenario's forecast range now means 0 for the delta (null stays reserved for years outside the range; A/B cells still display "-"). Also: commentary's balance-sheet movers now rank by **peak-year** |Δ| instead of final-year (final-year missed assets that diverge mid-horizon and converge by the end), with a "converged by the end" tag. +1 regression test (117 green); verified against the prod pair — SP - Properties renders 13 delta years and the commentary reads "SP - Properties (−$491K peak in 2027, converged by the end)". Frontend-only, no migration.
- **v3.0.60** (2026-07-10) — **Forecast Scenario Compare ([CR040](CRs/CR040_FORECAST_SCENARIO_COMPARE.md) — complete, P1–P3 in one day).** New `/forecast-compare` page (FC step 6): pick baseline A and comparison B, everything reads B − A. **P1** — pure `fcCompareUtils` diff engine transcribing FCReview's pivot (Expense-net-of-Transfers, Cash Flow/Net rows, Bank Accounts running balance seeded from LAY actuals + BaseYear budget NCF per scenario) so A/B columns reconcile with Review; KPI delta cards; P&L/BS delta grids with Δ/A/B modes, hide-unchanged, click-to-expand A/B/Δ; instant deterministic commentary (headline, first material divergence, advantage flips, net-cumulative P&L movers, final-year BS movers, structural diffs). Live-data e2e caught a base-year transfer double-count in the bank seed ($32K) — compare now covers years ≥ PeriodStart only. **P2** — recharts A-vs-B trajectory lines (5-metric switcher) + diverging cumulative-Δ bars; palettes validated light+dark via the dataviz six-checks (A green/B blue; delta blue↔red). **P3** — AI commentary on the local gateway: **migration 035** (`fc_ai_reviews.compare_scenario_id`), `buildCompareContext` (both full contexts + top-15 cumulative divergence table), fixed compare prompt (no action blocks), `processReview` derives the pair from the review row so follow-ups rebuild context; drawer list excludes compare reviews, `?compareWith` lists per pair; inline `FCCompareAIPanel` (generate → poll → narrative + follow-ups, restore-on-revisit). Verified: 13 frontend + 5 backend tests added (116/252 green); live gateway round-trip + follow-up on dev correctly explained the test pair's $20K-salary → sweep → interest → taxes chain. Dev-DB drift found & fixed (migration 020 missing on dev's `fc_ai_reviews`). Deploy: **apply migration 035 to prod before the code**.
- **v3.0.59** (2026-07-05) — **Interactive column mapper ([CR036](CRs/CR036_MANUAL_STATEMENT_UPLOAD.md) P2 — completes CR036 and CR021 Phase 4).** Statement uploads now work for **any** bank's CSV, not just preinstalled profiles. Cross-repo: the **bank-feed service** (commit `31dd0fc`, migration 004 `manual_profiles`) gains `POST /v1/manual/inspect` (CSV tokenize + header-row heuristic + sample rows), a saved-profile registry (`POST /v1/manual/profiles`, upsert-by-label; `GET` merges built-ins + saved), inline mapper specs on `/v1/manual/parse`, and per-row **currency column** support (the multi-currency case). **fin** threads `profile` (inline spec) + **`statedBalance {magnitude, date}`** through preview/commit — mapper formats have no preamble balance regex, so the owner types the statement's printed balance and the drift gate still runs; `ManualStatementUpload.jsx` gains the mapper panel (sample-row table, column pickers, date-format + sign-convention selects incl. split debit/credit, typed balance) with **Save format** → auto-selects and auto-matches thereafter; format dropdown now dynamic. E2E-verified on dev (unknown CSV → 422 → mapped preview with flipped signs → save → auto-detect matches). Service 100/100 tests (+9 new); fin suites green. Deploy order: bank-feed → fin.
- **v3.0.58** (2026-07-04) — **Forecast Assumptions to Postgres ([CR039](CRs/CR039_FORECAST_ASSUMPTIONS_TO_DB.md)) — CR027 prerequisite cleared.** The forecast assumptions dual source of truth (file+DB merge with sync `fs` writes on the request path) is retired: **migration 034** drops the never-used 001-era `forecast_assumptions` table (0 rows on dev and prod) and recreates it as a document store — one row per top-level key of the old `FCAssump.json`, `value` as **`json` not `jsonb`** (jsonb reorders object keys and broke byte-parity on first compare), `ord` preserving key order. New `forecastAssumptions` repo (getDoc/putDoc with the old file's partial-merge semantics), idempotent `import-fc-assumptions.js` (run after the migration; never re-run once live), `GET/PUT /forecast/assumptions` cut over, and the engine (`fcbuilder-setup.js`) loads async from the DB (both callers await). **Scope correction:** the planned `FC_DEBUG_CSV` gating was dropped — the engine's cash-sweep CSVs are read by `GET /forecast/audittrail` (live FCReview feature), not dead debug output. Verified: API **byte-identical** before/after (`cmp` clean, dev and prod), PUT round-trip + partial-merge semantics, forecast regenerate checksum parity (1442 entries, identical md5), 247 backend tests. `FCAssump.json` stays on disk one release as a fallback artifact; MIGRATIONS.md's missing 033 row added in passing.
- **v3.0.57** (2026-07-03) — **Mobile reconcile (CR038 P4 — closes CR038) + Refresh Feeds rename + nav hygiene.** (1) **`/m/reconcile`** (`MobileReconcile.jsx`, launcher card on MobileHome; `/balance-calibration` maps to it in the phone redirect table): lists fed accounts with drift or stale feed (≥3d) and manual accounts with drift; tap-to-reconcile with two-tap confirm — calibrate reconciles plain, MTM books at the last completed month-end; deliberately minimal (no flip-tx/mode/override/upload — those stay desktop). The weekly loop is now completable on a phone. (2) **`/refresh-ps` → `/refresh-feeds`**: route + component renamed (`RefreshFeeds.jsx`, git-mv history kept), old URL redirects, nav description and the "PS records in database" label de-PS'd ("Legacy PocketSmith records"); internal `refresh-ps-*` CSS class names deliberately kept (invisible churn). (3) **`/ui-preview` hidden from nav** (`showInNav: false` + `getRoutesByCategory` now honors the flag, so the CR026 mockup vanishes from the sidebar, Home features grid, landing pages, and ⌘K — still reachable by URL). Also closed as **false findings** from the 2026-07-03 design review: COA single-delete confirm (modal already renders a fallback "Are you sure…" + cannot-be-undone warning) and TransferAnalysis modal newlines (`.confirm-modal__message` already has `white-space: pre-line`). Frontend-only; no migration, no flags.
- **v3.0.56** (2026-07-03) — **Attention strip: MTM-aware drift semantics (CR038 refinement).** The first prod run of v3.0.55's strip flagged all four Fidelity MTM accounts as "drift" — but MTM accounts re-accumulate market drift the day after a booking, so raw drift would cry wolf all month. `GET /util/attention-summary` now counts `drift.fed` for **calibrate-mode accounts only** and adds **`mtmDue` {count, monthEnd}** — mtm-mode fed accounts missing a `source='mtm'` entry at the last completed month-end — rendered as a new "MTM booking due for N accounts (date)" pill. Also that day: the June-30 MTM bookings themselves were made on prod via the reconcile API (Stocks −41,219.86 / Bond +328.69 / IRA −4,145.11 / Options −2,918.36, all within the 15% guard). Backend+frontend, no migration. Trivial refinement — logged on CR038.
- **v3.0.55** (2026-07-03) — **Home Dashboard & Attention Surface ([CR038](CRs/CR038_HOME_DASHBOARD_ATTENTION.md) P1–P3).** Desktop Home stops being a zero-data link farm: (P1) live KPI row — hero **Net Worth** + MoM delta, this-month **Net Cash Flow / Income / Expenses** — via the new shared `useOverview` hook, which **MobileHome now also consumes** (rendering unchanged; first slice of the mobile-dedup theme). (P2) New `GET /api/v2/util/attention-summary` + **`AttentionStrip`** pills on Home, each linking to its clearing page: *N transactions to review* (`accepted IS NOT TRUE`) → Refresh Feeds; *verify-USD wire rows* (Known Issue #7 guard) → Refresh Feeds; *stale feeds ≥3d* (CR035 `feed_synced_at`, red ≥7d, oldest-days shown) → Balance Calibration; *fed/manual drift* → the matching calibration page; quiet "All clear" when clean; fail-open (strip hides on endpoint failure). (P3) Next-step prompts: post-refresh "review below, then reconcile →" on Refresh Feeds; "non-fed accounts → Manual Calibration" footer on Balance Reconciliation. Owner decisions settled: strip on **Home only**; **P4 (mobile reconcile page) deferred** — stays open on the CR. Verified: build+suites green; endpoint live on dev (review 338 / fed drift 10) incl. a seeded 10-day stale-feed case. No migration, no flags.
- **v3.0.54** (2026-07-03) — **Correctness Hardening ([CR037](CRs/CR037_CORRECTNESS_HARDENING.md)) — all six items.** Silent-wrong-number batch from the 2026-07-03 design review: (P1) `.toISOString().split` TZ pattern swept from all 8 live sites + new `formatDateOnly()` helper + **eslint `no-restricted-syntax` ban** so it can't return (also fixed BalanceChart's UTC-now month-boundary bug by adopting the shared `getYearStart`/`getMonthEnd`); (P2) transaction-**split penny leak** fixed — rounding residual lands on leg 0 so Σ legs ≡ original (new DB test suite; the drifting-thirds case leaked +0.01 pre-fix); (P3) `parseCurrency` fails loud (NaN, no partial parses; had zero call sites — defused pre-adoption); (P4) route-level **`ErrorBoundary`** in both shells (a page crash no longer blanks the app); (P5) forecast scenario-copy refresh → one set-based `UPDATE…FROM` (atomic, N+1 gone) and **module PUT's delete-then-reinsert wrapped in a transaction** (failure mid-reinsert used to wipe the module's Invest/Dispose/IncomePct schedule); (P6) new `v2/utils/validate.js` field-whitelist/type validation on transactions POST/PATCH/**split (legs must sum to the original — server previously accepted total-changing splits)**, budget entries (the "all months" batch is now validated up-front and inserted in one transaction), and reconcile date params. Bonus: budget `create()`'s `budget_year` UTC-parse year bug fixed. Suites: backend 247 / frontend 103 / build green; live-verified via 10-step curl matrix on dev (required rebuilding `fin-server-dev` — the dev container copies source at build, no hot reload). No migration; no flags.

- **v3.0.53** (2026-07-03) — **Refresh Feeds category picker auto-focuses its filter.** The bulk/single "Select Category" modal (Refresh Feeds → **Category**) now focuses the "Filter categories…" input on open, so you can type to filter immediately without clicking into it. Added an opt-in `autoFocusFilter` prop to [CategorySelector.jsx](../frontend/src/components/CategorySelector/CategorySelector.jsx) (default off — the ~10 inline filter-panel usages keep their behavior; the split-modal's per-leg selectors are deliberately excluded) and passed it on the modal usage in [RefreshPS.jsx](../frontend/src/pages/RefreshPS.jsx). Frontend-only; no flags/DB. Trivial UI enhancement — no CR.
- **v3.0.52** (2026-07-03) — **Cash Flow drill-down — "Summarize" nested modal.** The Cash Flow transaction-details modal (opened by double-clicking a report cell) now has a **Summarize** button beside Close that opens a second modal stacked on top (z-index 50 over the detail modal's 40, matching the existing `TransactionModal → TransactionSummaryModal` pattern). It rolls the currently-loaded rows up by a **By month / By account** toggle — Group · Count · Total with a grand-total footer, negatives in the usual red/parens, header click flips sort direction (months chronological by `YYYY-MM`, accounts alphabetical). Aggregation reuses the detail table's amount logic (`BaseAmount`→`Amount`→0) so totals reconcile; it summarizes the loaded set for that cell, not the whole report. New [TransactionSummaryModal.jsx](../frontend/src/features/CashFlow/TransactionSummaryModal.jsx)/`.css`; wiring + header-actions row in [TransactionModal.jsx](../frontend/src/features/CashFlow/TransactionModal.jsx). Frontend-only; no flags/DB. Trivial UI enhancement — no CR.
- **v3.0.51** (2026-07-02) — **Manual Calibration — deliberate override for the phantom-gain guard (CR033).** When an MTM reconcile trips the 15% phantom-gain guard (e.g. a real, large valuation change on a manual holding like United Beverages, −6.96M = 33.6%), the page previously dead-ended on the warning with no UI path forward (`force` was API-only). Now the guard block surfaces a **second confirm — "Book anyway (override)"** — that re-submits with `force: true`, so a genuinely-correct large move can be booked in two clicks while the guard stays up for every other account (the safe default). Chosen over removing the guard, which would silently expose all accounts (incl. fed brokerage) to unanchored-basis errors. Frontend-only ([ManualReconciliation.jsx](../frontend/src/components/ManualReconciliation/ManualReconciliation.jsx)); backend already accepted `force`; guard threshold unchanged. No CR (enhancement to CR033).
- **v3.0.50** (2026-07-02) — **Manual Calibration status-line fix (CR033).** The post-reconcile / guard message was rendered inline in the cramped filter header (`as of … · <message>`), so a long message (e.g. the phantom-gain guard's "MTM … is 33.6% of the entered balance — implausible …") **wrapped and visually collided** with the "as of {date}" span, garbling it. Moved the message onto its **own line below the header** ([ManualReconciliation.jsx](../frontend/src/components/ManualReconciliation/ManualReconciliation.jsx)) — the same declutter the fed page got in v3.0.47. Frontend-only; no flags/DB; the 15%-phantom-gain guard itself is unchanged (working as designed). Trivial UI fix — no CR.
- **v3.0.49** (2026-07-02) — **Balance Reconciliation button labels shortened.** v3.0.48's compaction still clipped on narrower widths, so the actions buttons are relabeled **"Reconcile to feed" → "Reconcile"** and **"Upload statement" → "Upload"** (full text retained as hover `title`s). Frontend-only; no flags/DB. Trivial UI polish — no CR.
- **v3.0.48** (2026-07-02) — **Balance Reconciliation actions-column fit.** The two actions buttons ("Reconcile to feed" + the CR036 "Upload statement") were overflowing/clipping the column ("Upload sta…"); made both more compact (padding `7×14→5×10`px, font `0.8→0.72rem`, gap `8→6`px, `white-space:nowrap`) so both fit. Scoped to `.recon-panel` ([BalanceReconciliation.css](../frontend/src/components/BalanceReconciliation/BalanceReconciliation.css)); frontend-only; no flags/DB. Trivial UI polish — no CR.
- **v3.0.47** (2026-07-01) — **Balance Reconciliation declutter (follow-up to v3.0.46).** The long sign-convention explainer above the table is now **collapsed behind a "? Help" toggle** (default hidden) instead of a permanent wall of text; the filter row is allowed to **wrap** and spaces out; and the post-reconcile message ("… re-anchored opening balance …") moved out of the crowded filter line onto its **own dismissible status line**. Scoped to `.recon-panel`; frontend-only; no flags/DB. Trivial UI polish — no CR.
- **v3.0.46** (2026-07-01) — **Balance Reconciliation table polish.** Optical cleanup of the reconciliation table on Balance Calibration: roomier rows (6→12px), a calmer uppercase header, zebra striping + row hover, a bordered/scrollable container, and a **primary/secondary button hierarchy** in the actions column (compact "Reconcile to feed" primary + outline "Upload statement" secondary — previously two heavy primary buttons crammed together after CR036). All **scoped to `.recon-panel`** ([BalanceReconciliation.css](../frontend/src/components/BalanceReconciliation/BalanceReconciliation.css)) so the shared `bfd-accounts`/`bfd-tx-table` styles (Bank Feed Diagnostic, Manual Calibration) are untouched; theme tokens only (dark-mode safe). Frontend-only; no flags/DB. Trivial UI polish — no CR.
- **v3.0.45** (2026-07-01) — **Manual Statement Upload — stale-feed fallback ([CR036](CRs/CR036_MANUAL_STATEMENT_UPLOAD.md) P1).** When a live feed stalls (e.g. **Luxury Card = Barclays**, per CR035), the owner can upload the bank's own CSV export and the system imports **only rows not already in the ledger** and reconciles to the statement's stated balance. Cross-repo: the **bank-feed microservice** gains a declarative format layer (`src/profiles/`, preinstalled Barclays profile) + `POST /v1/manual/{parse,commit}` (deployed 2026-07-01); **fin** gains `manualStatementImport.js` (sign alignment via `feed_negate_tx`/`feed_sign`/`account_type`, any-source dedup preview, hypothetical drift gate) behind `POST /api/v2/bank-feed/manual/{preview,commit}`, a generalized promote-side dedup (PS-only → any-source overlap, **scoped to `source='manual'`** so the live-feed path is unchanged; new `skippedDup`), and a per-row **"Upload statement"** button on Balance Reconciliation ([ManualStatementUpload.jsx](../frontend/src/components/ManualStatementUpload/ManualStatementUpload.jsx)). Verified live read-only on the real stale card: 46 parsed, 29 already-in-ledger / 17 new, drift −194.99 (surfaced pre-commit). No DB migration. **P2** = interactive column-mapper + saved per-bank profiles. Bank-feed committed `91c2911`; deploy order was bank-feed → fin.
- **v3.0.44** (2026-07-01) — **Feed Sync Freshness ([CR035](CRs/CR035_FEED_SYNC_FRESHNESS.md)).** Balance Calibration now shows each feed's **true upstream connection sync time** ("synced N days ago"), correcting v3.0.43's indicator which read `fetched_at` (fin's own daily poll) and so reported "synced today" for genuinely stale feeds. Cross-repo: the **bank-feed microservice** promotes fintable's per-connection **"⚡ Last Update"** onto `feed_balances.source_synced_at` + `GET /v1/balances` (additive contract-v1 field; service migration 003, commit `250b55b`); **fin** caches it (`bankfeed_balances.source_synced_at`, migration 033), returns it as `feed_synced_at` on `GET /bank-feed/balance-recon`, and renders it weekend-tolerant (grey ≤2d / amber 3–6d / red ≥7d) — dropping the wrong `feed_fetched_at`. Verified in prod: Luxury Card = Barclays reads *"synced 5 days ago"* (2026-06-25) while live feeds read today. Deploy order: bank-feed → fin. Realizes the stale-alert slice of [CR021](CRs/CR021_BANK_FEED_SERVICE.md) Phase 5. No new known issues.
- **v3.0.43** (2026-06-30) — **Balance Reconciliation (CR023) polish.** (1) The post-reconcile result message no longer exposes the raw DB field name — calibrate rows now read *"re-anchored opening balance −470.26 → −469.89"* (was `opening_balance …`) and MTM rows *"booked MTM entry … dated …"* ([BalanceReconciliation.jsx](../frontend/src/components/BalanceReconciliation/BalanceReconciliation.jsx)). (2) New **"synced N days ago"** sub-line under each row's Feed date, sourced from `bankfeed_balances.fetched_at` (the feed's last *sync* time, distinct from `balance_date` = the date the figure is *for*) — flags a stalled feed even when the figure looks current; surfaced via a new additive `feed_fetched_at` field on `GET /bank-feed/balance-recon` ([bankFeedReconciliation.js](../server/src/v2/repositories/bankFeedReconciliation.js)). At ship time 29 feeds read "synced today", 2 read "synced 26 days ago". Frontend + additive read-only API field; no flags, no DB migration. Trivial UI enhancement — no CR.
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
- [ ] **Shared components missing** (per §4.2): `<Modal>`, `<DataTable>`, `<FormField>`, `<ErrorMessage>`, `<ConfirmDialog>` (partially done), `<CurrencyInput>`. **Enforce before building** (design review 2026-07-03): the last generation of shared abstractions was built and never adopted — `useAPI`/`useModal`/`useFormState` have **0 importers**, `LoadingSpinner` is used in 2 files vs 27 bespoke "Loading..." literals, `formatCurrency` is redefined in 9 files despite `utils/formatters.js`, `DataTable.css` exists with no `DataTable.jsx`. Add lint/CI guardrails (the `check-button-css.sh` pattern) with each new shared component, or it meets the same fate.
- [ ] **Backend service layer simplification** (per §5): break up `fcbuilder-module.js` (835 lines), `cashFlowFetcher.js` (619 lines); `AppError` class.
- [ ] **Repo cleanup:** delete tracked Mongo-era debris (`old/`, `psAPI/`, `mongo/`, `Scripts/*-mongo.sh`), resolve `backups/` vs `Backups/` duplication, clarify root `package.json` (only declares axios). Also (2026-07-03): dead V1 pages shadowing routed V2 files (`pages/Balance.jsx`, `pages/BudgetInput.jsx` + orphan CSS), merge `js/` into `utils/` (or document the split), adopt-or-drop the `@lib` Vite alias (1 importer vs 56 relative paths).
- [ ] **Mobile shell dedup** (2026-07-03): all 8 `mobile/pages/*` fetch + transform independently — 0 imports from `features/` — so every fix is done twice (Known Issue #5 is this tax). Extract shared data hooks (`useBalanceReport`, `useCashFlowReport`, …) consumed by both shells; presentation stays forked. CR038 P1's `useOverview` is the first slice.
- [ ] **Logging: adopt pino or drop it** (2026-07-03): `pino`/`pino-pretty` are declared deps and listed in the docs' tech stack but **never imported** — all 378 log statements are `console.*`. Either wire pino in (feeds the §5.3 structured-logging item) or remove the deps and correct FC_PROJECT_STRUCTURE §3.
- [x] **`/refresh-ps` rename** — *Done v3.0.57 (2026-07-03):* route `/refresh-feeds` (+ redirect from the old URL), component `RefreshFeeds.jsx`, "Legacy PocketSmith records" label; internal CSS class names kept.
- [x] **UX polish batch** — *Closed v3.0.57 (2026-07-03):* `/ui-preview` hidden from all nav surfaces (`showInNav:false`, honored by `getRoutesByCategory`). The other two items were **false findings** on inspection: the COA single-delete confirm already renders a fallback "Are you sure…" + cannot-be-undone warning (`FCExpConfirmDeleteModal` defaults), and `.confirm-modal__message` already has `white-space: pre-line` so TransferAnalysis's `\n\n` copy renders as paragraphs.
- [ ] **Forecast inline-style migration** (2026-07-03): 571 `style={{…}}` occurrences concentrated in Forecast (`pages/FCLineMapping.jsx` 98, `FCReviewTable`/`FCAIReviewDrawer` 57 each; `FCStepNav` fully inline incl. JS hover handlers) bypass the 168-token design system — the likely source of the next dark-mode defect batch. Migrate Forecast to token CSS + add a lint guard.
- [ ] **Report-page consolidation** (2026-07-03, **owner decision — promote to CR if approved**): merge the four balance views (`/balance`, `/balance-trends`, `/balance-sheet-periods`, `/balance-chart`) into one report with a view switcher (they already share `periodHelpers.js`); same for the two cash-flow pages and the three budget-vs-actual pages. Cuts nav clutter and CSS surface; needs the owner's read on whether separate pages are actually preferred.
- [ ] **Route-level tests for `forecast.js`/`budget.js`** (2026-07-03): only 2 of 16 route files have tests, and the two biggest, logic-heaviest routes (1,441 / 912 lines, SQL in-route) have none — add coverage **before** the §5.1 route→service extraction so the split is safe.
- [ ] **TypeScript migration** (per §4.4) — gradual: utilities → hooks/components → pages.
- [ ] **API design pass**: consistent `{ success, data, meta }` envelope, pagination, structured logging via Pino.

---

## 3. Known Issues

1. **Test coverage:** 226 backend Jest tests (run on every CI push against a fresh migrations+seed DB) + 96 frontend Vitest helper tests ([CR016](#cr016)); component/hook tests + Playwright E2E still deferred. Route-level coverage is thin (2 of 17 route files). Layout: [Testing/TEST_OVERVIEW.md](Testing/TEST_OVERVIEW.md).
2. **Cloud-init ISO** still attached to the VM as a CD-ROM. Harmless; eject with `virsh --connect qemu:///system change-media fin sda --eject`.
3. **Timezone-sensitive date handling:** DATE columns return plain `YYYY-MM-DD` strings (`types.setTypeParser(1082)` in `postgres.js`). Frontend must use local-time `getFullYear()`/`getMonth()`/`getDate()` — never `.toISOString().split("T")[0]`. *2026-07-03: swept (8 sites fixed, `formatDateOnly` helper added) and an eslint `no-restricted-syntax` ban now enforces this — [CR037](#cr037) P1.*
4. ~~Fidelity brokerage balances wrong~~ — *Resolved by CR024* (feed_balances read-override).
5. **Mobile ledger running balance still seeds at 0.** v3.0.28 fixed desktop; `MobileLedger.jsx` still sums client-side from 0 and fetches by `accountId`, bypassing the server `running_balance` path. Fix: extend the route gate to a lone `accountId`, or consume `running_balance` when present.
6. **Secrets remediation tail (CR034):** `BANK_FEED_API_KEY` is still the pre-2026-06-12 value in git history — rotate it (requires updating the bank-feed service + the OCME consumer); revoke the leaked PocketSmith API key at pocketsmith.com (the integration is retired, the key may still be live upstream); optional `git filter-repo` history scrub once rotated.
7. **dockerd reboot race can detach containers from their networks.** Seen 2026-07-04: after a host reboot, `fin-postgres` + `fin-postgres-dev` came back running (healthcheck is in-container) but with **no network endpoint** — every DB-backed endpoint 500'd with `getaddrinfo ENOTFOUND fin-postgres`. Immediate fix: `docker network connect --alias fin-postgres psproject_fin-network fin-postgres` (and the `-dev` twin), or `docker compose up -d`. Prevention: `Scripts/boot-reconcile-docker.sh` + `Scripts/fin-docker-reconcile.service` run an idempotent `compose up -d` on all three stacks after boot — **installed, enabled, and test-run verified 2026-07-05** (`systemctl status fin-docker-reconcile.service`). *Considered mitigated; reopen if a reboot still detaches a container.*
8. **Foreign-currency dividend conversions arrive mislabeled from the feed.** When Fidelity auto-converts a foreign dividend to USD (e.g. EUR div → "ADJUST WIRE TRANSFER (Cash)" + "YOU EXCHANGED (Cash)"), the feed delivers a *single* row carrying the **foreign** numeric amount tagged `USD`, with the wrong sign and magnitude — the real post-conversion USD value (Fidelity's fill rate, not mid-market) exists only on the statement and never arrives structured. Auto-FX via `exchange_rates` would inject permanent recon drift on a USD cash account, so do **not** reinterpret as the foreign currency. Handling: accept the row, then on the **Ledger** (or Actuals) open the edit modal and set the correct USD `Amount` from the statement + recategorize (amount editing shipped v3.0.42 — the review-queue grid is still read-only on amount). For a USD row the read-only `USD Amount` mirrors the amount automatically. The row stays feed-linked via `bank_feed_external_id` and balance recon ties out. Corrected occurrences: 2026-06-19 (tx 2700481, EUR 1,891.09 → USD 2,146.29) and 2026-06-22 (tx 2700544, −30,887.00 → statement USD value), both Fidelity Bond. **Optional, not built:** flag `ADJUST WIRE TRANSFER (Cash)` rows in USD investment accounts as "verify USD value" so one can't be accepted on autopilot — *scoped into [CR038](#cr038) P2 (attention strip), 2026-07-03.*

---

## 4. Frontend Improvement Themes (ongoing)

### 4.1 DRY Violations (remaining)

1. ~~Transaction filter logic duplicated~~ — *Resolved* (CR002).
2. `collectCollapsiblePaths()` duplicated in `Balance.jsx` and `BalanceChart.jsx` — move to shared `treeHelpers.js`.
3. ~~Date initialization logic in BudgetInput~~ — *Resolved* via `PeriodSelector`.
4. Month options array recreated in multiple components — move to shared constants.
5. FX rate lookup duplicated in BudgetInput and transaction modals — move to shared `currency.js`.
6. `formatCurrency` redefined locally in 9 files (FCModulesTable, BudgetGraphModal, BalanceReport, CashFlowReport, budgetInputUtils, BudgetRealizationGraph, BalanceChart, CategoryTrend, BudgetVariances/BudgetRealization) despite the canonical export in `utils/formatters.js:30` — consolidate + lint-guard (2026-07-03).

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
- **Input validation** — no schema layer (zod/joi); routes trust `req.body`/`req.query` (e.g. `POST /transactions` passes `req.body` wholesale to `repo.create`). The money-writing 80/20 slice (hand-rolled field whitelists, no new dep) is scoped as [CR037](#cr037) P6; full schema-library adoption stays here.
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

*Last updated: 2026-07-03 (design review → CR037/CR038/CR039 + backlog additions)*
