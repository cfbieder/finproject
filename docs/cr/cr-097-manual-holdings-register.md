# CR097 — A holdings register for manually valued accounts — IN-PROGRESS

**Status:** IN-PROGRESS — **P1a SHIPPED v3.75.0 (2026-10-14)** (migration 083, `services/manualHoldings.js`, `/api/v2/manual-holdings`, page `/investments/holdings/:accountId`). P1b (replay, non-USD accounts) and P2 (Investments page) open. Started ahead of CR064 by owner choice. Rev 3 design: pass 1 *revise* → rev 2; pass 2 *revise* → rev 3, GO (§10) · **Track:** v3 · **Migration:** one (number claimed at build time, not now)
**Planned users:** Misc Investments only, for now; others possibly later (owner, 2026-10-14) — hence P1a restricts the **account** to USD. **Holdings** in EUR, GBP, USD and PLN are P1a from day one (owner requirement, 2026-10-14); the account-currency limit is the only thing deferred. **P1b candidates** (owner wants them, kept in P1b by owner choice 2026-10-14; non-fed on prod): PKO TFI (209, PLN), United Beverages (43), Barkeria (44), OCME (45), CVC - MIP (49) — PLN; CVC Fund VIII/IX (33/34) — EUR; PKO - Deposits (21, PLN, see §9). Fed accounts (PKO, PKO Savings, Santander, Revolut, Wise, Caixa) are ineligible.
**Builds on:** [CR033](cr-033-manual-calibration.md) (manual MTM reconcile), [CR061](cr-061-holdings-and-prices.md) (position tables), [CR090](cr-090-investments-section.md) (the Investments page)
**Roadmap anchor:** [project-roadmap.md#cr097](../current/project-roadmap.md#cr097)

## 1. The problem, measured

Some balance-sheet accounts are a bag of small investments that no feed reports: crowdfunded
private companies, convertibles that have not yet converted, a few foreign shares. Fin knows each
such account as **one number**, with no view of what is inside it and no record of how its value
moved.

The specimen is **Misc Investments** (id 50, parent *US - Investments*, USD), measured on prod
2026-10-14:

| Fact | Value |
|---|---|
| `manual_reconcile_mode` | `calibrate` — so no gain or loss has ever been booked |
| `opening_balance` | 0.00 |
| Transactions, all time | 4, summing **$4,875.08** — every one a contribution (Oct-25 FitnessGenes $1,412.19 · Jun-7 $2,694.59 · Sep-30 Republic $208.00 · Oct-12 $560.30); two are `auto-offset` rows |
| Unrealized G/L rows | 0 |

So the ledger balance is **pure cost**. One platform page the owner shared (2026-10-14) shows part
of what that cost bought, all in GBP:

| Holding | Invested | Shares | Price | Kind |
|---|---|---|---|---|
| Altilium | £514.47 | — | — | amount-only (not yet converted) |
| Minima | £1,000.00 | — | — | amount-only |
| Athena AI | £522.56 | 23 | £22.72 | units |
| Sixteen44 | £400.14 | 1,053 | £0.38 | units |
| **Σ** | **£2,437.17** ≈ **$3,228** at 1.3246 (GBP rate 2026-10-14) | | | |

⚠️ *Inference, not measured:* $3,228 + FitnessGenes $1,412 + Republic $208 = $4,848, within $27 of
the ledger, which points to the Jun-7 + Oct-12 transfers ($3,254.89) funding the GBP holdings,
the gap being FX and fees. Confirm with the owner when the register is first populated.

Three properties of this asset class shape the design:

1. **Not every holding has units.** Two of four show no shares or price — advance subscriptions
   that become shares at the next round. `value = qty × price` does not apply to them.
2. **Cost is reported as a total.** £400.14 / 1,053 = 0.38 rounded; the unit price cannot
   reproduce the total. The total is the fact; the unit cost is derived.
3. **Prices move only on events** (a funding round, an exit, a failure), so most months the change
   in USD value is **pure FX** (GBP/USD), and price moves are rare, large, and usually downward.

## 2. What it should do

Any balance-sheet account with **no bank feed** can opt into a **holdings register**: a list of
holdings, each in its own currency, revalued by dated **valuations**. Saving a valuation dated *d*,
in **one database transaction**:

1. writes a position snapshot for *d* (`source = 'manual'`);
2. sets the account's `manual_balances` row for *d* to **Σ value in account currency**;
3. books the CR033 `mtm` row **on *d* itself** (`bookDate = d`, *owner decision 2026-10-14*) —
   `entered − computed` to **Unrealized G/L** (category 88, `source = 'mtm'`);
4. *(P1b)* **replays** the `mtm` row of every later valuation date in ascending order (§5.3). In
   P1a only the latest valuation can be saved over or deleted, so there is nothing to replay.

Any failure — a missing FX rate, the 15% guard without `force`, a cost gap over the threshold, a
stale preview — rolls back all four. Nothing is half-saved.

The ledger keeps **one** Unrealized G/L number per valuation. The register explains it as
**price effect + FX effect + unreconciled cost** (§4.3–§4.4), which sum to the booked row exactly.

## 3. Non-goals (v1)

- **No lots, no realized gain.** Under MTM a sale is a reversal of prior unrealized gain; the ledger
  will not carry a separate realized figure. If a realized number is needed for tax (Belka), that is
  the trigger for lots, and `security_lots` (022, unused) is where they go — a later CR.
- **No split of category 88** into price vs FX in the ledger. Category 88 is resolved **by name**
  in reports, budget-LE and the net-worth bridge; a second category would touch all of them for a
  display distinction.
- **No quotes.** Fintable quotes cover US tickers only; none of the specimen's holdings is quotable.
  Prices are typed, and manual securities are kept out of the quote machinery (§4.1).
- **No fed accounts.** An account with an active bank-feed mapping already gets positions from the
  feed; two sources for one account's positions is the conflict CR061 was built to avoid.
- **No change to the X-ray.** Every X-ray reader filters `source = 'bank-feed'`: `exposure.js:35`,
  `risk.js:239`, `income.js:350`, `securityChart.js:368/439/456`, `marketPrices.js:270`,
  `investments.js` (module constant `SOURCE`, line 27), `Scripts/classify-funds.js:87/103`,
  `Scripts/load-equity-sectors.js:113`. The one unfiltered reader, `investments.accountHistory`
  (`investments.js:405-430`), would show manual snapshots — harmless, and wanted in P2.
- **Currencies limited to what `exchange_rates` carries** — EUR, GBP, PLN on prod today. A CHF or
  SEK holding cannot be entered until a rate source exists for it.

## 4. Model

### 4.1 The register (new table) — what persists between valuations

`manual_holdings` — one row per holding per account, `UNIQUE (account_id, security_id)`:

| Column | Notes |
|---|---|
| `account_id` | FK accounts; the account must have `manual_holdings_enabled` |
| `security_id` | FK `securities` (name, currency, `asset_class`) |
| `platform` | free text group, e.g. *Republic Europe* — subtotals and per-platform tie-out |
| `kind` | `units` \| `amount` |
| `status` | `active` \| `exited` \| `failed` |
| `acquired_on` | DATE — drives the default purchase FX |
| `quantity` | NULL for `amount` |
| `cost_local` | total invested in the holding's currency (the platform's "Investment made") |
| `cost_acct` | total cost in the **account's** currency; defaults to `cost_local × rate(acquired_on)`, overridable with the amount actually sent (fees included) |
| `cost_acct_source` | `fx_default` \| `entered` |
| `proceeds_acct` | exit proceeds in account currency; NULL unless `status = 'exited'` (§4.4) |
| `note` | |

