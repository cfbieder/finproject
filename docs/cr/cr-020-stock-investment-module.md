**Status:** OPEN — Planning (skeleton) · Depends on CR019 (Quicken Import)

# CR020 — Stock Investment Module

A supplementary module that tracks individual stock holdings (lot-level), reconciles against the existing cash ledger, and provides portfolio analytics. Does **not** replace the cash ledger — augments it with share-level detail the current system lacks.

This CR depends on CR019 (Quicken Import) shipping first. CR019 owns the schema below and the Quicken-side ingestion. CR020 owns everything else: UI, analytics, price feed, ongoing Fidelity ingestion, and forecast-module integration.

---

## 1. Background & Motivation

Today the system tracks investment accounts (Fidelity Stock, CVC Investments, etc.) only as **USD aggregates** in the COA. Brokerage trades are recorded as cash-for-shares "neutralize" pairs in `transactions`, categorized as `Transfer - Securities Trades`. No share count, no cost basis, no per-security history.

Gaps this causes:

- No realized / unrealized gain/loss visibility per security
- No allocation analysis (sector, asset class, concentration)
- No performance measurement (TWRR, MWRR, benchmark comparison)
- No tax-aware tooling (wash sale detection, lot picker, harvest candidates)
- Forecast module's `Market Value` field is hand-entered, never reconciled against actual lots

The user's holdings are ~99% at Fidelity, 100% USD/US-market — simplifies the design considerably (no FX in the portfolio).

## 2. Goal

Track every share the user owns, with full lot-level history back to account opening, and surface portfolio analytics that aren't possible from the cash ledger alone.

**Non-goals:**

- Replacing or restructuring `transactions` / `accounts` / the existing balance sheet flow
- Building a trading interface (read-only analytics, not order entry)
- Real-time intraday pricing (nightly close is sufficient)
- Multi-currency portfolio support in v1 (deferred until needed)

## 3. Scope

### In scope

- Portfolio overview page with current holdings, allocation, unrealized G/L
- Per-security detail page (lots, transactions, dividends, price chart)
- Activity log across all securities with filters
- Analytics dashboard (performance, tax, income)
- Tradier price feed integration (nightly cron)
- Fidelity CSV importers (Positions, Activity, Closed Lots)
- Reconciliation page: lots × price vs Fidelity Positions report
- Integration hooks for forecast module's Market Value / yield inputs

### Out of scope (explicit)

- Schema and table DDL → owned by CR019
- Quicken QIF investment-action parsing → owned by CR019
- Crypto support
- Options / derivatives
- Non-USD securities (PLN/EUR-listed)
- Order entry / brokerage actions
- Mobile-specific UI (responsive desktop is fine for v1)

### Dependency on CR019

The Quicken import CR creates and populates these tables. CR020 reads from them and adds Fidelity-side writers and a UI layer. **CR020 assumes CR019 has shipped with the schema below intact.** If CR019 deviates, CR020 must be re-scoped before starting.

### Coexistence with pre-existing manual mark-to-market entries

Today, brokerage account historical valuation in this system relies on user-entered monthly mark-to-market `transactions` rows against a holding-value account, with `opening_balance` calibrated to current market value. CR019 explicitly does **not** create MTM rows for the pre-2022 period — it leaves historical valuation to lot-based math (`SUM(open_lots × close_price_at_date)`).

This creates a temporary behavior fork CR020 must handle:

