# CR094 — The promote divergence gate: name the cause, not just the drift — **DRAFT**

**Status:** DRAFT (2026-09-20) · **Track:** v3 · **Migration:** none expected
**Origin:** [CR059 §22.13](cr-059-fintable-api-ingestion.md) — the content guard dropped a real
charge and Caixa EUR carried EUR 30.25 of drift for twelve days before anyone asked why.

---

## 1. The problem, stated precisely

**The drift was visible. Its cause was not.**

For twelve days the reconcile page showed Caixa EUR at `+30.25 DRIFT`. That is the surface working
as designed. What no surface could say was *why* — and the answer turned out to be sitting in
`bankfeed_staging` the whole time, as a fact any single query could have read:

```sql
-- two staging rows, two upstream ids, ONE ledger row
SELECT promoted_transaction_id, count(*)
  FROM bankfeed_staging
 WHERE promoted_transaction_id IS NOT NULL
 GROUP BY 1 HAVING count(*) > 1;
```

Two groups, DB-wide, in milliseconds. One of them was the defect. Nothing runs this.

**This is the project's standing failure shape in a new place.** `status.md` records it as *state
that exists, renders, and produces no visible effect, so it reads as absent* — eleven instances, ten
found by a person looking at the page and one by a gate. Here the state existed (`promoted_transaction_id`
recorded exactly what each staging row was deduped against, deliberately, "so a wrong skip is
auditable and reversible rather than a silent disappearance" — CR059 §22's own words) and **nothing
ever read it back.** The auditability was built and never instrumented.

## 2. What the measurement actually found

Run by hand on prod 2026-09-20, over 2,392 promoted feed rows:

| check | count | verdict |
|---|---|---|
| staging rows sharing one `promoted_transaction_id` (same batch) | **2** | 1 real defect (Caixa, §22.13) · 1 correct skip (LUXURY CARD) |
| ledger amount ≠ staging amount, after `feed_negate_tx` | **2** | both deliberate owner edits — **not** defects |
| ledger date ≠ staging date | **14** | 13 = known Chase/Akoya auth-vs-posted shift · 1 = feed revised a date post-promote |

⚠️ **The raw amount-mismatch count is 250 and it is a lie.** `feed_negate_tx` negates on promote
(Chase-card convention), so a naive comparison reports every negate-account row as divergent. The
gate MUST apply the mapping's own sign convention or it will ship a red number nobody reads —
the same fate as the CR065 unpaired-leg check before its watermark bound. **This is the single
most important design constraint in this CR**, and it was found by checking a suspicious number
rather than reporting it.

## 3. The three divergences worth reporting, and why each earns its place

**A. Collapse — N staging rows → 1 ledger row.** The §22.13 defect. A genuine re-delivery collapses
legitimately, so this is **not** an error on its own; it is a *question*. Report it per account with
its rows, and let the owner say. The Caixa case would have read: *2 feed rows, 1 ledger row, 2026-09-08,
CERT. NO RESIDENCIA, −30.25 each* — which is the whole diagnosis, on a page, on day one.

**B. Amount divergence.** A promoted row whose ledger amount no longer matches what the feed says,
after the negate convention. Deliberate owner edits are the common case and must be distinguishable
— they carry a changed description or category. **The dangerous case is neither:** `staging.upsert`
does `ON CONFLICT DO UPDATE SET amount = EXCLUDED.amount` and explicitly does **not** reset
`promoted_transaction_id`, so if an upstream ever corrects an amount after promote, staging silently
takes the new figure and the ledger keeps the old one. That is permanent drift no re-run clears.
**Zero instances today. The mechanism is live.**

**C. Date divergence.** Same mechanism, already firing once: PKO staging row 144193 reads 2026-09-16
while its ledger row 2710945 reads 2026-09-14. No balance effect — `computed_balance` sums amounts
regardless of date — but it moves a transaction between periods, and **across a month boundary that
moves a P&L figure**. The other 13 are the documented Chase/Akoya posted-vs-auth shift (CR059 P0)
and should be classified, not alarmed about.

## 4. Scope

**P0 — the query and a script.** `Scripts/check-promote-divergence.js`, the three checks above,
negate-aware, exit non-zero on a finding. Cheap, runnable in CI and by hand, no UI. **This alone
closes the gap**: the cost of the Caixa incident was not that the number was un-pretty, it was that
nobody could ask the question without writing SQL.

**P1 — surface it on the reconcile page**, per account, beside the drift it explains. The page already
carries `transfer_unpaired_legs` on exactly this footing (CR065) — a signal reported *on its own terms*
rather than folded into drift — and this is the same shape. Reuse that pattern; do not invent one.

**P2 — decide the repair path.** Today a confirmed collapse is repaired by hand-inserting the dropped
row (as §22.13 did). A one-click *"this was two real charges, book the second"* is the obvious
follow-on and is **deliberately deferred**: it writes to the ledger from a screen, and it should not
be designed before P0/P1 have shown how often it is actually needed. **Twice in 2,392 rows is not
yet a case for a button.**

## 5. What this CR must NOT become

- **Not a duplicate detector.** CR059 §22 already owns that, in five layers. This reports what the
  dedupe layers *did*, which is a different question and the one nobody can currently ask.
- **Not a new guard in the promote path.** The fix for §22.13 is shipped (v3.65.3). This is
  instrumentation, and instrumentation that can only read.
- **Not a red number.** See §2. Every check ships with its known-benign classes already classified,
  or it joins the list of warnings people learn to scroll past.

## 6. Open questions for sign-off

1. Does the collapse check bound itself by date, the way CR065's unpaired-leg check needed a
   watermark? ~776 Sheet-era ids and the whole PS-parallel era sit behind us; a check that reports
   history nobody will act on is the failure mode §2 names.
2. Is P1 worth building at two findings in 2,392 rows, or does P0 in CI carry this for a year?
   **My recommendation: P0 only, and revisit P1 the next time a collapse is found.**
3. Should the date check split into *feed-revised* (one row, PKO) vs *auth-vs-posted* (thirteen,
   known and benign)? They are the same query and completely different findings.

---

**Not yet reviewed.** Pass 1 (`cr-technical-reviewer`) and pass 2 (`cr-signoff-pm`) both pending.
