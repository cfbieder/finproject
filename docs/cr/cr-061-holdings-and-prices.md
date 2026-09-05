# CR061 — Investment holdings ingest and market prices — ✅ **P0 + P1 COMPLETE** (v3.50.0, 2026-09-03) · P2 open

**✅ P0 + P1 SHIPPED v3.50.0 (2026-09-03).** bank-feed serves `GET /v1/holdings` (its migration 008);
fin has migrations **075** + **076**, the securities master, the classifier, the ingest on the nightly
refresh, and both backfills. Measured after the backfills: **305 snapshots over 61 days
(2026-07-04..09-02), 5,628 positions, 93 securities, 1,978 daily closes** — in tables that had held
nothing since May 2026. **P2 (the statement-derived backfill to 2016) remains open.**

**rev 3 (2026-09-02)** — split, after a two-pass review returned `revise` / `revise-with-a-GO-on-the-
carved-increment`. rev 2 had grown into three CRs, and the one piece with a clock on it was scheduled
behind the two that had none. So:

- **This CR is the ingest.** The bank-feed storage, the securities master, the classifier,
  `security_positions`, the market-price source, and the backfills. **No UI.**
- **[CR090](cr-090-investments-section.md) is the page** — the Investments section, the per-account
  register, the quote overlay and the warnings the owner reads.

Why the split has a reason beyond tidiness: **fintable's holdings history begins 2026-07-04 and
nothing recovers a day nobody stored** (§4.8). The ingest can ship the day the endpoint exists and
starts the clock; the page cannot ship without nav wiring, both themes rendered, and a display review
— and by the time it is built it renders two months of accrued history instead of one day's.

Everything in §4 was measured **live against fintable's API on 2026-09-01/02** and against the dev
(`:5434`) and prod (`:5433`) databases. rev 1 of this CR quoted its constraints from
[CR059](cr-059-fintable-api-ingestion.md) §15B+C without ever calling the endpoints; rev 2 called
them and corrected three; **rev 3 corrects two more of its own** (§4.7, §4.8), both found by review.