**Manual `securities` rows are kept out of the feed and quote paths:** `ticker = NULL` (an exchange
symbol goes in `exchange` / a note — `ticker` is UNIQUE, and `ingestHoldings.js:110-121` inserts
any `^[A-Z]{1,5}$` feed symbol as a ticker, so a manual `ATH` would one day fail the feed's
ingest), `price_basis = NULL` (quote eligibility is gated on `price_basis = 'per_share'`,
`marketPrices.js:117-131`, not on `asset_class`), `classification_source = 'manual'`.
`asset_class` gains **`private`** as a display bucket for private-company shares and unconverted
subscriptions; it drives labels and exposure buckets only.

Cash held on a platform is a holding: a `securities` row with `asset_class = 'cash'` per
platform × currency, `kind = 'amount'`. Without it, uninvested cash surfaces as "gain".

A **buy into an existing holding** edits `quantity` and adds to both cost columns (average cost).
A **failure** sets `status = 'failed'`; it is valued at 0 from then on. An **exit** sets
`status = 'exited'`, value 0, and records `proceeds_acct` — the proceeds arrive as an ordinary
ledger transaction, or as a platform-cash holding if left on the platform.

### 4.2 A valuation — reuses the CR061 snapshot tables

One `security_position_snapshots` row (`source = 'manual'`, `status = 'fetched'`,
`polled_on = valued_on = d` — for a typed valuation the date **is** stated, unlike the feed's), plus
one `security_positions` row per holding valued, with `price_source = 'manual'`.
`UNIQUE (account_id, polled_on, source)` makes re-saving a day a replace.

**Currency.** `security_positions` already carries `currency`, and every existing row is USD with
`quantity × price = market_value` (075 note 5). The register keeps that meaning intact:
`price`, `market_value` and `currency` are in the **account** currency, and three new nullable
columns carry the holding's own: **`price_local`, `market_value_local`, `fx_rate`** (local
currency = `securities.currency`). Queryable columns, not `raw`, because P2 charts the split.