- **Pre-handoff date** (before each brokerage account's `handoff_marker` date): valuation via `SUM(open_lots × close_price_at_date)`.
- **Post-handoff date** (from handoff to today): valuation via existing `opening_balance + SUM(transactions)` against manual MTM rows.

CR020 Phase F resolves the fork by **deprecating the manual MTM entries**: removes them, re-calibrates `opening_balance` for brokerage accounts against today's lot-based total, and switches Balance Trends + Forecast consumers to the lot-based path for all dates. After Phase F, brokerage valuation has one regime end-to-end.

---

## 4. Data Model (owned by CR019, referenced here)

| Table | Purpose | Key columns |
|-------|---------|-------------|
| `securities` | Master list per instrument | `ticker`, `name`, `asset_class` (stock/etf/bond/mf), `currency` (default USD), `sector`, `country`, `exchange` |
| `security_source_mappings` | External name → security_id (mirrors `account_source_mappings`) | `source` (quicken/fidelity/manual), `external_name`, `security_id`, UNIQUE(source, external_name) |
| `security_lots` | Open lots from imports | `security_id`, `account_id` (→ existing BS account), `acquired_date`, `shares`, `cost_per_share`, `cost_total`, `status` (open/closed), `source` (quicken/fidelity/manual), `handoff_marker` (bool — flags lots at the Quicken→Fidelity boundary) |
| `security_transactions` | Buy/Sell/Div/Split/etc. events | `security_id`, `account_id`, `tx_date`, `tx_type` (enum: BUY/SELL/DIVIDEND/DIVIDEND_REINVEST/SPLIT/TRANSFER_IN/TRANSFER_OUT/INTEREST/MISC), `shares`, `price`, `fees`, `gross_amount`, `cash_transaction_id` (nullable, → `transactions.id`), `source` |
| `security_lot_disposals` | Sells matched to lots | `lot_id`, `tx_id`, `shares_sold`, `proceeds`, `cost_basis_sold`, `realized_gain`, `holding_period_days` |
| `security_prices` | Daily close history | `security_id`, `price_date`, `close`, `currency`, `source` (tradier/quicken/manual), UNIQUE(security_id, price_date) |

### Index recommendations (for CR019 to implement)

- `security_lots(security_id, status)` — frequent "open lots for security X" query
- `security_lots(account_id, status)` — account-scoped views
- `security_transactions(tx_date)` — date-range activity scans
- `security_transactions(security_id, tx_date)` — per-security history
- `security_prices(security_id, price_date DESC)` — latest-price lookup
- `security_source_mappings(source, external_name)` — import-time resolution

### Enum: `security_tx_type`

`BUY | SELL | DIVIDEND | DIVIDEND_REINVEST | SPLIT | TRANSFER_IN | TRANSFER_OUT | INTEREST | MISC`

CR019 creates this enum. New types can be added in later migrations.

### `source` column conventions (across CR019 + CR020 writers)

| Table | Possible `source` values |
|-------|--------------------------|
| `securities` | `quicken` (master block parse), `fidelity` (auto-created from Activity CSV), `manual` |
| `security_source_mappings` | `quicken`, `fidelity`, `manual` |
| `security_lots` | `quicken` (Quicken backfill), `fidelity` (Fidelity Closed Lots import), `manual` |
| `security_transactions` | `quicken`, `fidelity-import`, `manual` |
| `security_prices` | `quicken` (price-block backfill), `tradier` (nightly cron), `manual` |
| `security_lot_disposals` | inherits `source` from parent lot |

### `import_batch_id` on security tables

CR019 owns rollback for Quicken imports. CR020's Fidelity importers should reuse the same pattern: add `import_batch_id UUID NULL` to `security_lots`, `security_transactions`, `security_prices`, and `security_lot_disposals`. CR019 ideally adds the column when it creates these tables; if not, CR020's migration adds it. Manual entries leave `import_batch_id` NULL.

---

## 5. Workflow

### 5.1 Import path (steady state, post-CR019)

1. **Quicken backfill** (one-time, CR019) — full history through Quicken's last export date populates lots + transactions + price history. `handoff_marker=true` on the open lots as of last Quicken date.
2. **Fidelity ongoing** (CR020) — user downloads Fidelity CSVs (~weekly), uploads via UI, importer dedupes against existing data and stages new transactions for review.
3. **Tradier nightly** (CR020) — cron job fetches latest close prices for all `securities` with open lots and any security referenced in the last 30 days of transactions.
4. **Reconciliation** (CR020) — Fidelity Positions CSV upload compares computed (lots × price) vs reported; mismatches trigger review queue.

### 5.2 Fidelity CSV formats (CR020 implements)

| CSV | Purpose | Frequency |
|-----|---------|-----------|
| Positions | Reconciliation snapshot of current holdings | On-demand |
| Activity | Buys, sells, dividends, splits, reinvestments | Weekly-ish |
| Closed Lots / Realized Gain & Loss | Lot-level disposal detail for tax | Annual minimum, quarterly preferred |

Each CSV uploaded gets staged in `psdata_staging` (or a new `securities_staging` table), parsed, matched against existing `security_transactions` by date+shares+ticker, and presented for accept/reject in a pending-review UI.

### 5.3 Cash-leg linking

For buys and sells, the cash leg is already in `transactions` (categorized `Transfer - Securities Trades` via the existing Neutralize flow). The importer attempts to match `security_transactions` → `transactions` by:

1. Same account, same date
2. `transactions.base_amount` matches `security_transactions.gross_amount` within $0.50
3. Single best match wins; ambiguous matches stage for manual link

Unmatched share-side events flag a "no cash leg" warning. Unmatched cash-side `Transfer - Securities Trades` rows flag a "no share leg" warning. Both surface on a reconciliation page.

---

## 6. UI Pages

| Route | Page | Description |
|-------|------|-------------|
| `/portfolio` | `PortfolioOverview` | Holdings table, allocation pie, top-line KPIs (total value, total cost, unrealized G/L %, YTD return) |
| `/portfolio/security/:ticker` | `SecurityDetail` | Lots table, transaction history, dividend history, price chart |
| `/portfolio/activity` | `PortfolioActivity` | All `security_transactions` with filters (date range, ticker, type, account) |
| `/portfolio/analytics` | `PortfolioAnalytics` | Performance, tax, income dashboards (see Section 7) |
| `/portfolio/import` | `PortfolioImport` | Fidelity CSV upload + review queue |
| `/portfolio/reconcile` | `PortfolioReconcile` | Three views: (a) lots × price vs Fidelity Positions diff, (b) unmatched cash legs vs unmatched share-side events, (c) **handoff verification** — lots flagged `handoff_marker=true` vs Fidelity's earliest known positions for the same account (catches drift at the Quicken→Fidelity boundary) |
| `/portfolio/securities` | `SecurityMaster` | Manage `securities` and `security_source_mappings`; edit sector/exchange/country fields Quicken doesn't provide; **edit lots** — manual cost-basis adjustments (e.g. for CR019's `RtrnCap` follow-up workflow) write to `security_lots` with audit trail in `audit_log` |