Roadmap anchor: [project-roadmap.md#cr061](../current/project-roadmap.md#cr061). **Track: v3.**
**Split out of [CR059](cr-059-fintable-api-ingestion.md) §15B+C.**

---

## 1. Why

`securities`, `security_lots`, `security_transactions`, `security_lot_disposals`, `security_prices`
and `quicken_price_staging` are **0 rows on dev and prod** (verified 2026-09-02). The whole schema
was created by migration `022_quicken_import.sql` in May 2026 and has never held a row. Everything
downstream has been working around that absence:

- [CR056](cr-056-investment-returns.md) derives investment returns from **ledger postings** rather
  than positions, and its `Unattributed` row exists because of it. ⚠️ CR056 is **COMPLETED and not
  blocked** — it shipped *because* the tables were empty. This CR does not unblock it; it makes a
  future position-based return possible, which CR056 itself defers.
- [CR058](cr-058-quicken-valuation-anchors.md) reconstructs brokerage history from **Quicken
  exports** because nothing else knows what was held.
- [CR020](cr-020-stock-investment-module.md) has been a planning skeleton for the same reason.
- [CR089](cr-089-month-end-observation-dating.md) — **the nearest consumer, and the one with a
  recurring deadline** — needs holdings and dated closes to stop the owner having to know a poll date
  to book month-end MTM.
- fin has **no market-price source at all**, so no fin surface has ever known what a share is worth.

And a wrong number today: the roadmap records fin disagreeing with the custodian at **almost every
month boundary** — Fidelity Bond wrong at all four measured dates, by up to **+14,163** — because
past points are only as good as whenever an MTM row happened to land. §8's P2 is the fix.

---

## 2. What this CR delivers

1. **Stored holdings** — fintable's per-account daily snapshots, in bank-feed, served to fin.
2. **The `securities` master, populated** — with a classification that decides what an instrument
   *is* before anything tries to price it.
3. **`security_positions`** — the per-position snapshot series, with a snapshot header that can say
   "fetched and empty" and "never fetched" as different things.
4. **A market-price source** (fin's first): live quotes and **dated daily closes**.
5. **Two backfills** — fintable to 2026-07-04, and the custodian statements to 2016 (§8 P2).

Not here: the Investments section, the register, the quote overlay, the page's warnings. Those are
[CR090](cr-090-investments-section.md).

⚠️ **And not here, or anywhere in this thread of work (owner-confirmed 2026-09-03): any write to the
ledger.** This CR fills tables and CR090 reads them. Neither books an MTM row, auto-reconciles against
the balances fin already holds, re-anchors an `opening_balance`, or flips `balance_from_feed`. The
existing reconcile loop remains the only thing that books a mark. See [CR090 §0](cr-090-investments-section.md).

---

## 3. Relationship to CR020, CR089 and CR090

**[CR020](cr-020-stock-investment-module.md)** — this CR takes its ingest and price source; CR090
takes its overview page. CR020 keeps what genuinely needs lot-level data: realized G/L, tax lots,
wash sales, HIFO/FIFO selection, and the Fidelity **Closed Lots** import that is the only way to get
them. Its header and index row carry the narrowing.

**A snapshot is not a lot,** and this is why the split holds. `security_lots` requires
`acquired_date NOT NULL` and `cost_per_share NOT NULL`; a daily position snapshot has neither.
Writing snapshots there would fabricate an acquisition date and a per-share cost in three different
units (§4.4) and would poison CR020's lot model permanently. It also means this CR **does not depend
on CR019** (IN-PROGRESS, investment promote descoped to value-only) — it routes around it.

**[CR089](cr-089-month-end-observation-dating.md)** — ⚠️ **the ownership settled on 2026-09-02
was inverted by CR089's own review passes on 2026-09-03, and this CR follows it.** The owner decision
gave CR089 the bank-feed passthrough; CR089 then split into P1 (no dependencies) and P2 (blocked),
and its §P2.5 concludes the opposite: *"P2 should read **fin-local tables CR061 fills**, not add a
second live passthrough"* — which deletes its timeout/cache/fail-open machinery and takes a network
call off a read-only preview path.

**So this CR owns the bank-feed holdings work outright and ships it first** (§8 P0). CR089 P1 — the
date control moving into the dialog — has no dependency and can ship at any time. **CR089 P2 waits
on this CR's P1**, not the reverse.

🔴 **CR089 still changes this CR's data model** (§4.10) — and 🔴 **its P2.3 puts the `valued_on`
source in doubt**, which §4.10 now records.

---

## 4. Measured against the live API — 2026-09-01/02

### 4.1 The endpoint

`GET /accounts/{id}/holdings` → 200 for all six Fidelity accounts:

```json
{"id":"hol_01M1DTHVWGWR6K6PF4Q0BRJ8TX","name":"SPCX","symbol":"SPCX","quantity":"100",
 "price":"141.5","value":"14150.0","cost_basis":"15708.500","currency":"USD",
 "updated_at":"2026-09-01T06:29:53Z"}
```

plus `snapshot_date` and `workspace_id` on the envelope. **No collection route** (`/holdings`,
`/positions`, `/securities`, `/investments` all 404) and **no cursor**.

### 4.2 The six accounts, and how they tie

Five are tracked in fin; `Individual` is deliberately not (§10.1). It is listed because its
reconciliation is evidence about the *feed*, independent of whether fin renders it.

| Fintable account | fin account | Positions | Σ positions | Custodian balance | Residual |
|---|---|---:|---:|---:|---:|
| Stocks | 27 Fidelity Stocks | 31 | 1,187,764.09 | 1,187,764.08 | 0.01 |
| Fixed Income | 31 Fidelity Bond | 31 | 1,225,920.82 | 1,225,920.78 | 0.04 |
| Cash Management | 30 Fidelity Cash Mgt | 12 | 1,085,463.02 | 1,085,453.02 | 10.00 |
| Rollover IRA | 26 Fidelity IRA | 19 | 298,532.29 | 298,532.19 | 0.10 |
| Individual | *— not tracked (§10.1) —* | 1 | 26,111.55 | 26,111.55 | 0.00 |
| **Options** | 28 Fidelity Options | **1** | **70,526.53** | **103,607.53** | **33,081.00** |

**Five of six tie within $10** — four within a dime. That tie is the strongest integrity check
available, and CR090's residual row is built on it. Record these four residuals as **expected
values**, not as a tolerance to aspire to.

### 4.3 🔴 The Options account is missing $33,081 of option contracts

It returns **only its SPAXX money-market sweep**. Its transaction feed for 2026-08-31 alone shows
`YOU BOUGHT OPENING TRANSACTION PUT (EIX)`, `EXPIRED PUT (META)`, `YOU SOLD CLOSING TRANSACTION PUT
(EIX)` and a dozen more — the contracts are real, traded weekly, and **fintable's holdings endpoint
does not report them**. 31.9% of that account is invisible to any position-based total. Structural,
not transient.

### 4.4 Three quantity/price conventions, not one

| Kind | `quantity` unit | `price` basis | Live example |
|---|---|---|---|
| equity / ETF / CEF | shares | $ per share | `100 × 141.50 = 14,150` |
| **CUSIP bond / brokered CD** | **face value** | **fraction of par** | `100,000 × 0.9989 = 99,890` |
| money market | shares | par (1.00) | `70,526.53 × 1.00` |

`value = quantity × price` holds for all three. The failures are in aggregation, display and quote
lookup. ⚠️ `securities.asset_class` is `NOT NULL DEFAULT 'stock'` — an unclassified CUSIP inserted
without an explicit class **silently becomes a stock, and a stock is quote-eligible**. That default
has to go (§6).

### 4.5 The CUSIP positions are in two accounts, not one

**37 CUSIP-priced positions: 29 in Fixed Income and 8 in Cash Management** (brokered CDs — CR058
§12.6 records that account holding them). rev 2 said 29 and scoped the classifier's evidence to one
account; that would have left **8 positions classified per-share**, which is precisely the mis-basis
§6's guard exists to catch, arriving through a door the CR left open.

For every one, `name == symbol == CUSIP` (`718172DC0`, `06055JDF3`, `949764XN9`). No issuer, no
coupon, no maturity. Note also that **Fixed Income is not CUSIP-only**: `FLDR`, a bond ETF, is 44% of
that account, and it quotes.

### 4.6 Quote coverage: **47.5% of value** against fintable `/prices`, as of 2026-09-02

| Class | Positions | Value | Share | Quotable? |
|---|---:|---:|---:|---|
| equity / ETF / CEF | 48 | 1,848,640 | **47.5%** | **yes** |
| bond / brokered CD (CUSIP) | 37 | 1,676,285 | 43.1% | no — not a ticker |
| mutual fund (`FCNTX`) | 1 | 147,988 | 3.8% | **no — returns 200-empty** |
| money market (`SPAXX`/`FZDXX`/`FDRXX`) | 6 | 133,015 | 3.4% | no — par by nature |
| unclassified (`QIMHQ`, `QHYEQ`, `FDIC91125`) | 3 | 86,309 | 2.2% | no — returns 200-empty |

Per account, quotable share of positions: **IRA 97% · Stocks 87% · Fixed Income 44% · Cash Mgt 0% ·
Individual 0% · Options 0%.**

🔴 **The two fintable endpoints disagree on symbol format.** The custodian reports **`BRKB`**; the
quote endpoint returns empty for `BRKB` and **502.43 for `BRK.B`**. $25,202 that a naive lookup drops
*silently* — and a quote that isn't there looks exactly like a market that didn't move.

### 4.7 The price feed: public, IEX, and it has dated history after all

- **Public — no auth** (verified by calling with no `Authorization` header). The param is
  **`?symbols=`**, plural; `?symbol=` 422s.
- **`feed: "iex"`** with `price, open, high, low, previous_close, change, change_percent, volume,
  trading_day, as_of`. `as_of` is the **last IEX print**, clustered at `19:59:5x Z` with after-hours
  stragglers to `20:36Z`. IEX is one exchange at a low single-digit share of consolidated volume, so
  for a thin name the last IEX print can be materially older than the last sale. Fine for valuing a
  position; not a quote.
- **🔴 It returns `503 service_unavailable` often** — four of five batches failed during this
  measurement, and two symbols still 503'd after eight retries with backoff. Cached repeats ~25ms vs
  ~1s cold. **Quotes are best-effort; nothing may depend on one arriving, and nothing may fetch them
  on a render path.**
- ✅ **`GET /prices/{symbol}/history?start=&end=` WORKS** — corrected in rev 3. rev 2 reported it 404,
  having sent `from`/`to`; the params are **`start`/`end`**, and the 404 message
  (*"No price history for that ticker and range"*) is misleading. It returns daily bars with
  `open/high/low/close/volume/trade_count/vwap` **and the trading calendar** (its bars skip 08-29 and
  08-30). Found by [CR089](cr-089-month-end-observation-dating.md), verified here.

  **This changes §8.** A dated-close backfill is available, so `security_prices` can be populated for
  the quotable sleeve immediately rather than accruing forward from today.

### 4.8 Snapshot history: fintable starts 2026-07-04; the statements go back to 2016

`?date=` serves back-dated snapshots. Walking the Stocks account day by day: **2026-07-04 is
fintable's earliest**, and every calendar day since is present (weekends included, repeating
Friday's marks). Earlier dates return **200 with `data: []` and `snapshot_date: null`**.

⚠️ **rev 2 generalised this to "there is no earlier position history". That was wrong.**
[CR058 §12.8–12.9](cr-058-quicken-valuation-anchors.md) records that the custodian's statements carry
a **per-holding position table** — market value, total cost basis, unrealized G/L — across all **117
account-statements, 2016–2026**, and the parser is already built. The roadmap assigns that backfill
to this CR by name: *"fintable supplies holdings going forward, statements supply the backfill, and
the two check each other."* **Owner decision 2026-09-02: CR061 claims it** — §8 P2.

So: fintable gives a daily series from 2026-07-04 forward; the statements give a period-end series
back to 2016; and the overlap is what lets each check the other.

### 4.9 🔴 The `hol_…` id is re-minted on every sync

The Options account's SPAXX position carried `hol_01M1DTHW0HMT51GM25G6NXM0NE` at 06:29Z and
`hol_01M1GDAQ40QRV9GMR9JBRT14S0` hours later the same day — same position, new id, quantity moved
70,526.53 → 70,725.56 **under the same `snapshot_date`**. Never key on the upstream id; keep it in
`raw`. This is [CR059](cr-059-fintable-api-ingestion.md) §22's lesson in a new noun.

✅ **Measured, and it holds:** across all 95 live positions there are **0 duplicate
`(account, symbol)` pairs** — so `(account, security, snapshot_date)` is a sound grain *today*.
§6 makes a violation fail loud rather than trusting it to stay true.

### 4.10 🔴 `snapshot_date` is a POLL date, not a valuation date

[CR089](cr-089-month-end-observation-dating.md) measured this, and it is the most consequential
finding for this CR's schema:

```
GET /accounts/{id}/holdings?date=2026-08-31  → snapshot_date 2026-08-31, Σ = 1,187,764.09
GET /accounts/{id}/holdings                  → snapshot_date 2026-09-02, Σ = 1,185,594.39
```

The 09-02 snapshot is priced at the **08-31 close**. Asking for the snapshot *dated* 08-31 returns
positions priced at **Friday 08-28's** close. **No field anywhere states the valuation date** — the
only ground truth is the position prices, cross-checked against dated closes (which §4.7 now makes
available).

**Consequence, and it is not cosmetic:** `security_positions` must carry **two dates** —
`polled_on` (the envelope's `snapshot_date`, provenance) and `valued_on` (**nullable**, derived).
Storing one and letting consumers infer the other mis-dates the entire position history by a day or
two, invisibly. That is the class CR089 exists to kill, and this CR must not reintroduce it one table
over.

🔴 **`valued_on` has no proven source yet, so it ships nullable and mostly null.** CR089's pass 1
falsified its own strongest evidence row — the draft took `previous_close` from `GET /prices?symbols=`
where the authoritative close comes from `GET /prices/{sym}/history`, and **the two fintable endpoints
disagree by 0.65% about the same close**. Measured per-symbol residual between custodian price and
history close runs **0.005% (CSCO) to 1.3% (JEPI)**, systematically positive — and **that bias exceeds
the 0.7% adjacent-day separation** the detection rested on. CR089 P2 is explicit that *"if the
corrected margin does not separate, P2 does not get built."*

**What this CR must therefore do:** store the column, populate it only from a proven detector, and
**never let any consumer fall back to `polled_on` when it is null** — [CR090](cr-090-investments-section.md)
says *"valuation date not established"* instead. A nullable column read with a silent fallback is the
same defect wearing a schema.

🔴 **And a second finding from CR089 P2.4 that this CR's own reconciliation must respect:** the
08-31 snapshot holds the right **quantities** and the wrong **prices**; the 09-02 snapshot holds the
right **prices** and the wrong **quantities** (dividend and sweep credits landing 09-01/02).
**Neither snapshot is the month-end.** On Cash Mgt the quantity effect measured **ten times the mark
and the opposite sign**. So a position snapshot is a *poll*, not a valuation — nothing downstream may
treat `Σ(quantity × price)` from one snapshot as "the value on date X" without saying which date each
half came from.

### 4.11 Two live gaps in fin, both resolved by the owner 2026-09-02

- **The `Individual` account is not in fin, deliberately.** `account_source_mappings` id 369,
  `external_name = '3434139509958219125'`, `account_id IS NULL`, `ignored = TRUE`, holding
  **$26,111.55**. It looks like [CR060](cr-060-feed-connection-health.md)'s orphaned-mapping shape and
  is not — see §10.1.
- **fin's balance sheet was a month behind the custodian, by −$30,527**, every last `Unrealized G/L`
  mark dated 2026-07-31. The owner re-marked the same day in a parallel session, so those figures are
  a **dated snapshot of the gap, not a standing state**. What survives the re-mark is the mechanism:
  between marks the drift reappears and grows, which is why CR090's rule gates on **mark age**.
  ⚠️ **The fix is never `balance_from_feed`** — it is FALSE on all five mappings today
  (`reconcileToFeed.js` clears it on every reconcile), and [CR056](cr-056-investment-returns.md)
  documents that enabling it makes the Balance Sheet and `/investment-returns` disagree on the same
  account on the same date.

---

## 5. The price source, and what it is for

Two distinct uses, and conflating them is what makes a price history unauditable:

| Use | Source | Lands in | Grain |
|---|---|---|---|
| **Dated closes** — valuation, CR089's dating evidence, backfill | `/prices/{sym}/history?start=&end=` | `security_prices` | one row per `(security, date)` |
| **Live quotes** — CR090's overlay panel | `/prices?symbols=` | `security_quotes` | one row per `(security, quoted_at)` |

**A quote is not a close.** `security_prices` is `UNIQUE(security_id, price_date)` with a single
`close`; a custodian snapshot price and an intraday quote both dated today would collide and
last-writer-wins silently with no timestamp to tell them apart. Separate tables, and
`security_prices.source` distinguishes `fintable-close` from `statement` from `manual`.

⚠️ **Quotes are fetched server-side, cached, and scheduled — never on a render path.** A public
endpoint that 503'd four batches in five would otherwise make the page's first cold load the demo
that kills the feature.

### The structural guard against the $25M failure

The failure to design against is a CUSIP's 100,000 face priced at an equity's $250. Three layers,
because one threshold cannot do it:

1. **Structural refusal** — a security is never sent to the quote fetcher unless
   `quantity_unit = 'shares'` **and** `price_basis = 'per_share'`. Deterministic, and the actual fix.
2. **Magnitude refusal at ~5×** — catches the residue of (1) without ever refusing a real move.
   ⚠️ 20% is simultaneously far too loose for a 100×–1000× error and too tight for the market: a
   single-name equity can move >20% on earnings, and a snapshot straddling a split gives exactly 2×
   or 0.5×.
3. **5% / 20% as a warning only**, on implied position value (not on price — rev 2 stated the test
   two different ways).

**A refused quote is not silence.** The position falls back to `price_source = 'custodian'`, CR090's
overlay coverage drops by that position's weight, and the row's chip names the refusal — otherwise a
refused position reads as "didn't move", which is CR085's dead-state defect class.

---

## 6. Data model

### 6.1 The snapshot header — what makes the reconciliation and "absent" expressible

```
security_position_snapshots(
  id, account_id, polled_on DATE, valued_on DATE NULL, source, status,
  custodian_balance DECIMAL(18,4) NULL, positions_count INT, sum_market_value DECIMAL(18,4),
  fetched_at TIMESTAMPTZ, raw JSONB)
  UNIQUE (account_id, polled_on, source)
  status ∈ fetched | empty | absent | partial
```

🔴 **Why a header at all.** CR090's residual row is `custodian balance − Σ positions`, and rev 2 left
the balance coming from `bankfeed_balances` — **a different fetch on a different clock**. §4.9
measured the same `snapshot_date` returning different quantities hours apart, so a torn pairing moves
the Options residual by ~199 against a $33,081 headline. Capturing the balance *in the same fetch*
makes the residual arithmetic on one row. And `status` is the only way `no rows` stops meaning
never-fetched, fetched-and-empty, and genuinely-holds-nothing all at once (§4.8's pre-2026-07-04
case, which §9 tests).

### 6.2 The positions

```
security_positions(
  id, snapshot_id FK → security_position_snapshots(id) ON DELETE CASCADE,
  account_id, security_id, quantity NUMERIC(18,6), price NUMERIC(18,6), price_basis,
  market_value DECIMAL(18,4), cost_basis DECIMAL(18,4) NULL, currency CHAR(3),
  price_source, price_asof TIMESTAMPTZ, fetched_at, raw JSONB)
  UNIQUE (account_id, security_id, snapshot_id)
```

`price_source ∈ custodian | close | quote | par | manual | none`. Money is `DECIMAL(18,4)`,
quantity/price `NUMERIC(18,6)`, matching migration 022 — **never float**.

**Currency:** every measured position is USD, which is exactly how a latent defect ships. Any
cross-currency sum goes through the shared `fx.rateAsOf`, which returns **null, not 1:1**; an
unconvertible position **abstains** rather than being added at face.

🔴 **Uniqueness fails loud.** §4.9 measured 0 duplicates today, but an `ON CONFLICT DO UPDATE` on a
future duplicate (two CD tranches under one CUSIP, a mid-corporate-action double) keeps one row and
drops the other — Σ positions quietly under-counts and the residual row absorbs it as "not reported
by the feed", which is the one number CR090 exists to make legible. Assert
`COUNT(*) = COUNT(DISTINCT security_id)` per snapshot and **reject the snapshot**, do not upsert.

### 6.3 Quotes

```
security_quotes(id, security_id, quoted_at TIMESTAMPTZ, price NUMERIC(18,6), source, venue, fetched_at)
  INDEX (security_id, quoted_at DESC)
```

Retention: keep the latest per security plus 7 days; older rows are pruned. A per-render fetch with
no retention rule is unbounded growth for data with no audit value.

### 6.4 Classification — and quotability is *earned*, not inferred

`securities.asset_class` becomes `CHECK (asset_class IN ('equity','etf','mutual_fund','mmf','bond',
'cash','unknown'))` with **no default**. ⚠️ rev 2's vocabulary had **no value for a mutual fund at
all** — $147,988 the schema could not express — while migration 022's own comment already had `mf`.
`option` is included only if [CR090 §6](cr-090-investments-section.md)'s manual entry lands; today nothing can produce one.

Add to `securities`: `price_basis` (`per_share · per_1_face · par`), `quantity_unit`
(`shares · face · contracts`), `classification_source` (`inferred · manual`), `quote_symbol`
(nullable, **NULL until a quote has been observed**).

**Resolution goes through `security_source_mappings`, not `securities.ticker`.** Migration 022
created it with `UNIQUE(source, external_name)` for exactly this; use `source = 'fintable'`.
Resolving on `ticker` would mint duplicate `securities` rows for the same instrument once CR019's
Quicken promote runs, since that routes via `quicken_security_master_staging.promoted_security_id`.

**Shape decides only what is safe to probe, never what is quotable.** rev 2's rules could not produce
the classification its own tests asserted:

| Symbol | rev 2's rule gave | Correct |
|---|---|---|
| a CUSIP-shaped cash sweep | **`bond`** (matches `^[0-9A-Z]{9}$`, `name == symbol`) | not a bond |
| two par-priced tickers | **`equity`** (5 alpha chars) → quote-eligible | `unknown` |
| the mutual fund | **`equity`** | `mutual_fund` — inexpressible in rev 2's vocabulary |

### 🔴 rev 3's own proposed fix was ALSO wrong — measured 2026-09-03

rev 3 adopted pass 1's recommendation that **CUSIP mod-10 check-digit validation** is *"what makes the
rule falsifiable rather than shape-matching"*, on the stated grounds that real CUSIPs pass and the
cash-sweep identifier fails. **It does not fail.** Implemented and verified against public reference
CUSIPs (Apple's `037833100` and Microsoft's `594918104` both pass, a corrupted digit fails), the live
`FDIC91125` **passes too** — the check space is one digit, so roughly one in ten arbitrary
nine-character strings validates.

So the checksum is kept as a **necessary** condition and never a sufficient one. **What actually
separates the case is the price**: a deposit sits at exactly `1.00`, while the measured bonds price at
`0.9989`, `1.01045` and so on — a fraction *of* par, essentially never exactly par. The par test runs
**before** the CUSIP test, and that ordering is the rule.

⚠️ It resolves to **`unknown`, not `cash`** — we can see *how* the instrument is priced without
knowing *what* it is, and asserting `cash` would claim the second from evidence for the first.
`unknown` is never quoted and always warned, so it takes one manual classification. The cost is that
a bond trading at exactly par on the day it is first seen lands `unknown` rather than `bond`; it is
then flagged rather than silently mispriced.

### The rules as built

1. a known money-market ticker → `mmf` / `par`;
2. **price exactly `1.00` → `unknown` / `par`** (the rule above — it precedes the CUSIP test);
3. CUSIP-shaped **and** self-named **and** checksum-valid **and** not at par → `bond` / `per_1_face` / `face`;
4. five letters ending in `X` → `mutual_fund` / `per_share` (the US open-end fund convention — the
   basis is unchanged, but a fund never returns an intraday quote, and *"no quote because it is a
   fund"* must not look like *"no quote because the lookup is broken"*);
5. one to five letters → `equity` / `per_share`;
6. anything else → `unknown`, never quoted, always warned.

### ✅ Verified against the live portfolio, 2026-09-03

`Scripts/classify-live-positions.js` (read-only) run over all 95 positions:

| Class | Positions | Value | Share | Basis |
|---|---:|---:|---:|---|
| equity | 48 | 1,848,640 | **47.5%** | `per_share` |
| bond | 37 | 1,676,285 | 43.1% | `per_1_face` |
| mutual_fund | 1 | 147,988 | 3.8% | `per_share` |
| mmf | 6 | 133,015 | 3.4% | `par` |
| unknown | 3 | 86,309 | 2.2% | `par` |

**This reproduces §4.6's measured table exactly**, which is the cross-check that matters: §4.6 was
built by asking the quote endpoint what it would price, and this was built from shape and price
alone. ✓ **No CUSIP-shaped or par-priced instrument is marked `per_share`** — the assertion the whole
scheme exists for. The three `unknown` rows are a finding, not a failure: each takes one manual
classification, and `classification_source` stops the next ingest overwriting it.

⚠️ **The fixture is sanitized, not frozen from life.** §9 originally said "freeze the 95 measured
positions as a fixture"; the repo does not commit real financial data (`Samples/Fidelity/`,
`Samples/Fintable/` and the Quicken exports are gitignored) and the symbols **are** the holdings. So
the committed tests invent every identifier — CUSIPs are generated with a correct check digit rather
than copied — and the live check lives in the script above, whose output is data.

A security becomes quote-eligible only after a successful quote has passed §5's guards. That removes
the entire class where a wrong classification silently authorises a quote.

### 6.5 Migration notes

Fin migration **075**. It `ALTER`s `securities`, a table [CR019](cr-019-quicken-import.md)
(IN-PROGRESS) owns — safe today: **0 rows on both dev and prod**, nothing under `server/` writes
`asset_class`, and CR019's investment promote is descoped to value-only. But the column is `NOT
NULL`, so every future insert must supply a value, and CR019's `quicken_type` (Stock / Bond / Mutual
Fund / ETF) maps onto the new vocabulary — state that mapping here, and update CR020 §4's schema
table in the same pass.

House rules that bite: the `CHECK` needs a `DO` block (Postgres has no `ADD CONSTRAINT IF NOT
EXISTS`) · `pg_constraint` post-conditions schema-qualified · structural assertions only, never row
counts · a row in `docs/current/migrations.md` · verified on a fresh DB via `Scripts/test-fresh-db.sh`.

---

## 7. Repo boundary and the contract

| Piece | Repo | Why |
|---|---|---|
| Holdings fetch, **storage** and `/v1/holdings` | **bank-feed, this CR** (⚠️ re-inverted 2026-09-03 — see §3) | It holds the only `FINTABLE_API_TOKEN` and owns the account-id crosswalk that has already been re-keyed once in lockstep with fin's 044. Fetching direct from fin creates a *second* binding to fintable account ids that the next re-consent must repair twice. CR089 P2 reads fin-local tables rather than a second passthrough. |
| Securities master, classification, positions | **fin** | bank-feed must never learn what a security is. |
| Market prices (quotes and closes) | **fin** | `/prices` is public, so the credential argument does not apply. Prices are a market fact, not per-account bank data. |

**bank-feed stores positions denormalized and dumb** — `symbol`, `name`, `quantity`, `price`,
`value`, `cost_basis`, `currency`, `snapshot_date`, `raw` — the way it stores `category_hint`: a
string the upstream said, not an FK into a master it owns.

### 7.1 The contract fin builds against

Pinned here because it is fin's spec; the implementation stays bank-feed's record (its filenames and
migration number are its own to assign — fin cannot hold another repo's migration counter).

- `GET /v1/holdings?as_of=&account_id=&app=` — latest per `(account, symbol)`, mirroring
  `/v1/balances`' `DISTINCT ON` shape and its `app=` owner filter.
- **Every NUMERIC serialized `::text`** — the decimal-as-string convention, contract §Sign conventions.
- The response carries **`polled_on` per account** (not one global `as_of`), the **account's custodian
  balance from the same fetch** (§6.1), and a **`status`** distinguishing `fetched` / `empty` /
  `absent` / `partial`. A 503 or partial upstream read is reported as `partial`, never as an empty
  holdings list.
- **Keyed on the stable external account UUID**, resolved as `refreshBankFeedV2.buildAccountIdToUuid()`
  does — **not** fintable's internal id, which has been re-keyed once already (fin `063`/`051`,
  bank-feed `006`).
- Additive within v1: a **new endpoint** touching no existing shape, which the contract's
  additive-only rule permits. No `v2`.

Three storage rules fin is asserting and bank-feed should be held to:

1. **Stamp from the envelope's `snapshot_date`, never the sync clock.** `feed_balances` uses
   `balance_date: syncDate` (`fintableApiToCanonical.js:91`); a `?date=` backfill stamped "today"
   would file 60 days of history on one day. ⚠️ And per §4.10, that date is a **poll** date — bank-feed
   should name the column accordingly.
2. **Key on `(account_uuid, polled_on, source, symbol)`, not `hol_…`** (§4.9).
3. **Store `cost_basis` verbatim as the position total.** fin owns any per-share division; doing it
   on both sides is how the two silently diverge.

⚠️ **`feed_sign` and `feed_negate_tx` must not follow holdings across the boundary.** A position is
not a signed flow; applying either to a `quantity`, `value` or `cost_basis` is a category error.

### 7.2 🔴 Holdings must not be able to break the transaction sync

`fintableSync.js` has a single module-level `inFlight` handle (`:713`) and `requestSync` hands a
concurrent caller the in-flight result tagged `coalesced: true` (`:749`). Requirements, not
observations:

- A holdings fetch that 503s, times out or throws **leaves the ledger ingest unaffected**.
- A caller who asked for holdings **must not** receive a success summary from a run that never
  fetched them. Either holdings run unconditionally in every sync, or they get their own in-flight
  handle and `sync_jobs` trigger.

This is the only way this CR can damage an existing surface, and it damages the most important one.

### 7.3 The fin-side ingest

Rides the existing nightly refresh in the shape `refreshBankFeedV2.ingestBalances()` already
establishes: best-effort, never fails the transaction path, resolves ids, counts `unresolved`. A 503
or partial fetch is recorded as the snapshot header's `partial` status — **a partial fetch stored as
a complete snapshot invents "not reported by the feed" dollars.**

---

## 8. Phases

| Phase | What | Ships independently? |
|---|---|---|
| **P0** ✅ **BUILT 2026-09-03** (bank-feed `4acbe39`) | **bank-feed**: migration `008_feed_holdings.sql` (`feed_holding_snapshots` + `feed_holdings`), `fetchHoldings`, `convertHoldingsSnapshot`, `fetchHoldingsSnapshots` + `insertHoldingSnapshots`, `routes/holdings.js`, contract §Holding + endpoint row, `HANDOFFS.md`. 13 tests, suite **234/234**. Verified live: one forced sync fetched **6 accounts / 95 positions / 0 errors**. See §8.3 | yes — **CR089 P2 is now unblocked** |
| **P1** | **fin**: migration 075, securities master + hand-seeded classification, `security_position_snapshots` + `security_positions`, the ingest, **backfill to 2026-07-04**, and the `security_prices` close backfill for the quotable sleeve | **yes — and this is the piece with the clock on it** |
| **P2** ✅ **COMPLETE 2026-09-05 — 117 of 117 account-statements reconcile · parser 113 + LLM 4 · ingest, drift report and rows-vs-header check BUILT** | **statement-derived position backfill to 2016** — parse the per-holding position tables from the 117 statements, cross-check against fintable where they overlap, and explain the month-boundary disagreements the roadmap records. See §8.5 | yes |
| *(CR090)* | the Investments section and the quote overlay | separate CR |
| *(CR089 P2)* | dating by evidence — reads P1's fin-local tables | separate CR, and gated on its own §P2.3 discriminant measurement |

**P1 alone starts the accrual and unblocks CR089 P2.** Deferred to the roadmap rather than carried
here: position value history, TTM position return, yield on cost — all gated on twelve months of a
table that does not exist yet, and carrying them makes this CR read as unfinished for a year.

### 8.3 P0 as built — and the residual got *tighter*

Live on :3007 since 2026-09-03. `custodian_balance − Σ positions` on the 2026-09-02 poll:

| Account | Positions | Σ positions | Custodian balance | Residual |
|---|---:|---:|---:|---:|
| Stocks | 31 | 1,185,594.3939 | 1,185,594.38 | −0.0139 |
| Fixed Income | 31 | 1,225,038.4710 | 1,225,038.45 | −0.0210 |
| Rollover IRA | 19 | 298,161.6579 | 298,161.57 | −0.0879 |
| Cash Management | 12 | 1,086,530.1800 | 1,086,529.68 | −0.5000 |
| Individual | 1 | 26,185.99 | 26,185.99 | 0.0000 |
| **Options** | **1** | **70,725.56** | **102,288.86** | **31,563.30** |

✅ **Five of six now tie within $0.50, where §4.2 measured them $10.00 wide.** That improvement is not
noise and not a better upstream — §4.2 paired positions against a balance from a *separate* call,
and P0 captures both in one run. It is the header table (§6.1) doing exactly what it was added for,
and it means CR090's residual row can use a **$1 floor** rather than the $50 §9 proposed.

⚠️ **The Options residual moved: 33,081.00 (09-01) → 31,563.30 (09-02).** Expected — the contracts
trade weekly — but it settles a design question CR090 left open: **the residual is a live figure, not
a constant**, so it must be recomputed per snapshot and never cached or hard-coded as "the options
gap".

Also confirmed live, and worth having in one place: the ingest classifies **only brokerage accounts**
as candidates (the other 24 accounts would return an empty envelope forever), and holdings run
**unconditionally** in every API sync rather than as an optional phase — `requestSync` coalesces
concurrent callers onto one run, so an optional phase means a caller who asked for holdings can be
handed a success summary from a run that never fetched them.

### 8.5 P2 as it stands — the parser, and what it refuses to claim

`server/src/v2/scripts/parse-fidelity-holdings.js` reads the per-holding tables: every position with
quantity, price per unit, market value, total cost basis and unrealized G/L. The statements do carry
them, which was the open question — §4.8 only knew they carried *totals*.

✅ **The design decision that made this tractable: the statement checks the parser.** Every section
prints its own subtotal (`Total Common Stock (35% of account holdings) $241,952.11 …`), so the rows
extracted must sum to the number the statement itself printed. A section that does not reconcile is
an **error**, not a warning. Nothing here has to be believed.

**Current state: 117 of 117 account-statements reconcile fully (100%); 0 fail to parse** — 113 by the
deterministic parser and **4 through the `finance_statement_extract` gateway task**, each carrying the
model that produced it in `security_position_snapshots.raw.extractor`. The first
run reconciled **2**. Every gain came from the check reporting a lie rather than from the parser looking
right:

| What the check caught | What it had produced |
|---|---|
| Holdings pages repeat `Account #`, so each **page** became its own block | rows split across a page break were dropped — $292,410 of one ETF section |
| A rejected regex match still **consumes** input | a subtotal line swallowed the row after it; `Stock Funds` reported **0** against a printed 7,146.46 |
| Two column layouts differing by one column | the single-account form has a **Beginning** Market Value before Quantity, so every figure read one column left — a $4,496.85 sweep reported as **`1`** |
| The section subtotal moves with the layout | its first number is the *beginning* value, so a correct row sum was compared against the **wrong month** |
| `(continued)` pages carry rows but no subtotal | filtering on the subtotal dropped them entirely |
| A rate clause and a footnote marker sit between the identifier and the figures | an FDIC-deposit core account holding **$2,212,567.74** parsed as **0** |
| `unavailable` is a third way the statement declines to state a figure | a position opened mid-period was skipped entirely — one row, $4,314 |
| 🔴 **Bond rows have a different grammar, not a variant of the same one** | an extra **accrued interest** column between market value and cost, and the CUSIP printed **after** the figures rather than in parentheses. Read with the ordinary mapping, accrued interest books as cost basis and the cost as the gain |
| 🔴 The SUBTOTAL reader did not know the absence tokens the ROW reader did | a section whose beginning value read `unavailable` captured nothing, so its printed total silently defaulted to **0** — and the section then "failed" against rows that were **correct** |
| 🔴 A fourth absence token, `unknown`, on securities out on loan | the whole `Loaned/Collateralized Securities` section parsed as 0 — **and that produced a FALSE DRIFT FINDING**, see below |
| 🔴 **The page header became the security NAME** — and the gate is blind to it by construction, because it compares SUMS and never reads a name | 13 of 265 securities stored named after their own statement header: Iron Mountain as `st (AI) Sep 30, 2020 Total Cost Basis Un…`, Eaton Vance as `March 31, 2016 Account # X27-230910 CHRI…` (owner name included). Every figure correct, every section tying. `securities` is written once at first sight, so each name was permanent. See §8.7 |

⚠️ **Not one of those failures looked malformed.** Each produced a plausible number, and the only
reason any was noticed is that the statement's own arithmetic contradicted it. A test pins the
wrong-layout read precisely so it stays visible: `parseRows(single, …, 'combined')` returns
quantity 4900 and market value 50, and nothing about that result looks wrong.

**Coverage by year** (2026-09-04): 2016 8/8 · 2017 7/8 · 2018 8/8 · 2019 8/8 · 2020 9/10 ·
2021 11/12 · 2022 10/12 · 2023 9/12 · 2024 13/15 · 2025 11/16 · 2026 8/8.

**Still to do before P2 can ship:** **4** account-statements remain. ✅ **The gateway task SHIPPED
the same day** ([ocr-llm → Finance], 2026-09-04): `finance_statement_extract` is registered,
schema-enforced and **local-only** — `ollama_heavy → ollama_mid`, **no cloud step**, so naming
`claude` or `openai` returns `409 routing_unsatisfiable` rather than sending a holdings table off the
Tailnet. Local-only because the input is the most identifying data in the app, and
`finance_plan_review` is already routed that way for the same reason. It is registered at
`max_tokens` **8192** — our proposed 4096 truncates the JSON mid-object, which a schema does not
prevent. `Scripts/extract-statements-llm.js` calls it and holds its rows to the **same** printed-
subtotal gate as the regex parser; running it is what took the deterministic parser from 102 to 113.
⚠️ The gateway takes **no per-request schema**; schemas are declared per task in its catalog, which
is why this needed the other repo rather than a call we can just make. ⚠️ **Do not pin
`ollama_mid`** — ocr-llm asked for the pin for the 56-document bulk run this scope no longer has,
then measured it away (heavy 17.0s/37.9 tok/s vs mid 28.4s/20.2 tok/s, 3/3 subtotal ties on both).
Protocols: [guides/ocr-llm-integration.md](../guides/ocr-llm-integration.md). Whatever extracts a row, the subtotal gate checks it
identically. And **the ingest is not written**: nothing
yet writes these into `security_position_snapshots` / `security_positions` with `source='statement'`,
and the validation has had to change shape: 🔴 **the two position sources do not overlap at all.**
The statements end **2026-06-30** and fintable's history begins **2026-07-04**, so the cross-check
§8's P2 row describes has nothing to compare. **Owner decision 2026-09-04:** validate instead by
comparing each statement's per-account total against **fin's own ledger on that date** — which is the
comparison that produces the actual deliverable, since it names date by date where fin drifted from
the custodian. The single 2026-06-30 overlap with `bankfeed_balances` (which starts 2026-05-31) comes
along as a free spot check. **The output is a report; it books nothing** (owner, 2026-09-04) — the
standing non-goal that this thread does not write to the ledger holds.

### 8.6 🔴 The report's first finding was FALSE, and the gate is what caught it

The 2026-09-04 drift report named **+$74,895.00 (12.66%) on Fidelity Bond at 2024-12-31** as its
headline result — a specific, dated, plausible number, reported as the concrete thing to investigate.

**It was not drift.** The parser could not read the `Loaned/Collateralized Securities` section (its
rows use a fourth absence token, `unknown`, for cost and gain on securities out on loan), so the
statement total came up short by exactly that section. `591,456.17 + 74,895.00 = 666,351.17`, which
is fin's ledger **to the cent**. fin and the custodian agreed all along.

Once the subtotal reader was taught the same absence tokens the row reader knew, the section stopped
returning 0, failed its own check, and the statement was **rejected rather than ingested short** —
which is the gate doing precisely its job, one level up from where it was designed to work. It was
built to stop bad rows entering the data; here it stopped a bad *conclusion* leaving it.

⚠️ **The lesson is about the shape of the error, not the arithmetic.** A parser that silently drops a
whole section does not produce an obviously broken number. It produces a number that looks exactly
like the finding you went looking for — and this one matched the roadmap's prior suspicion that
Fidelity Bond was the drifting account, which made it more believable, not less.

### 8.7 P2 closed — the four the parser could not read, and what their rows exposed

**117 of 117 (2026-09-05).** The last four account-statements went through the ocr-llm gateway task
`finance_statement_extract`, answering the **same gate**: the statement's own printed section
subtotals. **24 of 24 sections tie.** Provenance is stored per snapshot in `raw.extractor`, so a row
produced by a model is answerable later without re-deriving it — 113 `parser`, 4 `llm`
(`qwen3.6:35b-a3b-q4_K_M`, `CONSTRAINED_DECODE`, heavy tier).

⚠️ **The first run reported four sections missing $159,651, $86,442, $80,393 and $160,067 — and every
row was correct to the cent.** The model had used the *generic* section names: `Stock Funds` came
back as `Mutual Funds`, `Common Stock` as `Stocks`, and `Equity ETPs` + `Fixed Income ETPs` merged
under their own aggregate heading. The gate looks sections up **by name**, so each read 0 against its
printed subtotal and the delta was the whole subtotal. 8 of 24 "failed" without one wrong figure —
the §8.6 shape again, a number that looks exactly like the omission you were watching for.

Fixed by **dictating the vocabulary**: the statement's own headings are passed in the prompt. That
supplies names, never values, so the arithmetic check stays independent. ⚠️ Matching the model's
labels to ours **by value** was the tempting fix and is the wrong one — it selects whichever mapping
makes the totals tie, and a gate fitted to its own answer proves nothing.

An **aggregate** section is not one any extractor should emit rows for: FA_2025_12 prints
`Corporate Bonds` 309,149.26 and then `Bonds` 309,149.26, a heading totalling the first rather than a
second holding of the same money. The parser already removes these structurally; it kept this one
only because its own read of Corporate Bonds came to 4,266.62. The same rule now applies to the LLM
gate, decided from the printed totals alone.

#### Three ingest defects, all silent, all found by adding one check

The LLM rows were the occasion, not the cause — each defect had been live for every statement:

| Defect | What it cost |
|---|---|
| 🔴 **Two lots of one security overwrote each other.** Fidelity prints one line per lot — FSMAX at 30.709/$2,563.59 *and* 231.41/$19,318.11, same $83.48 price, both inside the section subtotal. `security_positions` is `UNIQUE (snapshot_id, security_id)` and the insert's `ON CONFLICT DO UPDATE` kept the second | the first line's money vanished — **11 account-statements, 40 lines**. Lots are summed now |
| 🔴 **A holding with no ticker was dropped.** FA_2025_12 carries a `EURO (EUR)` cash balance, 7,607.47 at 1.174, correctly symbol-less because none is printed | the snapshot stored **$8,934.59 short**. Unticketed holdings key on their description |
| 🔴 **Provenance was lost on re-ingest** — the snapshot upsert never refreshed `raw` | two of the four LLM statements landed with rows replaced and no record of what produced them |

⚠️ **Each hid the same way the security-name defect did: the check that existed read the column that
was right.** `sum_market_value` is the statement's *own printed total*, so the header stayed correct
while the rows beneath it lost money. The ingest now asserts, after every apply, that stored rows
match `positions_count` **and** sum to `sum_market_value`. **It failed on its first run**, naming the
EUR row. `positions_count` is now what was *written*; the statement's line count moves to
`raw.statement_lines`.

**What says the model neither dropped nor invented rows:** the two dates LLM extraction added drift
**+119.43** and **−81.53** against fin's ledger — the same 0.01% magnitude as their parser-extracted
neighbours. IRA 42/42 and Cash Mgt 24/24 still tie exactly.

### 8.1 Deploy path

- bank-feed migrations through `scripts/migrate.js` so `schema_migrations` records them — the 005/006
  replay is on the record as a live hazard.
- fin migration **075** to **dev first**, then prod via `Scripts/deploy-to-production.sh` Step 2b,
  **before** the code that reads the new objects.

### 8.2 Backfill: dry run and rollback

The backfill is ~360 calls that also decide `asset_class` for every security on first sight, and
`classification_source` makes the answer sticky.

- **Dry run first**: a read-only pass that fetches, classifies and prints §9's assertions **without
  writing**. Resumable, with a per-account last-completed-date marker, and run outside `runSync`'s
  write transaction.
- **Rollback, in one sentence**: positions are re-derivable — delete by `polled_on` range and re-run.
  This repo's backfill scar is 31 duplicate rows netting +$267, so the rollback is stated, not assumed.

---

## 8.4 The testing gate — what "done" means for each stage

Owner-required 2026-09-03: **no stage is complete without its automated tests**, and each stage names
which layer it is proving. The rule this comes from is that P0's first cut tested the *conversion*
layer only — and conversion is not where this class of bug lives. CR059's two real defects were both
in a URL and both returned a plausible empty result rather than an error, and the duplicate-symbol
rejection P0 advertises is enforced by a **database constraint** that nothing exercised until it was
asked for.

| Layer | How it is tested | Why it cannot be skipped |
|---|---|---|
| Conversion / classification | pure unit tests over frozen fixtures | The 95 measured positions are the fixture; the classifier is the thing most likely to be confidently wrong (§6.4) |
| Adapter / HTTP | injected `fetchImpl`, asserting the **request shape** | A wrong URL returns a plausible empty result, not an error |
| Failure paths | forced throw / 503 per account | `partial` must never render as `empty`; one account failing must not fail the run |
| DB writer | fake client, asserting statement **order** | DELETE-before-insert is what stops a departed symbol inflating Σ positions |
| Constraints | real DB, inside an **always-rolled-back** transaction | A test asserting intent while the constraint is missing proves nothing |
| API shaping | pure function over rows | A LEFT JOIN's nulls must not become a phantom position |

**fin stages additionally run `./Scripts/test-fresh-db.sh`, not bare `jest`.** Dev's database holds
real rows a test can reach for by accident; five suites have borrowed something only dev has — most
recently CR080's hardcoded `Interest Income = 74`, which is **11** on a fresh database. Each passed
locally and failed in CI. Baseline before this CR's fin work: **1125/1125**.

**P0 as built: 22 holdings tests** across three files — `holdings.test.js` (13, conversion),
`holdingsPipeline.test.js` (17 total incl. adapter/failure/writer/route), `holdingsSchema.test.js` (5,
constraints, rolled back, skips when no DB is reachable). bank-feed suite **256/256**.

## 9. Verification

- Ingest one snapshot for the five tracked accounts; assert Σ positions reconciles to the custodian
  balance **within $50** and that the four measured residuals (0.01 / 0.04 / 10.00 / 0.10) come back
  as expected values, with **exactly** the Options residual on the fifth.
- Freeze the **95 measured positions as a fixture** — it is the falsifiable artefact the
  classification argument needs. Assert: **37 → `bond`** (29 Fixed Income + 8 Cash Mgt), 0 Stocks rows
  → `bond`, 6 → `mmf`, 1 → `mutual_fund`, 3 → `unknown`, **none → `equity` by default**.
- Assert `FDIC91125` fails CUSIP check-digit validation and lands `unknown`, not `bond`.
- Assert the structural refusal: no security with `price_basis != 'per_share'` ever reaches the quote
  fetcher; and a deliberately mis-mapped CUSIP→equity quote is **refused**, not merely warned.
- Assert a pre-2026-07-04 `?date=` (200, `data: []`) stores a header with `status = 'absent'` and
  **zero position rows** — distinguishable from `empty`.
- Assert a simulated 503 mid-fetch stores `status = 'partial'` and that the ledger sync is unaffected.
- Assert duplicate `(snapshot, security)` **rejects the snapshot** rather than upserting.
- Re-ingest the same day twice: one row per `(account, security, snapshot)`, later fetch wins,
  `fetched_at` moves, and the header's `custodian_balance` moves with it so the residual stays
  coherent. ⚠️ **Not byte-idempotence** — §4.9 measured quantities changing under a fixed
  `snapshot_date`.
- Resolve COA categories **by name, never by id**. A CI-built database gives `Interest Income` id
  **11**, not 74 — known issue #21, whose twelve tests failed the day they shipped.
- Suites: `server/src/services/__tests__/`, plus the bank-feed side's own.

---

## 10. Owner decisions

### 10.1 ✅ DECIDED — the `Individual` account is not tracked

It keeps `account_id = NULL, ignored = TRUE`. Three consequences:

1. **fin filters on `ignored = FALSE`** when mirroring — and it must be *fin* that filters, since
   bank-feed cannot see fin's `account_source_mappings`.
2. **bank-feed stores all six anyway.** One extra call, and it is the only place history can accrue;
   skipping it at ingest would forfeit history for no gain and make the decision irreversible, which
   contradicts §4.8's own rule. Un-ignoring later then starts from that day.
3. Any orphan rule scopes to **mapped, non-`ignored`** feed accounts, or it fires forever and becomes
   the warning CR074 forbids — the identical scoping CR060 needed for Bank Pekao.

### 10.2 ✅ DECIDED — the statement backfill is claimed here (§8 P2)

### 10.3 Open — does `cost_basis` arrive for the CUSIP bonds and for SPAXX?

Unmeasurable until something is ingested; the dry run (§8.2) answers it. It decides whether CR090's
Fixed Income unrealized column is populated or abstains. Does **not** gate the start.

---

## 11. Depends on

[CR059](cr-059-fintable-api-ingestion.md) P1's adapter and P4 cutover (done — live since 2026-08-10).
**Nothing else blocks this CR.** [CR019](cr-019-quicken-import.md) and
[CR020](cr-020-stock-investment-module.md) share the `securities` vocabulary this CR changes (§6.5) —
neither blocks it.

**Depending on this CR:** [CR090](cr-090-investments-section.md) (all of it) and
[CR089](cr-089-month-end-observation-dating.md) **P2** (which reads P1's fin-local tables — CR089 P1
is independent and can ship at any time). `valued_on` would come from CR089 P2 *if* its discriminant
proves out; §4.10 says what happens if it does not.
