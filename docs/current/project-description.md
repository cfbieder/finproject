# Fin - Personal Finance Manager

**Single-source rule (2026-06-12):** this document is the *current-state snapshot* — architecture, stack, structure, endpoints, schema, workflow. Feature/CR detail lives **only in the CR files** ([../cr/README.md](../cr/README.md)); the plan lives in [FC_NEXT_STEPS.md](project-roadmap.md); migrations live in [MIGRATIONS.md](migrations.md). The pre-restructure full text (with per-page implementation essays) is archived at [Archive/FC_PROJECT_STRUCTURE_FULL_2026-06-12.md](../archive/FC_PROJECT_STRUCTURE_FULL_2026-06-12.md).

## 1. Architecture Overview

```
                        +----------------------------+
                        |       nginx (port 80)      |
                        |   React SPA + API proxy    |
                        +-----------+----------------+
                                    | /api/*
                        +-----------v----------------+
                        |   Express 5 (port 3005)    |
                        |   Node.js Backend          |
                        +-----------+----------------+
                                    |
                        +-----------v----------------+
                        |  PostgreSQL 16 (port 5432) |
                        |  fin database              |
                        +----------------------------+
```

**Three-service architecture (production):** PostgreSQL, Node.js/Express API, nginx-served React SPA — Docker Compose orchestrated. A separate **bank-feed microservice** (own gitignored repo at `bank-feed/`, port 3007) supplies bank data over a versioned `/v1/*` contract (CR021).

---

## 2. Infrastructure

### VM

| Field | Value |
|-------|-------|
| IP | `192.168.1.87` (LAN) / `100.94.46.62` (Tailscale) |
| OS | Ubuntu 24.04 LTS (Noble) |
| vCPUs / RAM / Disk | 4 / 8 GB / 77 GB (LVM) |
| User | `cfbieder` (sudo with password — NOPASSWD no longer active, verified 2026-07-05; SSH key auth) |
| Project path | `/home/cfbieder/psproject` (symlink: `~/Programs/fin` → `~/psproject`) |

KVM host: `192.168.1.61` (Cockpit `https://192.168.1.61:9090`, pools `vm-ssd`/`vm-hdd`). Tailscale: `https://fin.tail413695.ts.net` → production frontend; auto-starts on boot.

### Access URLs

| Environment | Frontend HTTPS | Frontend HTTP | API | Database |
|-------------|---------------|---------------|-----|----------|
| **Production** | `https://192.168.1.87:5175` | `http://192.168.1.87:3006` | `http://192.168.1.87:3005` | `127.0.0.1:5433` / `100.94.46.62:5433` |
| **Production (Tailscale)** | `https://fin.tail413695.ts.net` | - | - | - |
| **Development** | `http://100.94.46.62:5174` | - | `http://100.94.46.62:3105` | `127.0.0.1:5434` / `100.94.46.62:5434` |

> **Postgres is NOT LAN-exposed** (CR034, 2026-06-12): the published DB ports bind to localhost + the Tailscale IP only.

---

## 3. Tech Stack

**Frontend:** React 19, Vite 7 (+ vite-plugin-pwa/workbox — installable PWA, cache-first hashed assets, network-only API), React Router 7, Lucide icons, Recharts, xlsx (SheetJS), env-cmd. Design system: "Mindful Minimalist" (warm cream, forest-green accents, Outfit font, soft shadows, rounded geometry).