Mobile shell (`/m/*`) gets a single read-only holdings card in v1, full mobile UI deferred.

---

## 7. Analytics

Five buckets. v1 ships buckets 1–3; v2 adds 4–5.

### 7.1 Position-level (v1)

- Unrealized G/L (absolute + %)
- Realized G/L YTD / all-time / by tax year
  - **Pre-handoff data sourcing:** CR019 collapses pre-2022 realized gains (CGShort, CGLong, CGMid, ReinvLg income side) into a single "Realized Gain (Historical)" P&L leaf in `transactions` — no per-security attribution, no ST/LT split, no `security_lot_disposals` rows. CR020 reports pre-handoff realized G/L from that leaf only (aggregate totals by year). Per-security and ST/LT-split realized G/L analytics apply to **post-handoff data only**, sourced from `security_lot_disposals`.
- Holding period — flag lots crossing into LTCG (≥ 366 days)
- Yield on cost vs current yield (TTM dividends / cost vs market)
- Share count history (DRIP, splits visible)

### 7.2 Portfolio composition (v1)

- Allocation: asset class, sector, account
  - **Asset class** is populated by CR019 from QIF `!Type:Security` blocks (`T` tag). Sector, country, exchange are **not** in Quicken data. v1 backfill is manual via the SecurityMaster admin page; later phases may add a free-API enrichment (Finnhub, Yahoo metadata) — see Open Question #8.
- Concentration: top-N positions as % of total
- Cash drag: USD cash in investment accounts vs invested
- Sector heatmap (optional; depends on sector backfill being substantially complete)

### 7.3 Performance (v1)

- TWRR — time-weighted return, chained sub-periods between cash flows
  - **Sparse-price regime:** CR019's price backfill is ~monthly density per security (Quicken stores prices at the cadence the user clicked "download quotes" — observed ~384K rows / 667 securities / 27 years ≈ monthly average). Daily TWRR isn't computable pre-handoff. Design:
    - **Pre-handoff:** monthly sub-period TWRR using nearest price within ±15 days.
    - **Post-handoff:** daily sub-period TWRR using Tradier-fed daily closes.
    - **Cross-handoff:** the period containing the handoff date is treated as a single sub-period regardless of granularity.
  - Backfill enrichment via Tradier `/markets/history` for major holdings is allowed but optional — Tradier's free history is sufficient for SPY/major ETFs and most large caps back ~20 years.
