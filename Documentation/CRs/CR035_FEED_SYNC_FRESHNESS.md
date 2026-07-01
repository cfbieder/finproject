# CR035 — Feed Sync Freshness (true upstream "synced N days ago")

**Status:** PLANNED (scoped + Phase 0 verified 2026-06-30; not yet built).
**Track:** v3
**Anchor in FC_NEXT_STEPS.md:** [cr035](../FC_NEXT_STEPS.md#cr035)
**Realizes:** the *stale-feed alerting* slice of [CR021](CR021_BANK_FEED_SERVICE.md) Phase 5 (Robustness layer), scoped down to the one signal the reconciliation page needs.
**Corrects:** the v3.0.43 "synced N days ago" indicator, which reads the **wrong** timestamp (see §Problem).

## Summary

The Balance Calibration page (CR023) should show, per fed account, **how stale the upstream bank connection is** — e.g. Luxury Card (Barclays) last actually synced *5 days ago* even though fin polled it today. v3.0.43 added a "synced N days ago" sub-line under each row's Feed date, but sourced it from `bankfeed_balances.fetched_at` — which tracks **fin's own daily poll**, not the bank. Every row therefore reads "synced today," including genuinely stale feeds. This CR promotes the real per-connection sync timestamp (fintable's **"⚡ Last Update"** column) through the bank-feed service into fin and renders *that*.

## Problem — why v3.0.43 is misleading (root cause)

Both timestamps fin currently has track fin's polling cadence, not the bank:

- **`bankfeed_balances.balance_date`** (the "Feed date" column) is stamped `syncDate = new Date()` by the service converter ([`converters/fintableToCanonical.js:195`](../../../Programs/fin/bank-feed/src/converters/fintableToCanonical.js) — `balance_date: syncDate`). The converter reads the accounts sheet, which *has* a real per-account **"⚡ Last Update"** column ([line 28, `COL.acct.lastUpdate`](../../../Programs/fin/bank-feed/src/converters/fintableToCanonical.js)), but **never uses it**.
- **`bankfeed_balances.fetched_at`** is set `NOW()` on every upsert ([`refreshBankFeedV2.js` `ingestBalances`](../../server/src/v2/services/refreshBankFeedV2.js)).

Both run daily regardless of upstream. Proof (Luxury Card = Barclays "Black Card (9915)"): balance frozen at −5,571.64 across Jun 28/29/30, yet each day got a fresh `balance_date` + `fetched_at`.

## Phase 0 verification — DONE (2026-06-30), signal confirmed viable

Read the live source directly from the service DB (`bank-feed-db`, `feed_accounts.raw->'row'->>'⚡ Last Update'`):

| Risk | Result |
|------|--------|
| Populated per-account? | ✅ All 30 accounts have a value; zero nulls |
| Parseable format? | ✅ Clean **ISO-8601 + tz** (`2026-06-25T01:29:10+00:00`) — parses via `::timestamptz`, **no** Excel-serial conversion needed |
| Per-account or sheet-level? | ✅ Per-**connection**: Barclays 06-25, Fidelity all 06-29 23:02, Chase 06-30 20:23, Amex 06-30 20:11 |
| Discriminates stale vs fresh? | ✅ Sorted oldest-first, **Barclays alone at 5d 22h**; everything else ≤ 1 day |

Luxury Card (`external_id j5a1n7…` → Barclays Black Card) = `2026-06-25T01:29:10+00:00` = the ~5-day delay the owner already knew about. The signal is real, clean, and correct.

## Design decision — where the field lives

The "⚡ Last Update" is **connection-level** truth (a property of the account, not of a day's balance). Two shapes:

- **(A) Denormalized onto the balance path (chosen).** Add `source_synced_at` to `feed_balances` (service) and `bankfeed_balances` (fin); the converter stamps it from the accounts row; `/v1/balances` returns it; fin's existing recon LATERAL surfaces it. **Least change** — rides the exact path v3.0.43 already uses; no new fin table/join. Cost: the value repeats on each daily balance row (harmless — it changes rarely).
- **(B) Normalized, account-level via `/v1/accounts` + `/v1/health/feeds`.** Cleaner semantics, but adds a fin-side per-account store + join, and pulls in the broader CR021 Phase 5 health endpoint. **Deferred** — do the full `/v1/health/feeds` (staleness_days, last_gap_at, consent_expires) as CR021 Phase 5 proper; CR035 is the minimal correct slice.

Chosen: **(A)**. Field name standardized as **`source_synced_at`** (TIMESTAMPTZ) in both DBs; fin's `/balance-recon` returns it as **`feed_synced_at`**.

## Scope — the field must travel two repos

```
fintable sheet "⚡ Last Update"
  → [bank-feed] convertAccount()   ← stamp balance.source_synced_at (currently dropped)
  → [bank-feed] feed_balances      ← + column
  → [bank-feed] GET /v1/balances   ← + field  (contract v1, additive)
  → [fin] ingestBalances()         ← read + write
  → [fin] bankfeed_balances        ← + column
  → [fin] GET /balance-recon       ← select + return feed_synced_at
  → [fin] BalanceReconciliation.jsx ← render "synced N days ago" from feed_synced_at (replace fetched_at)
```

### Bank-feed service (`~/Programs/fin/bank-feed` — separate gitignored repo)
1. **Migration** `db/migrations/00X_source_synced_at.sql` — `ALTER TABLE feed_balances ADD COLUMN source_synced_at TIMESTAMPTZ`.
2. **Converter** `converters/fintableToCanonical.js` — in `convertAccount`, parse `row[COL.acct.lastUpdate]` (ISO string → keep as-is / `null` if blank) and add `source_synced_at` to the returned `balance` object. Document the field in the header comment (line ~9).
3. **Sync writer** `services/fintableSync.js:~127` — add `source_synced_at` to the `feed_balances` INSERT column list + `ON CONFLICT DO UPDATE`.
4. **API** `routes/balances.js` — add `source_synced_at` to the `/v1/balances` SELECT + JSON row.
5. **Contract** — bump the `/v1` contract doc: `/v1/balances` rows gain optional `source_synced_at` (nullable ISO-8601). Additive/back-compatible.

### Fin (this repo)
6. **Migration** `server/db/migrations/03X_feed_source_synced_at.sql` — `ALTER TABLE bankfeed_balances ADD COLUMN source_synced_at TIMESTAMPTZ`.
7. **Ingest** `server/src/v2/services/refreshBankFeedV2.js` `ingestBalances` — read `b.source_synced_at`, add to the INSERT + `ON CONFLICT DO UPDATE`.
8. **Recon query** `server/src/v2/repositories/bankFeedReconciliation.js` — add `bb.source_synced_at` to the `feed` LATERAL SELECT and return `f.source_synced_at::text AS feed_synced_at`. (Leave the v3.0.43 `feed_fetched_at` in place or drop it — see decisions.)
9. **Frontend** `frontend/src/components/BalanceReconciliation/BalanceReconciliation.jsx` — point `fmtSyncedAgo()` at `a.feed_synced_at` (was `a.feed_fetched_at`); apply staleness color thresholds (below).

## Deploy ordering (matters)

1. Bank-feed: apply service migration → deploy service → let one sync cycle populate `source_synced_at` (or backfill from `feed_accounts.raw`).
2. Fin: apply migration on **prod** → deploy fin code.

Reversing this makes fin read a `/v1/balances` field that isn't there yet. Existing fin `bankfeed_balances` rows are `NULL` until the next ingest → UI shows "synced —" for one cycle (acceptable; optionally backfill).

## Consumer coordination

`/v1/balances` has 2 consumers (fin + OCME). The new field is **additive + nullable** → OCME ignores it, no break. Notify the OCME consumer of the contract addition; no coordinated deploy required.

## Display design (fin) — proposed, confirm before build

Render the real value in the Feed-date cell (replacing the v3.0.43 line), color-coded by age. Brokerage feeds legitimately don't sync on weekends/holidays, so the threshold must tolerate multi-day gaps:

| Age | Style | Label |
|-----|-------|-------|
| ≤ 2 days | grey (muted) | `synced today` / `synced N days ago` |
| 3–6 days | amber | `synced N days ago` |
| ≥ 7 days | red | `synced N days ago` |

`null` → `synced —`. Hover shows the exact `source_synced_at`. (Luxury Card at 5 days ⇒ amber; Fidelity at 1 day ⇒ grey.)

## Owner decisions (settled 2026-06-30)

| # | Decision | Choice |
|---|----------|--------|
| 1 | Field shape | ✅ **(A) denormalized `source_synced_at`** on the balances path (minimal); defer normalized `/v1/health/feeds` to CR021 Phase 5. |
| 2 | Staleness thresholds | ✅ grey ≤2d / amber 3–6d / red ≥7d (weekend-tolerant). |
| 3 | v3.0.43 `feed_fetched_at` | ✅ **Drop it** from the recon query + UI once `feed_synced_at` lands (it measured the wrong thing). |
| 4 | Interim before CR035 ships | ✅ **Hide now** — ship a small v3.x patch that removes the misleading `fetched_at` "synced today" line so the page stops asserting false freshness while CR035 is built. |
| 5 | Backfill | ✅ **Self-populate, no backfill** — "⚡ Last Update" is a current snapshot only (no historical timestamps to recover); the latest row is the only one the recon query reads, and the service's ~hourly cron writes `source_synced_at` onto it next cycle. A backfill would need a bespoke cross-DB script (fin ↔ `bank-feed-db` are separate instances) for ~1h of earlier correctness on an advisory field. |

## Testing

- **Service:** converter unit test — a fixture accounts row with `⚡ Last Update` → `balance.source_synced_at` set; blank cell → `null`. `/v1/balances` integration test asserts the field is present.
- **Fin:** `ingestBalances` writes `source_synced_at`; `balanceReconcile` returns `feed_synced_at`; `fmtSyncedAgo` helper unit test (today/yesterday/N-days/null + threshold buckets).

## Risks

| Risk | Likelihood | Mitigation |
|------|-----------:|-----------|
| Deploy order reversed → fin reads missing field | Low | Additive/nullable; fin tolerates absent field (writes `null`). Document order here. |
| "⚡ Last Update" semantics change upstream (fintable) | Low | Phase 0 confirmed per-connection ISO; store raw, re-verify if fintable format shifts. |
| "unchanged balance" ≠ "stale feed" confusion | — | Not used — we surface the true sync time, not balance-stability. |
| Thresholds cry wolf on brokerage weekends | Med | 3-day amber floor absorbs weekend gaps. |
```