**Backend:** Express 5, pg 8, archiver, morgan. Node 20. Logging is `console.*` (388 sites) to container stdout; `morgan` for HTTP access logs. (CR043 removed Arquero + danfojs-node — the forecast engine's label-indexed matrices are plain JS, `services/forecast/frame.js` — and the never-imported `pino`/`pino-pretty` deps; adopting a structured logger later would migrate the `console.*` sites.)

---

## 4. Project Structure

```
psproject/                          # ~/Programs/fin symlinks here
├── components/data|reports/        # Runtime data files / generated reports
├── docs/
│   ├── FC_PROJECT_STRUCTURE.md     # This file — current state
│   ├── FC_NEXT_STEPS.md            # Plan + open work + known issues
│   ├── MIGRATIONS.md               # DB migrations registry (one line per migration)
│   ├── FC_MODULE_MAPPING.md        # Forecast terminology reference
│   ├── OCME_BANK_FEED_IMPORT_GUIDE.md
│   ├── CRs/                        # Change Requests — CR_INDEX.md + CR001..CR0NN
│   ├── Guides/  Testing/  Archive/
├── frontend/                       # React SPA (Dockerfile: Vite → nginx; nginx.conf proxies /api)
│   └── src/
│       ├── App.jsx  main.jsx  config/routes.jsx
│       ├── components/             # Shared UI (Layout, Sidebar, TopStrip, CommandPalette, HelpPanel,
│       │                           #  Toast, HierarchyFilter, CategorySelector, AccountSelector,
│       │                           #  PeriodSelector, KpiCards, ConfirmModal, MtmDateControl,
│       │                           #  ErrorBoundary (route-level, CR037), …)
│       ├── contexts/  hooks/  utils/  js/   # ToastContext/ForecastContext; useAPI/useCoa/…; rest.js
│       ├── features/               # Balances, BudgetEntry, Budgets, CashFlow, Charts,
│       │                           #  COAManagement, Database, Forecast, Transaction
│       ├── mobile/                 # Dedicated /m/* shell (see §5)
│       └── pages/                  # 25+ page components
├── server/                         # Express API
│   ├── db/migrations/              # 001..060 SQL — registry in docs/current/migrations.md
│   ├── db/ci-seed.sql              # CI baseline COA rows (NOT a migration)
│   └── src/
│       ├── server.js  app.js
│       ├── services/               # budget.js, reports.js (route-facing); forecast/ below
│       ├── services/forecast/      # FC engine (index, cash-sweep, fcbuilder-*) + crud.js (route-facing)
│       └── v2/                     # PostgreSQL API (all routes)
│           ├── db/                 # pool (DATE parser → YYYY-MM-DD strings)
│           ├── routes/  repositories/  services/  scripts/
├── Scripts/                        # dev-start, deploy-to-production, sync-db-prod-to-dev,
│                                   #  bump-version, rebuild-frontend, backup-to-remote, v4-up, …
├── .github/workflows/ci.yml        # CI: backend tests (fresh DB) + frontend build + e2e + secret scan
├── docker-compose.yml              # Production (project name: psproject)
├── docker-compose.dev.yml          # Development (postgres-dev + server-dev)
├── docker-compose.v4.yml           # Isolated v4/CR027 stack (flags ON, own volume)
└── VERSION  NOTES.md
```

---

## 5. Frontend

### Pages & Routes

Detail for each page lives in its CR file (linked) — this table is a directory, not a spec.

| Path | Page | Category | Summary |
|------|------|----------|---------|
| `/` | Home | - | Live dashboard: net-worth/cash-flow KPIs (shared `useOverview` hook, also MobileHome) + "needs attention" strip (`AttentionStrip`) + quick actions ([CR038](../cr/cr-038-home-dashboard-attention.md)) |
| `/upload-ps` | UploadPS | Database | One-time PocketSmith CSV upload (live PS API removed — [CR030](../cr/cr-030-automated-ps-retirement.md)) |
| `/refresh-feeds` | RefreshFeeds | Transactions | **"Refresh Feeds"** — bank-feed review queue: refresh, tabbed review/edit, category suggestions, bulk accept, per-row kebab actions (Edit/Split/Neutralize/Transfer/Accept), group-by-account; renamed from `/refresh-ps` in v3.0.57 (old URL redirects) ([CR022](../cr/cr-022-bank-feed-parallel-import.md)/[CR028](../cr/cr-028-securities-trade-neutralization.md)) |
| `/backup-database` | BackupDatabase | Database | Download DB backup (tar.gz of pg_dump) |
| `/budget-worksheet` | BudgetWorksheetV2 | Budgeting | Two-panel worksheet: balance comparison + entry form; HierarchyFilter; math expressions; FX auto-base |
| `/budget-vs-actual/:view` | BudgetVsActual | Budgeting | **CR042 U5** — consolidated budget-vs-actual; tabs: `table` (BudgetRealization KPI cards), `chart` (BudgetRealizationGraph), `variances` (BudgetVariances ranked). Old `/budget-realization`, `/budget-graph`, `/budget-variances` redirect here |
| `/budget-fx` | BudgetFX | Budgeting | Monthly budget FX rates per currency/year (`budget_fx_rates`) |
| `/forecast-mapping` | FCLineMapping | Forecasting | FC step 1 — define FC Lines, assign budget categories |
| `/forecast-scenarios` | FCScenarios | Forecasting | FC step 2 — scenarios (copy, sweep band, target cash) |
| `/forecast-modules` | FCModuleManage | Forecasting | FC step 3 — modules. Since [CR070](../cr/cr-070-module-inputs-by-type.md)/v3.15.0 the form is **capability-gated** (a module with `has_valuation = false` shows no valuation, gains-tax or sweep fields), type seeds a new module's streams, and a residue panel reports any hidden field still holding a value. **Double-click opens the editor**; the read-only drawer that stood between was deleted. The type filter groups by what the module IS — **Assets / Debt / Flows**, the split `has_valuation` makes — and counts each option against the *other* active filters; an unrecognised type falls into a trailing **Other** group rather than vanishing (v3.15.1). **v3.17.0 ([CR072](../cr/cr-072-valuation-module-inputs.md)):** the editor's top half is **Reference value** (base date + the observed balance) · **Assigned value** (the four figures) · **Forecast assumptions** (growth, gains rate); an unmatched module collapses the first two. Base dates cap at the last closed year-end. Each stream card's reference rows drill into the transactions behind them: double-click opens `FCLineDrilldownModal`, which reuses the Actuals page's own machinery (`useTransactions`, `ACTUAL_CONFIG`/`BUDGET_CONFIG`, `useTransactionSelection`, `TransactionTable`, `HierarchyFilter`) rather than a second transaction list, pre-filtered to the line's own leaves via `GET /fc-lines/actual-breakdown` / `/budget-breakdown` — the same recursive CTE the totals use, so the two cannot disagree about which accounts count. Budget rows read `/budget/entries`, not `/transactions`; categories are filtered with the shared `HierarchyFilter` (type-to-narrow, right-click solo, All pill), opening on the line's own accounts. The two `[→ Market Value]` / `[→ Cost Basis]` buttons sit on the Reference block and write the observed balance into Assigned value in LC, with USD deriving after. **[CR073](../cr/cr-073-two-recurrence-guards.md) / v3.17.1:** a stream with a non-zero amount and no FC line is **refused** — by the form with a sentence and by `assertStreamsHaveLines` on POST/PUT as the backstop (roadmap Known Issue #2: the engine skips the P&L row but the cash path takes every stream). The two module endpoints now share `moduleCommonFields` and `loadModuleStreams` joins `fc_lines`, so LIST and DETAIL cannot drift again — pinned by `forecast.projection-parity.test.js`. **v3.16.0:** each stream card carries the FC line's real history — **actual (base−1, the last complete year) · budget (base) · actual (base, YTD)** from `/fc-lines/actual-totals` + `/fc-lines/budget-totals` — and names how many modules share the line, because the totals are the LINE's, not the module's (`Property Costs` has six). The module-level Actual field was removed as duplicate. |
| `/forecast-review` | FCReview | Forecasting | FC step 4 — multi-year review: P&L by FC Lines, BS, KPI cards, ΔNet-Assets bridge, graphs with quick-adjust, Cash Sweep summary, AI Review drawer. **Cash Health warnings ([CR045](../cr/cr-045-forecast-cash-warnings-liquidation.md)) are DISMISSIBLE per row or all at once ([CR074](../cr/cr-074-dismissible-cash-health-warnings.md) / v3.18.0, migration 061)** — stored per scenario in `forecast_warning_dismissals` against a **fingerprint** of the warning's substance, so a dismissal expires the moment its figures change; the header keeps the full issue count beside the dismissed count, and all-dismissed renders its own state rather than the all-clear banner. Routes: `GET`/`POST`/`DELETE /api/v2/forecast/warnings/dismissals`. |
| `/forecast-compare` | FCCompare | Forecasting | FC step 5 — compare two scenarios (baseline A vs B): KPI deltas, P&L/BS delta grids (client-side diff reconciling with Review), recharts A-vs-B lines + diverging delta bars, deterministic "where they differ" commentary + on-demand local-LLM AI narrative with follow-ups; **"Generate both"** rebuilds A and B so the diff isn't against a stale/never-generated scenario (v3.1.0) ([CR040](../cr/cr-040-forecast-scenario-compare.md)) |
| `/forecast-multi-compare` | FCMultiCompare | Forecasting | **[CR067](../cr/cr-067-forecast-multi-compare.md)** — a **report**, not a numbered step (no `step`, same rule as Equity below). One base scenario and up to six of its variants on a **single trajectory chart** — base at weight 3, each variant in its own validated hue — with the same five metric toggles as Compare (Net Assets · Total Assets · Net Cash Flow · Income · Expenses) and nothing else: no delta grid, no KPI cards, no commentary. Compare answers "how do these *two* differ?"; this answers "how does the fan sit against the base?", which used to mean opening Compare once per variant. Reuses `buildScenarioMatrix` per scenario (the pairwise `compareMatrices` layer is not called) and the shared `FCTrajectoryChart`. Series are keyed **by year, not by array position** — each matrix trims to its own `PeriodStart`, so a positional plot would silently shift scenarios against each other once [CR064 P2](../cr/cr-064-forecast-annual-close-and-assumptions.md) moves `PeriodStart` per scenario. Loads through `useQueries` (per-scenario cache/errors; the balance report is deduped by `PeriodStart − 2`). A variant with no generated forecast is **named as such** rather than being a missing line |
| `/forecast-equity` | FCEquity | Forecasting | **[CR062](../cr/cr-062-forecast-loan-module.md) P2** — a **report**, not a numbered step (it carries no `step`, so the sidebar's 1–5 still matches FCStepNav exactly; moved here from Reports & Graphs 2026-07-31).  every asset that carries debt, gross and net of the loans secured against it. Value less debt = **equity** (chart: gross line, equity area, dashed debt line — deliberately *unstacked*, because negative equity is a normal state and stacking makes "value = equity + debt" stop being true the moment it goes negative); then asset income less asset expense less loan interest = **net income**, and net income less principal = **net cash after debt service**. Two bottom lines on purpose: principal is a *transfer*, not an expense. Reads `forecast_entries` — no engine work. USD by construction. Only assets that actually carry debt are listed |
| `/fc-settings` | FCSettings | Forecasting | Birth year, module types, FX assumptions, AI system prompt |
| `/balances/:view` | Balances | Reports & Graphs | **CR042 U5** — consolidated balance report; deep-linkable tabs: `summary` (BalanceV2 sheet), `periods` (BalanceSheetPeriods), `trends` (BalanceTrends), `chart` (BalanceChart net worth). Old `/balance`, `/balance-trends`, `/balance-sheet-periods`, `/balance-chart` 301-redirect here |
| `/investment-returns` | InvestmentReturns | Reports & Graphs | **[CR056](../cr/cr-056-investment-returns.md) P1** — account (parent rolls up) + period + interval (month/quarter/year/**between valuations**) → realized income and unrealized G/L per period, absolute (USD ⇄ original) and as **realized / unrealized / total %** on average capital, plus a money-weighted **IRR** below the table. Metrics-as-rows / intervals-as-columns, two aligned chart panels, and banners naming every reason a % is suppressed or badged (mark coverage, mark cadence/anchor, broken chain, unattributed value) |
| `/cash-flow/:view` | CashFlowTabs | Reports & Graphs | **CR042 U5** — consolidated cash flow; tabs: `summary` (CashFlow P&L), `periods` (CashFlowPeriods per-period columns), `by-account` (CashFlowByAccount — By-Period layout + category/account filter chips + USD/original-currency toggle, [CR054](../cr/cr-054-cash-flow-by-account.md)). Old `/cash-flow-periods` redirects here |
| `/category-trend` | CategoryTrend | Reports & Graphs | Actual vs budget per category, grouped bars |
| `/trans-actual` | TransActual | Transactions | Transaction explorer: search, HierarchyFilter, KPI cards, edit/split/neutralize/delete ([CR008](../cr/cr-008-hierarchy-filter.md)). Redirects to `/m/transactions` on a phone; KPI tiles total in base, not per-currency-summed ([CR068](../cr/cr-068-mobile-actuals-search.md)) |
| `/trans-budget` | TransBudget | Transactions | Budget-transaction explorer (same pattern) |
| `/transfer-analysis` | TransferAnalysis | Transactions | Auto + manual transfer matching, match groups, orphan Remove/Neutralize ([CR009](../cr/cr-009-transfer-analysis.md)/[CR028](../cr/cr-028-securities-trade-neutralization.md)) |
| `/ledger` | Ledger | Transactions | Account ledger; **Balance column = true account balance** (server `running_balance`, v3.0.28); duplicates finder; add/bulk-edit ([CR031](../cr/cr-031-ledger-filter-parity-year-range.md)); edit modal supports **Amount/Currency + read-only USD Amount** (v3.0.42, shared with Actuals) |
| `/balance-calibration` | BalanceCalibration | Transactions | Bank-feed reconciliation `<BalanceReconciliation/>`: computed vs feed, calibrate/MTM, feed+status filters, flip-tx ([CR023](../cr/cr-023-pocketsmith-removal.md)) |
| `/manual-calibration` | ManualCalibration | Transactions | Non-fed twin: computed vs user-typed balance, calibrate/MTM with as-of date ([CR033](../cr/cr-033-manual-calibration.md)) |
| `/manual-entry` | ManualTransactionEntry | Transactions | Rapid hand entry of actual transactions ([CR025](../cr/cr-025-manual-transaction-entry.md)) |
| `/quicken-import` | QuickenImport | Database | Quicken QIF import admin: parse/map/preflight/promote/rollback ([CR019](../cr/cr-019-quicken-import.md)) |
| `/fx-options` | FXOptions | Forecasting | Forecast FX assumptions |
| `/coa-management` | COAManagement | Settings | COA CRUD tree editor, move/re-parent, feed badge ([CR010](../cr/cr-010-coa-management.md)); **↑/↓ reorder among siblings, expand/collapse all + one-layer** ([CR063](../cr/cr-063-coa-ordering.md)). Arrows are disabled at a group's ends **and whenever a search or filter is active** — in a filtered view the row above is not the sibling it would swap with. *Analyze PS Data* removed in the same release (PS is no longer a data source; the `/ingest-ps/analyze-ps` endpoint stays for Upload PS) |
| `/program-settings` | ProgramSettings | Settings | App preferences (default budget year) |

### Navigation & Layout

- **Sidebar layout (CR026, ON in prod since v3.0.0):** collapsible VS Code-style `Sidebar` + `TopStrip` (breadcrumbs, ⌘K search, help, install, theme). Flag: `localStorage.navLayout` → `VITE_NAV_LAYOUT` build arg → legacy top `NavigationMenu` fallback. Groups from `SIDEBAR_GROUPS`/`getSidebarNav()` in `routes.jsx`. Collapsed rail shows hover flyouts.
- **Dark mode:** `[data-theme="dark"]` token overrides in `index.css`; `useTheme` hook (default light, persisted, no-FOUC script). 100% coverage of reachable surfaces.
- **⌘K CommandPalette** + **HelpPanel** drawer (shortcuts + glossary).
- Category landing pages at `/<category-slug>` generated from `routes.jsx`.

### State, Patterns, Shared Components

- **Context:** `ToastContext`, `ForecastContext`; page-level `useState` otherwise. Shared hooks: `useAPI`, `useCoa` (COA + derived maps — currently refetches per consumer, caching is backlogged), `useOverview` (Home/MobileHome KPI data, CR038), `useFormState`, `useModal`; feature hooks for CRUD+toasts.
- **Shared selectors:** `HierarchyFilter` (two-stage group pills + checklist, type-to-narrow, right-click solo, opt-in `singleSelect`, opt-in `initialGroupKey` for a filter that opens already narrowed), `CategorySelector`, `AccountSelector`, `PeriodSelector` (presets incl. an "All" full-history preset shown only under opt-in `enableYearRange`), `MonthYearPicker`, `PeriodCountSelector`, `KpiCards`, `ConfirmModal`, `MtmDateControl`.
- **Patterns:** lazy routes (`React.lazy`+Suspense), feature modules under `features/`, toasts on all CRUD, collapsible filter panels, `.page-shell` page width wrapper.
- `utils/periodHelpers.js` — shared period-end series engine (Month/Quarter/Year, partial-period `(MTD/QTD/YTD)` handling) used by Balance Trends / BS Periods / Balance Chart / Cash Flow Periods.

### CSS Design System

Vanilla CSS with custom-property tokens in `index.css` (colors, type, spacing, radius, shadows, transitions) + dark-theme override layer. Canonical `.btn` family in `components/buttons.css`; `npm run lint:buttons` (via `Scripts/check-button-css.sh`) blocks new ad-hoc `*-btn` classes. Shared UI primitives (CR042 U4): `components/Modal/Modal.jsx` (Radix Dialog under tokens — the one home of `role="dialog"`; `npm run lint:modals` blocks new bespoke overlays) and `components/DataTable/DataTable.jsx` (sortable sticky-header table, BudgetWorksheetV2 pattern). `.page-shell` owns page max-width/gutters. Breakpoints: 1080/768/640px, desktop-first.

### Mobile / PWA Shell

Separate simplified pages under `frontend/src/mobile/` at `/m/*` (not a responsive restyle). `useIsMobile`: standalone PWA, viewport ≤640, or coarse pointer ≤900 (with fine-pointer-only `forceDesktop` escape). `MobileLayout` + bottom `MobileTabBar` (Overview, Balance, Cash Flow, Budget, Graph). Pages: MobileHome (live overview), MobileBalance, MobileCashFlow, MobileBudgetRealization, MobileBudgetGraph, MobileRefreshFeeds (refresh + summary + read-only list of imported/pending-review transactions, v3.0.35), MobileReconcile (`/m/reconcile` — fed drift/stale + manual drift, tap-to-reconcile with two-tap confirm, MTM books last month-end; CR038 P4, v3.0.57), MobileBalanceTrends, MobileLedger (read-only; running balance still seeds at 0 — Known Issue #5), **MobileTransactions** (`/m/transactions` — Actuals search: debounced server-side description search over three filter chips (period · accounts · categories), each opening a full-screen `MobileSheet`; holds an `ACTUAL_CONFIG`-shaped filter object so `useTransactions` and the period mapping are shared with `/trans-actual`; read-only, tap a row to expand; CR068 P1). `MobileSheet` is the shell's single bespoke dialog — `MobilePickerSheet` (single/multi select) and `MobilePeriodSheet` (month stepper + presets + custom range) both render through it. All consume existing v2 endpoints.

---

## 6. Backend

### API Endpoints

All mounted at `/api/v2` (nginx rewrites legacy `/api/*`). Behavioural detail in the linked CRs.

**Accounts (`/accounts`):** `GET /` (filters incl. `leafOnly`) · `/tree` · `/traits` · `/balances` · `/categories` · `/:id`(+children/descendants) · `POST /` · `PATCH /:id` · `DELETE /:id` (soft) · `GET /lookup?name=` · `GET|PUT|DELETE /:id/mappings`. **All of these read in COA order since [CR063](../cr/cr-063-coa-ordering.md) (v3.10.0):** the tree sorts siblings on `accounts.display_order` (a rank *within the parent*, migration 049) and the flat lists — `GET /`, `/balances`, `/categories`, plus `findPLeaves` — join a shared `SORT_PATH_CTE` for the tree's depth-first rank. Before that, `getTree` selected `display_order` and then sorted `ORDER BY path` where `path` is `ARRAY[id]`, so every tree, report and dropdown in the app rendered in **insertion** order; and the flat lists sorted on the *global* sequence the column used to hold, which a per-parent rank breaks rather than leaves alone.

**Budget (`/budget`):** versions CRUD+copy · entries CRUD (single/batch) · summaries (by-category/by-month/compare) · `fx-rates` (get/upsert/rate-map/preview/recalculate) · v1-compat `GET /`, `/actual-entries` (date-range aware, CR031; also filters `description`/`valueFrom`/`valueTo`/`currency` and returns `truncated` when the LIMIT is hit — CR068 P2), `/cash-flow`.

**Categories (`/categories`):** P&L leaf accounts post-migration-021 (URL preserved; backed by `accounts`). List/lookup/single + mappings.

**Forecast (`/forecast`):** assumptions get/put (the `scenarios` array carries **`ParentId`** — every scenario picker in the app reads this endpoint, so lineage has to reach it or a variant is indistinguishable from a base outside the Scenarios page; additive, [CR050 §10](../cr/cr-050-forecast-scenario-variants.md)) · scenarios (list/years/delete-by-name/**copy** — a *whole* copy since CR048/v3.0.93: scenario row + modules + inc/exp items **and** the per-scenario assumptions (period, inflation, FX, tax rate) that live in the `forecast_assumptions` document, all in one transaction; the UI used to do that last half client-side) · modules CRUD + `add-from-actuals` (**`POST /modules/bulk-update` was deleted in v3.15.0** — it had no caller and wrote a retired column) · ~~incomeexpense CRUD~~ (**410 Gone** since [CR069](../cr/cr-069-forecast-streams.md) P2 — an item is a module with `has_valuation = false` and one stream; the four tables were dropped in P3/migration 060) · entries · `POST /generate/:scenario` · **auto-adjust** ([CR053](../cr/cr-053-forecast-auto-adjust-spend-to-fund.md)): `GET /auto-adjust/lines/:scenario` (candidate expense lines), `POST /auto-adjust/solve` (async → `{jobId}`), `GET /auto-adjust/solve/:jobId` (poll), `POST /auto-adjust/apply` (persist the cut as a variant override + verify) · audittrail (`/:scenario/:module` also serves the **synthetic `_cash_sweep`** module, whose trail the sweep writes to `<scenario>_cash_sweep.csv` rather than the per-module `_entries.csv` — it is clickable in the Review breakdown, and 404'd until v3.0.97; **since [CR069](../cr/cr-069-forecast-streams.md) P0 an income/expense item's entries and its trail are both keyed on the ITEM's name, not on the FC line it posts to** — the two agreed before and still agree, but two items sharing a line no longer share one label and one file). **The module write contract takes `Streams`** (direction · FC line · mode `amount`/`yield`/`pct_of_value`/`derived` · amount · growth multiplier · CR046 window · CR047 income-tax override · a signed change schedule of `Percent %`/`Fixed $`/`One-Off $`/`Spread %`) and `HasValuation`; the per-direction `Expense*`/`Income*` fields were retired with their columns in P3 · **[CR062](../cr/cr-062-forecast-loan-module.md):** `GET /equity?scenario=` (the Equity report — assets that carry debt, gross/net/equity plus the two flow bottom lines; a read over `forecast_entries`, no engine work) **`GET /fc-lines/actual-totals?year=` ([CR070](../cr/cr-070-module-inputs-by-type.md)/v3.15.0)** — with the pre-existing `GET /fc-lines/budget-totals?budgetYear=`, the pair behind the stream card's three-year reference block (v3.16.0) — actual spend per FC line across *every* account mapped to it, built as the exact sibling of the existing budget-totals query so the two are comparable; it replaced a `PY Actual` field that looked a flow module up in the **balance-sheet** report and was therefore permanently blank on a `profit_loss` account · and `GET /modules/:id/loan-retype-preview` (what a retype to **Loan** would delete — Invest/Dispose/Yield-Spread rows and the income/expense window — so the confirm dialog can *name* it before the write).

Module and income/expense **writes are field-validated** (CR043 N10, v3.0.95): the body is checked against an explicit allow-list and an unknown key is rejected with `400 unknown field(s): X` rather than silently dropped — the failure mode that shipped CR046's window dates and CR047's tax override as no-ops. **The create path had the mirror of that defect until v3.9.1:** `repo.createModule` carried its own hand-written INSERT list, separate from `updateModule`'s allow-list, and **nine** columns were unreachable through it — including the same CR046 window dates and CR047 override, which the route mapped and POST then discarded behind a `201`. Both paths now read one exported `MODULE_COLUMN_DEFAULTS` map, and a test reads `information_schema` so a future migration that adds a column fails a test rather than going silently unwritable.

**Health (`/health`).**

**Ingest PS (`/ingest-ps`):** CSV upload path only (`POST /`, `/upload-ps`, `/clearall`, `/sync-to-transactions`, `/analyze-ps`, psdata count/options) + review queue (`/new-transactions`, `/modified-transactions`, `POST /review-new-transactions`) + `/appdata/last-refresh`. PS-API refresh removed (CR030).

**Ingest bank feed (`/ingest-bank-feed`):** `POST /refresh {sinceDays}` — stage + promote from the bank-feed service ([CR022](../cr/cr-022-bank-feed-parallel-import.md)). **Promote de-duplicates on the event hash (v3.7.2):** a fintable id is `{provider_account_id}--{event_hash}` and only the suffix is stable — the prefix changes when a connection is re-consented *and* when an account is re-attributed upstream, so the same event arrives under new ids. A staged row whose suffix already sits on a bank-feed transaction for that account is stamped against it instead of inserted. Runs **ahead of and independent of `BANK_FEED_DEDUP_ENABLED`** (that flag governs the fuzzy PS matcher; an exact id match is not a guess) and is inert on sources whose ids carry no `--`. **Ingest pages to the end (v3.7.4):** `ingest()` follows `offset` until a short page, reports `pages`, and **throws** past 40 full pages rather than staging a possibly-truncated window. Offset paging is sound here because the endpoint orders by `transaction_date DESC, id DESC` (total; `id` unique) and new rows land at the front — a concurrent sync can cause a re-read, never a skip, and re-reads are idempotent.

**Bank feed (`/bank-feed`):** read-only proxy + `GET /balance-recon` (institution-enriched + true upstream sync time `feed_synced_at` from the feed's `source_synced_at`, fail-open) · `POST /reconcile/:accountId` (`asOf/dryRun/force/bookDate`) · `PATCH /reconcile-mode/:accountId` · `PATCH /feed-negate-tx/:accountId` · `GET /fed-accounts` · diagnostic ([CR023](../cr/cr-023-pocketsmith-removal.md)/[CR024](../cr/cr-024-fidelity-feeds.md)) · **manual statement upload (stale-feed fallback, [CR036](../cr/cr-036-manual-statement-upload.md), v3.0.45; P2 mapper v3.0.59): `GET /manual/profiles` (built-in + mapper-saved) · `POST /manual/inspect` (headers/samples for the mapper) · `POST /manual/save-profile` · `POST /manual/preview` (parse + any-source dedup + hypothetical drift, no writes; accepts `profileId`, inline `profile` spec, and typed `statedBalance`) · `POST /manual/commit` (write to the service, promote only-new, reconcile; same params). Service `manualStatementImport.js` owns sign alignment (feed_negate_tx / feed_sign / account_type); the bank-feed microservice owns parsing via `POST /v1/manual/{parse,commit}` + declarative format profiles (`bank-feed/src/profiles/`, preinstalled Barclays / Luxury Card). UI: per-row "Upload statement" on Balance Reconciliation → `ManualStatementUpload.jsx`.**

**Manual calibration (`/manual-calibration`):** `GET /recon?asOf=` · `PUT /balance/:accountId` · `DELETE /balance/:accountId` · `PATCH /reconcile-mode/:accountId` · `POST /reconcile/:accountId` · `POST /reset-opening/:accountId` (zero the `opening_balance` plug; `{data}`-enveloped, `dryRun`/`force`) ([CR033](../cr/cr-033-manual-calibration.md)).

**Quicken import (`/quicken-import`):** `POST /parse` · batches list/detail/mappings/preflight/promote/rollback/delete ([CR019](../cr/cr-019-quicken-import.md)).

**Reports (`/reports`):** `GET /balance` · `/cash-flow` (+`/transactions`; CR054 adds optional `category`/`accounts` name filters + `currency=usd|original`, returning `meta:{currency,currencies[]}` — absent params ⇒ unchanged) · `/category-trend` · `/investment-returns` ([CR056](../cr/cr-056-investment-returns.md): `account` (parent rolls up descendants), `fromDate`, `toDate`, `interval=month|quarter|year`, `currency=usd|lc` → `{data,meta}`; per-interval income and flows by category / unrealized G/L / FX plug / unattributed, and realized / unrealized / total % on average capital `(open+close)/2`, plus a whole-period money-weighted **`total.irr`** solved on the actual dated flows (with `total.irrBasis` = `valued` | `closed` — a closed-out position needs no valuation because its ending value is exactly zero); `meta.markCoverage`, `markCadence`, `markedWindow`, `chainBrokenBy`, `feedBalanceOverrides`. `interval=marks` lays columns out between valuations. 400s on an unknown account and on a span over 60 columns rather than coarsening it).

**Transactions (`/transactions`):** `GET /` (rich filters; single-account ledger requests get per-row `running_balance` — v3.0.28) · summaries · `GET /:id` · `POST /` (CR025: `accepted` default TRUE for `source='manual'`) · `PATCH /:id` · `DELETE /:id` · `POST /:id/split` · `POST /:id/neutralize` (pair-or-mirror + dryRun + CR032 guard — see [CR028](../cr/cr-028-securities-trade-neutralization.md)/[CR032](../cr/cr-032-core-cash-sweep-neutralization.md)) · `POST /:id/transfer` · `POST /:id/book-at-source` + `POST /:id/book-at-source/undo` (CR057 three-leg income restatement onto the earning holding; `dryRun` preview shares the write path) · `POST /restatements` (which ids are already booked) · `GET /categories` (distinct categories on an account — the Ledger filter's options; derived from loaded rows before v3.6.0, which hid every category outside the first 500) · `POST /category-suggestions` · `GET /transfer-analysis`.

**Transfer match groups (`/transfer-match-groups`):** `POST /` · `GET /` · `DELETE /:id`.

**AI Review (`/ai-review`):** async create (202 + background gateway call to local `ocr-llm`, task `finance_plan_review`) · `GET /:reviewId/status` poll · follow-up message · per-scenario list · get/delete · `POST /apply` ([CR006](../cr/cr-006-ai-review.md)). **Compare mode ([CR040](../cr/cr-040-forecast-scenario-compare.md)):** `POST /` accepts `compareWith` → two-scenario context (both full contexts + precomputed cumulative B − A divergence table), fixed compare system prompt, no action blocks; pair persisted in `fc_ai_reviews.compare_scenario_id` (migration 035) so follow-ups rebuild the pair context; `GET /scenario/:name` excludes compare reviews (drawer) unless `?compareWith=<B>` (Compare page's pair list).

**Utility (`/util`):** appdata get/post · exchange-rates/currencies · COA read+add/update/delete · **`POST /coa/reorder`** ([CR063](../cr/cr-063-coa-ordering.md)) — takes the **whole** ordered sibling list (`{parentId|parentName, orderedIds}`), not a per-row nudge: idempotent, one transaction, and **409** when the ids are not exactly that parent's active children, which is the only way to catch a client whose tree went stale. `parentName` exists because `/coa/BalanceSheet` strips the section root and the client re-adds it as a bare label, so top-level rows know their parent only by name (names are `UNIQUE`) · `POST /backup-database` (execFile pg_dump → tar.gz download) · `GET /attention-summary` (Home strip counts: unreviewed tx, KI#7 verify-USD rows, stale feeds, fed+manual drift — [CR038](../cr/cr-038-home-dashboard-attention.md)).

### Repositories

`accounts`, `transactions` (+pending), `budget`, `budgetFxRates`, `forecast` (+sub-tables, AI reviews), `fcLines`, `psdata` (+app_data), `transferMatchGroups`, `accountSourceMappings`, `bankFeedReconciliation`, `manualReconciliation`.

### Forecast (FC) Module

Multi-year projection engine in `server/src/services/forecast/` (`index.js` orchestration in load → compute → persist phases + convergence, `cash-sweep.js` priority-ordered sweep ([CR017](../cr/cr-017-cash-sweep-phase-c.md)), `fcbuilder-module.js` a pure `computeModule` + compat `processModule` wrapper (**since v3.17.0 every year AFTER a module's base year grows, including those before PeriodStart — the base year itself never does**), `fcbuilder-stream.js` the ONE stream evaluator, `fcbuilder-loan.js`, `fcbuilder-common.js` shared payload/insert, `frame.js` LabelFrame, `fcbuilder-setup.js`; CR043 Phase 2.3). **`fcbuilder-incexp.js` was deleted in [CR069](../cr/cr-069-forecast-streams.md) P2** and the Expenditures step left the nav with it — the workflow is **4 steps** (mapping → scenarios → modules → review). FC Lines decouple budget categories from forecast outputs ([CR004](../cr/cr-004-fc-lines-mapping.md)). Terminology + period definitions: [FC_MODULE_MAPPING.md](fc-module-mapping.md); full engine spec: [CR003](../cr/cr-003-forecast-module.md); calculation rules (yield spread, disposal halving, tax 1-yr deferral, FX) archived in the full doc.

**Loan modules** ([CR062](../cr/cr-062-forecast-loan-module.md), migrations 047/048) — a module with a `loan_interest_rate` is a **loan**: five stored assumptions (principal, draw year, end year, rate, and a `(year, pct)` amortization schedule) from which `services/forecast/fcbuilder-loan.js` **derives** the draw and repayment schedule on **every generate**. Nothing is materialized — a stored schedule rots the moment an assumption changes, which is the CR049/CR050 pattern. The percentages apply to the **original** principal and the **end year repays the remainder**, so a loan closes at exactly zero rather than fractions short. Interest is charged on the **average** outstanding balance, which *is* the July-1 half-year convention — the draw year carries exactly half a year for free, and CR041's ownership gate and CR046's window are both **neutralised** for loans so nothing halves it a second time. The engine keys on `loan_interest_rate`, **never** on the user-editable `module_type`. A liability's market value is stored **negative**; base-year interest is a third UNION branch in `getBaseYearValues`, so it reaches the cash sweep's opening cash. `services/forecast/equity.js` serves the Equity report off `forecast_entries`. Warnings (`fcbuilder-loan.js` → `loanWarnings`, mirrored client-side in `fcWarnings.js`): bullet, balloon, unrepaid, over-scheduled, capped repayment, drawn-before-period, no principal.

**Scenario variants** ([CR050](../cr/cr-050-forecast-scenario-variants.md), migration 039) — a scenario may be a **variant** of a base (`forecast_scenarios.parent_scenario_id`) and then **inherits every item unless overridden**. Overrides live in `forecast_scenario_overrides` as a **JSONB patch keyed to the base row's id** (field-level, so pinning one field still lets the base's other changes flow through); schedules and the inflation/FX lists replace wholesale. `v2/services/forecastVariants.js` **materializes** base ⊕ overrides into the variant's real `forecast_modules` / `forecast_income_expense` rows — so **the engine, Review, Compare, AI review and the audit CSVs read an ordinary scenario and are unchanged**. Sync is **lazy** (on the variant's own reads, on an override write, and unconditionally at the top of `generateForecast`), never fanned out from a base write — a variant must not be able to fail an edit to its base. Its column list comes from `information_schema`, never a hand-enumerated list: that is the direct fix for the bug class that hit the deep-copy path twice (CR045 §1 dropped `cash_sweep_priority`; CR048 dropped the assumptions). Writes on a variant's inherited rows are **intercepted** (`repo.updateModule` / `updateIncExp` / `deleteModule` / `deleteIncExp`, plus `crud.replaceModuleSchedules`) and become overrides; a delete becomes a **tombstone**; `crud.refreshModulesFromActuals` (a set-based UPDATE that would be erased by the next sync) is **refused** on a variant. **Assumption edits** (FX / inflation / tax / period / sweep band) are made through the Scenarios page's own tables, which write the document / scenario row directly — so on a variant they are reconciled into overrides at write time by `reconcileAssumptionOverrides`, called from `PUT /assumptions` and the sweep-band `PUT /scenarios/:id` (without this, a variant's FX edit was invisible in the panel **and** erased by the next `syncAssumptions` — a silent-data-loss bug fixed in v3.0.112). Numeric comparisons use the column's own scale (from `information_schema`) and dates compare as calendar days, so float noise / timezone artifacts never register as a spurious override. The one column carrying a **row reference** — `secured_asset_module_id` — is resolved after the upsert by asking **which scenario the target sits in** (already the variant's ⇒ keep, a base row ⇒ translate through `origin_base_id`, otherwise NULL): an *inherited* link is a base module id while an *overridden* one is a variant id, and mapping base→variant unconditionally erased every link the owner set inside a variant ([CR062 §11.2](../cr/cr-062-forecast-loan-module.md), v3.11.3). Routes: `POST /scenarios/:id/variant` (the API's first real scenario-create — creation is otherwise a side-effect of `PUT /assumptions`), `GET /scenarios/:id/overrides` (returns each base row **with its schedules**, so the panel can show *was → now*), `PUT /scenarios/:id/overrides/assumption/:key`, `DELETE /scenarios/:id/overrides/:entityType/:baseEntityId[?field=]`, `POST /scenarios/:id/sync[?dryRun]`, `POST /scenarios/:id/adopt-variant[?dryRun]` (converts an existing **copy** into a variant by diffing it against a base), `POST /scenarios/:id/detach`. UI: `FCInheritanceBadge` (Inherited · Overridden · Local on Modules/Expenses) and `FCVariantPanel` on `/forecast-scenarios` (lineage, the override set with per-field revert, create-variant, detach — plus, on a **base**, a collapsed table of its variants: field count and the overridden items in words, fetched lazily on expand, each name selecting that variant; a scenario inside a lineage is tinted, a free-standing one is not). All **seven** scenario pickers (Scenarios, Modules, Expenditures, Review, Compare A + B, Equity) render through one `utils/scenarioOptions.js`, which **regroups** rather than relabels: bases keep the API's alphabetical order, variants move under their own base marked `↳`, an orphaned variant renders top-level rather than being dropped, and the option **value** stays the bare scenario name (what every caller stores, sends and persists).

**Auto-adjust spend-to-fund** ([CR053](../cr/cr-053-forecast-auto-adjust-spend-to-fund.md), no migration — *shipped v3.3.0, 2026-07-16*) — when the cash sweep runs out of assets to sell, the owner picks a set of expense lines and the system solves the **least uniform % cut** that keeps every year at/above the low band. It is a numerical solve, not a formula (cutting spend feeds back through the sweep: fewer forced sales ⇒ less capital-gains tax ⇒ more cash), driven server-side by the engine's own persisted `Cash Shortfall` entries — never the client `fcWarnings` util. `v2/services/forecastAutoAdjust.js` deep-copies the target into a **standalone scratch** scenario (a throwaway *variant* is impossible — a variant-of-a-variant is trigger-rejected, and a variant is force-synced at `generateForecast` Step 0, clobbering any factor written), threshold-searches the retained fraction (`expense = base × retain`, so one factor scales every year uniformly) over ~10 scratch builds (audit-CSV off via `generateForecast(name,{writeAudit:false})`), then tears the scratch down (DB rows cascade; the assumptions-doc rows keyed by its name are pruned explicitly). The solve runs as an in-memory async job (`startSolveJob`/`getSolveJob`) so a long request can't proxy-timeout. **Apply** persists the cut as a CR050 override (`expense_amount = effective × retain`) on a variant via `interceptWrite`/`mergeEntityOverride` — a base target gets a new "*… — reduced spend*" variant so the base is never mutated — and then a **verification rebuild** re-reads the shortfall to prove the real scenario is funded (the scratch number is not trusted). UI: `FCAutoAdjustModal` (line multi-select + optional max-cut, solve/apply with before→after), launched from a button in `FCReviewWarnings` shown when a blocking cash-health issue exists.

### Reconciliation Engines

- **Feed-driven** ([CR023](../cr/cr-023-pocketsmith-removal.md)): `services/reconcileToFeed.js` — per-mapping `reconcile_mode` `'calibrate'` (re-anchor `opening_balance`) | `'mtm'` (month-end cat-88 Unrealized-G/L entry, 15% phantom-gain guard, optional `bookDate`); sign axes `feed_sign` (balance) + `feed_negate_tx` (transactions); sync-before-reconcile (fail-open).
- **Manual** ([CR033](../cr/cr-033-manual-calibration.md)): `services/reconcileManual.js` — deliberate parallel fork for non-fed leaf accounts against user-typed `manual_balances`; shared `services/fx.js` for non-USD base amounts.
- **Neutralization** ([CR028](../cr/cr-028-securities-trade-neutralization.md)/[CR032](../cr/cr-032-core-cash-sweep-neutralization.md)): pair-or-mirror with dry-run; core-sweep auto-mirror at promote.

### Tests

802 backend Jest tests (measured 2026-08-05 — live counts live in [test-overview.md](test-overview.md), not here; engine incl. CR041 ownership gating + CR043 generate transactionality + CR050 scenario variants (20 DB-backed) + CR051 foreign-currency income/expense conversion & the base-year-FX guard, the CR043 migration runner, **route-contract tests for `forecast.js` + `budget.js` + `reports.js`** (CR043 Phase 1.2 / 2.2), services incl. aiReview compare, repositories, scripts, `v2/utils/validate` + `AppError`; DB-backed suites self-seed against `DATABASE_URL`) — run `cd server && npm test`. **A DB-backed suite seeds its own fixtures and cleans up by name — it never reads ambient data.** `SELECT … LIMIT 1` for an account or an fc_line passes on dev, whose database is full, and dies in `beforeAll` on CI's, which holds only what the migrations and `ci-seed.sql` create; that cost 29 tests and two days of red `main` (v3.11.2). 389 frontend Vitest tests ( utils helpers + `fcCompareUtils` diff engine + `FIELD_SECTIONS` grouping + `rest.js` timeout/unwrap + `useCoa`/`useOverview` hooks + the transaction date helpers — both the edit/display and the **period-filter** paths, pinned to `America/New_York` because the runner is UTC where neither defect reproduces — + a `MobileHome` render smoke test, via `@testing-library/react`) — `cd frontend && npm test`. HTTP smoke: `node server/src/scripts/smoke-after-021.js`. **CI** (`.github/workflows/ci.yml`) runs four jobs: the backend suite against a fresh migrations+[`ci-seed.sql`](../../server/db/ci-seed.sql) Postgres, the **frontend Vitest suite (blocking, CR043 Phase 1.1)** + build, the **8-spec Playwright money-path smoke** (`Scripts/e2e.sh`, [CR043](../cr/cr-043-code-structure-program.md) Phase 4; all 8 actually RUN since 2026-08-05 — `cr051-currency` was skipped until the seed grew a PLN account), and the secret scan. Because the backend and e2e jobs both build their database from the migration chain, **a migration that asserts a production data fact fails there and takes both jobs with it** — see [migrations.md](migrations.md) 046. Nothing announces a red `main`, which is [Known Issue #12](project-roadmap.md#3-known-issues); the **lint gate is BLOCKING** (errors 0; warnings baselined by `check-lint-debt.sh`, CR043), and a tracked-secret grep gate. The lint config carries two rules from `eslint-plugin-react` — `jsx-uses-vars` and `jsx-no-undef` (v3.6.6), *not* its `recommended` set: core ESLint builds no scope reference from a JSXIdentifier, so without them a component used only in JSX reads as unused and one that does not exist reads as nothing at all. That blindness shipped two `ReferenceError` crashes (`/m` home for 2 weeks, the Actuals split modal for 4 months); with them, `no-unused-vars` no longer needs its capitalized escape hatches (`^_` only). Inventory: [test-overview.md](test-overview.md).

### Operational scripts (`server/src/v2/scripts/`)

One-time/idempotent admin CLIs — all require `DATABASE_URL` (no embedded credentials since CR034): `quicken-import.js` / `quicken-promote.js` / `quicken-verify.js` ([CR019](../cr/cr-019-quicken-import.md)), `ps-anchor.js`, `retire-handoff.js`, `seed-cr019-coa.js`, `copy-quicken-to-prod.js`, `seed-bankfeed-cutoffs.js`, `seed-ps-lower-cutoffs.js`, `seed-cr023-reconcile-modes.js`, `seed-cr024-fidelity-*.js`, `mtm-reconcile.js`, `backfill-cr032-core-sweeps.js`, `ps-exit-monitor.js`, `fix-ps-transfer-signs.js` *(v3.6.3 — flips two PocketSmith transfers booked as credits on Fidelity Stocks and re-plugs `opening_balance` by the same amount; dry-run by default, idempotent, aborts unless today's balance is unchanged)*, `quicken-anchor.js` ([CR058](../cr/cr-058-quicken-valuation-anchors.md) — writes one dated adjustment per custodian/Quicken target date plus a handoff reversal so today is untouched; `--valuation-set` for accounts with no Quicken import, `--check` read-only tie-out, `--clear` removal), `restate-mtm.js` *(v3.7.0+ — rewrites an already-written month-end MTM mark from the custodian's own statement. A stale mark **cannot** be re-marked, because the feed row for that date IS the stale value; the settled close arrives on a later-dated row. Targets processed in date order with the balance re-read after each write, since restating an earlier quarter changes every later one. Lands in `Unrealized G/L`, not `Valuation - Historical`. Dry-run by default; asserts the resulting balance equals the target or rolls back. **Today's balance moves by design** — the next month-end mark re-pins it)*. `attribute-unrealized.js` *(v3.7.0+ — moves market movement out of the flow bucket into `Unrealized G/L` using the custodian's cost-basis figures. Writes a **balance-neutral pair** per period (`+U` category 88, `−U` category 229 `Valuation - Historical`), so the value re-buckets and no balance moves; asserts that at every date and refuses to commit otherwise. `U` is a difference of unrealized LEVELS — the first CSV row is a baseline that writes nothing. Guards against double-counting any period that already has an `Unrealized G/L` posting)*. Reading side: `parse-fidelity-statement.js` ([CR061](../cr/cr-061-holdings-and-prices.md) — no DB; extracts per-account valuations, the period/YTD value-change decomposition, and `Total Holdings` market value / cost basis / unrealized G/L from Fidelity statement PDFs via zlib + regex, no OCR and no third-party dependency). Usage in the owning CR file.

---

## 7. Database

**Enums:** `account_type` (asset/liability/equity/income/expense), `account_section` (balance_sheet/profit_loss), `security_tx_type`.

### Core tables

| Table | Purpose |
|-------|---------|
| `accounts` | Unified COA (BS + P&L) with `parent_id` hierarchy; calibration columns (`opening_balance`, `opening_balance_date`, `manual_reconcile_mode`); P&L leaves carry `is_transfer`/`ps_category_id` (migration 021). **`display_order` is a rank WITHIN THE PARENT** (1-based, gap-free) since migration 049 / [CR063](../cr/cr-063-coa-ordering.md) — it was a global 0–207 sequence that `getTree` ignored. `create()` appends at `MAX(sibling)+1` (it hard-coded **0**, tying 22 rows); the COA page's ↑/↓ arrows rewrite a whole sibling list through `POST /util/coa/reorder`. |
| `account_source_mappings` | External↔internal name map per source (pocketsmith/quicken/bank-feed) + per-mapping feed policy: `ignored`, `promote_from_date`, `balance_from_feed`, `trade_treatment`, `reconcile_mode`, `feed_sign`, `feed_negate_tx`. **`promote_from_date` NULL means "promote every staged row whatever its date"** — the Black Card mechanism — so since v3.6.11 mapping a bank-feed account **pins** it to the earliest row already staged (migration 043); it is still **read-only in the UI**, which is why a deliberate cutoff choice at mapping time is an open roadmap item. |
| `transactions` | Ledger (`accepted`, `transfer_matched`, `bank_feed_external_id`, `import_batch_id`, `source`) |
| `pending_transactions`, `psdata_staging`, `bankfeed_staging`, `quicken_*` (12 tables) | Staging per source |
| `bankfeed_balances` / `manual_balances` | Feed-reported / user-entered balance snapshots |
| `budget_versions`, `budget_entries`, `budget_fx_rates` | Budgeting |
| `transfer_match_groups` (+`_members`) | Manual transfer matching |
| `forecast_*` (scenarios, modules + investments/disposals/amortization, **streams + stream_changes**, entries) — a module carries `has_valuation` (no DEFAULT since migration 060) and N first-class **stream** rows (direction · fc_line_id · mode `amount`/`yield`/`pct_of_value`/`derived` · amount + `amount_usd` · growth_mult · CR046 window · CR047 tax override), each with a signed change schedule in `forecast_stream_changes`; migration 060 dropped `forecast_income_expense`, `forecast_incexp_changes`, `forecast_module_income_pct`, `forecast_module_income_steps`, the eleven `income_*`/`expense_*` columns and `expense_pct`, `forecast_assumptions` (CR039 document store — inflation/FX/tax/category/scenario periods, formerly `FCAssump.json`; migration 034), `fc_lines` (+`_categories`), `fc_ai_reviews`/`fc_ai_messages` | Forecast. `forecast_modules` also carries the sweep rank (`cash_sweep_priority`, migration 031), the CR046 stream window (`income_start_date`/`income_end_date`/`expense_start_date`/`expense_end_date`, migration 037 — NULL = unbounded; the year is stored as July 1, so the first/last year book 50%) and the CR047 income-only tax rate (`income_tax_rate_override`, migration 038 — NULL falls back to `tax_rate_override` then the scenario rate; **0 is a real rate**). **CR062** adds the loan assumptions (`loan_principal`, `loan_start_date`, `loan_end_date`, `loan_interest_rate`, migration 047, + the `forecast_module_amortization` child table of `(year, pct)` rows) and the secured-asset link (`secured_asset_module_id`, migration 048 — self-FK, `ON DELETE SET NULL`, same-scenario and non-self enforced). `forecast_assumptions` is keyed by scenario **NAME** and nothing in the schema enforces that the name resolves, so a rename is **atomic in code**: `repo.renameScenario` rewrites the row and all four documents in one transaction and `updateScenario` **throws** on a name, with migration **052** pruning the orphans left by earlier renames ([CR064](../cr/cr-064-forecast-annual-close-and-assumptions.md) P1 — a stranded document reads as **0% inflation for 36 years, silently**).. **CR064 P6** (migration **055**) gives amount-based income its own growth: `income_growth_rate` (a multiplier of inflation, read like `growth_rate` for value — NULL = 1 = grow at inflation) and `forecast_module_income_steps`, a child table of `(year, signed amount)` **permanent level changes** typed in the money of the year they happen and compounded from that year on. Both belong to the **amount** mode: recurring income has two mutually exclusive modes and **any** `forecast_module_income_pct` row switches the module to *yield* (`avg(market value) × (inflation + spread)`), which discards `income_amount`, its growth rate and its steps entirely — the editor now says so, because all six income-bearing modules in prod are in yield mode and their typed amounts are inert.. **CR064 P8** — the base-year P&L column (`GET /forecast/base-year-values` → `crud.getBaseYearValues`) sums module amounts per FC line and **converts each from its own currency** through CR051's `baseYearFxRate`; it previously summed them raw, so a PLN module's amount was read as dollars — and this figure is also the **cash sweep's opening cash** (`index.js` folds the base-year NCF into it), so the error ran the whole horizon. A currency with no rate throws rather than falling back. The Review column it feeds is labelled **`(Base Yr)`**, not `(Budget)`: `FCReview` never reads `budget_entries`. |
| `exchange_rates`, `sync_metadata`, `audit_log`, `app_data` | Config/infra |

Views: `v_balance_sheet`, `v_budget_vs_actual`. Size: ~30 MB, ~36k transactions.

### Migrations

Registry (one line per migration, 001–060): **[migrations.md](migrations.md)**. A runner exists — `server/db/migrate.js` / `npm run migrate` (CR043 Phase 1.1): `schema_migrations` ledger, apply-the-gap in per-file transactions, checksum-drift warnings, auto-baseline on first run against a populated DB; **`--accept-drift=<file>[,<file>]` (v3.9.1)** re-records the checksum for a *named* file only — never a blanket sweep, and a dry run never accepts — for the case where editing an applied migration was unavoidable (041 aborts the chain, so nothing later can repair it). Prove equivalence against the real DB first (re-run the file in a transaction and confirm it changes nothing); rule in `.claude/rules/migrations.md`; `deploy-to-production.sh` Step 2b applies pending to prod before rebuild, and **Step 2b(i) refuses the deploy when a pending file is absent from BOTH ledgers** — prod would otherwise be the first database it ever met (Known Issue #15, fixed 2026-08-05). A stopped dev stack warns and continues; `--allow-unverified-migrations` overrides deliberately. It reads the ledgers, so a file applied to dev with `psql -f` is invisible to it — apply through the runner. `initdb.d` still auto-applies `*.sql` on a fresh empty volume (the two coexist). CI proves the chain applies to an empty database via the psql loop.

---

## 8. Docker Services

| Stack | File | Containers | Ports (host) |
|-------|------|------------|--------------|
| Production | `docker-compose.yml` (project **psproject**) | fin-postgres / fin-server / fin-frontend | DB 5433 (localhost+Tailscale), API 3005, web 3006/5175 |
| Development | `docker-compose.dev.yml` | fin-postgres-dev / fin-server-dev (+ local Vite :5174) | DB 5434 (localhost+Tailscale), API 3105 |
| v4 (CR027) | `docker-compose.v4.yml` (project **finv4**) | fin-postgres-v4 / fin-server-v4 | DB 5435, API 3205; own volume, flags ON |

Notes: `POSTGRES_PASSWORD` is **required** (no default — compose fails fast; set it in `.env`). The prod data volume is pinned to the legacy name `fin_postgres_data` (see comment in `docker-compose.yml`). Prod frontend build args: `VITE_NAV_LAYOUT=sidebar`, `VITE_APP_VERSION` from `.env`.

---

## 9. Development Workflow

```bash
ssh cfbieder@192.168.1.87 && cd ~/psproject
./Scripts/dev-start.sh        # tmux: db logs / nodemon / Vite HMR / shell
```

- Frontend: instant HMR. Backend: nodemon restart. DB shell: `docker exec -it fin-postgres-dev psql -U fin -d fin`.
- Frontend env per `frontend/.env-cmdrc` (local, untracked — template `.env-cmdrc.example`): `npm run tail` (Tailscale API, recommended) / `npm run dev` / `npm run docker`.
- Deploy: `./Scripts/deploy-to-production.sh` (backs up DB, rebuilds, health-checks). A new migration goes to **dev first, through `migrate.js`** (the deploy refuses one that has never run there, and a `psql -f` apply leaves no ledger row to see); the deploy then applies it to prod at Step 2b, **before** the rebuild — schema ahead of the code that reads it. *Restoring from a deploy's own backup lands you one migration SHORT:* Step 1 dumps, Step 2b migrates, so the dump is a pre-migration snapshot (found 2026-08-05 restoring dev from the v3.14.1 backup — it came back with the four tables 060 had just dropped). Run the migrator after any such restore.
- Dual-track v3/v4: see [DEV_WORKFLOW.md](../guides/dev-workflow.md) and CR027 §Step 0.
- Month-end close (promote → neutralize → wait for the feed → MTM → re-anchor cash):
  [month-end-reconcile.md](../guides/month-end-reconcile.md). Bookkeeping first, market
  value last — an MTM absorbs any outstanding error and relabels it an unrealized gain.
- **CI:** every push/PR to `main` runs `.github/workflows/ci.yml` (backend tests on fresh DB, frontend build + Vitest + the six ratchets, Playwright e2e, secret scan). **A red run notifies nobody** — [Known Issue #12](project-roadmap.md#3-known-issues).

---

## 10. Scripts (`Scripts/`)

| Script | Purpose |
|--------|---------|
| `dev-start.sh` | tmux dev environment |
| `e2e.sh` | Throwaway Postgres + API + built bundle, then the 8 Playwright specs |
| `check-lint-debt.sh` | Ratchet: baselined ESLint warnings may only shrink |
| `check-api-envelope.sh` | Ratchet: v2 responses stay `{data}` + `Rest.unwrap()` |
| `refresh-bank-feed.sh` | Pulls the bank-feed service's latest balances/transactions |
| `deploy-to-production.sh` | Backup → rebuild → health-check deploy (`[--with-git] [--no-backup] [--allow-dirty] [--allow-unverified-migrations]`); refuses a dirty build tree, and a migration that has never run on dev |
| `sync-db-prod-to-dev.sh` | Copy prod DB to dev |
| `bump-version.sh` | patch/minor/major/X.Y.Z (edits `.env` VITE_APP_VERSION in place) |
| `rebuild-frontend.sh` | Quick frontend rebuild |
| `backup-to-remote.sh` | DB+config to 192.168.1.252 (cron every 2 days, 30-day retention) + Docker prune |
| `check-button-css.sh` | `.btn` guardrail (also `npm run lint:buttons`) — **blocking in CI** |
| `check-modal-adoption.sh` | `<Modal>` guardrail: blocks new bespoke `role="dialog"` overlays (also `npm run lint:modals`) — **blocking in CI** |
| `check-dead-tokens.sh` | Dangling-token guardrail: every `var(--x)` must resolve to a defined token (a dangling one silently falls back and ignores the theme). **No baseline — the bar is zero.** Also `npm run lint:tokens` — **blocking in CI** |
| `check-inline-hex.sh` | Naked-hex guardrail: per-file baseline of `color: "#hex"` inline styles, count may only shrink (also `npm run lint:hex`) — **blocking in CI** |
| `v4-up.sh`, `sync-db-prod-to-v4.sh` | Isolated v4 stack |
| `provision-vm.sh`, `deploy-on-vm.sh` | KVM provisioning |
| `boot-reconcile-docker.sh`, `fin-docker-reconcile.service` | Boot-time `compose up -d` on prod/dev/bank-feed stacks — fixes dockerd reboot race that leaves postgres containers detached from their networks (seen 2026-07-04); unit installed + enabled in `/etc/systemd/system/` 2026-07-05 |
| `backup-mongo.sh`, `restore-mongo.sh` | **Dead (Mongo era)** — deletion backlogged |

---

## 11. Backup & Restore

- **Automated:** `backup-to-remote.sh` via cron (`0 2 */2 * *`) → `cfbieder@192.168.1.252:~/backups/fin/` (DB dump, `.env` files, `components/data/`, `certs/`; 30-day retention; log `Backups/backup-remote.log`).
- **Local:** `Backups/` (git-ignored); deploy script auto-backs-up first. Manual: `docker exec fin-postgres pg_dump -U fin -d fin -Fc > Backups/fin_backup.dump`; restore with `pg_restore --clean --if-exists`. Full restore runbook: [../guides/restore.md](../guides/restore.md).

---

## 12. Git

- Single trunk `main` (also the prod deploy source). A local `prepare-commit-msg` hook prepends `[vX.Y.Z YYYY-MM-DD]`.
- Multi-agent git discipline (explicit-pathspec commits, no force-push, `.env` never committed): see [CLAUDE.md](../../CLAUDE.md).

---

## 13. Environment Variables

Secrets live in **untracked** files (since CR034, 2026-06-12): root `.env` (compose), `server/.env-cmdrc`, `frontend/.env-cmdrc` — templates: [`.env.example`](../../.env.example), `server/.env-cmdrc.example`, `frontend/.env-cmdrc.example`.

| Variable | Where | Purpose |
|----------|-------|---------|
| `POSTGRES_PASSWORD` | `.env` (**required**, no compose default) | DB password for the `fin` user (rotated 2026-06-12) |
| `DATABASE_URL` | derived in compose / set for scripts+tests | Server & CLI DB connection; **no embedded fallback anywhere** |
| `BANK_FEED_URL` | `.env` | bank-feed service base URL (default `http://host.docker.internal:3007`) |
| `BANK_FEED_API_KEY` | `.env` (secret) | Auth for `/v1/*`; empty disables bank-feed calls; shared with the OCME consumer |
| `LLM_GATEWAY_URL` | compose default `http://192.168.1.61:8080` | Local ocr-llm gateway for AI Review (no cloud key needed) |
| `CORS_ORIGINS` | optional | Comma-separated CORS allowlist override (defaults cover dev/prod/Tailscale — `app.js`) |
| `BANK_FEED_SYNC_MAX_AGE_MIN` | optional (default 60) | Sync-before-reconcile freshness window |
| `BANK_FEED_DEDUP_ENABLED`, `BANK_FEED_CUTOFF_ENABLED` | optional | CR022/CR023 guards |
| `NODE_ENV`, `PORT` | compose | Runtime |

Removed 2026-06-12: `PS_API_KEY`/`PS_USER_ID` (dead since CR030), `ANTHROPIC_API_KEY` (replaced by the local gateway), all `findev123` defaults.

---

## 14. Data Files (`components/data/`, mounted into the server container)

`account_names.json` / `category_names.json` (PS name mappings), `appdata.json` (metadata). `FCAssump.json` is **retired** (CR039, migration 034 — forecast assumptions live in the `forecast_assumptions` table; the file remains on disk one release as a fallback artifact, nothing reads it). COA lives in SQL (`accounts` table; `getNestedTree({section})`). Balance sheet = `opening_balance + Σ transactions` with feed read-override for `balance_from_feed` leaves (CR024); FX rates auto-refresh from Frankfurter API when >3 days stale (`server/src/utils/refreshExchangeRates.js`).

---

## 15. Quick Reference

```bash
./Scripts/dev-start.sh                               # dev env
./Scripts/deploy-to-production.sh                    # deploy
./Scripts/sync-db-prod-to-dev.sh                     # prod → dev data
./Scripts/bump-version.sh patch                      # version
docker compose ps                                    # prod status
docker compose -f docker-compose.dev.yml ps          # dev status
docker exec -it fin-postgres psql -U fin -d fin      # prod DB shell
docker exec -it fin-postgres-dev psql -U fin -d fin  # dev DB shell
cd server && npm test                                # backend tests (needs DATABASE_URL)
cd frontend && npm test && npm run build             # frontend tests + build
```

---

*Last updated: 2026-07-11 (v3.0.63 — CR043 code-structure hardening)*