**`amount`-kind holdings.** `quantity = 1`, `price = market_value`, `price_basis = NULL`; the UI
renders quantity as "—". A value carried forward from the previous valuation rather than re-typed
is marked `raw.carried = true`, so a stale value is distinguishable from a re-confirmed one.

### 4.3 The split — period first, cumulative alongside (*owner decision 2026-10-14*)

Per holding, between the previous valuation *p* and this one *t*:

```
value_acct_t   = round2(value_local_t × fx_t)
price_period   = round2((value_local_t − value_local_p) × fx_p)
fx_period      = (value_acct_t − value_acct_p) − price_period        ← residual, so cents tie exactly
```

A holding **new since *p*** takes `value_local_p = cost_local`, `value_acct_p = cost_acct`,
`fx_p = cost_acct / cost_local`. A failed or exited holding contributes 0 to both from the
valuation after it reaches 0.

**Cumulative** (since purchase), shown alongside: `unrealized = value_acct − cost_acct`, with
`price_cum = round2((value_local − cost_local) × fx_purchase)` and `fx_cum` the residual. Failed and
exited holdings freeze at `price_cum = −cost_acct`, `fx_cum = 0`, instead of drifting every month.
When `cost_acct` was **entered**, the FX column is labelled *"FX & costs"* because it then absorbs
the fee.

`manual_balances.balance` for *d* = Σ cent-rounded `value_acct_t`, so the booked row, the register
total and the ledger balance agree to the cent (the CR037 penny-leak class).

**FX source and staleness.** `fx.rateAsOf` falls back to the **nearest** rate at any distance and
returns null only for a currency with no rows at all (`fx.js:26-38`). The valuation therefore
records and shows the rate **date** used per currency, and requires an explicit acknowledgement when
it is more than 5 calendar days from *d*. *(P1b)* A non-USD account converts local → USD → account
currency (mtm accounts in EUR and PLN already exist: CVC Fund VIII/IX, United Beverages); P1a
enables USD accounts only.

### 4.4 The cost gap — shown, and blocking when large (*owner decision 2026-10-14*)

What `mtm` books for a period is `Δ Σ value_acct − contributions in the period`, which equals
`Σ (price_period + fx_period) + Δgap`, where

```
gap = (Σ cost_acct − Σ proceeds_acct)                         over all holdings, all statuses
    − (sumWithinBalanceWindow(account, d) − Σ source='mtm' rows)   i.e. opening + contributions
```

So the register shows **three** columns — price, FX, **unreconciled cost** — that sum exactly to the
booked row. A gap means a holding is missing, platform cash is unrecorded, a transfer is
miscategorised, or (correctly flagged) an `auto-offset` contribution was deleted by an unpair
(`transactions.js:1046-1049`). The save is **blocked** when `|gap| > max($50, 2% × Σ cost_acct)`
(tunable in build) until a cost is entered or the missing holding / cash recorded. On the specimen
the expected gap is ~$27 against a threshold of ~$97.

