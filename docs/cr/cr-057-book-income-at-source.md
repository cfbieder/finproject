# CR057 — Book Income at Source (holding-attributed distributions) — ✅ COMPLETED (v3.6.0, 2026-07-28)

Roadmap anchor: [project-roadmap.md#cr057](../current/project-roadmap.md#cr057). **Track: v3** — no
flags, no tenant context, nothing under `server/src/v2/db/`; verified on dev (`:3105`).
**Depends on:** [CR056](cr-056-investment-returns.md) (the report this corrects, and whose P2 item it
replaces) · [CR009](cr-009-transfer-analysis.md) (transfer matching, whose tables rev 1 wrongly
proposed to reuse — see [Linking and undo](#linking-and-undo)).

**Reviews:** pass 1 (cr-technical-reviewer) **revise** — 5 blocking, all addressed in rev 2 · pass 2
(cr-signoff-pm) **GO**, positioned **next in build order**, ahead of all four IN-PROGRESS CRs (no
surface overlap; the instrument that verifies it shipped the day before). Pass 2's two must-resolves
are folded in below: the category is now created **inside migration 041** with an explicit deploy
order, and the index/anchor rows are opened. Ship as a **minor — v3.6.0**.

**Rev 2** after pass 1 (cr-technical-reviewer) returned **revise** with 5 blocking findings. The
thesis survived — the reviewer confirmed against the real bucketing code that the three-leg booking
lands in the right buckets and that CR056's objection only ever covered a one-legged change. What did
not survive: the **verification plan was a tautology**, the **category guard** did not exist, the
**provenance store** was another feature's table, the **undo guard** had no mechanism, and the scope
mixed "unambiguous holding" with "unambiguous that it is income". All five are addressed below; the
scope call was taken by the owner.

Migration **041** — the next free number. *(Note: [CR052](cr-052-forecast-expense-fx-exposure.md),
still PLANNED, describes itself as "migration 040", which has since been used by the v3.4.6 data fix;
CR052 will need renumbering when it is picked up.)*

## Problem

Investment income is recorded on the account where the **cash landed**, not on the **holding that
earned it**. Every report that scopes by account therefore attributes it to the wrong place, and
[`/investment-returns`](../../server/src/services/investmentReturns.js) — which scopes strictly to
"transactions on the selected account" — reports United Beverages' realized return as **0.00%**
against ~25M PLN of average capital.

Verified against prod (2026-07-27), the pattern spans four categories:

| Category | Rows | Currently on | Earned by | PLN | USD |
|---|---:|---|---|---:|---:|
| `Financial Income - UB Dividend` (73) | 5 | PKO (18) | United Beverages (43) | 5,172,998.27 | 1,340,251.54 |
| `Financial Income - Barkeria` (77) | 2 | PKO (18) | Barkeria Sp. z o.o. (44) | 146,294.12 | 40,141.48 |
| `Financial Income - CVC` (78) | 6 | Fidelity Bond (USD) | *ambiguous, and cross-currency* | — | 66,851.19 |
| `Financial Income - Other Investments` (79) | 6 | Fidelity Stocks (5), CVC-MIP (1) | *already on holdings; 2 negative* | *mixed ccy* | 3,466,141.40 |

**In scope: the 7 UB + Barkeria rows** — 5,319,292.39 PLN / 1,380,393.02 USD. Both holdings are PLN
and both cash rows are PLN, so no cross-currency leg arises in the scoped set.

### Owner decision on the three loan-related rows

Pass 1 correctly separated two questions rev 1 had conflated — *is the target holding unambiguous* and
*is it unambiguous that this is income*. Three of the seven read as loan-related, not dividends:

| Tx | Description | PLN | Concern raised |
|---|---|---:|---|
| 2615 | `LOAN AGREEMENT ON JULY 17, 2023` | 1,187,000.00 | Filed as `UB Dividend`; 23% of the UB total |
| 3765 | `Zwrot Vat zgodnie z umową pożyczki` | 18,209.50 | VAT refund under a loan — may not be income |
| 2525060 | `Spłata odsetek pożyczki` | 128,084.62 | Loan interest — earned by a receivable, not by the equity |

**The owner reviewed these and decided all seven are in scope**: the income is attributable to the
holding regardless of the instrument it arrived through. Recorded here as a decision, not an
oversight. The alternative treatment — transfer legs with **no** income leg, using the existing
`Return of Capital` (217) — remains available per row and is *not* built into this CR; if any of the
three later proves to be a return of capital, undo the restatement and rebook it that way.

## Why restate the ledger rather than map it in the report

CR056 [§Known limitation](cr-056-investment-returns.md#known-limitation-at-ship) rejected moving the
income to the holding on the grounds that *"a dividend paid into PKO moved PKO's balance, not UB's, so
including it would break the reconciliation identity"*, and proposed instead a category→holding map
feeding a row **below** `Ending market value`, outside the identity block.

**That objection holds only for a one-legged change.** With `+X` income *and* `−X` transfer out posted
to the holding on the same date, the **deltas** contributed by the pair are:

```
Δ(EMV − BMV) = 0         (the pair nets to zero on the holding's book)
Δ netFlows   = −X        (the transfer leg; is_transfer ⇒ 'flow' bucket)
Δ income     = +X        (the income leg; profit_loss, not a mark ⇒ 'income' bucket)

Δ totalReturn = Δ(EMV − BMV) − Δ netFlows = 0 − (−X) = +X = Δ income ✓
```

`bucketOf` ([investmentReturns.js:415-423](../../server/src/services/investmentReturns.js#L415)) has
**no fall-through**, so both legs land in the intended bucket by construction — the property CR056's
rev-2 review insisted on. Pass 1 reproduced this.

Restating is also strictly broader in effect: it corrects the Budget worksheet and the P&L
drill-downs, and leaves the ledger stating what actually happened, rather than fixing one report.
**This CR therefore replaces CR056's P2 "Distributions received elsewhere" item** — see
[Out of scope](#out-of-scope) for what remains of that bullet.

## Why a guarded tool rather than a SQL migration

Not reuse volume. Prod recurrence is **1 / 2 / 2 / 2 rows per year** — seven backfill rows plus roughly
**two invocations a year** thereafter, ~17 uses over five years. That does not remove effort from the
weekly refresh→review→reconcile loop, and resting the case on reuse would invite the fair charge that
this is a one-time cleanup dressed as a feature.

The case is **reversibility**. The alternative is a hand-written SQL migration mutating seven money
rows on prod with no preview and no undo — the exact shape that has bitten this project twice: the
Black Card back-fill (31 duplicates, $8.4K gross but **net only +$267**, so a balance check did not
catch it) and the `promote_from_date = NULL` default. Dry-run plus a snapshot-guarded undo is the
incremental cost of not doing that a third time.

And the correctness argument carries the CR on its own: `/investment-returns` reports United Beverages'
realized return as a **confident 0.00%** against ~25M PLN of average capital. A confident zero is worse
than a blank.

## The three-leg booking

For a source income row `T` (amount `A`, base `B`, date `D`, category `C_inc`, account `A_cash`) and a
chosen holding `A_hold`:

| Leg | Account | Amount | Base | Category | Source |
|---|---|---:|---:|---|---|
| 1 (new) | `A_hold` | `+A` | `+B` | `C_inc` (unchanged) | `restatement` |
| 2 (new) | `A_hold` | `−A` | `−B` | `Transfer - Distributions` | `restatement` |
| 3 (`T`, edited) | `A_cash` | `+A` *(untouched)* | `+B` *(untouched)* | `C_inc` → `Transfer - Distributions` | *(unchanged)* |

Worked example — tx 24814, the 2026-01-07 UB dividend:

```
CREATE  United Beverages  +690,874.27 PLN  (+191,656.32 USD)  Financial Income - UB Dividend
CREATE  United Beverages  -690,874.27 PLN  (-191,656.32 USD)  Transfer - Distributions
UPDATE  PKO tx 24814      category: Financial Income - UB Dividend → Transfer - Distributions

United Beverages book:  20,686,000.00 PLN / 5,010,959.16 USD   — both unchanged
PKO balance:            unchanged
Net worth, P&L category total: unchanged
```

The USD book matters as much as the PLN: invariant 1 is really about `base_amount`, and that is the
number a sloppy copy corrupts. Legs are inserted **income-last** so the Ledger's same-day running
balance does not display a spurious negative spike on the holding.

### Invariants — each with the mechanism that enforces it

| # | Invariant | Enforced by |
|---|---|---|
| 1 | `amount`/`base_amount` copied and **negated exactly**, never re-derived from an FX table | Server asserts `leg1.amount + leg2.amount = 0` **and** `leg1.base_amount + leg2.base_amount = 0` before commit; a one-cent divergence would accrue a permanent USD residual visible in CR056's `FX effect` |
| 2 | The holding's book value does not move | Follows from 1 + same account; re-asserted on undo (see [B4 fix](#linking-and-undo)) |
| 3 | `transaction_date` identical across all three legs | Copied from `T`; asserted |
| 4 | Holding currency == source row currency, else **400** | Explicit check (not exercised by the scoped 7) |
| 5 | The resolved category has `is_transfer = TRUE AND section = 'profit_loss'`, else **400** | Explicit check — see below |
| 6 | All three writes in **one** DB transaction | Single `db.transaction(...)`; every write goes through the passed client |

**Invariant 5 exists because its absence fails silently and identically to the bug being fixed.** If
`Transfer - Distributions` were created with `is_transfer = FALSE`, `bucketOf` would classify leg 2 as
`income` (it is `profit_loss` and not the mark category), income would net to `+X − X = 0`, the report
would still read 0.00% — **and the identity would still close**, because `fxEffect` is a plug. Nothing
would surface it. `accountsRepo.create` takes `is_transfer` straight from the body and the column
defaults FALSE ([accounts.js:274](../../server/src/v2/repositories/accounts.js#L274)); only
`/util/coa/add` derives it from tree placement
([coa.js:123](../../server/src/v2/routes/util/coa.js#L123)).

Why invariant 2 is load-bearing, verified against real consumers: `refreshModulesFromActuals`
([crud.js:47-62](../../server/src/services/forecast/crud.js#L47)) re-bases forecast modules from
`SUM(t.amount)`/`SUM(t.base_amount)` per account, and manual calibration/MTM
([reconcileManual.js:154,221](../../server/src/v2/services/reconcileManual.js#L154)) both read
`SUM(amount)`. Net-zero legs leave all three identical. The forecast **base-year seed** is
structurally insulated — `crud.getBaseYearValues`
([crud.js:400-460](../../server/src/services/forecast/crud.js#L400)) reads only `forecast_modules` /
`forecast_income_expense` and never touches `transactions`.

## New COA row

`Transfer - Distributions` under `Transfers` (200), `account_type = expense`, `section = profit_loss`,
`is_transfer = TRUE`, `skip_transfer_analysis = FALSE`.

**The row is created inside migration 041**, idempotent and name-guarded, following the migration 040
precedent. Rev 2 originally leaned on
[`seed-cr019-coa.js`](../../server/src/v2/scripts/seed-cr019-coa.js) — pass 2 showed that to be wrong:
that script is a **manual admin CLI** (`--apply`, CR019 §23 STEP 2), not a fresh-DB seed path, so "a
fresh DB gets it right" only held if someone remembered to run it, and prod would have got the row via
an unstated hand-step. If it were instead hand-created through the generic create path, `is_transfer`
defaults FALSE — **the exact silent failure invariant 5 exists to catch, arriving through the door the
CR had left open.** The seed-script entry is still added, for parity, but the migration is the
authority.

The endpoint resolves the category by name and 400s with a create-it-first message if absent
(mirroring [neutralize](../../server/src/v2/routes/transactions.js#L465)), and additionally enforces
invariant 5, so a mis-flagged row is rejected rather than silently mis-bucketed.

### Prod deploy order (must not be reordered)

1. Apply **migration 041** to prod — creates `income_restatements` **and** the COA row.
2. **Verify the flags** on prod: `is_transfer = TRUE`, `section = 'profit_loss'`.
3. Deploy the code (`./Scripts/deploy-to-production.sh`, which backs up the prod DB first).
4. Only then use the action on prod rows.

Per [git-concurrency §6](../../.claude/rules/git-concurrency.md): migrations go to prod **before** the
code that references the new objects.

A dedicated category rather than reusing `Transfer - Bank` (201): these rows are a **restatement of
history**, not an observed bank movement, and must stay findable as a class. `source = 'restatement'`
tags legs 1 and 2 but *not* leg 3 (an existing row we only re-categorize), so the category is the only
tag covering the whole triple. `skip_transfer_analysis` stays FALSE because legs 2 and 3 genuinely
pair and should auto-match.

`source = 'restatement'` also earns its keep operationally, not just as an audit tag: manual
calibration deletes prior marks with `DELETE FROM transactions WHERE account_id = $1 AND source = $2
AND transaction_date = $3` ([reconcileManual.js:193](../../server/src/v2/services/reconcileManual.js#L193)).
A distinct source is what stops a same-dated MTM re-run from eating a restatement leg. (`source` is
`varchar(20)`, no CHECK constraint; existing values `pocketsmith`, `quicken-import`, `bank-feed`,
`auto-offset`, `bank-statement`, `mtm`.)

## Linking and undo

**Migration 041 — new table `income_restatements`.** Rev 1 proposed reusing
`transfer_match_groups` / `transfer_match_group_members` to avoid a migration. Pass 1 showed that to be
unsafe on three counts, all reproduced:

1. `DELETE /api/v2/transfer-match-groups/:id`
   ([transferMatchGroups.js:44-54](../../server/src/v2/routes/transferMatchGroups.js#L44)) is wired to
   the per-group **Unlink** button on
   [TransferAnalysis.jsx:140](../../frontend/src/pages/TransferAnalysis.jsx#L140). Unlinking a
   restatement group would delete the only record of the operation, orphaning both created legs and
   defeating the "already booked" check that reads the same field.
2. `transferMatchGroups.create()` accepts no client and runs its own `BEGIN`/`COMMIT`
   ([transferMatchGroups.js:15-54](../../server/src/v2/repositories/transferMatchGroups.js#L15)), so
   invariant 6 is **not achievable** through it.
3. Group membership sets `transfer_matched = TRUE` on every member with no category filter
   ([transactions.js:270-280](../../server/src/v2/routes/transactions.js#L270)), so leg 1 — an
   *income* row — would answer the Ledger's `transferMatched=true` filter. And members are *excluded*
   from auto-matching ([transactions.js:183](../../server/src/v2/routes/transactions.js#L183)), so the
   group would actively **prevent** the match it was supposed to record.

The group buys nothing anyway: legs 2 and 3 auto-match on their own — same category, exact opposite
`base_amount`, same date.

```sql
CREATE TABLE income_restatements (
  id                    SERIAL PRIMARY KEY,
  source_transaction_id BIGINT NOT NULL UNIQUE REFERENCES transactions(id) ON DELETE CASCADE,
  holding_account_id    INTEGER NOT NULL REFERENCES accounts(id),
  original_category_id  INTEGER NOT NULL REFERENCES accounts(id),
  income_leg_id         BIGINT NOT NULL REFERENCES transactions(id),
  transfer_leg_id       BIGINT NOT NULL REFERENCES transactions(id),
  leg_snapshot          JSONB  NOT NULL,   -- see below
  created_at            TIMESTAMPTZ DEFAULT NOW()
);
```

`source_transaction_id UNIQUE` is what makes the 409 "already booked at source" check structural
rather than a lookup that can be skipped.

*FK asymmetry, deliberate but worth knowing:* `source_transaction_id` cascades, while
`income_leg_id` / `transfer_leg_id` restrict. So deleting the **source** row drops the restatement
record and leaves two orphaned legs on the holding — net-zero, harmless to the book, but a quiet loss
of the audit trail; deleting a **leg** from the Ledger raises a raw FK error rather than a message.
Neither is a correctness defect. Revisit if it bites.

**Undo's guard is constructed, not asserted.** `leg_snapshot` stores
`{account_id, transaction_date, amount, base_amount, category_id}` for **both** created legs as
written. Undo, in one DB transaction: re-read both legs, compare field-by-field against the snapshot,
**refuse (409) on any divergence**, re-assert `amount` and `base_amount` each sum to zero, then delete
the two legs, restore leg 3's `category_id` from `original_category_id`, and delete the row.

Without this, a legitimate-looking undo after someone edited leg 1's amount would move the holding's
book value — breaking invariant 2 *via the undo path*, and silently invalidating every subsequent
`Unrealized G/L` mark, since each mark was written as `target − book`.

## API

```
POST /api/v2/transactions/:id/book-at-source
  body: { holding_account_id: int, dryRun?: bool }
  200 → { data: { legs: [...], update: {...}, restatement_id } }   // dryRun: computed, not written
  400 → category missing or mis-flagged (inv. 5) / currency mismatch (inv. 4)
        / holding == source account / source row's category is not account_type='income'
  409 → source row already booked at source

POST /api/v2/transactions/:id/book-at-source/undo
  200 → { data: { deleted: [...], restored_category_id } }
  409 → no restatement for this row, or a leg diverges from its snapshot
```

`dryRun` follows the neutralize precedent so preview and write share one code path — the preview
cannot drift from what gets written. Both endpoints return the `{data}` envelope required by
`check-api-envelope.sh`.

## UI

A **new `<Modal>`** in `frontend/src/features/Transaction/BookAtSourceModal.jsx`, not an addition to
[Ledger.jsx](../../frontend/src/pages/Ledger.jsx) (already 1,085 lines) — per the CR043 `features/`
pattern, and because `check-modal-adoption.sh` polices exactly this. Rev 1 named Neutralize as the UI
precedent; that was wrong in kind — Neutralize is a *toolbar bulk action* over `selectedRows` with a
plain-text `ConfirmDialog` ([Ledger.jsx:334, 732, 915-920](../../frontend/src/pages/Ledger.jsx#L732)),
which cannot carry a holding picker plus a three-leg preview table. Only the `dryRun` **endpoint**
pattern carries over.

The Ledger gains one row action opening the modal; the modal renders the `dryRun` result as the exact
three legs plus the before/after book value of the holding, and writes nothing until confirmed. A row
that is already booked offers **Undo book at source** instead.

## Out of scope

- **CVC (6 rows) — and it needs its own design, not just a decision.** The targets are ambiguous
  (`CVC VII`, `Dividend CVC`, `ADJUST WIRE TRANSFER (Cash)`; "CVC VII" is not one of the three CVC
  accounts) *and* cross-currency: the six rows are **USD** on Fidelity Bond, while CVC Fund VIII (33)
  and CVC Fund IX (34) are **EUR**. Invariant 4 rejects those two outright; only CVC Investments (32,
  USD) is reachable by this tool. A cross-currency leg needs a rate policy this CR deliberately does
  not take.
- **`Financial Income - Other Investments` (6 rows, $3,466,141.40).** All six already sit on holdings
  (5 Fidelity Stocks, 1 CVC-MIP), two are negative (−1,300,000 PLN on CVC-MIP, −$673.49 on Fidelity
  Stocks) and the set spans currencies, so a PLN/USD total is not a real number
  ([CR054](cr-054-cash-flow-by-account.md) documents the same caveat). These look **mis-signed rather
  than mis-placed** — a different defect.
- Both of the above keep a **reduced CR056 P2 bullet** so the gap retains an owner in the docs; only
  the "Distributions received elsewhere" *mechanism* is deleted, not the outstanding data.
- **`Transfer - Historical` (category 221, 2,741 rows).** A *different shape*, and it must not be
  folded in. Those rows are single-legged transfers whose counter-account was never recorded (Chase
  Checking 1,798, PKO 523, Santandar 367, PKO Savings 28, Chase Saving 25). Adding the missing leg is
  **not** balance-neutral: it moves the source account's balance by the full amount. For a
  mark-to-market holding the unrecorded distributions were silently absorbed by later marks (each mark
  = *target − book*, so a too-high book produced a too-small mark), which means each added `−X` leg
  must be paired with a `+X` adjustment to the following mark to keep the ending value intact. That is
  a per-row judgement needing its own CR.
- Per-security attribution; any change to how marks are captured.

## Effects that are changes, not just corrections

**Corrected in rev 3, after measuring it on dev.** Rev 2 said PKO's line would be *relabelled* to
`Transfer - Distributions`. It is not: the Cash Flow report defaults to `transfers = 'exclude'`
([reports.js:250, 347](../../server/src/services/reports.js#L250)), so the restated rows leave PKO's
P&L **entirely** and reappear under the holding. (Pass 1 asserted Cash Flow applies "no `is_transfer`
exclusion" — that was wrong, and only running it surfaced it.) Measured, 2026, PKO, original currency:

| Line | Before | After |
|---|---:|---:|
| `Financial Income - UB Dividend` | 690,874.27 | **0** |
| `Financial Income - Barkeria` | 128,084.62 | **0** |
| `Financial Income` (PKO) | 829,286.88 | **10,327.99** |
| `Financial Income - UB Dividend` (United Beverages) | 0 | **690,874.27** |

So the income is not hidden — it moves to the account that earned it, which is the whole point. The
honest statement of the trade: **PKO's cash-flow view loses a line it arguably should keep**, because
the cash really did land there; what it gains is that PKO stops being credited with income it did not
earn. Rev 1 listed CR054 as a beneficiary; that was overstated either way.

## Verification — RUN, against a prod copy on dev (`:3105`), 2026-07-27

Dev was re-synced from prod (`Scripts/sync-db-prod-to-dev.sh`, 37,364 rows), migration 041 applied,
all 7 rows booked, every check below run, then all 7 undone so the owner could walk it themselves.
**Every assertion passed.** Results are inline; the plan follows.

| # | Check | Result |
|---|---|---|
| 1 | UB `Net external flows` delta | **−1,340,251.54 USD / −5,172,998.27 PLN** — exact |
| 1 | UB `Income` delta | **+1,340,251.54 / +5,172,998.27** — exact, equal and opposite |
| 1 | UB `Beginning MV` / `Ending MV` | **byte-identical** in both modes |
| 1 | UB **`FX effect`** | **unchanged to the cent** (USD mode, non-zero row); **0.00** in LC mode |
| 2 | UB `Realized return %` | **0.00% → 5.10 / 8.31 / 4.27 / 3.42%** (2023–26, USD) |
| 3 | Book value, accounts 43 / 44 | **20,686,000.00 / 5,010,959.16** and **3,918,992.00 / 1,055,684.05** — unchanged |
| 4 | Balance-sheet report, prod vs dev | **byte-identical**; net worth 13,715,092.80 both |
| 4 | Cash-flow report (all accounts), prod vs dev | **byte-identical** |
| 4 | Category totals 73 / 77 | **5,172,998.27 / 146,294.12** — unchanged; new category 228 sums to **0.00** over 14 rows |
| 5 | PKO balance | **40,363.59 / 51,193.83, 4,572 rows** — unchanged (see the table above for the intended P&L move) |
| 6 | UB marks | all 8 `Unrealized G/L` postings incl. the 2025-12-31 `mtm` −6,956,000.00 **untouched** |
| 7 | Forecast re-base + calibration | `refreshModulesFromActuals` query returns **identical** LC/USD for 18, 43, 44 |
| 8 | Round-trip | undo restored all 7 exactly; **0** residual legs, **0** restatement rows, categories back to 73/77 |
| 8 | Undo refusal | edit a leg → **409, refused**; restore it → undo succeeds |
| 9 | Transfer Analysis 2026 | `Transfer - Distributions`: **2 matched, 0 unmatched** — auto-matched, no manual group |

Guards: all six ✓ except `check-lint-debt.sh`, which aborts on a **pre-existing** lint error at HEAD
(see [Not done](#not-done--notes)) — the CR's own debt counts are at or below baseline.
Tests: **487 backend** (17 new) / **195 frontend** / build ✓.

### The plan, as specified

**The rev-1 plan led with "the identity must remain 0.0000". That test cannot fail** —
`fxEffect = totalReturn − (income + price + unattributed)`
([investmentReturns.js:568](../../server/src/services/investmentReturns.js#L568)) is a *plug*, and the
code comment says so: *"FX effect is the plug, so the column ties by construction."* The identity
closes for any input, correct or corrupt. Replaced with falsifiable before/after assertions:

1. **United Beverages, same period/interval/currency, before vs after:**
   - `Net external flows` moves by exactly **−5,172,998.27** (LC) / **−1,340,251.54** (USD)
   - `Income` moves by exactly the same magnitude, positive
   - `Beginning MV` and `Ending MV` **byte-identical**
   - `FX effect` **unchanged to the cent** in USD mode (a PLN account, so this row is non-zero — it is
     precisely where a bad `base_amount` copy surfaces), and exactly `0.00` in LC mode
   - Same for Barkeria at **−146,294.12** / **−40,141.48**
2. **Realized % becomes non-zero** for both holdings, in the interval containing each payment's date;
   all four interval modes (month / quarter / year / marks) render.
3. **Book value unchanged** — `SUM(amount)`/`SUM(base_amount)` on accounts 43 and 44 identical before
   and after: **20,686,000.00 / 5,010,959.16** and **3,918,992.00 / 1,055,684.05**.
4. **Net worth and P&L totals unchanged** — balance-sheet total and category totals for 73/77
   identical; only account attribution moves. (P&L groups by category name with no `is_transfer`
   exclusion, [reports.js:328-336](../../server/src/services/reports.js#L328), so the transfer pair
   nets to zero.)
5. **PKO balance identical**; its income falls by exactly 5,319,292.39 PLN and its transfers rise by
   the same — the intended correction. **Plus an eyes-on check on dev**: open Cash Flow By Account
   filtered to PKO and look at the change described under
   [Effects that are changes](#effects-that-are-changes-not-just-corrections) before any prod write.
   A numeric assertion does not tell the owner what the report will look like, and that report shipped
   six days earlier.
6. **Marks unaffected** — the 8 `Unrealized G/L` postings on account 43 and the 2025-12-31 `mtm`
   −6,956,000.00 unchanged, and still consistent with the ending book.
7. **Forecast + calibration untouched** — `refreshModulesFromActuals` and a calibrate/MTM dry-run on
   43 and 44 return the same numbers as before.
8. **Round-trip** — book, then undo, then diff the three rows back to their original state; and undo
   **refuses** after a hand-edit to a leg.
9. **Transfer Analysis** — legs 2 and 3 appear as an **auto**-matched pair (not a manual group; rev 1
   said "match" without noting group members are excluded from auto-matching); no previously-matched
   pair breaks.

### Tests

- `bucketOf` unit tests asserting the two legs land in `income` / `flow` — already exported at
  [investmentReturns.js:841](../../server/src/services/investmentReturns.js#L841).
- Service test: `FX effect` unchanged to the cent across the restatement.
- Route tests: 400 when the resolved category has `is_transfer = FALSE` (invariant 5); 400 on currency
  mismatch, non-income source category, self-transfer; 409 on double-book.
- Undo tests: happy-path round-trip, and refusal after a leg edit.
- Leg-construction unit tests: exact copy/negate on `amount` **and** `base_amount`.
- CI: `check-api-envelope.sh` (both endpoints return `{data}`), `check-modal-adoption.sh` (the new
  modal), `check-lint-debt.sh` (may only shrink).

## Risks

- **Exactness of the copy** (invariant 1) is the whole correctness story, and pass 1 showed the report
  will not tell you when it is wrong. Mitigated by the server-side sum assertions and by verification
  step 1's `FX effect` comparison, which is the one number that does move if a copy is bad.
- **Classification.** Three of the seven rows are loan-related; the owner has decided they are income
  attributable to the holding (see above). If that proves wrong for any row, undo and rebook via
  `Return of Capital` (217).
- Blast radius is one row per action, previewed before write and undoable after.

## Follow-ups — tracked, deliberately not in this CR

1. **Attention-strip rule** ([CR038](cr-038-home-dashboard-attention.md)). Nothing prompts the owner at
   the ~2/yr moment: the next UB dividend arrives from the feed onto PKO, gets categorized as income,
   and the report drifts quietly back toward wrong. One rule — *"income in a holding-attributed
   category posted to a non-holding account"* — is what turns this from a cleanup into durable
   workflow. The strip already carries the analogous KI#8 "verify USD value" rule.
2. **`Transfer - Historical` repair (2,741 rows)** — needs its own CR, including the finding recorded
   under [Out of scope](#out-of-scope) that each added counter-leg must be paired with an adjustment to
   the following mark.
3. **CVC and `Other Investments`** — kept as a reduced CR056 P2 bullet so the outstanding data retains
   an owner; the "Distributions received elsewhere" *mechanism* is what CR057 deletes, not the gap.
4. **CR052's migration number** — it still calls itself "migration 040", which the v3.4.6 data fix took;
   renumber when it is picked up.

## Not done / notes

- **Shipped v3.6.0.** Owner walked the Ledger flow on dev and booked 2 of the 7 rows; both restatements round-tripped and the report moved as predicted. Migration 041 applied to prod **before** the code deploy, per the order above.
- **Two things only running it could find**, both recorded above: the Cash Flow transfer-exclusion
  (rev 2 and pass 1 both had it wrong), and a **double-book guard that returned the wrong error** —
  booking rewrites the row's category, so a second attempt reported *"only income can be booked at
  source"* instead of the 409. The already-booked check now runs first. Both are why the CR asked for
  a walkthrough rather than a test-suite sign-off.
- **Pre-existing blocker, not from this CR:** `frontend/src/mobile/MobileTabBar.jsx:18` has a
  `no-unused-vars` **error** at HEAD (`'Icon' is defined but never used`, though it *is* used in JSX
  at line 27). It came in with **v3.4.8 / `b3cc79d`**, so `npm run lint` — a blocking CI step — is red
  on `main` today, independent of CR057. It also makes `check-lint-debt.sh` abort with no output and
  exit 1 (`set -e` + `pipefail` on an eslint that exits non-zero), which reads as a debt-ratchet
  failure when it is not. Needs its own fix; do not fold it into this CR's commit.
- Pass 1 **revise** (5 blocking) → addressed in rev 2; pass 2 **GO** with two must-resolves → both
  folded in.
- Doc sync done at sign-off: row in [`docs/cr/README.md`](README.md), `#cr057` anchor in
  [project-roadmap.md](../current/project-roadmap.md). The
  [migrations.md](../current/migrations.md) row for 041 lands when the migration is written.
- Ship as **minor v3.6.0** (`./Scripts/bump-version.sh`): migration + two endpoints + a new COA row +
  a visible change to a shipped report.
