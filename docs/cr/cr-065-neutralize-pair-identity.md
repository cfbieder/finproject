# CR065 — A neutralize counter-leg is claimable exactly once — ✅ COMPLETE (v3.11.4, migration 053 dev + prod)

`neutralize()` decided "does this row already have a counter-leg?" by re-running a **value
match** over the ledger. Value-matching is not identity: two rows of the same value are
indistinguishable, so one counter-leg could be claimed by any number of originals, and
nothing in the schema recorded that a claim had happened — so nothing could refuse the
second one. On 2026-07-30 two identical $150,000 CD purchases claimed the same $150,000
mirror and Fidelity Cash Mgt ran **$150,000 light**.
[Roadmap](../current/project-roadmap.md) · [CR028](cr-028-securities-trade-neutralization.md) ·
[CR032](cr-032-core-cash-sweep-neutralization.md)

**Opened:** 2026-08-02 · **Track:** v3 · **Migration:** 053 (**dev + prod applied 2026-08-02**)
**Shipped:** 2026-08-02 (v3.11.4) · **Prod data corrected** the same day — §6.
**Found by:** the owner, asking why Fidelity Cash Mgt showed −107,830.71 of drift when it
"cannot just be MTM". It could not — see §2.

---

## 1. What happened

fintable delivered two genuine, separate CD purchases into Fidelity Cash Mgt, both $150,000,
both on 2026-07-30. Both promoted correctly (`accepted=FALSE`, category *Transfer -
Securities Trades*). Then, from the Ledger page:

| time | event |
|---|---|
| 14:08:45.798 | promote inserts **2709774** (United Bankers) and **2709773** (Texas Exchange), each −150,000 |
| 14:08:59.807 | `neutralize(2709774)` → no candidate → **mirror** → INSERT **2709785** (+150,000, `auto-offset`) |
| 14:09:03.838 | `neutralize(2709773)` → candidate query **finds 2709785** → **pair** → no insert, re-stamps both |

The timestamps are the proof: `2709773.updated_at` and `2709785.updated_at` are identical to
the microsecond — the pairing `UPDATE` hitting both rows in one transaction — and
`2709774.updated_at` equals `2709785.created_at`, which is the mirror insert. Both −150,000
legs ended up claiming the same +150,000 counter-leg.

This was **not** a fintable defect. Both staging rows are `source='fintable'`, distinct
external_ids, fetched exactly once each at 2026-08-01 06:00:01, and the Fidelity statement
confirms two real CD purchases. Nothing upstream dropped, merged or duplicated anything.

## 2. Why it hid for five days

The account is `reconcile_mode = mtm`, so a gap between fin and the custodian reads as an
un-booked market move. A $150,000 bookkeeping hole is indistinguishable from a market move
in that column, and the drift it produced was partly cancelled by an unrelated backlog:

| | |
|---|---|
| fin computed (2026-08-02) | 979,308.20 |
| + the missing counter-leg | +150,000.00 |
| − nine unpromoted 2026-07-31 feed rows (a −41,564.86 wire, +199.71 income; the core redemptions self-net) | −41,364.79 |
| **corrected** | **1,087,943.41** |
| bank reported | 1,087,138.91 |
| **residual — the genuine MTM** | **+804.50** |

Cross-check against the statement: cash 86,819.99 + $1,000,000 CD face = 1,086,819.99; the
bank's figure sits 318.92 above that (accrued/market on the CDs). So of −107,830.71 of
"MTM gap", **$108,635 was not market movement at all** and $804.50 was.

## 3. Root cause

[repositories/transactions.js](../../server/src/v2/repositories/transactions.js) — the
candidate query matched on account + negated amount + ±3 days + compatible category. Three
distinct defects fell out of the one cause:

1. **A synthetic mirror was a valid candidate.** The CR032 guard `(category_id IS NULL OR
   category_id = $6)` was written to stop a deliberately-categorized *real* trade being
   consumed. It does the opposite for a mirror: a mirror always carries exactly the category
   being passed in, so the guard made it the single most pairable row in the table.
2. **A real leg could be double-claimed too.** Rows `A −150k`, `B −150k`, genuine `C +150k`:
   neutralize A pairs with C; neutralize B finds C still matching and pairs again. Excluding
   `auto-offset` alone would **not** have fixed this.