- MWRR / IRR — money-weighted (XIRR equivalent); insensitive to price-data granularity since it uses cash flow dates and current value only.
- Benchmark comparison: SPY default, user-configurable. Benchmark prices fetched from Tradier daily; pre-Tradier-coverage period uses monthly closes (interpolated linearly between months) acknowledged as approximation.
- Drawdown curve (peak-to-trough) — granularity follows the TWRR regime.
- Rolling 30/90/365-day volatility — **post-handoff only** (pre-handoff monthly data is too sparse for meaningful daily-return stdev).

### 7.4 Tax-aware (v2)

- ST vs LT realized split
- Wash sale detection (loss + same security ±30 days)
- Tax-loss harvest candidates (positions with unrealized losses, optional filter for near ST→LT crossover)
- "What if I sell" lot picker (FIFO / LIFO / HIFO / specific-ID)

### 7.5 Income (v2)

- Dividend history by month / quarter / year
- TTM yield projection
- Upcoming ex-dividend calendar (if Tradier exposes it; if not, skip)

---

## 8. Price Feed — Tradier

- User has a Tradier account; market-data tier (~$10/mo) for real-time, sandbox tier for delayed
- Endpoints used:
  - `GET /v1/markets/quotes` — current price (batch ≤500 symbols)
  - `GET /v1/markets/history` — daily OHLCV bars, arbitrary date range — used for backfill and gap-fill
- Auth: bearer token in `.env`
- Cron job: nightly at 22:00 ET (after market close), fetches latest close for every ticker in `securities` with open lots OR transactions in last 30 days
- Failure handling: log to `audit_log`, fall back to last known price; show staleness badge in UI if last price > 3 trading days old
- Manual entry path remains for any security Tradier doesn't cover (private holdings, delisted, etc.)

---

## 9. Integration with existing system

### 9.1 Forecast module (CR003)

- BS module `Market Value` field gains an "Auto from holdings" toggle. When on, value = `SUM(open_lots.shares × latest_price)` for lots in that module's `account_id`. Read-only.
- BS module `Yield Spread` schedule can be seeded from TTM dividend yield with a one-click "Seed from holdings" action.
- No engine changes — forecast still operates on USD aggregates.
- **Manual MTM deprecation (Phase F):** once auto-from-holdings is shipped and verified, the user's monthly mark-to-market `transactions` rows against brokerage accounts become redundant. Phase F deletes them and re-anchors `opening_balance` against today's lot-based total. Forecast `Base Year` / `Last Actual Year` brokerage values pull from lots instead of the manual MTM ledger.

### 9.2 Balance Trends report (CR018)

- Add optional "By Security" toggle when a single investment account is selected: drills the row into per-security lines using lots × historical price per period end.
- **Brokerage row valuation source** follows the regime fork (§3): pre-handoff = lots × price; post-handoff = `opening_balance + SUM(transactions)`; after Phase F = lots × price end-to-end. Period-end queries must check the period-end date against each account's `handoff_marker` cutover.

### 9.3 Neutralize flow (existing)

- Unchanged. The Fidelity Activity importer creates `security_transactions` and attempts to link to the existing neutralized cash legs. If a user manually Neutralizes without a corresponding security event, reconciliation flags it.

### 9.4 PocketSmith refresh

- No interaction. Cash side stays in `transactions` as today.

---

## 10. Implementation Phases

