# CR043 — Code Structure & Architecture Improvement Program (2026-07-11 Review)

**Status:** 🟢 OPEN — owner decisions settled 2026-07-11 (see §Owner decisions); program approved, ready to implement, no code yet. Produced by the 2026-07-11 three-lens review. Companion CRs: [CR042](CR042_UI_LOOK_AND_FEEL.md) (UI), [CR044](CR044_PRODUCTIZATION_MARKETABILITY.md) (marketability).
**Track:** v3 — explicitly **excludes** the v4/CR027 flag work; two items (migration runner, N11; demo seed reuse noted in CR044) deliberately pull v3-safe slices forward from CR027 scope.
**Anchor in FC_NEXT_STEPS.md:** [cr043](../FC_NEXT_STEPS.md#cr043)

## Overall verdict

The macro-architecture is sound: clean SPA → Express `/api/v2` → Postgres split, a genuinely good DB layer (`v2/db/postgres.js` — lazy pool, `transaction()` helper, the DATE-as-string parser that kills a whole timezone bug class), pure well-tested algorithm kernels where it matters (`cash-sweep.js`, `fcCompareUtils`, CR037's `validate.js`), real CI on a from-migrations DB, and documentation discipline better than most professional teams'. **The biggest structural risk is the forecast engine's persistence model (N2)** — it uses `forecast_entries` as the working memory of its convergence loop with no transaction and no lock. The second-order risk: the documented debt backlog is currently *un-payable at acceptable risk* because the safety nets needed to execute it (frontend tests in CI, route tests, a migration runner) aren't in place. Hence the sequencing below: nets first, extraction second.

## New findings (not previously in FC_NEXT_STEPS)

Severity order within tiers; evidence cited as file:line at review time.

### Critical / high

- **N1 — The 117 frontend Vitest tests never run in CI.** `.github/workflows/ci.yml` has backend-tests / frontend-build (lint advisory + build only) / secret-scan — no vitest step, while `frontend/package.json` defines `"test": "vitest run"`. A PR can break all 117 and merge green. Fix: add `vitest run` to the frontend job. ~5 lines; the single highest-ROI item in this review. (S)
- **N2 — Forecast rebuild is non-transactional and unguarded against concurrency.** ✅ **FIXED 2026-07-11 (= Phase 1.3, pulled forward).** `generateForecast` now runs Steps 2–8 inside one `db.transaction()` holding `pg_advisory_xact_lock(GENERATE_LOCK_NS, scenario_id)`; all reads/writes (loaders, builders via the already-threaded `db` param, sweep, convergence loop) go through the tx client. Verified: live parity on dev "2026 Base" — **byte-identical md5** (`d3d2a746…`, 1442 entries) before/after; new DB-backed suite `generate-transaction.test.js` (3 tests: rebuild, **mid-build failure rolls back to previous entries** — fails on pre-change behavior, concurrent builds serialize); full backend suite 262/262. Side effect: engine ~4.5× faster (2.3s → 0.5s — convergence statements no longer each pay autocommit). Found in passing (not fixed): an inc/exp item mapped to the literal `Bank Accounts` account crashes the danfo category index (duplicate label) — ties into N9's magic-account work.
- **N4 — Docker socket mounted into the app container with no consumer.** `docker-compose.yml:57` mounts `/var/run/docker.sock` into fin-server; no runtime docker usage exists (backup uses `execFile('pg_dump')` with the client baked into the image). Root-equivalent host control for a compromised Express process — on the box that is also prod. Also Mongo-era `./mongo_backups` mount at `:56`. Remove both. (S)
- **N11 — No migration ledger; drift has already bitten twice.** 36 migrations apply only via `initdb.d` on fresh volumes; no `schema_migrations` table. On record: commit `4931b2a` (column on dev/prod never in a migration → CI-only failures) and `8c1823a` (dev drift, 020 re-applied). **Recommendation: pull the runner forward from CR027A** — a ~50-line "read dir, diff against `schema_migrations`, apply in order inside a transaction" script at container start is v3-safe, flag-free, and removes a standing prod-outage mechanism (manual-psql-before-deploy currently rests on human memory). (M — owner decision, touches CR027A scoping)

### Medium

- **N3 — Dead heavyweight deps in the production image.** `server/package.json` declares `@tensorflow/tfjs-node` and `arquero` with **zero imports**; `nodemon` sits in `dependencies`; root `package.json` declares only `axios`, imported nowhere. `danfojs-node` (used in 3 engine files as little more than a label-indexed 2D matrix) drags its own `@tensorflow/tfjs-node@3` — TF native binaries in the image **twice**, used for nothing ML. Drop the dead deps now (S); replace danfojs with a plain `Map` during the engine refactor to eliminate the whole TF chain (L, optional, Phase 2).
- **N7 — The documented "fetcher services" no longer exist; their SQL moved INTO routes.** `cashFlowFetcher.js`/`balanceSheetFetcher.js` are gone; `buildBalanceSheetReport` + cash-flow SQL now live inside `routes/reports.js` (629 lines, raw `db.query` throughout), same pattern at scale in `routes/forecast.js` (raw SQL at ~10 sites) and `routes/util.js` (651). The docs point refactoring effort at files that don't exist while the real SQL-in-route surface is untracked. Fix §5.1 (done in this review's doc update) and target `reports.js`/`forecast.js`/`util.js` extraction.
- **N8 — Response envelope inconsistent within single files; `rest.js` carries literal duplicate V1/V2 method pairs.** `routes/accounts.js:21` `{data}` vs `:46` raw; `js/rest.js` (617 lines) has byte-identical pairs (`fetchBalanceReport` vs `fetchBalanceReportV2`, etc.), mixed fetch styles, and 13 call sites in 10 files bypassing `Rest` with raw `fetch(`. Kill V1 aliases (S, mechanical), split per-domain, standardize the envelope route-by-route behind them.
- **N9 — The owner's personal COA is hard-coded into engine and UI.** `services/forecast/constants.js:4-12` (`"Bank Accounts"`, `"Taxes"`, `"FX - PLN"`…); SQL literals `account = 'Taxes'` inside convergence updates (`index.js:822-838`); frontend `hooks/useCoa.js:120,158-183` (`"Financial Expenses"`, `"Property - Other"`, …). Renaming any of these in COAManagement silently breaks forecast generation — no error, wrong numbers. Minimum: startup assertion that magic accounts exist (S); proper: trait/flag-driven lookup (M). Also a CR044 de-personalization blocker.
- **N10 — Validation stops at 4 of 16 route files; the biggest write surface (forecast, 26 endpoints) has none.** `validate.js` imported only by budget/bankFeed/manualCalibration/transactions; `routes/forecast.js` does ad-hoc `if (!name)` checks. Typo'd module-PUT fields are silently dropped — the exact failure class CR037 P6 was built to stop. Extend the existing whitelist helpers + test pattern. (S–M)
- **N5 — Frontend page monoliths are bigger than the documented backend ones.** `pages/QuickenImport.jsx` 1,747 · `FCReview.jsx` 1,640 · `RefreshFeeds.jsx` 1,457 · `FCModulesEdit.jsx` 1,481 · `TransActual.jsx` 1,298 · `BudgetWorksheetV2.jsx` 1,191 · `Ledger.jsx` 1,085; `pages/` totals 23k lines. This is where the mobile-duplication tax and inline-style debt originate. Add to the oversized-file register; same "split when touched, tests first" rule; `FCReview`'s extraction into `useForecastData` + `FCReviewTable` is the in-repo pattern to copy.
- **N12 — Engine error/observability contract is weak.** `generateForecast` flattens all errors to `{success:false, error: message}` (stack lost); telemetry is `console.log`; sweep audit trail written with **synchronous `fs.writeFileSync` on the request path** (`index.js:540`, `fcbuilder-module.js:74`). Dead `PATHS.ASSUMP_FILE` constant survives CR039. Throw typed errors, map in the route; async/optional audit writes; ties into the pino adopt-or-drop backlog item.

### Low / hygiene

- **N6 — `ForecastContext` is another built-never-adopted abstraction:** full provider, zero consumers (`useForecastData` won), and effectively the sole user of the `@lib` Vite alias. Delete rather than adopt.
- **N13 — Inline `require()` inside route handlers** (`routes/forecast.js:19,200,254,513,677,1195`) hides the dependency graph; hoist during the Phase-2 split (free if done then).
- **N14 — `components/` is a vestigial second package still hosting live state:** own `package.json` (no deps), dedicated `npm ci --prefix components` in the Dockerfile, while `components/data/` holds the audit trail + name-mapping JSONs. Fold the data paths under `server/` (or top-level `data/`), delete the package + Dockerfile step; do alongside the `old/` (56K) / `psAPI/` (552K) / `mongo/` debris removal — all still git-tracked.

## Verification of documented debt (FC_NEXT_STEPS §2/§4/§5)

| Documented item | Verified state 2026-07-11 | Verdict |
|---|---|---|
| `routes/forecast.js` 1,441 | 1,400 | still huge |
| `routes/budget.js` 912 | 950 | slightly worse |
| `fcbuilder-module.js` 835 | **578** (+31 uncommitted CR041) | improved — doc was stale |
| `fcbuilder-incexp.js` 436 | **271** | improved — doc was stale |
| `cashFlowFetcher.js` / `balanceSheetFetcher.js` | **deleted; SQL moved into `routes/reports.js`** | doc stale; problem inverted (N7) |
| `repositories/transactions.js` 826 | 845; `services/forecast/index.js` (895) now the biggest service file, absent from the table | slightly worse |
| `useAPI`/`useModal`/`useFormState` 0 importers | confirmed 0/0/0; **add `ForecastContext` (0)** | worse than documented |
| `LoadingSpinner` 2 importers | **1**, vs 17 files with literals | slightly worse |
| `formatCurrency` redefined in 9 files | **3** (FCModulesTable, CashFlowReport, BalanceReport) | improved — doc was stale |
| pino declared-unused / 378 `console.*` | confirmed; 383 non-test | accurate |
| 160 eslint errors, lint advisory | **163 + 25 warnings**; `continue-on-error: true` confirmed | slightly worse |
| Dead `pages/Balance.jsx`/`BudgetInput.jsx` | confirmed unrouted | accurate |
| Mobile shell: 0 imports from `features/` | confirmed | accurate |
| Route tests 2 of 16 | confirmed (`fc-lines`, `ingestBankFeed`) | accurate |
| 571 inline `style={{` | 577 | accurate |
| `@lib` alias 1 importer; `js/` = `rest.js`+`handleUpload.js` | confirmed | accurate |
| `useCoa` refetch per consumer | confirmed (plain useEffect, 3 endpoints, no cache) | accurate |
| §4.5 "Radix UI" decision | **no `@radix-ui` dependency exists** | recorded but never enacted — reconcile the decision |

## Sequenced improvement program

**Phase 0 — Safety nets & free wins (immediate; prerequisites for everything else)**

| # | Item | Size |
|---|---|---|
| 0.1 | Add `vitest run` to CI (N1) | S |
| 0.2 | Drop dead deps: `@tensorflow/tfjs-node`, `arquero`, root `axios`/`package.json`; `nodemon`→dev (N3) | S |
| 0.3 | Remove `docker.sock` + `mongo_backups` mounts (N4) | S |
| 0.4 | Delete dead code/debris: `pages/Balance.jsx`, `pages/BudgetInput.jsx`+CSS, `ForecastContext`, `useAPI`/`useModal`/`useFormState`, `DataTable.css` (unless U4 lands first), `old/`, `psAPI/`, `mongo/`, `ASSUMP_FILE` (N6/N12/N14) | S |
| 0.5 | FC_NEXT_STEPS §5.1 refresh to current reality (N7 + table above) | S |

**Phase 1 — Backend guardrails (before any extraction)**

| # | Item | Size | Depends |
|---|---|---|---|
| 1.1 | Migration runner + `schema_migrations` (N11 — owner decision to pull from CR027A) | M | — |
| 1.2 | Supertest route tests for `forecast.js` + `budget.js` against the CI Postgres (already backlogged) | M–L | — |
| 1.3 | **Transaction + advisory lock around `generateForecast`** (N2) — ✅ **DONE 2026-07-11** (pulled ahead of 1.1/1.2; see N2 for verification) | M | golden master exists |
| 1.4 | `AppError` + central error middleware + envelope decision (`{data, meta}`); extend `validate.js` to forecast writes (N8/N10). Express 5 forwards async rejections, so the 142 per-route try/catch blocks shrink as touched | M | — |

**Phase 2 — Backend extraction (depends on Phase 1)**

| # | Item | Size | Depends |
|---|---|---|---|
| 2.1 | Split `routes/forecast.js` + `routes/budget.js` into route + service; hoist inline requires (N13) | L | 1.2 |
| 2.2 | Extract report builders from `routes/reports.js`/`util.js` into services (N7) | M | 1.2 |
| 2.3 | Restructure `generateForecast` into load → compute (pure) → persist; danfojs→Map decision here; magic-account assertions or trait-driven lookup (N9/N12) | L | 1.3 |
| 2.4 | pino adopt-or-drop, riding on the error-middleware work | S–M | 1.4 |

**Phase 3 — Frontend consolidation (depends on 0.1)**

| # | Item | Size | Depends |
|---|---|---|---|
| 3.1 | Adopt **TanStack Query** incrementally, starting with `useCoa` — one decision resolves the useCoa-refetch item, obsoletes the SWR backlog entry, and provides the shared hooks mobile dedup needs | M | 0.1 |
| 3.2 | Mobile shell dedup via those shared hooks | M | 3.1 |
| 3.3 | `rest.js`: delete V1 duplicates (S), split per-domain, route the 13 raw-`fetch` call sites through it (N8); pairs with 1.4's envelope | M | 1.4 |
| 3.4 | Lint burn-down → flip `continue-on-error` off; split giant pages opportunistically when touched (N5); Forecast inline-style migration (with CR042 U1) | M–L | ongoing |

**Phase 4 — Longer horizon**

- TypeScript migration utilities-first (L) — materially cheaper after 3.1/3.3 shrink the surface.
- Playwright smoke over the 3–4 money paths (M) — the only e2e gap left once Phases 0–1 land.
- Report-page consolidation is CR042 U5 (owner decision).

**Testing ROI order:** (a) CI vitest step (free); (b) supertest on `forecast.js`/`budget.js` writes; (c) golden-master engine fixture extending `e2e-engine.test.js` (protects 1.3/2.3); (d) Playwright last.

## Owner decisions (settled 2026-07-11 via /question)

1. **Migration runner pulled forward from CR027A into v3 (N11): APPROVED.** Build the simple runner (`schema_migrations` ledger + apply-in-order-in-transaction at container start) as Phase 1.1; CR027A consumes it instead of building it. Update CR027A scoping accordingly when that work starts.
2. **TanStack Query (3.1): APPROVED.** Migrate `useCoa` first, then build the shared report hooks on it for the mobile dedup. Retires the hand-rolled-cache and SWR backlog entries.
3. **Radix decision reconciled: selective adoption** — behavioral primitives only (Dialog/DropdownMenu/Select) for CR042 U4's `<Modal>`; `<DataTable>` stays hand-rolled. §4.5's blanket "component library: Radix" entry is superseded by this narrower reading.

## Model guidance per item (owner-requested, 2026-07-11)

Most of this program is well-specified execution — **Opus-safe**: all of Phase 0, 1.1 (migration runner), 1.2 (route tests), 1.4 (AppError/envelope/validation), 2.1/2.2 (route→service extraction, with 1.2's tests as the net), 2.4 (pino), and all of Phase 3 (TanStack Query, mobile dedup, rest.js, lint burn-down).

**Fable-recommended** (money-producing code with byte-parity stakes, or cross-cutting judgment): ~~1.3 (engine transaction+lock)~~ — done by Fable 2026-07-11; **2.3** (generateForecast restructure into load→compute→persist + danfojs→Map + N9 magic-account de-hardcoding) — must hold md5 parity on real scenarios; and any mid-flight judgment calls the CR042 U5 IA consolidation surfaces. Cheaper alternative for borderline diffs: implement on Opus, then a high-effort `/code-review` pass on engine-touching changes before release.

## Out of scope

All v4/CR027 flag work (tenancy, auth, schema-per-tenant); UI look & feel (CR042); publishing/productization (CR044); the bank-feed microservice's internal structure (separate repo).