3. **The read was outside the write.** The candidate `SELECT` ran on the pool; the write
   opened a separate transaction. [Ledger.jsx](../../frontend/src/pages/Ledger.jsx) applied
   the batch with `Promise.all`, so every request decided against the same pre-write state —
   concurrency was the normal path, not an edge case.

And it was invisible because **the warning was on the wrong branch**: the confirm dialog
warns on `mirror` (the correct action here) and showed the reassuring *"Pair 1 transaction
with their existing offsetting leg… No new entries"* with `danger: false`.

## 4. The fix

### 4.1 Identity — migration 053

`transactions.paired_with_id` (nullable self-FK, `ON DELETE SET NULL`), written
**symmetrically** on both rows of a pair, plus:

```sql
CREATE UNIQUE INDEX uq_transactions_paired_with
  ON transactions (paired_with_id) WHERE paired_with_id IS NOT NULL;
```

That index is the point of the exercise: two rows may not name the same counter-leg, so the
double-claim is refused by the **database** even if the application logic regresses.
Correctness stops depending on a `WHERE` clause.

**Backfill** — the mirror path only, and only where exact. A mirror and its original are
written in one transaction, so `original.updated_at = mirror.created_at` to the microsecond;
combined with account + date + `description1` + negated amount, that is what disambiguates
the incident, where date and amount alone cannot. Both directions must be 1:1 or the row is
left NULL — a *wrong* link would make a genuinely-unclaimed leg ineligible and mirror
against it, which double-counts in the other direction. Unlinked is safe; mislinked is not.
On dev this linked 316 rows (158 pairs) and left 18 mirrors unlinked.

**Known residual, stated not papered over:** PAIR-path history (two real legs matched to each
other) left no durable trace and is **not** backfilled. What protects it is §4.2's
`source <> 'auto-offset'` guard plus the unique index from first touch.

### 4.2 Eligibility

Two clauses added to the (now single, shared) candidate predicate:

- `paired_with_id IS NULL` — not already spoken for. Note this is **not** `accepted = FALSE`:
  accepting a row in the review queue means *"I have looked at this"*, not *"this is spent"*.
  Conflating them would refuse legitimate pairs and mirror instead — the same double-count,
  in the other direction.
- `source <> 'auto-offset'` — a mirror is never a pair candidate. It was created to answer
  exactly one leg; an unclaimed one is an orphan to remove, not a leg to pair with. This also
  covers every pre-053 mirror, which is what makes the §4.1 residual safe.

### 4.3 Atomicity and idempotency

The decision moved inside the write transaction. The original is locked `FOR UPDATE` first,
and a counter-leg is taken by **compare-and-swap** (`UPDATE … WHERE paired_with_id IS NULL`)
rather than by lock, so a racing neutralize *loses the swap* instead of silently sharing the
leg; a lost race re-looks (bounded, 3 attempts) rather than falling straight to a mirror.
A row that is already half of a pair returns **`already-paired`** — a no-op. Re-clicking, or
a double-submit, can no longer produce a second counter-leg.

### 4.4 The client stops racing itself

[Ledger.jsx](../../frontend/src/pages/Ledger.jsx) applies **sequentially**, and reports what
actually happened (`N created, M paired`) rather than what the preview predicted, flagging it
when the two differ. The preview also now says when several selected rows are contending for
one leg. A plan of "2 new entries" that delivers 1 is a legitimate outcome of correct
sequencing — saying so is the difference between a visible surprise and a silent $150k.

### 4.5 The check that would have caught it

`balanceReconcile` ([bankFeedReconciliation.js](../../server/src/v2/repositories/bankFeedReconciliation.js))
now reports, per account, **accepted securities-transfer legs with no counter-leg** —
surfaced under Drift on Balance Calibration. Unlike drift it needs no feed balance and admits
no benign reading. Keyed off the **leg count**, not the amount: two unpaired legs that happen
to cancel are still two errors.

