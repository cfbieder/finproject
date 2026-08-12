# CR080 — The `accrue` reconcile mode (yield a feed never posts) — ✅ COMPLETED (v3.28.0, 2026-08-11)

Roadmap anchor: [project-roadmap.md#cr080](../current/project-roadmap.md#cr080). **Track: v3** —
no flags, no tenant context, nothing under `server/src/v2/db/`.
**Depends on:** [CR023](cr-023-pocketsmith-removal.md) (the reconcile engine and `reconcile_mode`) ·
[CR065 §11](cr-065-neutralize-pair-identity.md) (the sync-lag rule this reuses).
**Part A is already shipped** — migrations **065** + **066**, applied to prod 2026-08-11. This CR
covers Part B: making it stop recurring.

## Problem

`Wise - USD` (8) and `WISE - EUR` (13) are **Wise Assets** balances — the money is held in a
money-market fund, not as cash. The feed delivers the monthly service fee:

```
2209 | 2026-08-04 | -0.53 | USD | ACCRUAL_CHECKOUT-invoice-30010473 -- USD Assets service fee
2187 | 2026-08-04 | -0.22 | EUR | ACCRUAL_CHECKOUT-invoice-30010350 -- EUR Assets service fee
```

…but never the yield those fees are charged against. The fund accrues daily, the balance climbs
with no transaction behind it, and fin falls a little further below the feed every day. Measured
over the whole 66 days of feed history fin holds:

| | 2026-06-05 gap | 2026-08-09 | drift | per day | implied |
|---|---:|---:|---:|---:|---:|
| Wise – USD | −23.83 | +2.79 | +26.62 | 0.403 | ~3.6%/yr |
| WISE – EUR | −7.50 | +0.39 | +7.89 | 0.120 | ~2.1%/yr |

**Neither existing mode is the right treatment**, which is the whole reason this CR exists:

- **`calibrate`** folds a *recurring flow* into a single constant at `opening_balance`. Today
  becomes right and every prior date becomes wrong by the movement it swallowed — precisely the
  failure [migration 046](../../server/db/migrations/046_cashmgt_mtm_mode.sql) documents for
  Fidelity Cash Mgt — and the drift is back tomorrow.
- **`mtm`** books the right *shape* (a dated plug row) to the wrong *place*: `Unrealized G/L` (88),
  an **expense** category. Money-market yield is income. Booked there it never appears in income,
  budget, or anything tax-facing, and it is on the wrong side of the P&L.

Both accounts were configured `mtm` and had **never had a single `mtm` row written**, so nothing
had been booked either way. Wise's own periodic `Cashback - TransferWise` rows came through
PocketSmith and stop at 2026-04-06 (USD) — too small and too irregular (0.27–9.58/month against
~12/month of accrual) to have been the yield. On the evidence available the yield has never been
booked; it is **not** established that the CR023 cutover caused this.

`WISE - PLN` (20) is flat zero on both sides and stays on `calibrate`. **Fidelity Cash Mgt stays on
`mtm`** — migration 046 argued that on evidence its gap *flips sign* between quarters, which is a
real distinction from a monotonic accrual and is not overturned here.

## Part A — the history (shipped)

Migrations [065](../../server/db/migrations/065_wise_assets_yield_accrual.sql) and
[066](../../server/db/migrations/066_wise_accrual_base_amount.sql); see
[migrations.md](../current/migrations.md) for the full record. Two findings shaped it and both
generalise into Part B's design:

**1. Measure Δgap, not the gap — and only between settled endpoints.** Accrual over a period is the
*change* in (feed − fin) across it, which needs no rate model. But it needs endpoints the feed has
settled: this feed syncs in the small hours and its lag **jitters by a day**, so a row dated D may
hold the close of D−1. Endpoints were taken only on dates inside a transaction-free run, where
comparing the feed against fin same-day and against fin lagged one day give the *same* gap. Three
independent intervals per account then implied the same annualised yield to within 0.007/day — a
missing transaction does not accrue linearly.

**2. The current gap is not the accrual — but the leftover is a CALIBRATION PLUG, not an error.**
Both gaps *start negative*: at 2026-06-05 fin sat ABOVE the feed by 23.83 / 7.50. Booking today's
2.79 as one interest row would therefore have understated 2026 interest by ~24, so the two parts had
to be separated — that much was right, and it is why `Interest Income` correctly reads 25.43 USD /
7.89 EUR rather than 1.60 / 0.39.

**What 065 got wrong was the leftover's nature**, and it is worth recording because the mistake is
reusable. It reasoned: unbooked yield pushes fin BELOW the feed, fin is ABOVE, therefore this is not
yield but an unattributable older error → `Unrealized G/L`. **That premise only holds for a ledger
nobody has re-anchored.** The owner had been **calibrating these accounts for months**, and
`calibrate()` rewrites `opening_balance` — a single constant applied to every historical date — so
an August calibration drags June's balance up with it. Fin sitting above the feed in June is exactly
what a later calibration looks like. The sign test was answering a question about a static ledger
that these accounts had not been for months.

Nothing in the data was hidden; `calibrate()` simply **writes no audit row at all**, so the only
trace was the shape of the gap — a straight line through zero at the calibration date, which both
accounts cross in the first days of August. **Migration 069** moves the plug out of `Unrealized G/L`
and into `opening_balance`, reversing 065's own objection to `opening_balance`: the plug was
**already in there**, so this takes 23.83 / 7.50 out of the existing smear rather than adding one.
Balance-neutral on every date; it removes a fabricated −32.56 loss and leaves `Interest Income`
untouched. The post-condition is the proof — **all eight measured anchors tie to the feed to the
cent**, not just today's balance.

Also fixed: the `Converted 34.99 CHF to 37.52 EUR` row was categorised `Interest Income`, inflating
that category by 4.75× the entire real 2026 yield on the account. Now `Transfer - FX` (208).

## Part B — the `accrue` mode

**This is not a new engine.** [`mtm()`](../../server/src/v2/services/reconcileToFeed.js) already
books `expected − computed` as a dated, idempotent plug row with FX, a stale-feed guard and a
plausibility guard. Three things are hardcoded: the category (88), the month-end date snap, and
`source='mtm'`. Part B parameterizes them.

### B1 — schema (migration 067)

```sql
ALTER TABLE account_source_mappings
  ADD COLUMN IF NOT EXISTS accrual_category_id INTEGER REFERENCES accounts(id);
```

**⚠️ Corrected during the build — the first draft of this section was wrong in a way that would
have destroyed Part A.** It said to seed accounts 8 and 13 to `('accrue', 74)` in the same
migration, "inert until B2 ships, since nothing reads `'accrue'` yet". It is not inert. The
dispatch was `if (mode === 'mtm') … else calibrate`, so *any* unrecognised mode reached
`calibrate` — and migrations are applied to prod **before** the code that uses them. A Reconcile
click in that window would have re-anchored `opening_balance` on both accounts and wiped exactly
the history migration 065 had just booked.

Split accordingly: **067** adds the column only, before the deploy. And the same deploy removes the
trap for good — an unrecognised mode now **throws** rather than falling through, so the fourth mode
cannot re-set this. Falsified: with the throw removed, the unknown-mode test resolves to `calibrate`
proposing `new_opening: 12345.67` against an `old_opening` of 10000.

**Then 068 was withdrawn too, and the ordering problem with it.** The mode flip was first written as
migration 068, applied after the deploy. That header spent twenty lines justifying an inversion of
the standing migrations-before-code rule — which was the tell. `reconcile_mode` and
`accrual_category_id` are per-install **configuration**, the same family as `feed_sign`,
`feed_negate_tx` and `promote_from_date`, none of which is set by a migration. Setting it on the
reconcile page after the deploy needs no exception to any rule, avoids
`--allow-unverified-migrations` (Step 2b(i) would rightly have refused a file that never ran on
dev), and gets validation a migration cannot have. **067 is the only migration this CR ships.**

### B2 — engine

Factor the shared plug out of `mtm()` (both modes: resolve observation → compute
`expected − computed` → guard → delete-and-reinsert at the booking date → FX). The `accrue` branch
differs in four ways:

1. **Category** — `m.accrual_category_id`, refusing with a clear error when NULL rather than
   defaulting to anything. A silent fallback to 88 would reintroduce the exact defect this CR fixes.
2. **Source tag** — `'accrual'`, matching the rows migration 065 already wrote, so the first real
   run supersedes rather than duplicates them.
3. **Booking date** — **corrected during the build, and this is the substantive design change.**
   The draft said "the observation's own `balance_date`", gated by CR065 §11's
   `syncedBeforeDayEnded` (usable only if synced *after* the labelled day ended). Implemented as
   written, it selected **zero** observations and the mode could never have run for any account.
   Measured across the real feed's whole history, `synced_on − balance_date` is **0 (53 rows),
   −1 (29) or −2 (2), and never positive**: rows are labelled with the sync date or a date *ahead*
   of it, so "settled" in that sense never happens here. The rule is now

   ```
   bookDate = LEAST(balance_date, synced_on − 1)
   ```

   the last day the observation can be presumed to fully contain — correct in all three regimes
   (labelled ahead of the sync, labelled on it, genuinely settled), and the observation chosen is
   the one that can speak for the latest such day. This is a **conservative pairing, not a claim
   about the feed's true lag**, which remains unproven (Known Issue #14; CR065 §11 declined to
   guess it). It can only under-claim by a day — which the next run picks up — where over-claiming
   books a real transaction as income forever.