| Phase | Scope | Effort |
|-------|-------|--------|
| **A — Foundation** | Verify CR019 schema is in place; build read-only Portfolio Overview reading the Quicken-imported data; allocation pie; unrealized G/L; SecurityMaster admin page (incl. lot edit for RtrnCap follow-ups). | S |
| **B — Price feed** | Tradier client, nightly cron, manual override path, staleness handling. | S |
| **C — Fidelity ingestion** | Three CSV parsers (Positions / Activity / Closed Lots), staging, review queue UI, cash-leg matcher, lots × price reconciliation, **handoff verification** view at the Quicken→Fidelity boundary. | M |
| **D — Performance analytics** | TWRR (split regime: monthly pre-handoff, daily post-handoff), MWRR, benchmark, drawdown, volatility (post-handoff only). | M |
| **E — Tax + income analytics** | Wash sale, harvest candidates, lot picker, dividend history. | M |
| **F — Forecast integration + MTM deprecation** | Market Value auto-toggle, yield seeding, Balance Trends drill. **Plus:** one-time migration deleting manual MTM `transactions` rows against brokerage accounts and re-calibrating `opening_balance` to lot-based total. Unifies brokerage valuation regime end-to-end. | M |
| **G — Sector enrichment** | Optional: automated sector/exchange/country backfill via free metadata API. Manual admin entry still supported. | S |

Phases B and C can ship in either order. D and E depend on A and C. F depends on A and B. G is independent and optional.

---

## 11. Open Questions

1. **Securities staging table** — reuse `psdata_staging` (generic) or new `securities_staging`? Leaning toward new — different shape, simpler queries.
2. **Lot accounting default for ambiguous sells** — FIFO (IRS default) or HIFO (tax-minimizing)? Recommend FIFO; allow per-sell override in the lot picker.
3. **Benchmark configuration** — single global benchmark or per-portfolio-view? Probably single (SPY) for v1.
4. ~~**TWRR period granularity**~~ — *resolved by CR019 review.* Split regime: monthly sub-periods pre-handoff (Quicken price density), daily post-handoff (Tradier daily closes). See §7.3.
5. **Fidelity CSV column drift** — Fidelity has changed export columns historically. Pin to schema-version detection or fail-fast on unknown columns?
6. **Should the reconciliation page block** new imports if there's an open mismatch, or warn-and-allow? Recommend warn-and-allow with a count badge.
7. **Securities admin page access control** — anyone or admin-only? Project has no auth today, so moot for v1.
8. **Sector/exchange/country backfill source** — manual only (v1 Phase A), or automate via free metadata API (Phase G)? Free options: Finnhub (limited free tier), Yahoo Finance metadata scrape (fragile). Manual is fine for ~hundreds of securities; Phase G is optional polish.
9. **MTM deprecation cutover (Phase F)** — single global cutover, or per-account? Per-account is safer (smaller blast radius) but more user steps. Recommend single global with a clear "before / after" diff and rollback plan.
10. **Handoff drift tolerance** — when verifying Quicken-final lots vs Fidelity-earliest positions, how much disagreement before failing vs warning? Recommend $0.50 / share difference at security level surfaces as warning; >5% as blocker.
11. **Lot edit audit trail** — write to `audit_log` (existing JSONB) or new `security_lot_audit` table? Existing `audit_log` is simpler but harder to query. Recommend `audit_log` for v1.
12. **Phase F scope decision** — does the user want manual-MTM deprecation in CR020, or kept indefinitely as a parallel regime? Keeping it indefinitely shrinks Phase F from M to S (just the auto-MV toggle + yield seeding) and accepts permanent dual-path valuation. Unifying via Phase F is cleaner long-term but requires a one-time `opening_balance` re-calibration migration with rollback. Recommend unify (current §10 plan); flagging because the answer changes phase sizing.

---

## 12. Test Strategy

### Backend

- Unit tests for each Fidelity CSV parser against a fixture file per format
- Unit tests for cash-leg matcher (exact match, near match, no match, ambiguous)
- Unit tests for TWRR / MWRR / drawdown calculators against known-good reference values
- Integration test: full import flow (Quicken-style fixture + Fidelity CSV fixture) → expected lots and disposals
- Tradier client tests with mocked HTTP

### Frontend

- Vitest unit tests for analytics helpers (allocation %, concentration, yield calc)
- Component tests for PortfolioOverview rendering with fixture data
- Snapshot tests for SecurityDetail price chart

### Manual QA

Documented per-phase checklist (mirrors CR018 style).

---

## 13. Follow-ups / Deferred

- Crypto (`asset_class='crypto'`, no Tradier coverage)
- Options / derivatives
- Non-USD securities — would need FX layer on cost basis and price
- Real-time intraday pricing
- Multi-user / shared portfolios
- Mobile-specific portfolio UI
- Order entry / rebalancing recommendations
- AI-assisted portfolio review (mirroring `fc_ai_reviews` pattern)