**Bounded to `id > watermark`** (`app_data.cr065_pairing_since_tx_id`, stamped by 053 as
`MAX(id)`). Pairing was only *recorded* from 053 forward, and this category has also carried
genuine **cross-account** securities transfers whose counter-leg legitimately sits elsewhere
— on prod that is ~1,800 legacy legs across five accounts, with Fidelity Stocks
(+134,772.19) against Fidelity Cash Mgt (−138,113.41) mostly *being* those cross-account
pairs. Unbounded, the check would paint five accounts permanently red, which is a warning
everybody learns to scroll past. `MAX(id)` rather than a timestamp deliberately: a hard
boundary immune to the UTC-vs-local parsing this codebase has been bitten by three times
([Known Issue #3](../current/project-roadmap.md#3-known-issues)). A fresh database stores 0
and checks everything.

## 5. Verification

- **Nine** DB-backed tests in
  [neutralize.test.js](../../server/src/v2/repositories/__tests__/neutralize.test.js) — the
  four pre-existing behaviours unchanged, plus: two identical same-day trades each get their
  own counter-leg; a real counter-leg is claimed once and the second trade mirrors; links are
  symmetric and a mirror is never a candidate; re-neutralizing is a no-op; and the unique
  index refuses a double-claim written *around* the query guard.
- **End-to-end on dev through the live API.** Two −150,000 rows dated 2026-07-30 in Fidelity
  Cash Mgt, neutralized in sequence, produced **two distinct mirrors** (2722667, 2722669);
  the accidental repeat calls were absorbed as `already-paired`, leaving 2 offsets, not 8.
  Deleting one mirror made the recon endpoint report `unpaired_legs=1, amount=-150000` on
  Fidelity Cash Mgt; probe rows removed afterwards.
- **Gates:** 740 backend · 298 frontend · lint 0 errors · all six ratchets OK.
- Migration re-applied to dev to prove idempotency (`UPDATE 0` on the second run).

## 6. Prod, 2026-08-02

Backup taken first (`Backups/fin_backup_20260802_123125_pre-cr065.dump`, 4.3 MB).

**Migration** applied with `node server/db/migrate.js` rather than by hand, so the
`schema_migrations` ledger records it and `deploy-to-production.sh` will not re-run it.
Dry-run showed exactly one pending file. The backfill linked **328 rows (164 pairs)**, left
18 mirrors NULL, and — the check that mattered — linked mirror 2709785 to **2709774**
(United Bankers) while correctly leaving **2709773** (Texas Exchange) unclaimed.

**The data fix went in as SQL, not through the API.** Prod still runs the *old* `neutralize()`,
whose candidate query does not test `paired_with_id`: calling it on 2709773 would have found
2709785 a second time and re-paired, reproducing the defect and creating nothing. So the
mirror path was replicated in one transaction — insert the negated `auto-offset` leg with
`paired_with_id` set, stamp the original — guarded by `paired_with_id IS NULL` so a re-run is
a no-op. **This is the ordering correction to §7.1 as first written: the data fix must follow the code deploy,
or bypass the API entirely.**

| | |
|---|---|
| computed before | 979,308.20 |
| computed after (new leg **2709789**, +150,000) | 1,129,308.20 |
| bank reported | 1,087,138.91 |
| **drift, was −107,830.71, now** | **+42,169.29** |

And that remainder decomposes exactly: 41,364.79 (the unpromoted 2026-07-31 feed rows) +
804.50 (the genuine MTM) = 42,169.29. Both pairs are symmetric and a table-wide check returns
**zero** one-sided links.

## 7. Still open

1. **The 2026-07-31 feed backlog** (nine staged rows, net −41,364.79) is unpromoted, and
   Fidelity Options carries **191** unpromoted staging rows back to 2026-05-04 (Stocks 46).
   Those net to ~0 so they are not distorting balances the same way, but they want a look.
2. **The $78.35 residue** on Fidelity Cash Mgt beyond the $150,000, and the smaller ones on
   IRA / Bond / Stocks / Options, are pre-existing and unexplained. The §4.5 check cannot see
   them (pre-watermark) — they need a one-off pass.
3. **Transfer Analysis already has both cleanup halves** ("remove orphaned neutralize-mirror",
   "neutralize a genuine unmatched leg"), so the *converse* symptom was known and tooled. The
   direction this CR fixes had no detection at all until §4.5.

## 8. The same defect, one level down (2026-08-02, one hour after the deploy)

053 gave a pair an identity and taught `neutralize()` to record it. **`neutralize()` is
not the only thing that makes a pair**, and the two that were missed both wrote their
counter-leg with `paired_with_id` NULL:

- `refreshBankFeedV2` — the CR032 core-sweep mirror, on every promote.
- `transferToAccount` — the CR022 cross-account offset.

An unrecorded pair *looks unclaimed*, which is exactly the state the new guard reads. So
the fix reopened the hole it had closed, one level down. It took under an hour to prove on
production:

1. The v3.11.4 boot-reconcile promoted the 2026-07-31 backlog, including a Fidelity Bond
   sweep — `2709863` (−20,000, PURCHASE INTO CORE) plus mirror `2709864` (+20,000) — with
   the pair unrecorded.
2. A neutralize of the bond redemption `2709858` (+20,000) found `2709863` apparently free
   and claimed it, exactly as the CD purchases had claimed one mirror in §1.
3. `2709864` was left an orphan and Fidelity Bond ran **+$20,000**, drift 27,670.78.

**The check added in §4.5 caught it the same hour** — `unpaired_legs=1, amount=20000` on
Fidelity Bond. That is the one part of this CR that behaved exactly as designed, and it is
the argument for detection over care.

It also exposed the check reporting **its own false positives**: 6 unpaired legs on Fidelity
Cash Mgt immediately after the deploy, being the three sweep pairs, and gaining two more per
sweep per day until the number meant nothing.

**Fixed:** both paths now record the pair symmetrically, as `neutralize()` does; migration
**054** links what was already written; a test pins the cross-account link. Linking
`transferToAccount` also removes the largest false-positive class the check could have had —
a legitimate cross-account transfer whose counter-leg is in another account.

**Repair.** `2709858 ↔ 2709863` was broken, `2709863 ↔ 2709864` restored as the true sweep
pair, and the redemption neutralized properly — the dry-run returned **`mirror`**, not
`pair`, the fixed code declining to take a claimed leg, and created `2709884` (−20,000).
Fidelity Bond drift 27,670.78 → **7,670.78**. Prod now reports **0 unpaired legs on every
account** and **0** one-sided links table-wide; Fidelity Cash Mgt sits at **804.50**, the
genuine MTM predicted in §2.

**The lesson worth keeping:** a uniqueness invariant only holds if *every* writer maintains
it. The unique index cannot help here — it constrains rows that name a partner, and these
paths named nobody. Any new code that creates an offsetting leg must set `paired_with_id`,
and the §4.5 check is what will say so if it does not.

## 9. Defence in depth: the badge and the accept guard (v3.11.5)

Asked for by the owner as *"if we just accept a securities trade, pop a warning — are you
sure no offset needed?"*

**Stated plainly first: neither of these would have caught §1 or §8.** The CD row in §1 was
accepted *by the neutralize call itself* — there was no bare Accept to warn on. The Bond row
in §8 was a legitimate neutralize acting on data that an unrecorded pair had made wrong.
What prevents those is §4.1–4.3 and §8; what caught §8 was §4.5. This closes a **third**
hole — accept-without-neutralize — and moves the signal from a once-a-day reconcile page to
where the decision is actually made.

**`NEEDS_OFFSET_SQL`** — one definition of "self-netting transfer leg with no counter-leg",
exported from the transactions repository and used by all three list queries **and** the
review-queue endpoint. The badge the owner sees and the number the reconcile page counts are
therefore the same predicate; they cannot drift apart. Bounded by the 053 watermark for the
reason in §4.5, and a missing watermark key yields FALSE — quiet, not loud-and-wrong.

**The badge.** A flagged row wears `no offset` beside its description in the review queue.

**The guard.** All four accept paths — single row, Accept All, by-source, Accept Selected —
funnel through one gate, so a leg cannot slip in by a route nobody thought about. It names
the rows, totals the exposure, and says what accepting will look like: *drift, and on a
brokerage account, a market move rather than a mistake.*

It **warns rather than blocks**, deliberately. A DB trigger refusing `accepted = TRUE` on an
unpaired leg would be the strongest form and is the wrong one: this category also carries
genuine cross-account securities transfers whose counter-leg legitimately sits in another
account (Known Issue #13), and a hard constraint would refuse them.

**Live on prod immediately.** 3 of the 71 rows in the review queue flagged — three
REINVESTMENT legs on Fidelity IRA (−24.93, −152.55, −113.43) that would have taken the
account $290.91 light on accept. Note the reconcile check reads **0** at the same moment:
those rows are not accepted yet, so they are not errors yet. That is the division of labour
— the badge catches a leg *before* it becomes an error, §4.5 catches one after.

Twelve DB-backed tests now, two of them pinning the flag itself: true for an unpaired leg,
false once neutralized, and never set on an ordinary category.

## 10. Closing out — and one more defect the close-out found

**The three Fidelity IRA reinvestment legs** flagged by §9 were neutralized. Worth recording
why the dry-run mattered: each `REINVESTMENT −X` sits beside a `DIVIDEND RECEIVED +X` of the
**identical amount on the same date**, which is precisely the shape the pair-matcher looks
for. Pairing them would have consumed real dividend income as a counter-leg and left the
fund purchase unmirrored. All three previewed as **`mirror`** — the CR032 category guard
(§3.1) refusing them, because a dividend carries `Financial Income - Dividend`, not the
transfer category. Three mirrors created; the dividends untouched.

**Booking the MTM surfaced a new defect.** `reconcileToFeed` proposed **+$40,150.79** for a
2026-07-31 month-end mark on Fidelity Cash Mgt — a 3.6% one-month unrealized gain on a **CD
ladder held at par**, which is not a thing. The cause: it takes the newest
`bankfeed_balances` row dated `<= bookDate`, and this feed's row dated 07-31 was **synced at
01:48 on 07-31**, before that day's −41,564.86 wire. The row that actually reflects the 07/31
close is dated **08-02**.

The existing stale-feed guard cannot see it. It fires on *no row dated month-end* or *three
identical balances* — both of which test the **date label**. This row has the right label and
the wrong contents. `source_synced_at` is the signal that would catch it: a balance synced
before the end of the day it is dated cannot contain that day. Filed as
[Known Issue #14](../current/project-roadmap.md#3-known-issues).

Booked at `bookDate` **2026-08-02** instead, against the balance that does reflect the 07/31
close: **−804.50**, entry `2709888`, category *Unrealized G/L*. If the owner wants the mark
in July's P&L rather than August's it should be re-dated — the amount is right either way.

**Fidelity Cash Mgt now reconciles at drift 0.00**, from −107,830.71. The remaining Fidelity
drifts (Stocks 20,247.88 · Bond 7,670.78 · Options 1,498.51 · IRA 1,347.11) are un-booked
market moves awaiting their own marks, and every account reports **0 unpaired legs**.

## 11. An MTM may only mark a day the balance could actually contain (v3.11.6)

Owner-found, an hour after §10 filed the theory: *"I clicked the MTM adjustment for Fidelity
Stocks but it still shows a big difference — the balance from Friday 7/31 should be the same
today?"*

**That calendar argument is the proof.** 2026-07-31 was a Friday; 08-01 and 08-02 are the
weekend. With markets shut, Friday's close and "today" must be the same number. They were
not:

| balance_date | balance | source_synced_at |
|---|---|---|
| 2026-08-02 (Sun) | 1,165,523.25 | 00:05 on 08-02 |
| 2026-08-01 (Sat) | 1,157,779.86 | 00:53 on 08-01 |
| **2026-07-31 (Fri)** | **1,141,170.68** | **01:48 on 07-31** |

The feed labels a balance with the date it **synced**, and it syncs in the small hours — so
the row dated 07-31 was taken before Friday traded. Marking against it booked **−44,600.45**
and left Stocks **24,352.57 below** the custodian. Cash Mgt, the same day, was proposed
**+40,150.79** — a 3.6% one-month unrealized gain on a **CD ladder held at par**, under the
implausibility threshold and therefore unflagged (§10).

**Why neither existing guard could see it.** Both test the date **label** — "no row dated
month-end" and "three identical balances". This row has the right label and the wrong
contents. Guard **(c)** tests `source_synced_at` instead: *a balance synced before the end of
the day it is named after cannot contain that day.* It refuses rather than books. A NULL
`source_synced_at` means "cannot tell" and stays lenient, so nothing pre-existing changed —
all 17 prior reconcile tests passed untouched.

**Deliberately not a lag rule.** How far behind the feed runs, and whether in calendar or
business days, is still unproven ([Known Issue #14](../current/project-roadmap.md#3-known-issues));
encoding a guess would silently mis-mark every future month-end. So a new **`balanceDate`**
states *which observation* to mark against while the entry keeps the month-end date it
belongs to. The guard stops the silent mistakes in the meantime.

**Both accounts re-marked at July month-end**, each replacing its wrong entry:

| | was | now |
|---|---|---|
| Fidelity Stocks | −44,600.45 dated 07-31 → drift −24,352.57 | **−20,247.88** dated 07-31 → **drift 0.00** |
| Fidelity Cash Mgt | −804.50 stranded on 08-02 | **−804.50** dated 07-31 → **drift 0.00** |

Bond (7,670.78), Options (1,498.51) and IRA (1,347.11) still await their own marks — the
same `bookDate` 2026-07-31 + `balanceDate` 2026-08-02 pairing applies, and the guard will now
refuse them if that observation turns out not to contain 07/31 either.

### 11.1 The guard needed a way out (v3.11.7)

Shipping guard (c) left the UI with a refusal and no remedy — the page only ever sent
`bookDate`, so Bond, Options and IRA became unbookable from the browser. The owner hit it
within the hour: *"I did the MTM adjustment as of 7/31 but it did not book."* It was working
exactly as designed and that is not the same as being usable.

- The refusal now **lists the candidate observations with their balances** —
  `Later observations: 2026-08-01 = 1,219,893.81 · 2026-08-02 = 1,219,402.92` — so the choice
  is made on evidence rather than a shrug.
- `MtmDateControl` gains an optional **"mark against balance dated"** input, plumbed through
  as `balanceDate`. Blank = unchanged behaviour, so nothing else moves.

**Still no auto-pick, and this is the reason:** "synced after day D" does **not** imply
"contains day D". Fidelity Cash Mgt's 08-01 observation was synced after 07-31 ended and
still lacked that day's −41,564.86 wire. Any auto-rule would have chosen it and been wrong.
The evidence goes to the human until the lag is actually proven (Known Issue #14).

**Which observation is right, and how we know.** Cash Mgt is the account that can be checked
against a document: its 08-02 observation (1,087,138.91) matches the custodian's 07/31 close
exactly, and 08-01 does not. All these accounts ride one connection synced at the same times,
so 08-02 is the observation carrying 07-31 for all of them — which is also what the Stocks
weekend argument independently implies.

**Fidelity Bond booked** −7,670.78 at 2026-07-31 against the 08-02 observation → **drift
0.00**. Three of five Fidelity accounts now reconcile exactly; Options (1,498.51) and IRA
(1,347.11) remain, same treatment.

## 12. Chase Checking: a plug for history that arrived later

Not a CR065 defect — found while sweeping the reconcile page to zero, with the owner's
`Chase7265_Activity_20260802.csv` as the check.

**The activity is perfect.** 142 rows in the bank export, 142 in fin, identical sums, nothing
unmatched in either direction over 2026-01-02 → 2026-07-31. So none of the −1,950.61 drift
was in the transactions; all of it was in the balance carried *into* the window:

| | |
|---|---|
| bank balance before the earliest CSV row | 25,166.36 |
| fin balance at 2026-01-01 | 23,215.75 |
| difference | **1,950.61** |

**A plug that outlived its history.** On **2026-05-21** the account was calibrated: fin's
Chase history then began 2022-12-01, and `opening_balance` was set to **−1,995.64** to stand
in for everything earlier. On **2026-06-05** the Quicken import back-filled **6,058
transactions** covering 1999-12-31 → 2022-11-25 — including its own `Opening Balance` row of
**+1,950.61** — and nothing reset the plug. The account then carried its pre-2022 history
twice: once as a plug, once as the real rows. The delta is exactly the Quicken opening row.

Same class as CR058's "2023 handoff plug", which was found and corrected for Fidelity and
never done for Chase.

**Re-anchored** to **−45.03** (`old_opening −1,995.64 → new_opening −45.03`) — a figure
derived by hand before the dry-run was run, and matched by it. **Every fed account now
reconciles: `total_unreconciled: 0`.**

**Correcting the first reading of this** (kept, because the wrong version is instructive):
the −45.03 was initially reported as "1,950.61 explained + 45.03 unexplained residue", on the
assumption that `opening_balance` ought to be **0** because the Quicken row is the 1999
opening. It ought not. `opening_balance` is a **calibration anchor, not a historical fact** —
and 0 is the rule only for accounts with *no* PocketSmith coverage
([quicken-promote.js Step 8](../../server/src/v2/scripts/quicken-promote.js)):

> *pin each touched account's `opening_balance` so today's computed balance equals
> PocketSmith's authoritative closing_balance … Accounts with no PS coverage (closed/legacy)
> anchor to pure reconstruction (`opening_balance = 0`).*

Chase **has** PS coverage, so it was anchored to PocketSmith — and the batch confirms it
(`calibration_mode = 'ps-anchored'`, promoted 2026-06-05, 6,058 rows). PS coverage for Chase
ends **2026-06-01**; the feed takes over **2026-06-03**. So the account was pinned to a source
that had stopped being the truth, and drifted from the bank by 1,950.61.

That is a **named, already-documented failure mode**, in the same file, a few lines further
on: *"PS-anchoring drags it back to a stale PocketSmith closing_balance (−42,552.71 on Fidelity
Stocks, whose PS coverage stopped in May 2026)."* Chase is the same defect, two orders of
magnitude smaller, on an account nobody thought to re-check.

So there is **no residue to chase**: −45.03 is simply the anchor value that ties a feed-owned
account to bank truth, which is what re-anchoring is for. The equality between the drift and
the Quicken opening row (1,950.61) is a coincidence of this account's history, not a
mechanism.

### 12.1 Why Fidelity is NOT exposed to the same thing

Four other accounts were calibrated *before* Quicken back-filled them, so the question was
whether their plugs are stale too — and for the two `mtm` ones it matters more, because a
stale plug there would be absorbed into an MTM entry and read as *unrealized gain*.

The ordering settles it:

| account | calibrated | quicken imported | **anchors written** |
|---|---|---|---|
| Chase Checking | 2026-05-21 | 2026-06-05 | **never** |
| Fidelity IRA | 2026-06-03 | 2026-07-30 | 2026-07-30 |
| Fidelity Stocks | 2026-06-03 | 2026-07-29 | 2026-07-31 |

CR058's valuation anchors are **deltas that force fin to the custodian's statement** at each
quarter-end, and for both Fidelity accounts they were computed **after** the import — so any
plug error upstream of the last anchor (2025-12-31 IRA, 2025-01-01 Stocks) is absorbed by
construction. Chase had no anchors at all, which is precisely why its plug survived. Chase
Saving and Santandar reconcile at 0.00 on their own.

**The reusable check** is the ordering itself: an account whose `last_calibrated_at` predates
the `created_at` of its earliest back-filled history, and which has no later anchor, is
carrying a plug for history it now also holds as rows.

## 13. The three cleanups

### 13.1 A securities trade on a credit card

`Amazon Visa` row **11030** (2025-06-25, +376.69, *"AUTOMATIC PAYMENT - THANK YOU"*) was
categorised **Transfer - Securities Trades**. A credit card cannot have one. Its counter-leg
was already sitting correctly in Chase Checking (row 9912, −376.69, *Transfer - Credit Card
Payments*), and 56 of the card's other 67 automatic payments use that same category — so this
was one mis-clicked row. Recategorised. The neutralize category is now confined to the five
brokerage accounts where it belongs.

### 13.2 The "$45.03 residue" — there isn't one

See the correction in §12. `opening_balance` is a **calibration anchor, not a historical
fact**; the framing that it "ought to be 0" applies only to accounts with no PocketSmith
coverage. Nothing to chase.

### 13.3 The 1,861 legacy unlinked legs — mostly fine, and two that were not

Characterising them before touching anything turned out to matter:

| | |
|---|---|
| unlinked legs (all pre-CR065) | 1,861 |
| …with an opposite-amount partner in the **same account**, ±3 days | **1,756 (94%)** |
| …with no partner **anywhere** | 88 |

So the overwhelming majority are genuine self-netting pairs whose link was simply never
recorded, because the column did not exist when they were made. **Recommendation: leave
them.** Every one of these accounts now ties to the custodian at 0.00, so linking 1,756
historical rows buys tidiness and no correctness. The forward-looking check is bounded to the
watermark precisely so it does not drown in them.

The 88 with no partner anywhere were worth reading, and two of them were not trades at all:

| row | date | amount | description | was | is |
|---|---|---|---|---|---|
| 11448 | 2020-10-14 | −23,536.00 | `DIRECT DEBIT IRS USATAXPYMT` | Transfer - Securities Trades | **Taxes US** |
| 11541 | 2021-05-17 | −126,500.00 | `DIRECT DEBIT IRS USATAXPYMT` | Transfer - Securities Trades | **Taxes US** |

Every other IRS `USATAXPYMT` on that account — 2023, 2024 ×2, 2025, 2026 — is *Taxes US*.
These two were misfiled, so **$150,036 of tax expense was sitting in a transfer bucket**,
which is excluded from P&L. **2021 reported zero US tax expense** and now reports −126,500;
2020 goes −7,000 → −30,536. Balances are untouched (a category never moves one) — this is
purely a reporting correction, and a material one for those two years.

The remaining 86 are pre-CR032 core sweeps, reinvestments and sales whose mirrors were never
created, plus one near-pair the exact-amount matcher misses by $11.61 (a 2023-11-14 core
redemption of 249,988.39 funding a 250,000.00 CD purchase the next day). None affects a
reconciled balance; they are historical shape, not money.

## 14. Sweeping the 86, and the month-end runbook

### 14.1 The sweep

Read all 86 unpaired legs (the §13.3 set, after the two IRS corrections). **No second
IRS-class error** — nothing else had escaped from P&L into a transfer bucket. What it did
find:

**Three Wise/Currency-Cloud deposits on Fidelity Cash Mgt filed as securities trades**
(11526 +125,000.00, 11725 +90,000.00, 11739 +10.00 — **+215,010.00**). Money arriving from
outside is not a trade; 15 of the account's other 19 `DIRECT DEPOSIT` rows use
**Transfer - Bank**. Recategorised. Both categories are `is_transfer`, so unlike the IRS rows
this changes **no P&L** — it is classification hygiene, and it stops them polluting the
securities self-netting invariant.

Only one of the three surfaced in the §13.3 orphan list ($10); the other two had an
opposite-amount row within ±3 days and so never looked orphaned. **The lesson: "unpaired" was
the wrong net to fish with.** Querying by *description shape against category convention*
found all three at once, and is the better tool for this class.

**Sign-shape oddities, left alone:** the 2021-07-21 merger booked as two POSITIVE legs
(`MERGER MER FROM` +12,000 and `MERGER MER PAYOUT` +18,000 — one should almost certainly be
negative), a 2022-07-08 `Buy` of **+**2,000, and the 2022-06-17 `YOU EXCHANGED` cluster
(+16,000 / −32,000 amid three same-signed "Transferred To" rows). These are securities
activity with wrong signs, they overlap
[Known Issue #8](../current/project-roadmap.md#3-known-issues) (13 same-signed transfer
clusters awaiting triage), and CR058's quarter-end anchors correct the account's shape past
them. Not touched: fixing a sign without the 2021/2022 statements would be guessing.

**Everything else** — 80-odd rows — is genuine: pre-CR032 core sweeps, reinvestments, option
opens/closes, spinoffs and CD redemptions whose mirrors were never made. Historical shape,
not money.

### 14.2 The runbook

The month-end procedure now lives in
**[docs/guides/month-end-reconcile.md](../guides/month-end-reconcile.md)** rather than in a
conversation. Written as a transcript of the 2026-07-31 close that worked, with every number
real, and leading on the ordering that matters: **bookkeeping first, market value last** —
because an MTM absorbs any outstanding error and permanently relabels it as an unrealized
gain, which is exactly how $150,000 hid inside a "−107,830.71 MTM gap" for five days.