Exits net correctly: proceeds withdrawn reduce contributions and `proceeds_acct` reduces cost by the
same amount; proceeds left on the platform add a cash holding whose cost offsets `proceeds_acct`.

### 4.5 Opt-in, and the guard that makes the register the only writer

`accounts.manual_holdings_enabled BOOLEAN NOT NULL DEFAULT FALSE`. Enabling requires: balance
sheet, no active feed mapping, account currency USD (P1a; lifted in P1b), `manual_reconcile_mode = 'mtm'` (the enable action offers to switch
it — `calibrate` re-anchors `opening_balance` and silently absorbs every gain). Eligibility is
re-checked on **every** save, not only at enable (a feed mapping added later makes
`setManualBalance` throw, `reconcileManual.js:66`).

While enabled, **the service layer refuses** every other path that moves the account's balance or
its marks, so the guard cannot be bypassed by a route or a mobile screen:

| Path | Route (`manualCalibration.js`) | UI callers |
|---|---|---|
| set a manual balance | `PUT /balance` (39) | `ManualReconciliation.jsx`, `MobileReconcile.jsx:82` |
| delete manual balances (wipes **all** rows) | `DELETE /balance/:accountId` (61-65) | `ManualReconciliation.jsx` |
| switch to `calibrate` | `PATCH /reconcile-mode` (78) | `ManualReconciliation.jsx` |
| reset opening | `POST /reset-opening` (129) | `ManualReconciliation.jsx` |
| reconcile at an arbitrary `bookDate` | `POST /reconcile` (105) | `ManualReconciliation.jsx` |

The guard lives in `setManualBalance`, the mode update, `resetOpeningBalance` and `reconcileManual`;
the register writes through the client-accepting internals of §5.1, which bypass it by construction.

⚠️ **Not guarded in P1a (code review, 2026-10-14):** the generic account edit can still change
`opening_balance` / `opening_balance_date`, and a Ledger edit or delete can still touch the
register's `source = 'mtm'` rows. Either makes the next valuation book the shift. A large opening
change trips the cost-gap block; a removed mark surfaces as the preview's **"other"** line (booked −
price − FX − cost change), which is 0 unless something outside the register moved the ledger.

**Back-out.** Disabling the register stops register writes and lifts the guards, so the CR033 page
works on the account again. Snapshots and booked MTM rows stay: they are valid ledger history, and
the next typed manual balance continues from them. A first save is undone by deleting it (the
latest valuation), before which the preview has already shown exactly what it books.

## 5. Mechanics

### 5.1 One transaction (review B1)

`db.transaction` takes a fresh pool client and does not nest (`v2/db/postgres.js:103-117`);
`setManualBalance` writes through the pool (`reconcileManual.js:54,68`) and `reconcileManual` opens
its own transaction (line 117). Composed as-is, the MTM would run on a second connection that cannot
see the uncommitted balance. P1a therefore adds **client-accepting internals** —
`setManualBalanceTx(client, …)`, an exported `mtm(client, …)`, `deleteManualBalanceTx(client,
accountId, date)` — which the existing wrappers call unchanged.

### 5.2 Preview, then apply

**Preview** runs the full save inside a transaction that **always rolls back**, and returns the
per-holding split, the gap, the FX dates, every booked and replayed row, and any guard trip.
**Apply** re-runs it with `expect: { mtm_amount, entered_balance }` and fails `PREVIEW_STALE` on a
mismatch — the CR087 guard `calibrate` and reset already carry (`reconcileManual.js:287-314`) and
`mtm` lacks. When the 15% guard trips without `force`, `mtm` returns without writing (lines
188-192); the save treats that as **rollback of the whole valuation**, never as a committed snapshot
and balance with no MTM row.

### 5.3 Back-dated edits and deletes replay forward (*owner decision 2026-10-14; staged to P1b*)

