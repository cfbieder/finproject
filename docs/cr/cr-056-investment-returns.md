# CR056 — Investment Returns report — ✅ COMPLETED (P1 shipped v3.5.0, 2026-07-27)

**Track:** v3 · **Migration:** none · **Roadmap:** [§1.1](../current/project-roadmap.md) ·
**Depends on:** CR043 N8 (`{data, meta}` envelope + `Rest.unwrap`), CR028 (neutralization —
why trade legs pair), CR024 (`balance_from_feed` read override — interaction only) ·
**Precedents (not dependencies):** CR054 (period-column layout, currency toggle,
double-click drill-down), CR042 U5 (report page shell), v3.4.4 (`PeriodSelector` "All").

**P1 shipped v3.5.0 (2026-07-27).** 470 backend tests (28 new pure-arithmetic + 10 new
route-contract) / 195 frontend / lint clean on the new files / build / five content guards.
Verified end-to-end against the dev API: the reconciliation identity closes to **0.0000 in
every interval** for single accounts, roll-ups and LC mode. Four rules were revised *after*
the owner clicked the built page — see [Post-build revisions](#post-build-revisions-2026-07-27).

**Rev 2** incorporates the pass-1 technical review (verdict: *revise*, 6 blocking findings,
all reproduced against prod before acceptance). The identity is now closed **by
construction** rather than by assertion; decision #4 is reversed on the evidence; the
whole-period Dietz fallback is removed; the "mark-bearing" inference is replaced by mark
**coverage**. See [Review response](#review-response-rev-1--rev-2).

## Problem

Fin can say what an investment account is *worth* (Balance Sheet) and what cash it
*produced* (Cash Flow), but not what it **returned**. The owner asked for: pick an
**account**, a **period** (standard selector), an **interval** (month / quarter / year, plus
`marks`) →
a table and charts of realized income and unrealized gain/loss per interval, absolute
(USD or local currency) and as a %.

## Why this is ledger-derived, not lot-level

The investment schema created by [migration 022](../current/migrations.md) is **empty in
prod** — `securities`, `security_lots`, `security_transactions`, `security_prices`,
`security_lot_disposals`: **0 rows each**. CR019's investment-side promote was never built,
so there are no holdings, no cost basis, no price history. Lot-level return is a multi-week
CR standing between the owner and the first number on screen.

The **ledger already carries mark-to-market**. `Unrealized G/L` (account 88, an expense
category under *Financial Expenses*) holds 65 postings that true investment balances up to
reported market value, and realized income is already categorized per account:

| Account | UGL postings | Range | Cadence | Anchor |
|---|---|---|---|---|
| Fidelity Stocks / Fidelity IRA | 18 each | 2025-01-31 → 2026-06-30 | monthly | month-end |
| Fidelity Bond / Fidelity Options | 2 each | 2026-05-31 → 2026-06-30 | monthly (new) | month-end |
| United Beverages (PLN) | 8 | 2019-03-31 → 2025-12-31 | annual | **March 31** |
| CVC Fund VIII (EUR) | 8 | 2022-12-31 → 2025-12-31 | annual | Dec 31 |
| CVC Fund IX (EUR) | 5 | 2025-03-31 → 2026-05-31 | ad hoc | — |
| SP - Panorama Mar 4, SP - Sea Senses (EUR) | 3 | 2025-12-31 | one-off | — |
| Tradier | 1 | 2026-06-30 | one-off | — |

A later lot-level build would replace the numerator behind the same endpoint.

**State plainly on the page:** under mark-to-market accounting a *realized* capital gain is
already absorbed into the `Unrealized G/L` trueing. This report's second component is
**total price return**, not strictly unrealized gain. It cannot separate realized from
unrealized capital gains, and no work on this CR will change that — only lot-level data can.

## Decisions

Settled with the owner 2026-07-26 (`/question`, one at a time; #4 and #7 revised after the
pass-1 review produced evidence against the first answer):

| # | Decision | Choice |
|---|---|---|
| 1 | Track | **v3** — no flag gating, verified on dev `:3105` |
| 2 | Basis | **Ledger-derived** |
| 3 | Income rows | **Auto-derived** — any non-transfer P&L category posting to the account |
| 4 | External flows | **All** `is_transfer` categories, **including** `Transfer - Securities Trades` *(reversed in rev 2)* |
| 4b | Residual | **`Unattributed` row**, always computed, drill-down enabled *(new in rev 2)* |
| 5 | Return % | **Realized / Unrealized / Total, each on average capital `(open+close)/2`** *(revised 2026-07-27; was Modified Dietz)* |
| 6 | Currency | **USD ⇄ LC toggle**, with **FX effect & rate drift** as its own row |
| 7 | Unsupported intervals | **Mark coverage share of BMV** — a period is covered when a valuation falls inside it; ≥90% plain, 50–90% badged, <50% suppressed. Misdating disclosed with **†**, not hidden *(revised twice, 2026-07-27)* |
| 8 | Selection | **Single account picker**, parent rolls up its descendants |
| 9 | Table | **Metrics as rows, intervals as columns** + Total |
| 10 | Charts | **Two aligned panels** — stacked absolutes, then return-% |
| 11 | Delivery | New CR + **one server endpoint**; page at `/investment-returns` |
| 12 | Data quality | **Flag + drill-down + link out**; report stays **read-only** *(new in rev 2)* |
| 13 | Intervals | month / quarter / year **+ `marks`** — columns between valuations *(added 2026-07-27)* |

### #4 — why `Transfer - Securities Trades` is a flow after all

Rev 1 excluded category 206 as "internal", on the CR028 reasoning that a trade's two legs
land in one account and cancel. The mechanism is right; the conclusion was wrong.

The legs **do** pair exactly, so they cancel *automatically* — including 206 in flows cannot
double-count:

```
2025-03-04   -17,905.50  YOU LOANED VS Z31-443539-6 ISHARES TR
2025-03-04   +17,905.50  YOU LOANED VS Z31-443539-1 ISHARES TR
2025-03-12    -8,158.63  YOU SOLD JOHNSON &JOHNSON (JNJ)
2025-03-12    +8,158.63  YOU SOLD JOHNSON &JOHNSON (JNJ)
```

What survives the cancellation is the **unpaired remainder**, and historically that is not
trade activity at all:

```
2020-02-04  +100,000.00  Fid Bkg Svc (PPD ID: 0368004600)
2020-02-20  +100,000.00  Fid Bkg Svc (PPD ID: 0368004600)
```

Full-history net of category 206 (prod), so this is not re-derived next session:

| Account | Year | n | Net |
|---|---|---|---|
| Fidelity Stocks | 2020 | 6 | **+200,460.86** |
| | 2021 | 13 | +58,766.45 |
| | 2022 | 18 | −12,152.17 |
| | 2023 | 26 | −4,213.09 |
| | 2024 | 52 | −3,395.74 |
| | 2025 | 179 | −1,263.05 |
| Fidelity Cash Mgt | 2020 | 1 | −23,536.00 |
| | 2021 | 4 | +33,500.00 |
| | 2022 | 11 | +70,361.31 |
| | 2023 | 18 | +1,126.97 |
| Fidelity IRA | 2023–25 | — | −10,594.20 / −7,368.77 / −8,781.87 |

Excluding 206 put those two $100K ACH deposits **inside** the return numerator: Fidelity
Stocks 2020 would have reported a six-figure deposit as investment gain, and 2021 would
have been 72% deposit. Including 206 classifies the remainder as the contribution it is.

**Cost, stated:** from 2023 on the remainder is trade fees (−$1,263 on Fidelity Stocks in
2025), which this treats as a small withdrawal instead of a cost — 0.1% of a $1.3M account,
against the 15%+ distortion the exclusion caused in 2020.

**Why the meaning changed.** Density is flat across years (291 / 315 / 432 / 385 / 359 /
384 transactions on Fidelity Stocks 2020→2025) — nothing is missing. The *semantics* of 206
changed at the bank-feed cutover (CR023): pre-feed it carried occasional deposits and
dividend reinvestments and individual trades were never recorded at all; post-feed it
carries paired trade legs. Pre-feed balances were maintained by large `Transfer - Bank` /
`Transfer - FX` / `Transfer - Matched` plugs, and there are **no UGL marks before 2025-01**
— which is why the report's honest domain for Fidelity starts there, enforced by #7.

### #7 — mark coverage, not "has it ever been marked"

Rev 1 called an account *mark-bearing* if it had ≥ 1 UGL posting ever, and treated
never-marked accounts as always supported. That inverts on assets nobody has ever
revalued. Prod, assets > $100K with zero marks:

```
PL - Niemena         PLN 4,287,465      Fidelity Cash Mgt    USD  778,982  <- correctly unmarked
Barkeria Sp. z o.o.  PLN 3,918,992      PKO - Deposits       PLN  450,000
US - Casarina        USD   919,581      SP - Panorama Mar 6  EUR  421,992
```

`SP - Panorama Mar 6` is a €422K property that has never been revalued: under rev 1 every
interval was "supported" and the report would show a confident **0.00%** forever. But
`Fidelity Cash Mgt` is in the same list and is *correctly* unmarked — cash has no
unrealized G/L. No data signal separates them.

**Rev 2 rule.** Per interval, compute **mark coverage** = the share of `Beginning MV` held
by constituents that have a mark satisfying the boundary test below. Then:

| Coverage | Behavior |
|---|---|
| ≥ 90% | render the % plainly |
| 50–90% | render the % **with a coverage badge** (`61% marked`) and the uncovered-account list |
| < 50% | `—`, with `meta` naming each uncovered account and its share of BMV |

**Why not hard-suppress below 90%** (pass 2, R2): `Fidelity Fixed Income` is
`Fidelity Cash Mgt` $778,982 — never marked, and *correctly* so, it is cash — plus
`Fidelity Bond` $1,229,468, first marked 2026-05-31. That roll-up sits at **61%** coverage,
so a 90% cut-off would hide the owner's entire fixed-income sleeve permanently. Coverage 0%
(the €422K never-revalued property) genuinely deserves suppression; 61% does not — it
deserves a caveat. The badge is cheaper and better than the deferred
`accounts.marks_to_market` migration.

**Accepted cost:** a never-marked account contributes zero coverage, so `Fidelity Cash Mgt`
selected alone yields `—` even though interest ÷ balance is well-defined. Absolute income
rows still show the interest.

### #12 — the report as a data-quality instrument, read-only

The `Unattributed` row (#4b) is the flag. Double-clicking it opens the CR054-style
drill-down listing the exact offending transactions, each deep-linking to the existing
transaction editor to be **recategorized**.

No write path in this report. The defects it surfaces are *miscategorized rows that already
exist* (the two "Fid Bkg Svc" deposits belong in `Transfer - Bank`; `Car Purchase/Sale
−$29,954` is sitting on a brokerage account in 2022). A correcting entry would leave the
wrong category in place, add a second wrong thing beside it, and move a balance that is
currently correct — fin's balances are calibrated, so that $200K is in the right place and
only labelled wrong. It is also the same "invent data" failure rejected in #7: afterwards
nothing distinguishes the synthetic entry from a real one. Genuinely missing value belongs
in the calibration flow next to `Transfer - Historical`, not here.

## Phasing

Pass 2 signed off **REVISE → P1 GO** on the condition that this ships as an increment
rather than one drop. Owner set the P1/P2 boundary: LC stays in P1 (it was in the original
brief and its *absolute* rows work in every interval regardless of marks — the only way to
read a PLN holding in PLN); the drill-down moves to P2.

**P1 — build now.** Account/roll-up picker · period · interval · the table · both chart
panels · all four buckets incl. a visible `Unattributed` row · Modified Dietz with the
guards · boundary test + coverage rule + the `markCoverage` / `markCadence` /
`chainBrokenBy` / `feedBalanceOverrides` banners · **USD ⇄ LC toggle** · the FX plug
(load-bearing for identity closure on the CVC accounts even in USD mode) · supported-span
auto-clip.

**P2 — deferred** (roadmap bullets, not lost): `Unattributed` **drill-down + deep-link** to
the transaction editor (the offending rows are already enumerated below; one-off cleanup
needs no UI) · `returnPctExFx` · splitting `FX effect & rate drift` into revaluation vs
booking drift · the Sunday-boundary FX reconciliation test.

**Day-one computable surface — state it, so it isn't discovered by clicking.** Roughly 22
data points:

| Selection | Computable |
|---|---|
| Fidelity Stocks · Fidelity IRA · `Fidelity Stock` roll-up | monthly Feb-2025 → Jun-2026; quarterly 2025-Q2 → 2026-Q2 |
| CVC Fund VIII | annual 2023–2025; quarterly 2025-Q2→Q4 |
| CVC Fund IX | quarterly 2025-Q2→Q4 |
| Fidelity Bond · Fidelity Options · Tradier | June-2026 only |
| Everything else (~$32M of assets) | `—` |

**No Fidelity *calendar-year* return exists**: an annual 2025 column needs a 2024-12-31
mark and the first mark is 2025-01-31. This is why the supported-span auto-clip is
mandatory in P1 rather than optional — without it the default view is a wall of dashes.

## Report definition

### Market value

For account `a` at date `d`, on the additive basis the Balance Sheet uses
([`reports.js:78-105`](../../server/src/services/reports.js)):

```
MV_lc(a, d) = a.opening_balance + Σ t.amount
              for t.account_id = a AND t.transaction_date BETWEEN a.opening_balance_date AND d
```

`MV_usd(a, d) = MV_lc(a, d) × rateAsOf(a.currency, d)`. For a roll-up, `MV` is per account
and the aggregate is formed **after** conversion (a roll-up may span currencies).

**FX rate** — `rateAsOf` = the latest `exchange_rates` row with `rate_date <= d`, falling
back to nearest if the boundary predates coverage (EUR/PLN/GBP start 1999-12-30). This
rule already exists at [`server/src/v2/services/fx.js:22-28`](../../server/src/v2/services/fx.js);
**extract a shared `rateAsOf(querier, currency, date)`** from `usdBaseAmount` rather than
re-deriving it (`usdBaseAmount` rounds to cents per call; the report needs the raw rate for
a bulk multiply). The endpoint **reads `exchange_rates` only** — it must **not** call
`refreshStaleRates` the way [`reports.js:126`](../../server/src/services/reports.js) does,
which would be ~320 sequential Frankfurter round-trips on the "All" preset and would mutate
the table under the balance report.

**Two documented divergences from the Balance Sheet** (both deliberate):

1. **No CR024 override.** `fetchAccountBalances` substitutes the latest feed balance when a
   mapping has `balance_from_feed = TRUE`; this report does not, because a point-in-time
   feed snapshot carries no per-transaction attribution and cannot be decomposed into
   income / UGL / flows. **Today 0 of 390 mappings set it**, so the two agree exactly. If it
   is ever enabled — and `reports.js:70-77` says it exists *for the Fidelity market-value
   accounts*, i.e. exactly this report's subject — then (a) the two reports will disagree on
   the same account on the same date, and (b) it will be because the additive ledger has
   drifted from market, at which point the UGL trueing this report's numerator depends on
   has presumably stopped. **Believe the Balance Sheet for value, and treat this report as
   unusable for that account until marks resume.** `meta.feedBalanceOverrides` must surface
   as a visible page banner, not just JSON.
2. **FX rate selection.** `fetchAccountBalances` picks the nearest rate by *absolute*
   difference ([`reports.js:133-139`](../../server/src/services/reports.js)) and can
   therefore use a rate from **after** the as-of date. `exchange_rates` holds business-day
   rows only, so the two diverge on Sunday / holiday boundaries — 2025-08-31 (Sunday) PLN:
   as-of `0.273246` vs nearest `0.275300`, 0.75% apart (~$42K on United Beverages). As-of-or-
   before is correct for a period boundary; the divergence is bounded and documented, and
   the reconciliation test below is scoped so it cannot flake.

Also: `MV_usd` uses the boundary rate, so `Ending MV` will **not** equal `Σ base_amount` and
will not tie to CR054's Cash Flow USD figures. It ties to the Balance Sheet instead, which
is the right choice for a report whose subject is value.

### Components per interval

Interval `[s, e]`, clipped to the requested period. Every transaction on the selected
accounts with `transaction_date BETWEEN a.opening_balance_date AND e` — **the same
`opening_balance_date` clause as MV**, or components and MV disagree (prod has one such
row: `Chase Checking`, +$1,950.61) — falls into exactly one bucket:

| Bucket | Rule |
|---|---|
| **Net external flows** `F` | category has `is_transfer = TRUE` (**including** 206) |
| **Price return** | category is `Unrealized G/L` (matched by name, to survive a re-seed) |
| **Realized income** | any other non-NULL P&L category — one row per category present |
| **Unattributed** | `category_id IS NULL`, or a category outside the P&L section |

The buckets are exhaustive by construction — that is the point. Prod has 76 NULL-category
rows (`Chase Checking` −$99,986.71, `PKO` −$101,010.01) and those accounts are reachable
from the picker.

**Row label: `Price return (incl. realized gains)`, not "Unrealized G/L"** (pass 2, R3). The
ledger category is named `Unrealized G/L` and the owner asked for "unrealized gain/loss",
but under mark-to-market a realized gain is already inside the trueing — see the opening
section. A caveat in prose is read once and forgotten; the row label is read every time.

Amounts use `t.amount` in LC mode, `t.base_amount` in USD mode (`base_amount` is populated
on all 37,346 rows in prod).

### The identity, closed by construction

```
Total return $ = Ending MV − Beginning MV − Net external flows          (definitional)
               = Realized income + Unrealized G/L + FX effect + Unattributed
```

The first line defines `Total return $`; the second is what the visible component rows must
sum to. They agree because the buckets are exhaustive and `FX effect` is the plug:

```
FX effect = (EMV − BMV − F) − (income + ugl + unattributed)
```

— exactly 0 for a USD account, and for a foreign one it captures the revaluation of the
opening balance plus the drift between transaction-date FX (`base_amount`) and boundary FX.

**Rev 1's defect:** it asserted the identity instead of constructing it, leaving category
206 and NULL-category rows in no bucket at all, and hid the only row that could absorb them.
Fidelity IRA 2025 was off by **$8,781.87** — 19.5% of the reported gain, ~3.8 percentage
points of return — silently, in both currency modes.

**Row label:** `FX effect & rate drift`, not `FX effect`. It is a mixed bucket, and part of
it is a data artifact rather than currency movement: United Beverages 2025-12-31 books
−6,956,000 PLN as −$1,850,588.15, an implied rate of `0.266042` against fin's own curve at
`0.278373` — 4.4% apart, ≈$85,694 of pure booking-rate drift. (Also 2026-03-26 EUR:
1.156155 implied vs 1.180498 curve.) Splitting revaluation from drift is a follow-up.

### Return % — three of them, on average capital

**Owner revision, 2026-07-27: Modified Dietz replaced by the simple average.** A
denominator reproducible from two numbers on the same screen was judged worth more than
one that weights each flow by its exact day.

```
Average capital = (Beginning MV + Ending MV) / 2        ← shown as its own row

Realized return %    = Realized income  / Average capital
Unrealized return %  = Unrealized G/L   / Average capital
Total return %       = Total return $   / Average capital
```

**Stated trade-off:** the closing balance already contains the period's flows, so a period
with a large withdrawal (Fidelity Stock 2024, −566,014) divides by a figure that money has
already left. Flow-heavy periods read as approximations. Modified Dietz corrected exactly
this and cost legibility to do it; the owner made the call.

- **Realized return % is reported whatever the mark coverage** — it is cash that actually
  arrived, and needs no valuation. Only the two price-movement rows depend on marks.
- **`null` (renders `—`) when:** average capital ≤ 0; **or** `< 1% of |EMV|` (a magnitude
  floor — `Fidelity Stocks` carries `opening_balance = −302,785.91` at 1990-01-01 with no
  transactions until 2020-01-02, so the average crosses zero and an unguarded division
  yields a five-digit percentage); or the interval is unsupported.
- **All three chain over the SAME intervals.** Chaining realized over three years while the
  total covers two would put unrelated figures in one column.

**Total column.** Absolute rows are a plain sum. **Total %** is the geometric chain of the
interval returns, `Π(1 + rᵢ) − 1` (linked TWR), consistent with the columns on screen. If
**any** interval is unsupported the chain is broken and the Total % renders `—`, with
`meta.chainBrokenBy` naming the intervals.

**Supported-span auto-clip (P1, mandatory).** When the chain breaks, the report also
computes the **longest contiguous supported run** and labels the Total with its **actual
dates** — *"Feb 2025 – Jun 2026, cumulative"*. Without this the default experience is a wall
of dashes with no headline number, because calendar-2025 monthly breaks on January and no
Fidelity calendar-year column is computable at all. Absolute rows still span the full
requested period; only the Total % is clipped, and the clip is stated on screen.

**Annualization.** A Total spanning more than one year on an **intact** chain also reports
`(1 + R)^(365/days) − 1` as *annualized*, beside the cumulative figure. It does not reopen
the +2,064% hazard: it applies only to a chain with no broken links, never to a fallback.

There is **no whole-period Modified Dietz fallback**. Rev 1 had one, and it fired precisely
when the mark data was least trustworthy: United Beverages over the "All" preset —
`BMV = 0`, `EMV = 20,686,000 PLN`, one `+2,000,000 PLN` flow in 2014 — produced a headline
**+2,064%**, un-annualized, footnoted only as "dietz". Trading a row of honest `—` for one
confident garbage figure is a bad trade. Any multi-year Total is labelled **cumulative**.

### Supported intervals — the boundary test

`Beginning MV = MV(s − 1)` and `Ending MV = MV(e)`. **Both** must be marked for the
difference to be a return; a mark somewhere inside `[s, e]` guarantees neither.

An account is **covered** for `[s, e]` when a UGL posting falls **strictly inside** the
period. Coverage share and the bands then apply as in #7.

**This rule was wrong twice before landing (owner-found, 2026-07-27).**

*First cut — a mark within ±5 days of **both** boundaries.* Right for a monthly column,
absurd for an annual one: calendar 2025 was discarded because Fidelity's first mark ever
landed **31 days** after the 2024-12-31 boundary. Scaling the tolerance to a sixth of the
period fixed Fidelity but not United Beverages, whose 31-March marks sit ~90 days from every
calendar boundary — so its entire 2014→2026 series stayed blank.

*Second cut — the incoherence that settled it.* The table **prints** UB's calendar-2020
`Unrealized G/L` of +1,151,997 and then suppressed the percentage that same posting
implies. If a figure is good enough to display, it is good enough to divide. Suppression now
means only **"this period was never valued"**, which still catches every case that matters:
UB's 2014–2018 and its missing 2021, and every Fidelity year before 2025.

The opening boundary deliberately does **not** count — a mark sitting only at `s − 1` values
the period's *opening*, not the period, and counting it made UB's 2026-YTD column report a
confident **0.00%** price movement when nothing had valued 2026 at all.

**Misdating is handled by disclosure, not by hiding.** `rows.boundaryAligned` is false when
the valuations did not land on the period's boundaries; the page marks the column **†** and
names the actual valuation dates on hover ("Valued 2020-03-31 — not on this period's
boundaries"). Fidelity's month-end marks align, so its columns carry no dagger. For columns
that line up exactly by construction, use `interval=marks`.

**Why the boundary test, not containment.** United Beverages marks on **March 31**, not
December 31. Under a containment rule, calendar 2024 contains the 2024-03-31 mark ⇒
"supported" ⇒ the report shows +5,375,000 PLN as the *2024* return when it is actually
FY-Mar-2023→FY-Mar-2024, misdated by nine months with no flag. At quarterly interval it is
worse: 2024-Q1 carries twelve months of appreciation labelled as one quarter. Similarly CVC
Fund IX's last mark is 2026-05-31, so 2026-Q2 would end on a month-stale mark plus a month
of raw cash flows.

`meta.markCadence` carries each account's **actual anchor dates**, so the banner can say
*"United Beverages is marked at 31 March; calendar columns cannot be computed."*

### `interval=marks` — columns between valuations (owner-chosen, 2026-07-27)

United Beverages is marked **once a year on 31 March**, so every calendar boundary sits
~90 days from a valuation and the entire series suppressed — correctly, but uselessly, on
the owner's largest single holding.

A fourth interval lays the columns out **mark → mark** instead of on the calendar. Each
span is `(mᵢ, mᵢ₊₁]`: `start = mᵢ + 1`, so the builder's `MV(start − 1)` lands exactly on
`mᵢ` and `end` lands on `mᵢ₊₁`. **Both boundaries are marks by construction**, so coverage
is 100% and nothing is suppressed — no new tolerance, no relaxed rule, no invented data.
A missing mark becomes one visibly longer span rather than two blank columns, and a span
over a year also reports its annualized rate so irregular columns stay comparable.

Verified on prod data — the series that the calendar grid had hidden entirely:

| Span | Beginning | Ending | Unrealized G/L | Return | Annualized |
|---|---:|---:|---:|---:|---:|
| Apr 2019 – Mar 2020 | 5,401,000 | 10,166,000 | +4,765,000 | +61.22% | — |
| Apr 2020 – Mar 2022 | 10,166,000 | 22,975,000 | +12,809,000 | +77.30% | **33.15%** (2021 unmarked) |
| Apr 2022 – Mar 2023 | 22,975,000 | 25,050,000 | +2,075,000 | +8.64% | — |
| Apr 2023 – Mar 2024 | 25,050,000 | 30,425,000 | +5,375,000 | +19.38% | — |
| Apr 2024 – Mar 2025 | 30,425,000 | 27,642,000 | −2,783,000 | −9.59% | — |
| Apr 2025 – Dec 2025 | 27,642,000 | 20,686,000 | −6,956,000 | −28.79% | — |
| **Total (PLN)** | | | **+18,686,000** | **+138.70%** | **13.74%** |

It also un-lumps: the calendar-2025 column had merged the March mark (−2,783,000) and the
December one (−6,956,000) into a single −9,739,000.

**400s** when fewer than two marks fall in the period — that is not a layout the account
can support.

*This supersedes the "fiscal-year-end offset per account" follow-up, which was the weaker
fix: it needs a per-account setting, only helps accounts with a consistent anchor, and
would still have blanked 2020-21 and 2021-22 for United Beverages.*

## Endpoint

```
GET /api/v2/reports/investment-returns
  ?account=<id>                  (required — leaf or parent; parents roll up descendants)
  &fromDate=YYYY-MM-DD           (required)
  &toDate=YYYY-MM-DD             (required)
  &interval=month|quarter|year|marks  (default month; `marks` = between valuations)
  &currency=usd|lc               (default usd)
```

```jsonc
{
  "data": {
    "account": { "id": 25, "name": "Fidelity Stock", "isRollup": true,
                 "members": [{ "id": 25, "name": "Fidelity Stock", "currency": "USD" }, …] },
    "intervals": [{ "key": "2025-Q1", "label": "Q1 2025", "start": "2025-01-01", "end": "2025-03-31" }, …],
    "rows": {
      "beginningMV":   [ … ],
      "netFlows":      [ … ],
      "income":        [ { "category": "Financial Income - Dividend", "values": [ … ] }, … ],
      "incomeTotal":   [ … ],
      "priceReturn":   [ … ],          // labelled "Price return (incl. realized gains)"
      "fxEffect":      [ … ],          // hidden when identically 0 (all-USD selection)
      "unattributed":  [ … ],          // hidden when identically 0
      "totalReturn":   [ … ],
      "returnPct":     [ … ],          // null where coverage < 50% / denominator guarded
      "coverage":      [ … ],          // 0–1; page badges the 0.5–0.9 band
      "endingMV":      [ … ]
    },
    "total": { …, "returnPct": …, "cumulative": true, "annualizedPct": …,
               "chainBroken": false, "clippedSpan": { "start": "2025-02-01", "end": "2026-06-30" } }
  },
  "meta": {
    "currency": "usd",
    "currencies": ["USD"],
    "mixedCurrency": false,
    "markCoverage": [ { "interval": "2025-Q1", "share": 0.62,
                        "uncovered": [ { "account": "Fidelity Options", "shareOfBMV": 0.38,
                                         "firstMark": "2026-05-31" } ] } ],
    "markCadence": [ { "account": "United Beverages", "cadence": "annual", "anchor": "03-31",
                       "marks": ["2019-03-31", …] } ],
    "chainBrokenBy": ["2025-Q1"],
    "feedBalanceOverrides": [],
    "unattributedTotal": -8781.87
  }
}
```

Server-computed on purpose: the [`BalanceTrends.jsx`](../../frontend/src/pages/BalanceTrends.jsx#L131)
pattern of one `fetchBalanceReportV2` per boundary would cost 13 full balance-sheet builds
(with FX refresh) for a monthly year and ~320 for the "All" preset. One grouped SQL pass
replaces it, and Dietz / the FX plug become unit-testable without a browser.

**Column cap.** "All" at monthly interval is ~320 columns. The endpoint **rejects** a span
that would exceed **60** columns — `400` with `"This span needs quarterly or annual
intervals"`, surfaced inline on the page. It does **not** silently coarsen: changing
month → quarter behind the owner's back violates the request they made, and a
`meta.coarsenedTo` footnote is not read.

## Implementation

**Backend**

- `server/src/services/investmentReturns.js` (new) — interval splitting, the SQL, Modified
  Dietz, the FX plug, coverage detection. Sits beside `reports.js` in `server/src/services/`
  (not `server/src/v2/services/`) because it is a report builder consumed by the v2 reports
  route, matching `reports.js`. Arithmetic in pure functions so it tests without a DB.
- [`server/src/v2/routes/reports.js`](../../server/src/v2/routes/reports.js) — new
  `GET /investment-returns`, validation mirroring the existing `isValidDateString` guards.
  **Additive only** — `/balance`, `/cash-flow`, `/cash-flow/transactions`, `/category-trend`
  untouched. Responds `res.json({ data, meta })`.
- `server/src/v2/services/fx.js` — extract `rateAsOf` (see above); `usdBaseAmount` calls it.
- Roll-up: [`accountsRepo.getDescendants`](../../server/src/v2/repositories/accounts.js#L148)
  **excludes the selected account itself** (`WHERE id != $1`) and filters `is_active = TRUE`
  in the recursive step — union the root back in explicitly. `Fidelity Stock` (25) holds no
  transactions today, so omitting this would ship green and break the day one lands there.
- Flow classification uses `accounts.is_transfer` (authoritative, correct for all 11
  transfer categories), not name matching.
- Interval boundaries: generate in SQL (`generate_series` + `date_trunc`) or with the UTC
  pattern at [`reports.js:543-553`](../../server/src/services/reports.js) — `MV(s − 1)` is
  the classic CR037 timezone hazard.

**Frontend**

- `frontend/src/pages/InvestmentReturns.jsx` + `.css` (new).
- Route + nav in [`routes.jsx`](../../frontend/src/config/routes.jsx), **Reports & Graphs →
  Reports**, path `/investment-returns`, icon `LineChart`.
- [`PeriodSelector`](../../frontend/src/components/PeriodSelector/PeriodSelector.jsx) with
  `enableYearRange` (the "All" preset; multi-year is the main use); interval control
  matching [`CashFlowPeriods.jsx`](../../frontend/src/pages/CashFlowPeriods.jsx)'s
  `frequency`; account picker via
  [`AccountPicker`](../../frontend/src/components/AccountPicker/AccountPicker.jsx)
  (`buildHierarchyOptions` already builds the COA-tree option list).
- Charts use [`chartTheme.jsx`](../../frontend/src/utils/chartTheme.jsx) (`useChartTheme` /
  `ChartTooltip`) — required to pass `check-inline-hex.sh` and `check-dead-tokens.sh`.
- **REST: do not call bare `Rest.unwrap`.** [`rest.js:115-128`](../../frontend/src/js/rest.js)
  returns `payload.data` when the siblings are only `success`/`meta`, which would silently
  discard `markCoverage`, `markCadence`, `chainBrokenBy`, `feedBalanceOverrides` — the page
  would render with no warnings at all, the exact CR043 N8 failure shape. Follow the CR054
  precedent at [`rest.js:552`](../../frontend/src/js/rest.js): return `{ data, meta }`.
- Drill-down (#12): double-click `Unattributed` → transaction list → deep-link to the
  transaction editor.

**No migration. No new secret. No change to any existing endpoint's output.**

## Tests / verification

Rev 1's test plan passed against the broken design — every proposed assertion was green
while the identity was off by $8,781.87. Rev 2 adds the tests that fail on rev 1:

- **Residual-must-be-zero**, `EMV − BMV − F − income − ugl − fx − unattributed = 0`, as a
  **fixture test that runs in CI**. It cannot be expressed against the dev DB: CI builds a
  fresh Postgres from [`ci-seed.sql`](../../server/db/e2e-seed.sql), so a "real dev DB"
  assertion would never run where it is claimed to run — the B6 failure shape again. The
  fixture carries a category-206 posting **and** a `category_id IS NULL` row, both of which
  break rev 1's bucketing. A separate one-off script verifies the same identity against
  prod per account per year 2020–2026 (it fails on all five Fidelity accounts under rev 1).
- **Foreign-currency reconciliation on a Sunday month-end (2025-08-31)** — asserts the
  documented, bounded divergence from `GET /reports/balance` rather than pretending there
  is none. The USD reconciliation ("`Ending MV` matches to the cent") is scoped to **USD
  accounts on business-day boundaries**, or it is a flaky red test that gets muted.
- **Unit (no DB):** Dietz weighting (flow on day 1 / mid / last day); the identity for a USD
  and a PLN fixture; linked Total; chain-broken ⇒ `—`; denominator ≤ 0 and the 1% floor ⇒
  `null`; interval splitting incl. partial first/last spans; coarsening at 60 columns.
- **Boundary test:** United Beverages at annual interval ⇒ **unsupported** (March-31
  anchor); Fidelity intervals before 2025-01 ⇒ unsupported; no Fidelity **calendar-year**
  column is supported at all.
- **Coverage:** `Fidelity Stock` roll-up 2025 ⇒ **supported at 95.6%** — `Fidelity Options`
  is unmarked until 2026-05 but is only **4.4%** of the 2024-12-31 roll-up BMV
  (51,502 of 1,173,057). *Rev 2's first draft asserted the opposite and the test would have
  failed.* `Fidelity Fixed Income` ⇒ **61%**, so it renders the % **with a badge**, not `—`.
  No prod selection lands between 50% and 90% by chance, so the threshold behavior is
  pinned by fixtures, not by live data.
- **Route contract:** documented envelope; `interval`/`currency` defaults; 400 on bad date,
  unknown `account`, unknown `interval`.
- **Guards:** lint 0 errors, frontend build, the six blocking CI guards.
- **Clicked live on dev `:3105`** before any deploy — per the v3.0.97–100 lesson, a unit
  test on a code path that never receives data is worse than no test.

## Review response (rev 1 → rev 2)

| # | Finding | Resolution |
|---|---|---|
| B1 | Identity asserted, not constructed; 206 + NULL rows in no bucket (Fidelity IRA 2025 off $8,781.87) | Exhaustive buckets + `Unattributed` row, shown in **both** modes |
| B2 | 206 carries real external flows (Fidelity Stocks 2020 +$200,460.86) | Decision #4 **reversed** — 206 is a flow; legs pair so nothing double-counts |
| B3 | Whole-period Dietz fallback → +2,064% headline | Fallback **removed**; chain-broken ⇒ `—` |
| B4 | "Mark-bearing" inverts on never-marked assets (€422K at 0.00%) | Replaced by **coverage share of BMV**, 90% threshold |
| B5 | Mark inside interval ≠ marks at both boundaries (UB's March-31 anchor) | **Boundary test** ±5 days of `s−1` and `e`; anchors in `meta` |
| B6 | Reconciliation test could not fail | Scoped to USD/business-day; Sunday-boundary FX case added |
| S1–S13 | Label, ex-FX %, lumpy income, `Rest.unwrap`, shared `rateAsOf`, `getDescendants` self-exclusion, `opening_balance_date`, Dietz floor, roll-up strictness, perf/`refreshStaleRates`, CR024 guidance, tests, UTC dates | All adopted; see the sections above |

**S3 caveat, carried:** auto-derived income will surface one/two-row lumps that are not
income — Fidelity Stocks `Financial Income - Other Investments` +$1,093,145.89 (2020),
+$2,530,114.00 (2023, paired with a −$2,565,324.52 transfer), and `Car Purchase/Sale`
−$29,954.13 on a brokerage account (2022). They are left **visible as their own category
rows** rather than filtered: this report's #12 purpose is to surface exactly this. They are
also the likely reason the first UGL mark (2025-01-31, +20,518 on an $894K account) is small
rather than a multi-year catch-up — pre-2025 trueing was booked under other categories.

## Post-build revisions (2026-07-27)

The owner clicked the built page and four rules did not survive contact. Each is recorded
because each was a *design* error that tests could not have caught — the code did exactly
what it was told.

1. **The page rendered in two columns.** `.page-main` ([`PageLayout.css:95-105`](../../frontend/src/pages/PageLayout.css))
   is a hard-coded 2-column grid; the page never opted out, so the toolbar and a 12-column
   table were crushed into the `0.95fr` track with half the viewport empty. Fixed with
   `balance-grid balance-grid--single`, as the four other period-column reports already do.
   The systemic version — five pages now carry a class whose only job is to undo that
   default — is logged at [roadmap §4.1 item 7](../current/project-roadmap.md).
2. **Modified Dietz → average capital `(open+close)/2`**, and **three** return rows
   (realized / unrealized / total) instead of one. Owner's call: a denominator reproducible
   from two numbers on the same screen beats one that weights each flow by its exact day.
   Trade-off recorded above.
3. **The mark-coverage rule was wrong twice** (see #7). The settling argument: the table
   *prints* United Beverages' calendar-2020 `Unrealized G/L` of +1,151,997 and then
   suppressed the percentage that same posting implies. If a figure is good enough to
   display, it is good enough to divide.
4. **`interval=marks`** — columns between valuations, which is the only honest layout for a
   holding valued on its own schedule, and needs no configuration because it reads the
   marks.

Also from the build: per-cell currency prefixes dropped (the unit is stated once, in the
corner cell and caption); the row renamed back to **Unrealized G/L** (the ledger's own name
— "Price return (incl. realized gains)" was accurate and unfindable); `Net external flows`
and `Realized income` became collapsible with server-side per-category breakdowns; and the
period is clipped to today so a "This Year" preset stops rendering six months of future as
`0 / 0.00%` — a zero is not a blank.

## Known limitation at ship

> **Superseded 2026-07-27 by [CR057](cr-057-book-income-at-source.md)** — which fixes this in the
> **ledger**, not the report, and in doing so overturns the reasoning below. The claim that including
> the dividends "would break the reconciliation identity" holds only for a **one-legged** change: with
> the transfer leg also posted to the holding, `Δ totalReturn = 0 − (−X) = +X = Δ income` and the
> buckets close by construction. The "Distributions received elsewhere" row is **not** being built.
> What survives is the deferred data: the CVC rows (cross-currency) and `Other Investments`
> (mis-signed rather than mis-placed). Text kept below as the record of what was decided at ship.

**United Beverages' `Realized return %` is 0.00%, and that is not a bug in the report.**
The holding account has only ever carried 8 `Unrealized G/L` postings and 1 funding
transfer; its dividends — **5 payments, 5,172,998 PLN, 2023-07-21 → 2026-01-07** — post to
**PKO**, because that is where the cash actually arrived. Scoping the report to "transactions
on the selected account" therefore cannot see them, and against ~25M of average capital
that is not a rounding error.

The fix is **not** to add them to the income row: a dividend paid into PKO moved PKO's
balance, not UB's, so including it would break the reconciliation identity this whole CR is
built on. The design settled on but not yet built is a **"Distributions received elsewhere"**
row placed *below* `Ending market value` — outside the identity block, feeding
`Realized return %` — driven by a category→holding mapping the owner supplies
(`Financial Income - UB Dividend` → United Beverages, and similarly for CVC, Barkeria,
Other Investments). Deferred to P2; the owner had not chosen a mapping at ship time.

## Open / follow-ups

All of these are also registered as roadmap bullets under
[§1.1 `cr056`](../current/project-roadmap.md#cr056), so they survive this CR closing.

- **P2 items** — **"Distributions received elsewhere"** (see Known limitation above, the
  highest-value one) · `Unattributed` drill-down + deep-link · `returnPctExFx` · split
  `FX effect & rate drift` into revaluation vs `base_amount` booking drift · the
  Sunday-boundary FX reconciliation test.
- **Growth-of-$1 panel** — must chain Dietz returns, not track the balance; the curves differ.
- **Multi-select accounts** (`HierarchyFilter` chips + combined Total) — endpoint shape allows it.
- **`accounts.marks_to_market` flag** — the exact answer to #7 if the never-marked holdings
  are to be revalued on a schedule; then the flag is the worklist, not overhead.
- **Per-security attribution / true realized-vs-unrealized split** needs CR019's
  investment-side promote plus a price source. Out of scope; recorded so it is not
  rediscovered.
