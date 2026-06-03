**Status:** PLANNING (open) — to be planned in a dedicated thread (one-question-at-a-time Q&A). Gathers the post-CR024 open items + the stepwise PS→Fintable cutover. — [Plan](../FC_NEXT_STEPS.md#cr023)

# CR023 — PocketSmith Removal & PS→Fintable Cutover Completion

**Created:** 2026-06-03 (stub; plan TBD)
**Follows:** [CR021](CR021_BANK_FEED_SERVICE.md) (bank-feed service), [CR022](CR022_BANK_FEED_PARALLEL_IMPORT.md) (PKO parallel import), [CR024](CR024_FIDELITY_FEEDS.md) (Fidelity feeds — DONE).
**Related (kept separate):** [CR020](CR020_STOCK_INVESTMENT_MODULE.md) (investment lot/cost-basis) — the plan should *decide* whether to pull this forward or leave it as its own CR.

## 1. Why this CR

CR022 (PKO) and CR024 (Fidelity) stood up the bank feed alongside PocketSmith and cut those accounts over with per-account cutoffs. **PocketSmith is now turned off for PKO and Fidelity.** This CR is the endgame: finish migrating every remaining account off PocketSmith, remove the last live dependencies on PS, and retire it.

## 2. Verified current state (2026-06-03)

- **PS is OFF** for PKO + Fidelity (no new uploads).
- **Cutoffs (`promote_from_date`) set on all 11 mapped bank-feed accounts** (PKO 6 + Fidelity 5) — bank feed owns from PS-last+1; double-count-free by construction.
- **Ledger reconciles to the bank** to the cent: all 6 PKO accounts match `feed_balances` (the 2 credit cards differ only by sign convention — fin stores liabilities negative). Fidelity uses the market-value read-override (`balance_from_feed`).
- The 9 PKO VISA CB cross-source duplicates were cleaned + R2-linked; a full duplicate sweep is clean (0 dup external_ids, 0 cross-source overlap).
- The daily cron is **stage-only**; promotion is manual (human-in-the-loop).
- **Only PKO + Fidelity have a bank feed.** Other PS accounts (Chase, Delta, entity/OCME, etc.) are PocketSmith-only — no Fintable/SnapTrade connection exists for them yet.
- Parked as `ignored`: Fidelity *Individual* and PKO *business 5564*.

## 3. Open items to plan (the scope to be decided one-by-one in the dedicated thread)

1. **Re-anchor balance calibration to the bank feed.** `/balance-calibration` + `server/src/v2/scripts/ps-anchor.js` still anchor `opening_balance` to PS `closing_balance` — now frozen. Switch the anchor to `feed_balances` (cached locally in `bankfeed_balances`) for mapped accounts so drift can be detected/fixed without PS. *The last live tie to PS.* (Logged in CR022 §2.3 / §G.)
2. **Stepwise PS→Fintable cutover for the remaining accounts.** The mechanism exists (un-ignore → `seed-bankfeed-cutoffs.js` → manual promote). Plan the sequence, per-account gates (reconcile-to-bank before declaring done), and rollback.
3. **Non-PKO/Fidelity feeds (CR021 dependency).** Chase, Delta, entity/OCME accounts have no bank feed — they can't be cut over until the bank-feed service grows a connection for those institutions (CR021 Phase 4 / new adapter). Decide: in scope here, or a CR021 prerequisite?
4. **Ignored accounts.** Fidelity *Individual* (user: leave ignored) and PKO *business 5564* — confirm final disposition.
5. **Actual PocketSmith removal.** When/how to retire the PS code paths, sync, mappings, and `pocketsmith`-source rows. Exit criteria (all accounts reconcile to the bank; no PS-only accounts left). The hard cutover.
6. **Forecast modules on parent account 29** (Fidelity Fixed Income) carry a hand-entered $1.24M that under-states the fed roll-up (~$1.99M). Revisit the forecast base.
7. **UI for cutover settings.** `promote_from_date` / `trade_treatment` / `balance_from_feed` are script-only today. Decide whether to surface a small admin panel for self-service switchover.
8. **Reconciliation monitoring.** With PS off, the §G "ps_only" gate is moot — the live gate is fin-balance vs `feed_balances`. Decide whether/how to surface this (a recon report/alert) as the cutover health signal.

## 4. Non-goals / boundaries (proposed — confirm in planning)

- **Investment lot/cost-basis analytics** → CR020 (decide pull-forward vs separate).
- **bank-feed feed-health drift anchor** → already logged to the bank-feed repo `HANDOFFS.md`; bank-feed-side, display-only.
- No PS removal until every account reconciles to the bank and no PS-only account remains.

## 5. Planning approach

Per CLAUDE.md: work through the §3 items **one question at a time**, each with a recommendation + rationale; skeptical-collaborator stance; verify live state before asserting; confirm scope before building. Then flesh out this CR, update `CR_INDEX.md` + `FC_NEXT_STEPS.md` + `FC_PROJECT_STRUCTURE.md`. No push without explicit owner OK.