**P1a:** a save dated before the latest valuation, and an edit or delete of any valuation but the
latest, is refused with a message naming the latest date — "delete forward to it". With monthly,
mostly carried-forward valuations that is rare. **P1b** lifts the refusal as follows.

Each MTM row is a delta against everything before it (`reconcileManual.js:153-164`), so correcting
a valuation silently shifts every later one. Any edit, insert or delete at date *d* therefore
re-runs `mtm(client, bookDate = v)` for every later valuation date *v* in ascending order, in the
same transaction. **Delete** removes that date's snapshot, its `manual_balances` row (by date — not
the all-rows route) and its MTM row, then replays. The 15% guard applies to each replayed row; a
trip rolls back the whole operation and names the date.

## 6. The first valuation is an anchor

The account has never been marked, so the first valuation books **all** gain or loss since each
purchase in one row. On the specimen that is probably small — unless FitnessGenes ($1,412, 29% of
the account, bought Oct-2025) is written down, which alone would exceed the 15% guard. The first
save shows the preview with the per-holding breakdown and lets the owner `force` it, rather than
the guard blocking a figure that is real.

## 7. Phases

**Before any build — zero code, owner action.** Switch Misc Investments to `mtm` on the existing
reconcile page (its `opening_balance` is 0.00, so the switch is clean) and type a monthly total.
That alone stops `calibrate` absorbing every gain; the register adds the *why*.

**P1a — register + valuation + booking, USD accounts, latest-only edits.** Built in its own
worktree (`git-concurrency.md`).
- Migration (next free at build time; row in `migrations.md`; additive, so **apply to prod before
  deploying the code** via the normal `deploy-to-production.sh` path): `manual_holdings`;
  `accounts.manual_holdings_enabled`; `security_positions.price_local / market_value_local /
  fx_rate`; `securities_asset_class_chk` **dropped and re-added** with the full current list
  (including legacy `stock`, `mf`, `misc`) plus `private`. Structural post-condition only, per 075.
- Service `server/src/v2/services/manualHoldings.js`: register CRUD; `previewValuation` /
  `saveValuation` / `deleteValuation` per §5; the §4.5 guards in `reconcileManual.js`.
- Routes: `{data}` envelope (`check-api-envelope.sh`); whitelisted fields; holding ids must belong to
  the account; non-finite numbers rejected, not coerced; dates via `validate.assertDateString`.
- UI: a **Holdings** panel on the account (reachable from the Ledger account header), on the
  Modal/DataTable primitives — register grouped by platform with subtotals, a *New valuation* row
  pre-filled from the last one, the three-column explanation (period and cumulative), FX dates, the
  gap, and the preview before apply.
- One-line fix in the P1a diff: `Scripts/backfill-fin-positions.js:24`'s rollback recipe deletes
  snapshots with no `source` filter; manual ones cannot be re-fetched.
- Tests (jest, shared dev DB, `maxWorkers: 1`):
  - split arithmetic: period and cumulative sum to the booked row to the cent; new-holding,
    `amount`-kind, entered vs default cost, failed/exited freeze;
  - rollback: an MTM failure leaves no snapshot and no balance; a guard-blocked save writes nothing;
  - P1a edit rule: a back-dated save, edit or delete is refused; deleting the latest removes its
    snapshot, balance row and MTM row together;
  - stale preview → `PREVIEW_STALE`; FX older than 5 days needs acknowledgement; gap over threshold
    blocks;
  - enabling a non-USD account is refused;
  - each §4.5 route refused while enabled;
  - X-ray isolation tested against the `source = 'bank-feed'` SQL fragments with account-scoped
    fixtures — not through `buildExposure`, which reads ambient data (roadmap #26).
- Month-end runbook (`docs/guides/month-end-reconcile.md`) gains "revalue register accounts" when
  P1a ships — a stale but believable register total is the defect class to avoid.

**P1b — replay and non-USD.** Lifts the P1a refusal with §5.3's replay-forward (tests: editing and
deleting a back-dated valuation leaves every later ledger balance equal to its register total; a
guard trip on a replayed row rolls back and names the date), and lifts the USD-only rule with the
§4.3 cross-rate (test: a non-USD account). Scheduled when a second register account, or a real
back-dated correction, needs it.