4. **The guard — the part that genuinely needs new design.** `mtm`'s
   `MTM_IMPLAUSIBLE_PCT = 0.15` is *useless here*: a missed $500 transfer on Wise USD is 12% of
   balance and sails straight through, permanently laundered into income and never revisited (an
   MTM row at least re-marks against the feed each period and self-corrects; an income posting is
   cumulative and nothing ever looks at it again). Replace it with **implied annualised yield** —
   `amount / balance / days_since_last_accrual × 365` — refused outside a plausible band without
   `force`. That is what converts "book whatever the gap is" into "book only what looks like
   yield", and it is the only reason this button is safe to put in the UI.

`base_amount` **must** come from [`usdBaseAmount`](../../server/src/v2/services/fx.js), not a
re-derivation of the rule — migration 066 exists precisely because an inline copy dropped its
USD-is-1 case and wrote four NULLs.

Idempotency follows `mtm`: delete prior `source='accrual'` rows at the booking date, and compute
the base *including* earlier accrual rows (only the same-date row is excluded).

**A fifth difference, found by running it against prod:** an accrual dated *later* than the day the
newest observation can speak for must **refuse**, not book. Such a row sits outside the
`<= bookDate` base and would be recognised a second time. This is not hypothetical — it is
`WISE - EUR`'s live state, whose Part A accrual is dated 2026-08-09 while the newest observation
reaches only 2026-08-08.

