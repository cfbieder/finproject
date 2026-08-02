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

---

## 1. Promote and clear the review queue

**Refresh Feeds** → *Refresh bank feed*, then work the review queue.

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

## 3. Wait for the feed to settle — this is the step people skip

**The feed labels a balance with the date it SYNCED, and it syncs in the small hours.** The
row dated *D* was therefore taken **before *D* traded**, and marking against it marks to a day
that had not happened yet.

Proof, from 2026-07-31 (a **Friday** — so with markets shut all weekend, Friday's close must
equal Sunday's, and it does not):

| balance_date | Fidelity Stocks | synced at |
|---|---|---|
| 2026-08-02 (Sun) | **1,165,523.25** ← Friday's real close | 00:05 on 08-02 |
| 2026-08-01 (Sat) | 1,157,779.86 | 00:53 on 08-01 |
| 2026-07-31 (Fri) | 1,141,170.68 | 01:48 on **07-31** |

Marking against the 07-31 row booked **−44,600.45** and left the account **24,352.57 below**
the custodian. In practice the settling observation has been **two days after** month-end —
but that is an observation, not a rule (see *Known Issue #14*), which is why fin refuses
rather than guessing.

**How long to wait:** until an observation exists whose sync date is *after* month-end. Two
days has been enough. There is no harm in marking later.

## 4. Book the MTM

Above the table:

- **Book MTM entry as of** → the month-end, e.g. `07/31/2026`
- **· mark against balance dated** → **leave blank on the first attempt**

Then **Reconcile** on each `brokerage (mtm)` row.

**If it refuses**, that is the guard working, and the message names the alternatives:

> *the balance dated 2026-07-31 was synced on 2026-07-31, so it was taken BEFORE 2026-07-31
> ended and cannot contain that day's activity. … Later observations: 2026-08-01 =
> 1,219,893.81 · 2026-08-02 = 1,219,402.92.*

Pick the observation that contains the month-end and put it in **mark against balance dated**.
The entry still carries the month-end date, so the unrealized move lands in the right period.

**Choosing between candidates** — do not guess, and do not assume "later is better". On
2026-07-31 the 08-01 observation was synced *after* month-end and still lacked that day's
−41,564.86 wire. Two ways to decide:

- **Against a statement.** Fidelity Cash Mgt's 08-02 figure matched the custodian's 07/31
  close exactly; 08-01 did not. Once one account on a connection is settled this way, the same
  date applies to all of them — they share a sync schedule.
- **By calendar.** A month-end on a Friday must equal the following weekend's value, because
  nothing traded. Any candidate that differs is not the close.

**Two guards can still stop you, and both are worth respecting:**

- *stale feed* — no observation dated month-end, or three identical balances (a stalled
  connection). Wait; do not `force`.
- *implausible* — the mark exceeds 15% of the balance, which usually means the account's
  basis was never anchored.

Neither fires on a healthy month. Note the implausibility threshold did **not** catch a 3.6%
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
