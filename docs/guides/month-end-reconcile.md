# Month-end reconcile — Runbook

> **Executed and verified on 2026-08-02** for the 2026-07-31 month-end, across five Fidelity
> accounts and Chase Checking. It is not a plan; it is a transcript of a close that worked,
> turned into steps. Every number quoted below is real.
>
> Background for the *why*: [CR065](../cr/cr-065-neutralize-pair-identity.md) §4.5, §11, §12.

**Goal:** the Balance Calibration page reads **`0 unreconciled`** and **`0` unpaired legs**,
with every mark-to-market entry dated at month-end.

**Page:** `https://fin.tail413695.ts.net` → **Balance Calibration**.

---

## The order matters

Bookkeeping first, market value last. An MTM entry marks the account to whatever the
custodian says, so **any bookkeeping error still outstanding gets absorbed into it and
permanently relabelled as an unrealized gain.** On 2026-08-02 a $150,000 missing counter-leg
was sitting inside what looked like a −107,830.71 "MTM gap"; only $804.50 of it was market.

1. Promote the feed and clear the review queue.
2. Neutralize any leg that has no counter-leg.
3. Wait for the feed to settle.
4. Book the MTM.
5. Re-anchor any `calibrate` (cash) account still showing drift.
6. Roll the Latest Estimate: finalise the open one, recalculate FX, cut the next.

---

## 1. Promote and clear the review queue

**Refresh Feeds** → *Refresh bank feed*, then work the review queue.

⚠️ **An empty queue at month-end is suspicious, not quiet.** Month-end posting volume is what
tripped bank-feed's insert guard on 2026-10-01 and blocked every sync for ~30 hours. If the queue is
empty or Home shows *"bank-feed has not synced for Nh"*, work
[feed-stall-runbook.md](feed-stall-runbook.md) before anything below — reconciling against balances
whose transactions have not arrived bakes in false drift.

Watch for the **`no offset`** badge. It means a securities-trade leg whose other half does
not exist. **Neutralize it — do not Accept it.** Accepting leaves the account light by the
full amount, and on a brokerage account that reads as a market move rather than a mistake.

Accepting one anyway raises a confirmation naming the rows and the total exposure. Reading
that dialog is the whole point; "Accept anyway" is for the one legitimate case — a
**cross-account** securities transfer whose counter-leg really is in another account.

**Neutralize preview vocabulary** — the dialog says which of these it will do:

| it says | it means |
|---|---|
| `pair` | an unclaimed opposite leg exists nearby; both get categorised, **no new row** |
| `mirror` | ⚠ no counter-leg found → it will **CREATE** one. Correct for a genuine single-leg trade; a double-count otherwise |
| `already neutralized` | the row is already half of a pair. No-op — safe to re-click |

Selecting several rows at once is fine; they apply one at a time, and the result message
reports what actually happened rather than what was predicted.

## 2. Check nothing is left unpaired

On Balance Calibration, any account with an unpaired leg shows it in red under **Drift**:
`N unpaired legs <amount>`. That amount is a bookkeeping error, not a market move — **fix it
before step 4** or the MTM will bury it.

Find them in **Transfer Analysis**. Two buttons, and the page picks by row type:

- **Neutralize** — a real leg missing its other half. Creates the counter-leg.
- **Remove** — an `auto-offset` row that is genuinely orphaned. Only appears on synthetic
  mirrors, because neutralizing a mirror would mint a mirror-of-a-mirror.

⚠ **Remove is not the default answer for an orphaned mirror.** On 2026-08-02 one such orphan
looked removable but its real partner had been mis-claimed elsewhere; the fix was to restore
the true pair and neutralize the other leg properly. Removing would have reached the right
account total while leaving the sweep without its core-position leg. If an orphan appears,
find out *why* before deleting it.

**Drift with no unpaired leg — did the feed revise a row after it was promoted?** A staging row
the bank later changes (new amount, new date, or two upstream ids collapsing onto one) keeps its
`promoted_transaction_id`, and the ledger row does not follow. Three read-only checks name the
cause (from [CR094](../cr/cr-094-promote-divergence-gate.md), closed 2026-09-28 in favour of this
step; all three returned 0 for rows since the 2026-08-10 API cutover):

