**Status:** SHIPPED (v3) — forward fix **released v3.0.27 (2026-06-10)**. Backfill intentionally **NOT applied** (history left as-is per owner; the script stays a forensics tool). — [anchor](../current/project-roadmap.md#cr032)

# CR032 — Fidelity Core-Cash Sweep Auto-Neutralization

**Created:** 2026-06-10 · **Follows:** [CR028](cr-028-securities-trade-neutralization.md) (smart neutralize), [CR024](cr-024-fidelity-feeds.md) (activity categorizer).

## 1. Why

A Fidelity brokerage **"core" position** (SPAXX, "FDIC INSURED DEPOSIT AT JP MORGAN/SANTANDER", "FIDELITY GOVERNMENT CASH RESERVES", …) is the cash sweep: idle settlement cash is swept **INTO** core and **redeemed FROM** core to fund trades. The feed delivers **only the settlement-cash leg** —
`REDEMPTION FROM CORE ACCOUNT …` (+cash) / `PURCHASE INTO CORE ACCOUNT …` (−cash) — and **never the core-position counter-leg** (SnapTrade reports the sweep as a single cash event, tagged as a plain `BUY`/`SELL` or with a null type).

Counting that lone cash leg inflates the reconciled balance: each un-mirrored sweep is a **drift** of its own amount. Concretely (2026-06-08, Fidelity Options): a `REDEMPTION FROM CORE … (SPAXX) +30,000` with no counter-leg drove **+$30,000 of a +$34,562.93 MTM-GAP**.

**Why CR028's pairing didn't cover this.** CR028 makes `neutralize` *pair* an equal-and-opposite leg. But the offsetting amount it finds is often a **real trade** of coincidentally identical size — e.g. the `YOU BOUGHT ASSIGNED PUTS −30,000` that the redemption funded. Pairing then (a) mis-labels the real trade as `Transfer - Securities Trades`, stripping its `Option Trade` P&L, and (b) creates **no row**, so the sweep stays un-mirrored and the drift persists. The sweep's true counter-leg (the core-position change) is never in the feed, so it must be **mirrored**, not paired.

## 2. What (forward fix — done on dev)

### 2.1 Categorizer — detect core sweeps by description ([bankFeedToCanonical.js](../../server/src/v2/converters/bankFeedToCanonical.js))
- New `CORE_SWEEP_RE = /\b(?:REDEMPTION FROM|PURCHASE INTO) CORE ACCOUNT\b/i`, checked **ahead of** the `activity_type` switch (SnapTrade tags these `BUY`/`SELL`/null, so only the description distinguishes them from a real option/equity trade).
- New action `{ action: 'transfer-mirror', category: 'Transfer - Securities Trades' }`. `categorizeFidelityActivity(activityType, tradeTreatment, description)` gains the optional `description` arg; omitting it preserves pre-CR032 routing.

### 2.2 Promote — insert leg + mirror ([refreshBankFeedV2.js](../../server/src/v2/services/refreshBankFeedV2.js))
- A `transfer-mirror` row is **auto-accepted** (`accepted=TRUE`, deterministic plumbing — no review queue) and immediately paired with a negated **`source='auto-offset'`** mirror (same shape as a manual neutralize mirror), so the sweep self-nets and never drifts.
- These rows **skip cross-source dedup** (they are synthetic net-zero plumbing, never a PS twin). New `mirrored` count in the promote summary.

### 2.3 Neutralize guard ([transactions.js](../../server/src/v2/repositories/transactions.js))
- The pair-candidate query gains `AND (category_id IS NULL OR category_id = $6)` (the transfer category being applied). A row the user deliberately categorized as a real trade (e.g. `Option Trade`) is **no longer consumable** as a sweep's offset → `neutralize` falls through to **MIRROR**, injecting the missing leg instead of mis-pairing. This is the manual-path mirror of the automatic §2.2 fix.

## 3. Backfill (data — dry-run only so far)

[`scripts/backfill-cr032-core-sweeps.js`](../../server/src/v2/scripts/backfill-cr032-core-sweeps.js) — retro-mirror sweeps promoted before CR032. **Report-first / conservative** (mutates financial history):
- `already-mirrored` (auto-offset twin exists) → skip.
- `lone` (no real opposite-leg nearby) → recategorize to `Transfer - Securities Trades` + insert mirror. Written **only** under `--apply`.
- `needs-review` (a non-sweep, non-offset opposite-amount row sits within ±3 days — a possible CR028 pair) → **report only, never auto-written**; a human decides.

**Prod dry-run (2026-06-10):** 27 already-mirrored, **1 lone**, **4 needs-review** (acct 28 dividend→core; acct 28 TSLA assigned puts/calls — already CR028-paired, ≈ −$0.87 real, cosmetic mis-label; acct 30 interest→core round-trip). Not yet applied — pending owner decisions on the 4.

## 4. Tests (all green on dev :5434)
- `services/__tests__/cr024Categorizer.test.js` — +5 cases: REDEMPTION/PURCHASE both directions, null-activity-type wins, genuine option SELL not misread, description optional.
- `services/__tests__/bankFeedImport.test.js` — promote inserts the leg (accepted) **and** the negated auto-offset mirror.
- `repositories/__tests__/neutralize.test.js` — guard: a real-trade-categorized leg is not consumed → mirrors instead, and keeps its category.

## 5. Non-goals / open
- **Backfill on prod** — owner decided to **leave history as-is** (2026-06-10). The piecemeal `--apply` is unsafe anyway: in a self-netting cluster (e.g. acct 30: `+624.66 redemption` / `−624.66 purchase-into-core` / `+624.66 interest`), mirroring only the `lone` leg while skipping its `needs-review` twin would unbalance the account by −624.66. Residual historical drift is small and mostly self-netting; revisit per-account only if a specific account's recon shows real drift.
- Non-Fidelity core sweeps (other brokers) — out of scope until such a feed exists.

## 6. Manual fix already applied (prod, 2026-06-10)
Ahead of this CR, the immediate +$30,000 drift was cleared by hand: mirrors `2700285` (−30,000) + `2700286` (−1,942.06) injected for sweeps `2700263`/`2700269`, and `2700269` recategorized `Option Trade → Transfer - Securities Trades`. These now read as `already-mirrored` in the backfill (idempotent).
