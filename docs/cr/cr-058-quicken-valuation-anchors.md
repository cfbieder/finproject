**Status:** PLANNED — designed against a completed dev rehearsal (batch `f1fdf550`, Fidelity Stocks); nothing built. · Unblocks the [CR019](cr-019-quicken-import.md) §24 backfill for the three Fidelity accounts.

# CR058 — Quicken-era valuation anchors (brokerage history)

Give the pre-PocketSmith history of a **brokerage** account a correct balance curve, by anchoring each
year-end to Quicken's own Net Worth Report instead of letting it drift on cash flows that never see
the holdings. Adds a "preserve today" calibration mode so promoting a **feed-owned** account stops
dragging its current balance back to a stale PocketSmith number.

Roadmap anchor: [project-roadmap.md#cr058](../current/project-roadmap.md). **Track: v3** — no flags,
no tenant context, nothing under `server/src/v2/db/`; verify on dev (`:3105`).
**Depends on:** [CR019](cr-019-quicken-import.md) §22 (the value-only promote whose blind spot this
closes) · [CR024](cr-024-fidelity-feeds.md) (the feed that already owns these accounts' *current*
balances) · [CR056](cr-056-investment-returns.md) (the report this deliberately does **not** feed —
see [Why not Unrealized G/L](#why-not-unrealized-gl)).

Migration **042** — 041 is CR057's.

---

## 1. Problem

[CR019 §22](cr-019-quicken-import.md#22-investment-side--value-only-promote-2026-06-01-descope)
descoped the lot walker: a brokerage account is promoted as a plain balance-sheet asset, trades are
**neutral** (a Buy is an internal cash↔holdings move), and only income legs and transfers reach the
ledger. That is the right call for cost basis, but it leaves the ledger tracking **cash only**. The
holdings are invisible, so any year where the cash/securities split moved produces a balance that is
badly wrong — and the error compounds across 22 years.

The rehearsal quantifies it. After importing `fid_brokerage.QIF` (1998-03-21 → 2019-12-31) onto
**Fidelity Stocks (27)** on dev, the reconstructed history runs:

| | 1998 | 2008 | 2013 | 2019 |
|---|---:|---:|---:|---:|
| Ledger after import | −585,343 | −759,213 | −398,995 | −345,339 |
| Quicken's own report | 29,436 | 191,451 | 586,818 | 642,514 |

Every pre-2020 year is **negative**, on an account that never was. That is worse than the pre-import
state (a flat −302,786 plug), so the CR019 backfill cannot ship for Fidelity without this.

### 1.1 Why the ledger goes negative — worked example, 2008

The ledger recorded **−224,423** of flows in 2008: seven transfers out (a 100,000 withdrawal on
10-03, another on 10-15, 40,000 on 10-17, 38,058 to `Reserve for Tax`, …) net of dividends and
interest. The account's actual value barely moved: **209,003 → 191,451**, a fall of 17,552.

Both are true, because the withdrawals were funded by selling securities:

```
Sell   1,127,093.39   (21 rows)
Buy      902,426.37   (32 rows)
        ─────────────
net    +224,667.02  of cash raised   ≈  the −224,423.46 that left the account
```

Under value-only, the sales are neutral and the holdings reduction is untracked, so the ledger sees
only the withdrawal. Algebraically the cumulative gap is

```
cumulative anchor  =  securities MV  −  cumulative net purchases  +  constant
annual anchor      =  ΔMV  −  net purchases in the year
```

which is why a year with heavy liquidation (2008) or heavy deployment (2010) throws a large anchor
while the account's value hardly moves.

### 1.2 The second problem — calibration drags today backwards

`recalibrate` ([quicken-promote.js:657](../../server/src/v2/scripts/quicken-promote.js#L657)) is
**PS-anchored** per [CR019 §22.1](cr-019-quicken-import.md#221-calibration-redesign--ps-anchored-2026-06-01):
it pins today's computed balance to the latest non-Quicken `closing_balance`. §22.1's reasoning was
sound for PS-only cash accounts, whose "today" was wrong before the import. It does **not** hold for
the Fidelity accounts: CR024 wired them to `feed_balances`, and PocketSmith stopped updating them in
May 2026. Promoting therefore drags a *correct* balance back to a stale one:

| Account | Before promote | After promote (stale PS anchor) | Damage |
|---|---:|---:|---:|
| Fidelity Stocks (27) | 1,157,037.74 | 1,114,485.03 | **−42,552.71** |
| Fidelity IRA (26) | 289,424.22 | 284,396.97 | −5,027.25 |
| Fidelity Cash Mgt (30) | 778,981.54 | 983,713.76 | +204,732.22 |

Observed for account 27; the other two are computed from prod's current anchors and will be
re-measured at their own rehearsals.

---

## 2. Source of truth — Quicken's Net Worth Report

`Samples/Downloads/fid_quickenMV.xlsx` — *"Net Worth Report — As of 12/28/2022 … (Includes unrealized
gains)"*, one row per account, one column per year-end 12/31/1999 → 12/28/2022.

**This CR does not build a share walker.** It reads the report. A throwaway walker was written only
to *validate* it, by reconstructing share positions from the QIF's own `!Type:Invst` events and
pricing them from its 384,172 `!Type:Prices` entries. It reproduced the report **to the cent in 22 of
24 years**:

| Year | Report | Independent walk | Δ |
|---|---:|---:|---:|
| 1999–2007, 2009–2013, 2015–2022 | — | — | **0.00** (22 years) |
| 2008 | 191,450.91 | 188,051 | −3,400 (one position with no price in the file) |
| 2014 | 719,821.95 | 720,768 | +946 |

Two independent reconstructions of a 25-year portfolio agreeing to the cent in 22 of 24 years is a
far stronger warrant than any invariant this CR could assert against the ledger. **1998 has no report
column**; the walk gives **29,436.00**, and that single value is the one anchor not sourced from the
report.

Practical consequence: the QIF export used for the import needs **no** price or security blocks. The
697 KB transactions-only export is sufficient, well inside the 25 MB upload cap.

---

## 3. Design

### 3.1 The anchor series

Anchors are **sequential** — each one is computed against the balance *after* all prior anchors, so
posting them in date order lands every year-end exactly on target:

```
anchor(Y) = target(Y) − [ ledger(Y) + Σ anchor(y) for y < Y ]
```

For Fidelity Stocks, measured on dev after the corrected promote:

| Year | Ledger | + prior anchors | Target | **Anchor row** |
|---|---:|---:|---:|---:|
| 1998 | −585,343.43 | −585,343.43 | 29,436.00 | **614,779.43** |
| 1999 | −566,858.38 | 47,921.05 | 51,950.03 | 4,028.98 |
| 2000 | −558,811.17 | 59,997.24 | 49,151.96 | −10,845.28 |
| 2001 | −548,871.77 | 59,091.36 | 60,249.04 | 1,157.68 |
| 2002 | −531,293.64 | 77,827.17 | 63,126.86 | −14,700.31 |
| 2003 | −522,696.66 | 71,723.84 | 89,013.63 | 17,289.79 |
| 2004 | −609,705.53 | 2,004.76 | 1,027.85 | −976.91 |
| 2005 | −609,690.53 | 1,042.85 | 1,198.68 | 155.83 |
| 2006 | −523,278.71 | 87,610.50 | 103,433.38 | 15,822.88 |
| 2007 | −534,789.79 | 91,922.30 | 209,002.80 | 117,080.50 |
| 2008 | −759,213.25 | −15,420.66 | 191,450.91 | **206,871.57** |
| 2009 | −742,087.73 | 208,576.43 | 258,467.01 | 49,890.58 |
| 2010 | −681,592.70 | 318,962.04 | 434,194.82 | 115,232.78 |
| 2011 | −702,949.94 | 412,837.58 | 281,922.02 | −130,915.56 |
| 2012 | −519,890.56 | 464,981.40 | 466,470.05 | 1,488.65 |
| 2013 | −398,995.29 | 587,365.32 | 586,817.83 | −547.49 |
| 2014 | −272,848.82 | 712,964.30 | 719,821.95 | 6,857.65 |
| 2015 | −239,728.32 | 752,942.45 | 670,808.13 | −82,134.32 |
| 2016 | −222,773.27 | 687,763.18 | 733,288.25 | 45,525.07 |
| 2017 | −419,729.95 | 536,331.57 | 575,743.37 | 39,411.80 |
| 2018 | −593,815.18 | 401,658.14 | 349,691.82 | −51,966.32 |
| 2019 | −345,338.62 | 598,168.38 | 642,513.72 | 44,345.34 |

**Granularity is annual** (owner decision), and is a **parameter**, not a constant. Anchors are
idempotent and batch-tagged, so re-running at a finer interval later is a re-run, not a migration —
the Quicken Net Worth Report can be regenerated with monthly or quarterly columns whenever the
sawtooth between annual anchors becomes annoying. It is real: within 2008 the balance still runs down
to −15,421 before the year-end anchor lifts it to 191,451.

### 3.2 The handoff reversal

Anchors must not move the PocketSmith era or today's balance. After the last Quicken-era anchor, one
**reversal row** at the handoff date (`2020-01-01`, the day before the account's PS cutoff) posts
`−Σ(anchors)`. For Fidelity Stocks that is **−987,852.34**.

Everything from the PS cutoff forward is then byte-identical to today, which keeps this CR additive
and cleanly reversible — the same property CR019 §6.4 step 10 was rewritten to preserve, and the
reason the rehearsal's rollback came back exact.

This is the [§22.3 `retire-handoff.js`](cr-019-quicken-import.md#223-retire-handoffjs--scripted-historical-account-handoff-2026-06-02)
pattern: one dated row that zeroes an era's cumulative effect at a boundary without disturbing either
side of it.

### 3.3 Where anchors post — a new non-P&L leaf

New COA leaf **`Valuation - Historical`** under the **Transfers** parent, `is_transfer = TRUE`,
`skip_transfer_analysis = TRUE` (it has no counterparty and must never appear in
[/transfer-analysis](../current/project-description.md) as perpetually unmatched — the same treatment
[CR019 §4.3](cr-019-quicken-import.md#43-existing-tables--minor-changes) gave `Return of Capital`).

Balance Sheet and Balance Trends are section/tree-driven, so they pick the rows up and the curve
becomes correct. P&L reports exclude `is_transfer` rows, so income statements are untouched.

#### Why not `Unrealized G/L`

`Unrealized G/L` (88) is tempting — it is exactly the leaf CR056 reads as its unrealized numerator, so
routing anchors there would light up pre-2020 Investment Returns for free. **Rejected**, because each
anchor is a mixture, and three of its ingredients are not market movement:

1. **Liquidation timing.** 2008's +206,872 is securities sold to fund withdrawals (§1.1), not a gain.
   Booking a +$207K unrealized gain in 2008 would be conspicuously false.
2. **Money-market sweep churn.** `FIDELITY CASH RESERVES`, `FIDELITY CASH` and `FIDELITY SELECT MONEY
   MARKET` are $1.00 cash vehicles that Quicken records as securities. Only **15 rows / ~535,000
   across 25 years**, but **512,925 of it falls in 2008** — 45% of that year's "sales" were cash
   moving in and out of a sweep.
3. **Gaps in Quicken's own share history.** CEDC sells **8,000 shares in May 2008** when the position
   walk shows 500 held (750 post-split). Across its life it roughly balances — 32,500 bought + 6,667
   `ShrsIn` against 39,417 sold — so the timing is wrong, not the totals. This is upstream data, not
   an import defect.

CR056 spent two review passes removing exactly this failure mode: a confident, precise, wrong return
percentage (the never-revalued €422K property at 0.00%, the +2,064% Dietz headline). Feeding it a
numerator built from liquidation timing would reintroduce it. **Pre-2020 Investment Returns will show
realized income only** — the 2,815 imported dividend/interest rows are genuine income on the right
account in the right period — and no unrealized figure. Showing nothing beats showing something
confidently wrong.

Reclassifying later is cheap: every anchor carries `import_batch_id` and a single category, so if
CR020's lot walker ever lands, the decomposition can be done retroactively with an `UPDATE`.

### 3.4 "Preserve today" calibration mode

`recalibrate` gains a **mode**, selected per batch:

| Mode | Rule | For |
|---|---|---|
| `ps-anchored` *(current default)* | `opening_balance := ps_close − Σ(all tx)` | PS-only cash accounts whose "today" is wrong pre-import (CR019 §22.1) |
| `preserve-today` *(new)* | `opening_balance −= Σ(this batch's rows)` | Accounts whose current balance is already correct — i.e. feed-owned (CR024) |

`preserve-today` keeps today's computed balance **byte-identical** across the promote. The audit row
(`quicken_calibration_audit.delta_amount = old_ob − new_ob`) and therefore rollback are unchanged —
the deterministic inverse still applies.

`verifyBalances` gains the matching assertion: under `preserve-today`, every touched account must
equal its `_pre_promote_balances` snapshot within 1¢ (this is the pre-§22.1 assertion, which still
exists in the `batchId === null` branch and can be reused), and untouched accounts stay unchanged.

Mode selection is **explicit per batch**, not inferred. Inferring it from "does this account have a
bank-feed mapping" would couple the importer to the feed cache and inherit its staleness failure
modes — the Black Card incident is the standing reminder of what happens when one system trusts
another's cached view without checking freshness.

---

## 4. Data model

### Migration 042 — `042_valuation_anchor_leaf.sql`

Creates the `Valuation - Historical` leaf under Transfers if absent (idempotent, guarded on name +
parent), `is_transfer = TRUE`, `skip_transfer_analysis = TRUE`, `section = 'profit_loss'`.

Following [CR057's pass-2 ruling](cr-057-book-income-at-source.md), the category is created **inside
the migration** with an explicit deploy order, rather than left to
[`seed-cr019-coa.js`](../../server/src/v2/scripts/seed-cr019-coa.js) — the anchor writer must not be
able to run against a database where its target leaf does not exist.

No new tables. Anchor rows are ordinary `transactions`:

| Column | Value |
|---|---|
| `account_id` | the brokerage account |
| `category_id` | `Valuation - Historical` |
| `transaction_date` | the anchor date (year-end, or the handoff date for the reversal) |
| `amount` / `base_amount` | the computed anchor (USD accounts ⇒ equal) |
| `source` | `quicken-valuation` |
| `import_batch_id` | the CR019 batch being anchored |
| `description1` | e.g. `Valuation anchor 2008-12-31` / `Quicken-era handoff reversal` |
| `accepted` | `TRUE` |
| `transfer_matched` | `FALSE` |

Carrying `import_batch_id` means [CR019 §6.5](cr-019-quicken-import.md#65-rollback-contract)'s
existing `DELETE FROM transactions WHERE import_batch_id = …` removes the anchors with the batch, at
no extra cost. A distinct `source` keeps them separable from the import's own rows.

---

## 5. Reconciliation invariants (fail-loud)

Per [`.claude/rules/data-import.md`](../../.claude/rules/data-import.md) — *"assert a reconciliation
invariant on every import that reconstructs quantitative state; fail the import otherwise"*:

1. **Every anchored date ties to the report to the cent.** After posting, recompute the balance at
   each anchor date and assert equality with the target within 1¢. Abort and roll back on any miss.
2. **The handoff is neutral.** Today's computed balance after anchoring must equal the value before
   anchoring, within 1¢. This is what proves the PS era is untouched.
3. **Coverage is total.** Every year between the account's first imported transaction and the handoff
   has an anchor, or the run fails. A silently skipped year is a silently wrong curve — and per the
   same rule, "no silent caps": any year dropped for want of a report column is logged, not ignored.
4. **Targets are present and parseable.** A missing or non-numeric report value for a year in range is
   a hard error, never a `0` default on a money field.
5. **Idempotent.** Re-running deletes this batch's prior `source='quicken-valuation'` rows and
   recomputes from the ledger excluding them — matching `retire-handoff.js`'s established pattern, so
   a re-run after a re-promote is safe.

---

## 6. Scope

**In:** Fidelity Stocks (27) first, end to end. Then Fidelity IRA (26) and Fidelity Cash Mgt (30),
each needing its own column in a regenerated Net Worth Report.

**Out:** any non-brokerage account (PKO, Chase Checking, Chase Saving, Santander are cash accounts —
their flows *are* their value, and they are already promoted and verified on prod); the CR020 lot
walker; cost basis; per-security anything; Fidelity Options and Fixed Income (created 2024+, no
Quicken history, explicitly skipped by [CR019 §24](cr-019-quicken-import.md#24-prod-cutover--live-per-account-loop-actual-2026-06-03--supersedes-23)).

---

## 7. Known limitations — stated, not hidden

- **The anchors are not a return series.** §3.3 item-by-item. They make the *balance* right; they do
  not decompose why.
- **Sawtooth between anchors.** Annual granularity leaves the intra-year path following incomplete
  cash flows. Worst observed case is 2008 (−15,421 mid-year against a real ~191,451). Mitigation is a
  finer re-run, which the design already supports.
- **1998 is walker-sourced**, not report-sourced — the report starts at 12/31/1999.
- **Quicken's share history has gaps** (CEDC). They wash out at year-end boundaries — which is exactly
  where the anchors sit — but they mean the intra-year record cannot be trusted for anything finer.
- **Two report years disagree with the independent walk** by 3,400 (2008) and 946 (2014). The report
  is taken as authoritative in both cases; the 2008 delta is a position the QIF carries no price for.

---

## 8. Test plan

Constructed, not asserted — CR056 pass 1 and CR057 pass 1 both returned *revise* for test plans whose
central assertion could not fail.

- **The invariant must be able to fail.** Perturb one target by 1.00 and assert the run aborts. A
  green tie-out over a series that was forced to tie is worth nothing.
- **Handoff neutrality:** promote → anchor → assert today's balance is unchanged to the cent; then
  roll back and assert `opening_balance` and today both return to their pre-promote values. The
  rehearsal already showed the plain promote/rollback cycle is exact (3,334 rows in, 3,334 out,
  `opening_balance` −302,785.91 → −614,777.36 → −302,785.91).
- **`preserve-today` vs `ps-anchored`:** the same fixture batch under both modes, asserting the two
  produce *different* `opening_balance` values and that only `preserve-today` leaves the snapshot
  intact. A test that passes under both modes is not testing the mode.
- **Idempotency:** anchor twice, assert row count and balances are unchanged.
- **Coverage failure:** a batch spanning a year with no report value must fail loud, not skip.
- **P&L isolation:** assert anchors appear in Balance Sheet / Balance Trends and are absent from the
  P&L and from `/investment-returns` for the period.

---

## 9. Rollout

**Hard gate, ahead of everything else:** prod's `fin-server` container bakes source at build time and
is running the **pre-`d4bf7da`** parser. Both investment-QIF fixes — the discarded `L` category and
the reversed `XOut` sign — must be **deployed before any Fidelity QIF is uploaded through the prod
UI**, or the import silently repeats both bugs. Prod has never run an investment-file parse, so
nothing is wrong today; this is purely an ordering constraint.

1. Deploy `d4bf7da` (+ this CR's code) via `Scripts/deploy-to-production.sh`.
2. Apply migration 042 to prod **before** the deploy that references the new leaf
   ([git-concurrency rule 6](../../.claude/rules/git-concurrency.md)).
3. Per account, following [CR019 §24](cr-019-quicken-import.md#24-prod-cutover--live-per-account-loop-actual-2026-06-03--supersedes-23)
   minus its destructive steps — **no delete, no `promote_from_date` guard**, because the auto-cutoff
   already equals the account's PS start date (verified 2020-01-02 for account 27), so the import
   fills only the era PocketSmith never covered:
   `pg_dump` → upload QIF → map → pre-flight (confirm the cutoff) → promote in `preserve-today` mode
   → anchor → `quicken-verify` → eyeball Balance Trends.
4. Ships as a **minor** — new COA object, new ledger rows, new calibration mode.

---

## 10. Open questions

1. **Does the Net Worth Report separate the three Fidelity accounts?** The current export has a
   single `Fidelity Brokerage` row. IRA and Cash Mgt need their own columns before they can be
   anchored, and it is not yet confirmed Quicken modelled them as separate accounts.
2. **Should the 1998 anchor be dropped instead of walker-sourced?** Dropping it leaves 1998 on the
   raw flows; keeping it relies on the one number the report cannot corroborate. Low stakes — 29,436.
3. **`Valuation - Historical` vs reusing `Transfer - Historical` (221).** A distinct leaf is proposed
   so the anchors are separable in reports and reversible as a set; the counter-argument is one fewer
   COA object for a category the owner will never pick manually.

---

## 11. Update history

- **2026-07-28** — Drafted from a completed dev rehearsal of the Fidelity Brokerage backfill
  (batch `f1fdf550`, account 27). The rehearsal found and fixed **two importer defects** (committed
  separately as `d4bf7da`, outside this CR's scope): investment-QIF cash rows discarded their real
  `L` category (306 of 328 pre-cutoff rows), and `XOut` was staged with the wrong sign (50 rows,
  +642,391.62 booked backwards, ~$1.28M of overstatement — confirmed by `opening_balance` moving
  exactly 2× the error once fixed). `quicken-verify` on the corrected promote: **8 passed, 1 benign
  warning, 0 failures**; rollback exact. Owner decisions taken during design: anchors post to a
  **non-P&L leaf** (not `Unrealized G/L`), granularity **annual** (parameterised), calibration gains
  a **preserve-today** mode.