```sql
BEGIN READ ONLY;
-- A. collapse: two staging rows, one ledger row
SELECT promoted_transaction_id, count(*) FROM bankfeed_staging
 WHERE promoted_transaction_id IS NOT NULL AND transaction_date >= DATE '2026-08-10'
 GROUP BY 1 HAVING count(*) > 1;
-- B. amount divergence, after the feed_negate_tx convention (owner edits show up here too)
SELECT s.id, t.id AS tx_id, s.amount AS feed, t.amount AS ledger
  FROM bankfeed_staging s JOIN transactions t ON t.id = s.promoted_transaction_id
  LEFT JOIN account_source_mappings m ON m.account_id = t.account_id AND m.source = 'bank-feed'
 WHERE s.transaction_date >= DATE '2026-08-10'
   AND t.amount <> CASE WHEN COALESCE(m.feed_negate_tx, false) THEN -s.amount ELSE s.amount END;
-- C. date divergence
SELECT s.id, t.id AS tx_id, s.transaction_date AS feed, t.transaction_date AS ledger
  FROM bankfeed_staging s JOIN transactions t ON t.id = s.promoted_transaction_id
 WHERE s.transaction_date >= DATE '2026-08-10' AND t.transaction_date <> s.transaction_date;
ROLLBACK;
```

## 3. Wait for the feed to settle — this is the step people skip

**A feed row's date is not the day its value describes.** Since September 2026 the upstream
syncs **once a day, at about 18:04 UTC — 14:04 in New York, mid-session** — and bank-feed
stamps each sync with the date it *fetched* it. Its 00:24 fetch copies the previous sync onto
the new date, and the 18:24 fetch replaces it. So, for a weekday month-end *D*:

| row dated | holds the sync of | contains *D*'s close? |
|---|---|---|
| *D* | *D*, 18:04 (before the close) | **no** — refused |
| *D*+1 | *D*, 18:04 until 18:24, then *D*+1's | only after *D*+1's own sync |
| *D*+2 | *D*+1, then *D*+2 | yes — but may also carry *D*+1's activity |