### B4 — cadence: this mode is monthly, not daily

Running it against prod read-only, **both accounts currently refuse**, and both refusals are
correct: EUR on the double-count guard above, USD on the rate guard (−1.08 over one day on 4,074.95
is −9.7%/yr, outside the band).

The reason generalises. This feed's day-granularity jitter is **larger than one day of accrual** —
roughly ±1.5 against 0.40/day on the USD account — so a single-day run is noise-dominated and
essentially cannot clear the band. Over a month the same jitter is ±0.45%/yr around a 3.6% signal
and passes comfortably. **The APY band therefore self-selects for longer periods**, which is the
behaviour we want and needs no separate minimum-period rule: a too-frequent click refuses loudly
instead of booking noise as income. Operationally this belongs with the month-end reconcile, beside
the MTM run — not on the weekly loop.

### B3 — UI

Third option in the reconcile-mode dropdown on
[BalanceReconciliation.jsx](../../frontend/src/components/BalanceReconciliation/BalanceReconciliation.jsx),
plus a category picker on the row (shown only for `accrue`). Button label follows the mode. The
existing `MTM GAP` / `DRIFT` badge needs a third state.

## Non-goals

- **Spreading accrual across days.** One dated row per reconcile is how a bank posts interest
  anyway; daily rows would be 365× the ledger volume for no reportable gain.
- **Deriving yield from the feed's day-over-day increments** rather than Δgap. More machinery, and
  it fails on exactly the days Δgap fails on (unsettled observations), so it buys nothing.
- **Re-treating Fidelity Cash Mgt.** See above — 046's sign-flip evidence stands.

## Verification — done

`server/src/v2/services/__tests__/reconcileAccrue.test.js`, 14 tests, all passing; **896 backend
across 66 suites**, 507 frontend, frontend build ✓, lint clean on the changed files.

Two of them were **falsified against the unfixed code**, because a guard that has never refused
anything has not been tested:

- **the rate guard** — widening `ACCRUAL_MAX_APY` to 99 makes the missing-transaction test fail.
  The fixture is the Wise-USD shape exactly: a 500 deposit fin never recorded, which is **5% of
  balance and so INSIDE mtm's 15% threshold** — the concrete demonstration that the old guard
  cannot do this job.
