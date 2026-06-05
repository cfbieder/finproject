**Status:** PLANNED (scope settled 2026-06-03, one-question-at-a-time Q&A) — ready to build. The cutover engine + per-account migration framework + source-aware calibration/monitoring. **Actual PS removal is a deferred tail** (criteria defined here; executed in a future CR when the last account is off PS). — [Plan](../FC_NEXT_STEPS.md#cr023)

# CR023 — PocketSmith Removal & PS→Feeds Cutover

**Created:** 2026-06-03 (stub) · **Planned:** 2026-06-03
**Follows:** [CR021](CR021_BANK_FEED_SERVICE.md) (bank-feed service), [CR022](CR022_BANK_FEED_PARALLEL_IMPORT.md) (PKO parallel import), [CR024](CR024_FIDELITY_FEEDS.md) (Fidelity feeds — DONE).
**Related (kept separate per §0 decision):** [CR020](CR020_STOCK_INVESTMENT_MODULE.md) (investment lot/cost-basis).

## 0. Planning decisions (resolved with owner, 2026-06-03)

The §3 open items were worked one-by-one. Outcomes:

| Decision | Resolution |
|---|---|
| **End-state** | **Incremental full retirement.** Migrate account-by-account PS→Feeds *as feeds become available*. PS stays the **live catch-all** until the *last* account is off it. Accounts with no obtainable feed move to **manual / Excel** ingest eventually. Full PS removal is the goal, on a long, account-paced timeline. |
| **#1 calibration + #8 monitoring** | **Source-aware MANUAL calibrate + read-only drift monitor.** The calibrate anchor follows each account's current source automatically (fed → `feed_balances`; PS-only → PS, as today). A read-only **source-partitioned** reconciliation monitor shows drift; recalibration stays a human click (matches the stage-only-cron / manual-promote philosophy — no silent self-healing that would mask feed gaps). |
| **#2 cutover engine** | **Add a deterministic, symmetric PS-side cutoff** (the central new code): the PS promote skips PS rows dated ≥ a fed account's `promote_from_date`. Combined with the existing feed-side cutoff, each account has a clean date handoff (PS owns `< cutoff`, feed owns `≥ cutoff`) — **no reliance on the R2 amount/date dedup heuristic**, closing the CR022 §G recurring-charge weakness. R2 stays as a backstop for the brief pre-cutoff parallel window only. |
| **#3 OCME / unfed** | **Migrate fin account 45 (OCME) onto its Bank Pekao feed.** The bank-feed is a **shared, read-only microservice** (fin + the OCME app + future consumers), each consumer applying its own independent mapping/opt-in policy. fin mapping Pekao→45 is a purely local fin decision that does not touch OCME's policy. Genuinely-unfed residual after OCME: **US cards (Luxury, Amazon Visa, Delta, Bonvoy Amex, Hilton, Marriott), Chase Checking/Saving, Capital One, Wise-EUR/USD, Caixa EUR, Revolut-EUR, SP-Panorama** — these wait for feeds or move to manual/Excel. |
| **#4 parked accounts** | **PKO `(PLN) (5564)` "business" and Fidelity `Individual` stay ignored in fin.** Neither has a fin COA balance-sheet account; 5564 is OCME's PKO account (served to the OCME app), Individual was the owner's CR024 call. Out of fin's ledger scope. |
| **#5 PS removal** | **Define exit criteria + a data-preserving removal runbook; defer execution.** Removal retires PS **code/sync only**; **all historical `source='pocketsmith'` rows + `psdata_staging` are KEPT frozen** (25k+ rows back to 2000 that the balance sheet/trends/reports compute from; feeds only reach ~mid-2026). Execution is a future trigger/CR when the exit criteria hold. |
| **#6 forecast on parent 29** | **Out of scope.** The leaf balances (30 Cash Mgt, 31 Bond) are correct via the feed override, so the forecast roll-up computes correctly. Forecast modules may legitimately combine Bond+Cash for long-horizon extrapolation; the hand-entered base is the owner's planning figure, owned in the forecast UI. No CR023 work. |
| **#7 cutover-settings UI** | **Script-only.** `promote_from_date` / `trade_treatment` / `balance_from_feed` / un-ignore stay behind audited set-once scripts (a wrong cutoff double-counts or gaps the ledger — the same discipline CR024 used). The **only** new UI is the read-only monitor + a per-account "Calibrate to feed" button on the existing Bank Feed Setup page. |
| **#9 CR020** | **Kept separate.** Lot/cost-basis needs a new bank-feed contract extension (`units/price/symbol/option_type`) + a fin FIFO lot-walker — orthogonal to PS removal, not on this critical path. CR024 already meets the balance-sheet + cash-flow needs for Fidelity. |

### 0.1 Build log

- **2026-06-04 — symmetric cutoff completed (lower bound).** Decision #2's cutoff engine had only the **upper / feed-side** half live (PS skips rows ≥ a fed account's bank-feed `promote_from_date`). A PS sync resurrected the **2,170** pre-handoff PKO rows the owner had deleted: PS dedups on `ps_id` against the *live* `transactions` table, so a deleted pre-handoff row looks new and re-promotes (its `psdata_staging` row persists; the PS fetch is `updated_since`-based, not date-bounded). Added the **symmetric lower bound** in [`ingestPs.js`](../../server/src/v2/routes/ingestPs.js) `syncStagingToTransactions` — a PS staging row dated **< its own `pocketsmith` mapping's `promote_from_date`** is excluded from promote (the backfilling source, e.g. `quicken-import`, owns that era). One-line clause `AND (asm.promote_from_date IS NULL OR s.transaction_date >= asm.promote_from_date)`; dormant by default (NULL on every PS mapping); shares the `cutoffOn` column-existence gate. 2 DB-backed tests (held pre-handoff row; no resurrection on re-sync); suite 34/34. **No migration** (reuses the `027` column). **Applied to prod 2026-06-04:** server container rebuilt with the fix; PKO main (account 18) `pocketsmith.promote_from_date='2022-12-01'`; deleted the 2,170 `accepted=FALSE` pre-cutoff re-imports (CSV backup kept). End state for acct 18: `quicken-import` ≤2022-11-26 → `pocketsmith` 2022-12-01→2026-05-28 → `bank-feed` 2026-05-29+. Verified live: a scoped promote of a deleted pre-cutoff `ps_id` re-inserts 0 rows. **Set-once seeder** [`seed-ps-lower-cutoffs.js`](../../server/src/v2/scripts/seed-ps-lower-cutoffs.js) (mirror of `seed-bankfeed-cutoffs.js`) carries the audited per-account handoff dates — the lower bound is *not* auto-derived (Quicken-last+1 would re-admit a dup tail), so each date is an explicit operator decision; idempotent re-run reports `kept`. Generalises to any Quicken-backfilled account (Chase next) by adding a `{account_id, date}` row to the seeder.

## 1. Why this CR

CR022 (PKO) and CR024 (Fidelity) stood up the bank feed alongside PocketSmith and cut those accounts over with per-account cutoffs. **PS is now off for PKO + Fidelity.** This CR turns that one-off pair of cutovers into a **reusable cutover engine** and migrates the remaining fed-capable accounts (starting with OCME), with source-aware calibration and a live reconciliation gate — so PS can be retired account-by-account and, eventually, entirely.

## 2. Verified current state (2026-06-03, live)

- **PS is OFF** for PKO + Fidelity (no new uploads), but **PS is still actively feeding ~15 other accounts** (`source='pocketsmith'` rows through 2026-06-02; 25,633 PS rows total). PS remains the live catch-all.
- **11 mapped bank-feed accounts** carry `promote_from_date` cutoffs (6 PKO: 4/12/18/19/67/69; 5 Fidelity: 26/27/28/30/31). The 5 Fidelity use `balance_from_feed=TRUE` (balance-sheet read-override); the Options account (28) uses `trade_treatment=income`. All reconcile to the bank to the cent.
- **bank-feed exposes 14 accounts across 3 institutions** (PKO 7, Fidelity 6, Bank Pekao 1 = `OC MEDYCYNY ESTETYCZNEJ (PLN) (8781)`, UUID `466a4ae8-…`). It is a **shared read-only microservice** — the OCME app is a second consumer (consumes Pekao + 1 PKO account; see [OCME_BANK_FEED_IMPORT_GUIDE.md](../OCME_BANK_FEED_IMPORT_GUIDE.md)).
- **2 parked feed accounts** (ignored, `account_id=NULL`): PKO `(PLN) (5564)` business (`b2416778`) and Fidelity `Individual` (`190d7bf1`). Neither maps to a fin COA account.
- **Prod calibration mechanism = `POST /accounts/calibrate`** ([accounts.js:157](../../server/src/v2/routes/accounts.js#L157)): `opening_balance = PS_current_balance − Σ(tx)`, anchored to the **live PS API**, `closing_balance` fallback. **`ps-anchor.js` has produced 0 rows on prod** — it is the CR019 dev-cutover *script*, not the live prod mechanism. The calibrate route's PS anchor is **the last live PS tie** for the additive (PKO) accounts.
- The daily cron is **stage-only**; promotion is manual (human-in-the-loop).
- **`ingestPs.js` `syncStagingToTransactions`** has only the R2 reverse-dedup (`NOT EXISTS` on date/ABS(amount)/currency ±1 day) — **no date-based PS cutoff** (the gap §4.A closes).

## 3. Open items — dispositions

The §0 table is the authoritative resolution of the original 8 items + CR020. Build scope below.

## 4. Architecture / build scope

Likely **no new migration** — reuses existing columns (`account_source_mappings.promote_from_date` from 027, `bankfeed_balances` from 025, `balance_from_feed`/`trade_treatment`). Confirm during build.

### 4.A Symmetric PS-side cutoff *(the central new piece)*
In `ingestPs.js syncStagingToTransactions`, add a guarded clause: **skip a PS staged row when the fin account it resolves to has a bank-feed mapping (`ignored=FALSE`) whose `promote_from_date ≤ row.transaction_date`.** The feed owns `≥ cutoff`; PS owns `< cutoff`.
- Join path: PS staging row → `account_source_mappings (source='pocketsmith')` → `account_id` → `account_source_mappings (source='bank-feed', ignored=FALSE, promote_from_date IS NOT NULL)`.
- Guard: behind a feature flag + a column-existence self-disable (mirror the existing R2 guard), so a DB without the columns is byte-for-byte unchanged.
- Result: clean date handoff per account, immune to the recurring-charge dedup weakness. R2 dedup remains for the short pre-cutoff parallel window.

### 4.B Source-aware calibration (#1)
In `POST /accounts/calibrate`: for an account with a bank-feed mapping (`ignored=FALSE`), anchor `opening_balance` to the latest `bankfeed_balances.balance` (the bank's reported balance) instead of the PS API. PS-only accounts keep the existing PS anchor. The anchor source thus auto-follows each account's migration. (Brokerage `balance_from_feed=TRUE` accounts are unaffected — the read-override already bypasses `opening_balance+Σtx`; calibration is a no-op for them.)

### 4.C Reconciliation monitor (#8) — source-partitioned, read-only
New endpoint (e.g. `GET /api/v2/bank-feed/balance-recon`): per fed account, fin **computed** balance (`opening_balance + Σtx`, or the read-override for brokerage) vs the bank's `feed_balances`, with drift + last-feed-date. On the **Bank Feed Setup** page:
- **NEW "Bank reconciliation" section** — the fed accounts (computed vs `feed_balances`, drift, per-account **"Calibrate to feed"** button → the manual action from 4.B).
- **Keep the existing "PS ↔ bank-feed reconciliation (§G)" section but SCOPE it to accounts still fed by PS** — exclude accounts now on a direct feed. As accounts migrate, the PS-rec list depopulates; when empty, the PS rec is retired.

### 4.D OCME migration (#3)
Map the Pekao UUID `466a4ae8-…` → fin account **45** (UI or a small idempotent seed step), run `seed-bankfeed-cutoffs.js` (cutoff = PS-last-tx(45)+1 ≈ 2026-05-27), promote, gate on reconcile-to-`feed_balances`. fin and the OCME app then consume the same feed independently (read-only; no shared state).

### 4.E Settings stay script-only (#7)
`seed-bankfeed-cutoffs.js` (set-once cutoffs) is the cutover tool for each new account. No editable cutover-settings UI.

## 5. Per-account cutover runbook (#2)

The reusable procedure (proven on PKO+Fidelity, now generalized):

1. **Feed exists** — account appears in `/v1/accounts`; visible on the Bank Feed Setup page.
2. **Map (R1)** — map the feed UUID → fin account; account leaves "pending."
3. **Brief parallel run** — both PS + feed ingest; watch the §G PS-row recon (`ps_only`) for the transition window only.
4. **Set cutoff** — `seed-bankfeed-cutoffs.js` sets `promote_from_date = PS-last-tx+1` (set-once). Both sides now honor it: feed holds `< cutoff`, PS skips `≥ cutoff` (§4.A).
5. **Promote** — manual; feed rows `≥ cutoff` land `accepted=FALSE` for review.
6. **Gate** — the account's computed balance reconciles to `feed_balances` to the cent (cash) / read-override correct (brokerage). **Not "done" until it does.**
7. **Anchor flips** — calibration + the monitor auto-switch this account from PS-rec to bank-rec (source-aware, §4.B/4.C).
8. **Rollback** — re-ignore the mapping, clear `promote_from_date`, delete `source='bank-feed'` rows for the account; PS resumes ownership (cutoff gone → PS no longer skips).

Migration order is **driven by feed availability** (owner-paced), not a fixed schedule. OCME (45) is the first candidate (§4.D).

## 6. PS-removal exit criteria + removal runbook (#5) — DEFERRED execution

> **Live per-account backlog + exit monitor:** [CR023_PS_MIGRATION_TRACKER.md](CR023_PS_MIGRATION_TRACKER.md) (owner-confirmed dispositions 2026-06-05; §4 query = the "still PS-dependent" gate).

**Exit criteria (all must hold before executing removal):**
1. Every *active* fin balance-sheet account is either (a) on a direct feed and reconciling to `feed_balances`, or (b) moved to manual/Excel ingest, or (c) explicitly frozen/archived.
2. No active account still depends on PS for new data (no recent `source='pocketsmith'` activity for any active account).
3. The source-partitioned monitor's **PS-rec list is empty** (every active account is bank/manual-anchored).

**Removal runbook (future CR, when criteria hold) — data-preserving:**
- Stop the PS sync/upload entirely.
- Retire PS **code paths**: `refreshPsApiV2.js`, the PS-fetch in `ingestPs.js`, `psdataConverter`, the PS-side cutoff/dedup (no longer needed), and the calibrate route's PS-anchor branch.
- **KEEP** all historical `source='pocketsmith'` rows in `transactions` and `psdata_staging` **frozen** (CR021 §2 commits PS data is never rewritten; the balance sheet/trends depend on pre-feed history). **No data deletion.**

## 7. Tests
- **PS-side cutoff (§4.A):** a fed account's PS rows `≥ cutoff` are skipped; `< cutoff` still promote; flag-off / column-absent → byte-for-byte unchanged PS behavior; an unmapped/ignored account is unaffected.
- **Source-aware calibrate (§4.B):** fed account anchors to `bankfeed_balances`; PS-only account anchors to PS; brokerage `balance_from_feed` account is a no-op.
- **Balance-recon endpoint (§4.C):** computed vs `feed_balances` drift per fed account; PS-rec scoped to PS-fed accounts only.
- **OCME migration (§4.D):** smoke that account 45 maps, cutoff applies, reconciles.
- Regression: existing PKO/Fidelity cutovers and reconciliation unaffected; `smoke-bank-feed.js` green.

## 8. Risks
- **PS-side cutoff join correctness.** The PS↔fin↔bank-feed mapping join must resolve the same `account_id` both sides key on. Test the resolution explicitly; guard self-disables if columns absent.
- **US-card / EUR-account feeds may never arrive** (GoCardless signups closed; fintable=EU/PSD2+SnapTrade). The incremental model tolerates this — PS stays catch-all; manual/Excel is the eventual floor. PS removal (#5) cannot complete until these are resolved, by design.
- **Shared microservice.** fin is a read-only consumer; it must never assume it owns the feed or mutate shared bank-feed state. Mappings/cutoffs are local fin state only.
- **Monitor must not auto-heal.** Calibration stays manual so drift surfaces instead of being silently absorbed into `opening_balance` — the failure mode this project exists to catch.

## 9. Non-goals / boundaries
- Investment lot/cost-basis → CR020 (separate).
- Reconstructing pre-feed historical market value → not recoverable from the feed; out of scope.
- Editable cutover-settings UI → script-only.
- Executing PS removal → deferred future CR (criteria in §6).
- Forecast-model changes → out of scope (§0 #6).
- bank-feed feed-health drift-anchor → logged in the bank-feed repo `HANDOFFS.md` (bank-feed-side, display-only).

## 10.1 As-built — reconciliation layer + PS-side cutoff (dev, 2026-06-04)

Built and green on **dev** (`fin-server-dev` :3105 / `fin-postgres-dev` :5434); **not yet on prod**. Full backend suite **197/197**.

**New owner decision implemented (investment MTM via an entry, not a plug or read-override):** brokerage accounts recognize market moves through a month-end **Unrealized-G/L** adjustment transaction (`category_id=88`, `source='mtm'`), continuing the pre-existing PocketSmith "Unrealized…" pattern (54 historical entries, gain = positive on the asset). It supersedes CR024's `balance_from_feed` read-override (which the engine flips off) — `opening_balance` stays real, P&L gets a monthly audit trail. Cash accounts keep feed-anchored `opening_balance` calibration.

- **Migration `028_reconcile_mode.sql`** — `account_source_mappings.reconcile_mode VARCHAR(20) DEFAULT 'calibrate'` (`'calibrate'` cash | `'mtm'` brokerage). Applied to **dev only**.
- **`seed-cr023-reconcile-modes.js`** — sets `'mtm'` on 26/27/28/31 (idempotent). Cash Mgt 30 stays `'calibrate'`.
- **`services/reconcileToFeed.js`** — source-aware engine. `mtm`: posts `feed(monthEnd) − computed(monthEnd)` as the cat-88 entry (delete-then-insert → idempotent), backfills the month-end snapshot via `ingestBalances({asOf})` (the daily cron caches recent dates only; the service has history), removes the read-override; `calibrate`: `opening_balance = expected − Σtx` (sign-aware, liability vs `−feed`). Atomic. Non-USD `mtm` / ignored / missing mapping fail loud.
- **`POST /api/v2/bank-feed/reconcile/:accountId`** (`{asOf?, dryRun?}`) — the "Reconcile to feed" action.
- **`scripts/mtm-reconcile.js`** — monthly batch over `reconcile_mode='mtm'` accounts (`--month`, `--apply`). Cash is deliberately NOT batched (calibrating cash would bury a missing-tx gap — e.g. Cash Mgt 30's −$253k CR024 artifact, flagged, untangle before calibrating).
- **`GET /api/v2/bank-feed/balance-recon`** (`balanceReconcile()`) — read-only monitor: per fed account, computed vs `feed_balances`, sign-aware drift, `reconciled` flag.
- **`BankFeedDiagnostic.jsx`** — new "Bank reconciliation" section + per-account "Reconcile to feed" button (confirm-gated); §G PS-rec scoped to accounts still showing PS activity (depopulates as accounts migrate).
- **PS-side cutoff (§4.A)** — `ingestPs.js syncStagingToTransactions`: a guarded clause excludes a PS staging row dated `≥` a fed account's `promote_from_date`. Gated by `BANK_FEED_CUTOFF_ENABLED` (default on) + a `promote_from_date` column-existence self-disable; **dormant** when no cutoffs set. Deterministic handoff, independent of the R2 dedup heuristic.
- **`ingestBalances(asOf)`** — extended to backfill a historical month-end snapshot from the service.
- **Tests** — `reconcileToFeed.test.js` (7: mtm post/idempotent/override-flip/converge, calibrate asset+liability, dry-run, non-USD/ignored/missing throw) + 2 cutoff tests in `bankFeedImport.test.js` (held ≥ cutoff / promoted < cutoff / flag-off).

**Verified on dev:** MTM cycle end-to-end (e.g. acct 27 drift −$128k → entry posted → computed==feed at 05-31 → residual −$2,008 = live partial-month move); idempotent re-run; override flipped off; mode partition (30/PKO never auto-MTM'd); calibrate dry-run.

**Remaining before prod:** apply migration 028 prod-first → release (bump-version + deploy-to-production.sh) → seed reconcile-modes → `mtm-reconcile` dry-run/apply (recognizes real prod gains: Bond +$304k, Stocks +$61.5k, IRA +$8.7k, Options +$1.5k; flips brokerage balance sheet to month-end-stepped). Then OCME migration (§4.D). `CR_INDEX.md` / `FC_NEXT_STEPS.md` one-liners deferred (another thread's CR025 edits coexist uncommitted in those files).

## 10.2 MTM correctness — basis must be anchored (2026-06-04, v2.15.1)

A prod review caught that `mtm = feed − computed` **only equals unrealized gain when `computed = cost basis`.** It isn't for accounts whose ledger never tracked market: Fidelity **Bond (31)** showed a −$304k "drift" but its real total gain/loss is **−$7,370** (statement) — the other ~$310k is **unrecorded bond principal**, not gain. Booking `feed − computed` would have created phantom income.

Per-account treatment (verified against cat-88 MTM history + statements):
- **Stocks (27), IRA (26)** — properly MTM'd via cat-88 through 2026-04-30; `computed` = market as of last MTM. **Standard MTM is correct** (the drift is the legitimate recent market move).
- **Options (28)** — tracked via cash-basis option P&L (`trade_treatment=income`); computed correct. Standard MTM (small).
- **Bond (31)** — never MTM'd. Needs a **one-time basis anchor**: set `opening_balance` so `computed = cost basis = feed − statement_gl` (≈ −$2,867), then standard MTM books the real −$7,370.
- **Cash Mgt (30)** — holds CDs (not pure cash), real ≈$776k; `computed` overstated ~$253k by a PS CD double-count (data bug). **Deferred**: parked on the read-override (balance sheet correct), investigate the $253k separately; not calibrated (would bury the dup) and not MTM'd.

**Guard (v2.15.1):** the engine now blocks an MTM when `|feed − computed| > 15% of feed` (`MTM_IMPLAUSIBLE_PCT`), flagged in the dry-run and refused on apply unless `force` — so an unanchored account (Bond 33%) can't silently book phantom gain on an unattended/monthly run (e.g. a future Caixa). Decisions: basis via `opening_balance` (one-off), keep the read-override removed after MTM (balance sheet = computed; drift stays visible).

## 10.3 MTM activated on prod (2026-06-04, v2.15.1)

Seeded `reconcile_mode='mtm'` on 26/27/28/31; **Bond basis-anchored** (`opening_balance` −314,299.24 → **−2,316.51** so `computed(05-31)` = cost basis $1,211,841.91 = feed + statement g/l); ran `mtm-reconcile --apply` (month-end 2026-05-31). Posted 4 cat-88 `source='mtm'` entries — **IRA +7,326.57, Stocks +59,694.27, Options +1,995.90, Bond −7,369.86 (net +$61,647 May unrealized)** — and removed the `balance_from_feed` override on all four (balance sheet now reads `computed` = 05-31 market, month-end-stepped). The guard blocked Bond at 25.3% pre-anchor (dry-run #1) and passed it at 0.6% post-anchor (dry-run #2). Residual monitor drift on the four is the legitimate June partial-month move (booked at 06-30). Backup `~/fin-prod-pre-mtm-20260604-134520.dump`.

**Cash Mgt 30 resolved (2026-06-04) — calibrated, not MTM'd.** Investigation showed 30 is the **main Fidelity cash hub** (940 PS tx / 6 yrs, millions in transfers, incl. ~$1.16M "Transfer - Unmatched"), so the $253k overstatement is **accumulated cash-hub drift, not a discrete double-count or a market move** — a calibration case, not forensic cleanup or brokerage MTM. Ran the `calibrate` reconcile (`opening_balance` 170,980.90 → **−82,495.32** so `computed = feed = 789,949.38`) and **removed the read-override** (`balance_from_feed=FALSE`) so the balance sheet reads `computed` and future drift stays visible. Monitor: 30 now RECONCILED (was red +$253k); `total_unreconciled=4` (the 4 brokerage June-move MTM gaps). Revert = `opening_balance=170980.90` + `balance_from_feed=TRUE`.

## 10.4 Luxury card (62) cutover + per-mapping feed-sign fix (2026-06-04, v2.15.4)

The Fintable **Black Card (9915)** feed (`external_id j5a1n7R1OmtJ0zekLmMpCg7evP4DrJikqzVpL6`, USD, balance −15,359.33, tx from 2026-06-02) arrived ~a day early and was mapped to fin account **62 LUXURY CARD**. This is the first cut-over account whose upstream is **Plaid/SnapTrade** (US) behind fintable rather than **GoCardless** (EU/PKO).

**New problem it exposed — liability balance-sign is per-upstream, not per-account-type.** The balance-recon monitor + `reconcileToFeed` hard-coded `expected = -feed` for every liability, because GoCardless/PKO reports a card as a **positive** amount owed. Plaid reports it **negative** (already matching fin's stored sign), so the `-feed` flip produced a **false 2× drift** (62 showed computed −15,359.33 vs feed −15,359.33 but drift **−30,718.66**), and a calibrate would have re-anchored `opening_balance` to flip the card to **+$15,359** (~$30k corruption). Transaction signs are identical across upstreams (spending negative), so promotion was never affected — only the balance-comparison layer.

**Fix (migration 029 + v2.15.4):** `account_source_mappings.feed_sign SMALLINT` (nullable). `feed_sign` is the multiplier converting feed_balance → fin's stored sign; **NULL falls back to the account_type heuristic (liability −1, asset +1)** = byte-for-byte pre-029 behavior for every existing mapping. Both the monitor SQL and `reconcileToFeed` calibrate/mtm now use `COALESCE(feed_sign, liability?-1:+1)`. Set `feed_sign=1` on 62 (and on any future Plaid/US card). New test in `reconcileToFeed.test.js` (liability + feed_sign=+1 reconciles against +feed); full suite **203/203**.

**As-built sequence (prod):** backup `~/fin-prod-pre-cr023-feedsign-20260604-203850.dump` → migration 029 prod-first → release v2.15.4 (`fix(cr023)` commit `6e30058`, deploy-to-production.sh) → `feed_sign=1` on 62 → `seed-bankfeed-cutoffs.js --accounts 62 --apply` (`promote_from_date=2026-06-04` = PS-last 06-03 +1) → gate: **62 RECONCILED** (drift 0). No promote needed (0 feed rows ≥ cutoff yet; future charges flow via the feed on the next Import). PS-side cutoff (already live) now skips PS rows ≥06-04 for 62. `total_unreconciled=4` = the 4 brokerage June-move MTM gaps (by design). Revert = clear `promote_from_date`/`feed_sign`, re-ignore the mapping, delete `source='bank-feed'` rows for 62.

## 10.5 Sync-before-reconcile (6b) + per-account backlog (2026-06-05, v2.16.1)

**Sync-before-reconcile.** fin's reconcile action and daily ingest read fin's *local* `bankfeed_balances` cache, which only reflects what the bank-feed last synced from upstream — so reconciliation could run on morning-stale balances (the `feed_balances`-freeze lesson, bank-feed `HANDOFFS`). Added `bankFeedClient.sync()` (`POST /v1/sync?max_age&force`) + a **fail-open** `syncUpstream()` (never throws — a bank-feed outage falls back to cached data), called at the start of `ingest()` (covers the 6am stage-only cron + manual refresh) and in the reconcile route (15-min freshness window + a balance re-ingest) before `reconcileToFeed`. Window via `BANK_FEED_SYNC_MAX_AGE_MIN` (default 60); the reconcile response carries `_synced: fresh|synced|cached`. Unit test (`syncUpstream.test.js`) covers the param passthrough + fail-open contract. Verified on prod (a dry-run reconcile returned `_synced:"fresh"`).

**Per-account backlog + exit monitor.** The PS→Feeds migration backlog with **owner-confirmed dispositions** (2026-06-05) lives in [CR023_PS_MIGRATION_TRACKER.md](CR023_PS_MIGRATION_TRACKER.md): 13 accounts cut over; the 13-account active residual → **8 US accounts to Fintable feeds** (5 cards need `feed_sign=+1`), Wise×2 + Revolut best-effort feed, **OCME 45 + dormant holdings → manual/CR025**. `server/src/v2/scripts/ps-exit-monitor.js` is the live read-only exit gate (prod today: 13 PS-dependent; PS removal can run when it reaches 0). OCME 45 is a **loan receivable** (not a bank account) — offset-fed from PKO transfers + manual; the §4.D "map 45 → Pekao feed" plan was retired. Caixa EUR (14) cut over 2026-06-02.

## 10. Decision log
- **2026-06-03 — Investment mark-to-market via an Unrealized G/L *entry*, not a balance read-override (owner decision).** CR024 currently values the 5 Fidelity brokerage accounts with `account_source_mappings.balance_from_feed=TRUE` (balance sheet reads `feed_balances` market value directly, bypassing `opening_balance+Σtx`). The owner wants the recurring monthly mark-to-market done by **posting an adjustment transaction** instead: `amount = feed_market_value − current fin balance`, categorized to the existing **"Unrealized G/L"** P&L category (`accounts.id=88`, profit_loss/expense), dated month-end, on the investment account. Benefits: `opening_balance` stays the real opening; the transaction stream = contributions/trades (cost basis); the monthly entries accumulate to total unrealized gain and are **visible in P&L** with a per-month audit trail (vs the silent read-override, which shows the value but records no gain). This is the proper accounting treatment and supersedes `balance_from_feed` as the MTM mechanism for fed investment accounts (the read-override can stay as a fallback or be retired once the entry-based MTM lands). **Scope/owner placement:** sits between this CR's source-aware calibration and CR020 (lot/cost-basis); CR023 thread to decide whether to implement here or route to CR020. **Cash accounts are unaffected** — they keep `opening_balance ← feed_balances` calibration (§4.B); this entry mechanism is for *investment* accounts only. **Correction note:** during the 2026-06-02 PKO recalibration session, this month's Fidelity MTM was briefly applied via an `opening_balance` plug before `balance_from_feed` was understood; that change was reverted (Fidelity openings restored), and only the legitimate PKO (cash) calibration `opening 115,478.38→5,534.68` was kept.
- **2026-06-03** — CR planned one-question-at-a-time with owner. See §0 for the full decision table. Key calls: incremental account-paced full retirement (PS = catch-all until last account off); source-aware manual calibrate + source-partitioned read-only monitor; **new symmetric PS-side cutoff** as the deterministic cutover guarantee (closes the §G dedup weakness); OCME (45) migrates onto its Pekao feed (bank-feed reaffirmed as a shared read-only microservice); parked 5564/Individual stay ignored; CR020 separate; forecast-29 out of scope; PS-removal data-preserving + deferred.