How many closes behind the upstream *value* runs has itself drifted between 0 and 2 (Known
Issue #14), so fin does not assume a lag; it refuses what is provably wrong — any row synced
on or before *D* — and offers only rows synced after it.

Two older observations still hold, and are why §4's checks exist:

- **2026-07-31** (syncs were then in the small hours): the row dated 07-31 was synced at 01:48
  that morning; marking against it booked −44,600.45 and left Fidelity Stocks 24,352.57 below
  the custodian.
- **2026-09-30**: a bank-feed stall (10-01 05:28 → 10-02) meant no sync between 09-30 18:04 and
  10-02 06:47, and the 06:47 sync returned the **same** 09-30 midday values. No row held 09-30's
  close; the first that did (10-02 18:08) already carried 10-01's activity — Cash Mgt's
  −21,425 tax payment. The marks were booked against the midday snapshot, deliberately (§4,
  *Book anyway*), and Cash Mgt's was corrected for 1,190.74 of 09-30 interest the snapshot
  predated.

**How long to wait:** until a row exists that was **synced after month-end** — normally the
day after. fin's daily ingest re-reads the last three days, so its copy of each row converges on
bank-feed's final one; a row it revises is logged (`balance revised:` in the server log).

## 4. Book the MTM

Above the table:

- **Book MTM entry as of** → the month-end, e.g. `07/31/2026`
- **· mark against balance dated** → **leave blank on the first attempt**

Then **Reconcile** on each `brokerage (mtm)` row.

**If it refuses**, that is the guard working, and the message names the alternatives:

> *the balance dated 2026-09-30 was synced on 2026-09-29, so it was taken BEFORE 2026-09-30
> ended and cannot contain that day's activity. … Observations synced after 2026-09-30: …*

The dialog lists **only** observations synced after month-end, and pre-fills the first. (Until
2026-10-09 it listed every later-*dated* row, so it pre-filled one it would then refuse.) The
entry still carries the month-end date, so the unrealized move lands in the right period.

**Choosing between candidates** — do not guess, and do not assume "later is better". On
2026-07-31 the 08-01 observation was synced *after* month-end and still lacked that day's
−41,564.86 wire. Two ways to decide:

- **Against a statement.** Fidelity Cash Mgt's 08-02 figure matched the custodian's 07/31
  close exactly; 08-01 did not. Once one account on a connection is settled this way, the same
  date applies to all of them — they share a sync schedule.
- **By calendar.** A month-end on a Friday must equal the following weekend's value, because
  nothing traded. Any candidate that differs is not the close.

**Two guards can still stop you, and both are worth respecting:**

- *stale feed* — no observation dated month-end, or the same balance from **three distinct
  syncs** (a stalled connection; one sync copied onto several dates counts once). Wait first.
- *implausible* — the mark exceeds 15% of the balance, which usually means the account's
  basis was never anchored.

Neither fires on a healthy month. **When one fires and waiting cannot help** — as at 2026-09-30,
where no row would ever hold the close — the refused dialog offers **Book anyway**: tick the
acknowledgement and it books the figure shown, still refusing (409) if that figure moved. Check
the number first against what the account holds, and against the ledger's flows dated the
month-end: interest or dividends the ledger dates *D* but the snapshot predates show up as an
unrealized loss of the same size (Cash Mgt, 09-30: 1,190.74). Fix those afterwards with
`server/src/v2/scripts/restate-mtm.js` (dry-run by default; `--targets` CSV of
`as_of_date,target`). Note the implausibility threshold did **not** catch a 3.6%
phantom gain on a CD ladder held at par — size is a weak signal, so sanity-check the number
against what the account actually holds.

## 5. Cash accounts — re-anchor, don't mark

A `bank (calibrate)` row showing drift is a **cash mismatch**, never a market move.
**Reconcile** re-anchors `opening_balance` so computed matches the bank.

Before clicking, check whether the drift is in the *transactions* or in the *carried-in
balance*: export the bank's activity and diff it. On 2026-08-02 Chase Checking's 142 rows
matched the bank's 142 exactly — so none of the −1,950.61 was in the activity, and the cause
was upstream (`opening_balance` pinned to a PocketSmith closing balance that had stopped being
the truth). Re-anchoring was right; had the transactions *not* matched, re-anchoring would
have plugged a real gap and hidden it.

> `opening_balance` is a **calibration anchor, not a historical fact.** Re-anchoring a
> feed-owned account is normal operation, not an admission of error.

## 6. Confirm

Balance Calibration should read **`0 unreconciled`**, no red `unpaired legs` on any row, and
each MTM entry dated at month-end (Ledger → source `mtm`).

## 7. Roll the Latest Estimate

**Owner rule (2026-09-15): the current month's estimate stays a draft all month.** LE-09-26
(actuals through August) is open during September, so its Sep–Dec estimates can change as news
arrives and the effect on the month and the year shows at once. Once the month has closed, on
**Budget → Latest Estimate** and **Budget FX**:

1. **Finalise the open LE.** Finalise re-reads its actual months from the ledger and freezes them
   with the full-year budget.
2. **Recalculate FX** for the month that just ended. It is refused while any LE for the year is a
   draft, because it would move the budget figures a draft reports against — this is its window.
3. **Cut the next LE.** It seeds its estimate months from the one just finalised. Cutting one while
   a draft is still open is refused, and the message names the draft.

Do this **after step 3's settle**, not on the 1st. A draft's actual months are the ledger as it
stood at the cut, so a cut on the 1st shows the month short for all of the month it is open
(83 of July's 85 late rows landed Aug 1–3). *Month may be incomplete* (L1) warns for the first
four days; drift shows what has landed since. Finalising a month later re-reads them regardless.

---

## Quick reference

| symptom | meaning | action |
|---|---|---|
| `no offset` badge in the review queue | trade leg with no counter-leg | **Neutralize**, don't Accept |
| red `N unpaired legs` under Drift | bookkeeping error, not market | fix in Transfer Analysis **before** the MTM |
| reconcile refuses, *"synced on … cannot contain"* | balance predates the day | use **mark against balance dated** |
| reconcile refuses, *"stale feed"* | connection stalled / no month-end row | wait — do not `force` |
| MTM looks far too large | possibly marking against the wrong observation | check the balance against a statement first |
| `bank (calibrate)` row drifting | cash mismatch | diff the bank export, then re-anchor |

## Verified run — 2026-07-31 month-end

| account | before | after |
|---|---|---|
| Fidelity Cash Mgt | −107,830.71 | **0.00** (−804.50 marked) |
| Fidelity Stocks | +20,247.88 | **0.00** (−20,247.88) |
| Fidelity Bond | +7,670.78 | **0.00** (−7,670.78) |
| Fidelity Options | +1,498.51 | **0.00** (−1,498.51) |
| Fidelity IRA | +1,347.11 | **0.00** (−1,347.11) |
| Chase Checking | −1,950.61 | **0.00** (re-anchored −1,995.64 → −45.03) |

Of Cash Mgt's original −107,830.71: **$150,000** was a missing counter-leg, **−$41,364.79** an
unpromoted feed backlog, and **$804.50** was the only genuine market movement.
