# CR065 — A neutralize counter-leg is claimable exactly once — ✅ BUILT · migration 053 + prod data fix APPLIED (code deploy pending)

`neutralize()` decided "does this row already have a counter-leg?" by re-running a **value
match** over the ledger. Value-matching is not identity: two rows of the same value are
indistinguishable, so one counter-leg could be claimed by any number of originals, and
nothing in the schema recorded that a claim had happened — so nothing could refuse the
second one. On 2026-07-30 two identical $150,000 CD purchases claimed the same $150,000
mirror and Fidelity Cash Mgt ran **$150,000 light**.
[Roadmap](../current/project-roadmap.md) · [CR028](cr-028-securities-trade-neutralization.md) ·
[CR032](cr-032-core-cash-sweep-neutralization.md)

**Opened:** 2026-08-02 · **Track:** v3 · **Migration:** 053 (**dev + prod applied 2026-08-02**)
**Prod data corrected 2026-08-02** (§6); **code deploy still pending** — prod runs the old
`neutralize()` until it ships.
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

1. **The code is not deployed.** Until it is, prod's `neutralize()` can still double-claim —
   the unique index would not stop it, because the old code never writes `paired_with_id` at
   all. Deploy before neutralizing anything by hand.
2. **The 2026-07-31 feed backlog** (nine staged rows, net −41,364.79) is unpromoted, and
   Fidelity Options carries **191** unpromoted staging rows back to 2026-05-04 (Stocks 46).
   Those net to ~0 so they are not distorting balances the same way, but they want a look.
3. **The $78.35 residue** on Fidelity Cash Mgt beyond the $150,000, and the smaller ones on
   IRA / Bond / Stocks / Options, are pre-existing and unexplained. The §4.5 check cannot see
   them (pre-watermark) — they need a one-off pass.
4. **Transfer Analysis already has both cleanup halves** ("remove orphaned neutralize-mirror",
   "neutralize a genuine unmatched leg"), so the *converse* symptom was known and tooled. The
   direction this CR fixes had no detection at all until §4.5.
