**Status:** COMPLETED 2026-10-01 — released in **v3.68.0** (prod data repairs applied the same day) · [roadmap](../current/project-roadmap.md#12-completed-chronological-latest-first)

# CR096 — Four owner fixes: the LE walk (and the seeding bug it exposed), Unpair, Ledger transfer, Wise split card payments

Four items the owner raised together on 2026-10-01. Two turned out to be data defects, not the
questions they first looked like.

## 1. "LE-10-26 differs a lot from LE-09-26" — a seeding bug, and a walk to see it

**Measured on prod.** FY NET moved −73,771 → −38,655 (+35,116). Split: Jan–Aug actuals restated **0**;
September came in **+11,096** better than estimated; and **+24,019** came from the Oct–Dec estimates —
of which ~26,000 was **typed estimates LE-10-26 never carried** from LE-09-26 (Taxes US Oct −21,425,
IT Costs Oct–Dec −1,500, Education Nov −1,000, Utilities − Gas, SP − Flights, …). The owner's only
edit after the cut was Option Trade Oct (−4,000).

**Cause.** `createIn` ([budgetLe.js](../../server/src/v2/repositories/budgetLe.js)) looped over the
freshly materialised lines and used a prior-LE cell only where a budget row existed with the same
**category, month AND currency**. A typed cell was dropped when (a) the month had no budget row, or
(b) the worksheet's single USD row sat over a PLN budget row — the key missed and the budget came
back in its place.

**Fix.** Seed by **(category, month)**: a cell the prior LE answered keeps all of its slices and none
of the budget's; carried cells are scope-filtered. Regression: `cr083.leSeed.test.js` (3 of its tests
fail on the old code).

**Repair (prod, 2026-10-01).** LE-10-26 is a draft, so its 21 dropped cells were restored from
LE-09-26 by SQL, skipping the one cell the owner had edited. LE-10-26 now lands at **−64,674.76**,
+9,096 vs LE-09-26 (September +11,096, Option Trade −2,000). **LE-09-26 is final and was left as
finalised** — it was cut from LE-08-26 by the same code, and 11 cells typed in LE-08-26 are absent from
it. Clearing a cell and the bug dropping it leave the same trace, so they cannot be told apart. Because
the repair copied from LE-09-26, five categories still lack their LE-08 figures in LE-10-26's Oct–Dec:
Anna − Exp (−400/mo typed vs −308 budget), Education Oct (−1,500), FL − Food and Drink Nov (−2,000),
FL − Groceries Nov (−2,000), Groceries Nov–Dec (−500/mo vs −856 budget) — about −5,060 if all restored.
**Owner decision 2026-10-01: decide each in the worksheet; no SQL restore.**

**The walk** — `GET /api/v2/budget/le/:id/walk?from=<id>` and a collapsed panel on `/budget-le`
(`LEWalk.jsx`): prior FY + restated + closed-month actual vs estimate + re-estimated = new FY, per
category, largest change first, with the BASIS on each side (`Typed → Budget` / `Typed → —` is a
lost figure, not a forecast change). Restated shows only when non-zero. ⚠️ **This reverses part of
[CR083](cr-083-budget-latest-estimate.md) §11.1**, which cut the LE-vs-prior-LE walk with the
frozen-series reading (owner Q6). The reason to bring it back is this incident: two grids side by side
read as "the forecast improved 35k".

## 2. Undo for Neutralize — `unpair`

Neutralize and transfer recorded nothing about what they overwrote, so a mis-click could only be
repaired by hand. Each now writes an `audit_log` row (`action` `neutralize`/`transfer`,
`user_info='pairing'`, `old_values` = the original's category + accepted, and on the pair path the
claimed counter-leg's). `POST /api/v2/transactions/:id/unpair` (either leg) deletes a synthetic
offset or releases a claimed counter-leg, restores what the pairing changed, and writes an `unpair`
audit row. **A row edited since the pairing is only unlinked, never restored** — the owner's own
correction must survive (compared in SQL against the audit row: a JS `Date` truncates microseconds and
made every row look edited). **A pair with no audit row is refused** unless `force` — it is usually the
feed refresh's core-sweep mirror, made on purpose, and deleting it re-opens the drift with nothing to put
it back. Also refused: an offset with a booking built on it (`income_restatements`,
`security_transactions`). Both legs are locked in id order (two unpairs from opposite legs would
deadlock). Ledger de-duplicates a selected pair, confirms before unpairing, and reports partial failures;
no Undo is offered for a row that was already paired. UI: an **Undo** button
on the neutralize/transfer toast (12 s, paused while hovered/focused, never evicted by the 3-toast cap) on Refresh Feeds and Ledger — on Refresh Feeds the row leaves
the review list once accepted, so the toast is the only way back — and an **Unpair** button on Ledger
when every selected row is paired. Tests: `unpair.test.js`.

## 3. Ledger: offset to another account

Ledger's selection bar gains **Transfer…** (one unpaired row) using the same modal Refresh Feeds uses,
now shared as `features/Transaction/TransferToAccountModal.jsx` — which now restates the row being moved
and, when the target account's currency differs, says the offset is converted at the date's rate rather
than the negated amount. The endpoint already accepted any
row; it now **refuses an already-paired row** (409) — a second offset would re-point `paired_with_id`
and orphan the first. Ledger rows now carry `paired_with_id` (it was dropped by `transformEntry`).

## 4. WISE − EUR −45.85 drift — split-funded card payments

**Cause (prod).** On 2026-09-21 two card payments (Sarl Chaboisson 54.10, Autoroutes Asf 28.20 EUR)
exceeded the 36.51 EUR balance; Wise funded the rest from USD. The feed booked the **full** EUR amount
on WISE − EUR **and** the converted part on Wise − USD (−20.19, −32.24 USD) under the same `CARD-<n>`
id — 45.79 EUR counted twice; the other 0.06 was unbooked interest. In `accrue` mode no reconcile could
clear it: the rate guard rightly refuses a 45.85 "yield" on a zero balance. Only two such payments in
the account's history, both that day.

**Repair (prod, 2026-10-01).** Two `manual` rows on WISE − EUR, same date and categories, at the
original rows' own rate: +17.59 (Food and Drink) and +28.20 (Car Rental), each naming its CARD id and
the USD row; then the 0.06 accrual booked with `force`.

**Prevention.** `GET /bank-feed/balance-recon` rows carry `split_card_payments`: a `^CARD-<n>` id
(staging `description`) seen on two accounts within 60 days, reported on the **paying** account only
(the one in the card's face currency, "Card transaction of 54.10 EUR"), and cleared once a `manual`
row there names the CARD id. The reconcile table shows "N split card payment(s)" under an unreconciled
row's drift, with the pair and the repair in its tooltip.