- **the fall-through** — removing the throw makes the unknown-mode test resolve to `calibrate`
  proposing `new_opening: 12345.67` against `old_opening: 10000`, i.e. the destruction described
  in B1, printed.

Also pinned: the three booking-date regimes; an observation with no sync time is excluded rather
than guessed at; a NULL category refuses instead of defaulting; re-running supersedes rather than
duplicating; an earlier accrual row is part of the base and not re-recognised; and `calibrate` /
`mtm` are unchanged by the new dispatch.

**Shipped v3.28.0 (2026-08-11), migrations 067 + 069.** Both accounts are live on `accrue` /
`Interest Income`; `WISE - EUR` reconciles to **0** and `Wise - USD` carries −1.19, the accrual
since the 08-07 anchor. Both API guards were verified **against live prod**, not a fixture:
selecting `accrue` with no category was refused, and clearing the category while in `accrue` was
refused.

**Still open:** the first real `accrue` run happens at month-end, when the signal clears the band
(B4) — today both accounts correctly refuse. Dev's ledger lacks rows for 065–067 (they were applied
prod-first); `Scripts/sync-db-prod-to-dev.sh` resolves it. Neither reviewer pass
(cr-technical-reviewer, cr-signoff-pm) was run — this shipped on measurement and falsification
instead.

## Historical reconstruction — attempted, measured, and declined (2026-08-12)

Interest earned **before 2026-06-05** (the feed's first observation) is not booked. The owner
supplied Wise's own CSV exports for both accounts and confirmed **no interest statement is
available**, so this records what the data can and cannot settle, to stop it being re-derived.

**What the Wise CSVs settled.** Neither export contains a single interest row — Wise does not post
the Assets yield as a transaction even in its own record, which confirms the diagnosis from the
other side. They do carry the monthly `ACCRUAL_CHARGE` Assets fee, and fee ÷ average balance holds
at **0.127–0.154%/yr across a 13× range of balances** on the USD account. That is an independent
check that **fin's transaction history for these accounts is complete** — missing rows would make
the computed balances wrong and scatter the ratio.

**What actually measured it.** Every PocketSmith row carries `closing_balance`, a bank-reported
running balance — 389 rows on USD back to 2023-01-01, 610 on EUR back to 2022-03-26. Over any span,
`interest = Δ(closing_balance) − Σ(transactions)`, with **no rate assumption**. Taken across the
whole history the result is order-independent (it telescopes to the first and last rows):

| | period | unexplained |
|---|---|---:|
| Wise – USD (8) | 2023-01-01 → 2026-05-14 | **+187.21** |
| WISE – EUR (13) | 2022-03-26 → 2026-06-03 | **−504.27** |

USD's +187.21 cross-checks against the month-by-month figures (104.22 Mar + 73.49 Apr + 8.37 May =
186.08; the 1.13 difference is one Wise transfer fee), and April's 73.49 landed within **13 cents**
of a completely independent estimate from average balance × the feed-measured rate (73.36). Almost
all of the 187 falls in March–May 2026.

**⚠️ EUR's −504.27 is NEGATIVE, which interest cannot be.** The EUR account has a genuine gap in its
history — most likely a single missing transaction around 2026-05. Logged here as a data-quality
issue in its own right; it is **not** an interest question and is unrelated to CR080's engine.

**Two false trails, recorded because both looked convincing.** An earlier pass put the figure at
**~$492 USD / €121 EUR** by applying the feed-measured rate to average balances — ~2.6× too high,
because it assumed the entire balance was invested in Assets and that the June rate held back to
January. And a "13,000 hole" in January 2026 was an artifact of **within-day row ordering**, not
missing data: December closes at 1,327.45 and January's cashback closes at 1,328.11 = 1,327.45 +
0.66, chaining perfectly. Within-day ordering in the PS export is ambiguous, and it flipped the
monthly answer twice.

**Owner decision (2026-08-12): leave it — book nothing.** The money is **not missing from any
balance**; the calibrations already put it there, and every account ties to the bank today. What is
absent is only the *classification*: roughly $187 of pre-June-2026 interest sits inside
`opening_balance` instead of appearing as `Interest Income`. Booking a reconstruction would have
meant entering a number derived from a source with a known −504 defect, which is precisely the
"launder a data error into income" failure the `accrue` guard exists to prevent.

From 2026-06-05 the feed measures it properly and the monthly `accrue` run books it as income, so
the gap does not grow.