**P2 — Investments page.** Unscheduled after P1a — a $4.9k account beside the Fidelity accounts is
low value until more accounts use the register. Manual-register accounts appear on `/investments` beside the Fidelity
accounts. `investments.js` hard-codes `SOURCE = 'bank-feed'` (line 27), so P2 adds a real `source`
parameter; cross-account totals convert to USD (EUR/PLN register accounts would otherwise mix
currencies). A value-over-time chart per holding from the snapshot history.

## 8. Acceptance (P1a)

- Misc Investments enabled, the specimen's four GBP holdings + the remaining holdings entered; the
  gap is under threshold and explained. **§1's inferred link** (Jun-7 + Oct-12 transfers fund the
  GBP holdings) is confirmed or corrected with the owner at this first fill-in. If the real gap
  exceeds the threshold, the first save is blocked until costs are entered — by design.
- A valuation dated 2026-10-31 books one category-88 row **on 10-31**; the account's ledger balance
  equals the register's Σ `value_acct`, and the account's **cumulative** category-88 total equals
  Σ cumulative unrealized + gap.
- Re-saving 10-31 with one price changed replaces that row (still one row).
- Editing 10-31 after 11-30 is booked is refused, naming 11-30 (P1a; P1b: allowed, and 11-30's
  ledger balance still equals its register total).
- Between two valuations with no price change and a moved GBP rate, the **period** price effect is
  0.00 and the period FX effect equals the change in Σ `value_acct`.
- Rendered in both themes (the display half of the recurring defect class has no gate — see
  [current-phase.md](../current/current-phase.md)).

## 9. Open questions

None blocking P1a. Thresholds (gap `max($50, 2%)`, FX staleness 5 days) are tunable at build.

**For P1b — deposits.** The register books every value change to category 88 (Unrealized G/L). On
a deposit account (PKO - Deposits) the growth is **interest income**, not a mark. Options: keep
deposits off the register and record interest as transactions; or a per-account booking category
for the register's difference (small, but a design change touching §2 and the §4.4 gap). Decide
before P1b.

## 10. Review log

**Pass 1 — `cr-technical-reviewer`, 2026-10-14: *revise*.** All findings taken:
- **B1** (nested transactions) → §5.1. **B2** (rev 1 claimed CR033 books at the month-end *on or
  after* the date; `resolveMonthEnd` snaps to the one on or **before**) → owner chose
  `bookDate = valued_on`, §2. **B3** (back-dated edits shift later rows; no delete design) → owner
  chose replay-forward, §5.3. **B4** (booked amount includes the cost gap, so rev 1's acceptance
  test failed by design) → owner chose show + block, §4.4, §8.
- **S1** currency columns §4.2 · **S2** reader audit corrected; rev 1's claim that `investments.js`
  "already takes `source` as a parameter" was false, §3 / §7 P2 · **S3** manual securities kept off
  ticker and quote paths, §4.1 · **S4** FX staleness, §4.3 · **S5** period split (owner decision) and
  cent rounding, §4.3 · **S6** guard table, §4.5 · **S7** preview staleness + guard rollback, §5.2 ·
  **S8** exits and the window floor, §4.4 · **S9** route hygiene, §7 · **S10** test plan, §7.
- Nits N1–N6 folded into §4.1, §4.2, §4.5, §7.

**Pass 2 — `cr-signoff-pm`, 2026-10-14: *revise*, GO on doc edits with no third review.** Confirmed
B1, B2, B4 resolved and B3 resolved at a cost. Finding: P1 built the general case (any currency,
edit any date) for one $4.9k USD account whose value case is visibility — correctness is available
with zero code (§7 "Before any build"). Taken:
- **Re-stage P1 → P1a / P1b** (owner, 2026-10-14) — replay-forward and non-USD move to P1b; the
  owner's replay decision is deferred, not reversed (§5.3, §7).
- **Named users** — Misc Investments only for now, maybe others later (owner) (header).
- **Back-out** sentence (§4.5). Migration order, month-end runbook line, first-fill-in confirmation
  as acceptance, P2 unscheduled (§7, §8). Build after CR064 P2 (shared test rig, CR064's hard date).