---

## 14. Coordination with CR019

CR019 (drafted 2026-05-21) commits to all seven schema items this CR originally requested:

| Original ask | Confirmed in CR019 |
|---|---|
| 1. Six tables + indexes | §4.2 |
| 2. `security_tx_type` enum | §4.2 |
| 3. `security_source_mappings` populated with `source='quicken'` | §11.2 + §6.2 |
| 4. `handoff_marker` set on lots open at last Quicken date per account | §6.4 step 6 |
| 5. Link Quicken Buy/Sell to cash side via `cash_transaction_id` | §6.4 steps 1–2 + §5.3 |
| 6. Preserve Quicken's specific-lot ID; FIFO default | §6.4 step 5 |
| 7. Backfill `security_prices` from Quicken price history | §5.5 + §6.4 step 7 |

CR019 also delivers two bonuses CR020 didn't ask for but benefits from:

- **Pre-populated `securities` master** — 667 securities seeded directly from `!Type:Security` blocks; eliminates almost all manual entry in Phase A.
- **27 years of price history** — 384K rows in `security_prices` covering 1998–present at ~monthly density. Eliminates one-time backfill effort and enables historical TWRR / dividend yield computations from day one.

### New asks of CR019 raised during this review

These are not in CR019's current draft. They're small, but worth confirming before CR019 starts implementation:

1. **`import_batch_id` on `security_*` tables** — CR019's rollback path (§6.5) deletes by `(source='quicken' AND import_batch_id)`, but only `transactions` carries `import_batch_id` per CR019's current draft. Adding the same column to `security_lots`, `security_transactions`, `security_prices`, `security_lot_disposals` keeps rollback clean and lets CR020's Fidelity importers reuse the pattern. Trivial DDL addition.
2. **Confirm `source` column exists on every CR020-shared table** — CR020 §4 documents the planned values. CR019 should ensure the column is `NOT NULL` with a reasonable default (`'manual'`?) on all six.
3. **Confirm `handoff_marker` recompute on re-promote** — CR019 Open Q #10 flags re-run behavior. CR020 depends on the marker being accurate when re-runs happen (e.g., user finds another Quicken file later). Pin "re-promote recomputes `handoff_marker` per account" as the resolution.
4. **Internal inconsistency in CR019:** §6.4 step 8 says calibration "leaves `opening_balance_date` at `'2000-01-01'`", but §9 says migration 022 lowers it to `'1990-01-01'`. Doc bug, not a schema issue — flagging for CR019 author to fix.
5. **Duplicate `§5.5` heading in CR019** — both "Price blocks" and "Reconciliation outputs at parse time" are numbered 5.5. Pure formatting bug; the second one should be 5.6. Flagging for CR019 author to fix.

### Behaviors CR020 inherits from CR019 (not optional, embedded in the design)

- Pre-handoff realized G/L analytics are aggregate-only — single "Realized Gain (Historical)" P&L leaf, no ST/LT split, no per-security attribution. §7.1 reflects this.
- Pre-handoff options activity (~540 trades) exists in P&L only ("Options Trading" leaf) — no lot data. CR020 analytics ignore it; CR020 §3 already excludes options anyway.
- Pre-handoff `RtrnCap` (rare, 2× in 27 years) creates a `MISC` `security_transactions` row with a reconciliation warning. CR020 Phase A must provide the manual lot edit UI to action this — captured in §6.

---

## 15. Update history

- **2026-05-21** — Initial planning skeleton.
- **2026-05-21** — Revision after CR019 review. Added: pre/post-handoff valuation regime (§3), `source` + `import_batch_id` conventions (§4), handoff-verification view + lot edit UI (§6), pre-handoff realized-G/L sourcing caveat (§7.1), sector backfill caveat (§7.2), TWRR split-regime design (§7.3), manual MTM deprecation as Phase F (§9.1, §10), Balance Trends regime fork (§9.2), new Phase G for sector enrichment (§10), five new open questions (§11 #8–12), reframed §14 from "asks" to "coordination" (CR019 already commits to all original asks; added five small new asks + four inherited behaviors).
