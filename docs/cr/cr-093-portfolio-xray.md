# CR-093 — Portfolio X-ray: look-through, sector, credit and the security detail chart

**Status:** IN-PROGRESS — P1 + P3 SHIPPED v3.58.0 (2026-09-05); P2 open · **Track:** v3 · **Owner-requested**

Shipped: the Exposure page and sector look-through (v3.55.0, migration 077), the manual
sector picker (v3.55.1), the **fixed-income X-ray** (v3.56.0, migration 078) — §3's credit,
maturity and coupon slices — the **security detail chart** (v3.57.0, §5a) and its **yield row** (v3.57.1, §5b,
migration 079). **P1 is now complete.** Still open: P2 risk and P3 income (§4).

## Why

[CR090](cr-090-investments-section.md) answers *"what do I own"* as a register: positions, values,
and a residual that ties to the custodian. It cannot answer *"what am I actually exposed to"* — and
for this portfolio those are very different questions, because **72% of the equity sleeve is funds**.

The owner asked for analysis "by sector, by rating, by interest rate — a full portfolio x-ray", and
for a per-security chart with index and MACD overlays.

## 0. Measured facts this CR is built on

Everything here was measured on prod 2026-09-05, not assumed.

| | |
|---|---|
| portfolio | **$3,879,092** across 95 live positions |
| funds/ETFs | **28 distinct**, $1,652,714 — top five are **68.8%** of it |
| single-name equity | ~21 positions, **~$350–450k, roughly 10% of the portfolio** |
| bonds | 38 positions, **$1.67M (43.2%)** |
| quotable | **46 of 273 securities** (47.5% by value) |
| stored daily closes | **2,023 rows, 46 securities, 44 trading days** (2026-07-06 → 2026-09-03) |
| available daily closes | fintable `/prices/{sym}/history` reaches back to **~2020-08** — about **six years** |

### 🔴 The finding that reorders the whole problem

**Four bond funds are classified `equity`:**

| | | |
|---|---|---|
| FLDR | Fidelity Low Duration Bond Factor ETF | $533,703 |
| HYG | iShares iBoxx High Yield | $17,822 |
| NVG | Nuveen AMT-Free Muni Credit Income | $9,560 |
| AGG | iShares Core Aggregate Bond | $5,631 |
| | **total** | **$566,716** |

That is **14.6% of the portfolio in the wrong asset class**, so the register's *"47.8% equity /
43.2% fixed income"* is materially wrong — fixed income is closer to **58%**. ⚠️ **The coarsest
look-through is the highest-value one**, and it needs no external data at all: it is 28 judgements
about what each fund *is*.

⚠️ **A sector chart built without look-through would describe ~10% of the portfolio while appearing
to describe half of it.** That is the failure this project keeps catching — a confident picture of
the wrong denominator ([CR058](cr-058-quicken-valuation-anchors.md) §12.8,
[CR061](cr-061-holdings-and-prices.md) §8.6).

## 1. Decisions taken (owner, 2026-09-05)

| # | Decision | Consequence |
|---|---|---|
| 1 | **Fund look-through first**, before any sector view | Nothing ships until funds are seen through — the bonds-first option was declined |
| 2 | Depth: **asset class, then sector weights per fund** — not full constituents | Answers "by sector"; does **not** answer overlap or true single-name exposure. §6 records that as deliberately out of scope |
| 3 | Source: **one market-data API** for everything it covers | Declines hand-seeding and per-issuer file scraping |
| 4 | API scope: **only what statements cannot give us** | Fund asset class, fund sector weights, single-name sector/industry. **Bonds stay statement-derived; prices stay fintable** |
| 5 | Page leads with **Exposure**; risk and income also wanted | Phased P1/P2/P3 rather than one page |
| 6 | *(agent call)* **fin owns the integration**, not bank-feed | bank-feed connects to *your institutions*; sector weights are public facts about instruments. fin already calls an external price API in `marketPrices.js` |

### Why decision 4 matters more than it looks

The statements print, per bond: **Moody's and S&P ratings, coupon rate, maturity, payment frequency
and the full call schedule** — 27 Moody's and 22 S&P ratings in a single statement. That is the
custodian's own record of instruments we hold, free, local, and already inside text the parser reads
and discards.

⚠️ **A third party must not override it.** The statement is what the section subtotals reconcile
against; a vendor's coupon disagreeing with the custodian's would be a second wrong number beside the
right one — the shape [CR090](cr-090-investments-section.md) §6 already refuses for manual entry.

## 2. The provider

### Measured 2026-09-05 — Tradier (the owner already holds an account)

Probed live against the owner's token. **A split verdict, and it fails the two requirements the owner
ranked highest.**

| requirement | priority | Tradier |
|---|---|---|
| Fund **asset class** | 1 | 🔴 `asset_classification: null` for **both** QQQ and FLDR |
| Fund **sector weights** | 2 | 🔴 not offered by any endpoint |
| **Single-name** sector | 3 | ✅ **12 of 12** via `historical_asset_classification.morningstar_sector_code` |
| Daily price history | prerequisite | ✅ **3,112 bars, 2014-04-17 → 2026-09-04 — 12.4 years**, OHLCV |

For an ETF, `/beta/markets/fundamentals/company` returns `company_profile`, `asset_classification`
and `historical_asset_classification` **all null**; the only fund signal is
`share_class.security_type`, and it is inconsistent — QQQ reports `"ETF"`, FLDR reports
`"ST00000005"`.

⚠️ The docs' claim that history covers *"the entire lifetime of the company"* **did not hold** — DIA
launched in 1998 and Tradier starts at 2014. 12.4 years is far more than this CR needs, but the claim
was checked rather than repeated.

Sector arrives as a **Morningstar sector code**, not a name (`311` = Technology). Eleven values,
stable — a local lookup table, not a dependency.

⚠️ `BRKB` returned no sector because Tradier expects **`BRK.B`** — the same symbol-form split already
recorded against fintable. Normalisation, not a coverage gap: **12/12 once applied.**

**Conclusion: Tradier is adopted for price history and single-name sector, and is NOT the fund-data
provider.** It supersedes fintable for `security_prices` — 12.4 years against fintable's measured
floor of ~2020-08 — and settles requirement 3.

### 🔴 Requirement 1 never needed a vendor, and treating it as procurement was the error

FLDR, HYG, NVG and AGG are recognisably bond funds. Classifying **28 funds by asset class is 28
judgements, once** — and it is the highest-value item in this CR at **$566,716, 14.6% of the
portfolio**. No purchased feed improves on the owner knowing what FLDR is, and Tradier — an actual
market-data vendor — could not answer it at all. This is [CR061](cr-061-holdings-and-prices.md) P1's
lesson repeating: it hand-seeded 95 positions after a proposed classifier *could not reproduce its
own test's answers*.

### Still open: fund sector weights

The only genuinely vendor-shaped requirement left, and it is small — **28 funds × ~11 weights,
refreshed at most quarterly**.

**Financial Modeling Prep** publishes a dedicated ETF sector-weighting endpoint plus ETF holdings and
asset exposure. Verified 2026-09-05 that both `/api/v3/etf-sector-weightings/{sym}` and
`/stable/etf/sector-weightings` **exist and require a key** (HTTP 401 key-invalid, not 404). Coverage
against *our* 28 funds is unverified and needs a free key to test — a ten-minute experiment, not a
procurement decision.

**Fallback:** the issuers publish sector breakdowns themselves (SPDR, Invesco, iShares, Fidelity).
Rejected at decision 3 as per-issuer scraping — but the premise there was that one API would cover
everything, and that premise is now measured false.

### Selection rules

**Not yet chosen, deliberately.** Candidate assessment must be *measured*, not recalled: this
agent's knowledge of current API coverage and pricing is a year stale, and the repo has a standing
rule that an objection or endorsement used to steer a decision must be verified rather than
plausible (`feedback_verify_before_recommending_against`).

**Required coverage**, in priority order:

1. **Fund asset class** — is this fund equity, fixed income, or mixed (the $566,716 question)
2. **Fund sector weights** — ~11 GICS weights per fund, for 28 funds
3. **Single-name sector/industry** — ~21 holdings

**Must NOT be required to supply:** bond ratings/coupon/maturity (statements), prices (fintable), or
anything reconciliation depends on. ⚠️ **A provider outage must degrade one page, never break the
register.** Sector weights are therefore CACHED IN FIN with a `weights_as_of` date the page displays;
they are not fetched per page load. Sector weights move slowly, so a stale one is a rounding error —
but only if its age is visible.

**Disclosure, stated plainly for the owner's decision:** this API receives our ticker list. No
quantities and no values, but it does reveal *which securities we hold*. That is a materially smaller
disclosure than the holdings table [CR061](cr-061-holdings-and-prices.md) hard-required to stay
local — and it is not zero, and the owner has accepted it in choosing decision 3.

## 3. P1 — Exposure

One page, and every slice states its own coverage.

- **True asset-class split** after look-through, with the correction called out: fixed income is
  ~58%, not 43%.
- **Sector exposure across the whole equity sleeve**, funds seen through by weight.
- **Fixed income by rating** (Moody's / S&P), **by coupon**, and a **maturity ladder** — all
  statement-derived.

⚠️ **Coverage is stated per slice, in words.** A fund with no sector weights is its own labelled
bucket, never silently dropped and never distributed pro-rata across the sectors we do know — that
would invent exposure. Same rule as the residual row: the gap is shown, not absorbed.

⚠️ **A sector weight is as of a date.** Print it. Bond ratings likewise carry the statement date they
came from, which can be up to a quarter old.

## 3a. Shipped — the fixed-income X-ray (v3.56.0, migration 078)

Measured on the live snapshot, 2026-09-05. **$2,243,163 — 58.0% of the portfolio**, which is the
number §0 predicted once the four bond funds moved out of `equity`.

| slice | measured |
|---|---|
| rated by an agency | **$633,712** — 28.3% of the sleeve, **89.7% of it investment grade** |
| FDIC-insured CDs | **$694,010** — 30.9%, the largest single block |
| bond funds | **$566,878** — 25.3%, no single rating/coupon/maturity by nature |
| no statement yet | **$348,563** — 15.5%, bought since 2026-06-30; closes itself |
| weighted average coupon | **4.51%** across the $1,327,722 that carries one |
| maturity | 1–3y **$799,879** (35.7%) is the bulge; only $36,879 inside a year |

### 🔴 The parser was throwing away more than the terms, and the gate could not see it

Three defects were found by reading what the parser produced, not by any failing check:

1. **CDs print under `Other`, which is not a bond section**, so they were read with the ordinary
   grammar and their **accrued interest was stored as cost basis while the real cost basis became
   the unrealized gain** — **161 rows** across the corpus, $9,991,277 of market value carrying
   $19,356 of cost. ⚠️ **The reconciliation gate compares MARKET VALUE, which sits BEFORE the extra
   column and was correct in every row.** Same shape as the name defect: the check that existed read
   the column that was right. The grammar is now chosen by the table's own **column header**
   (`… Accrued Int. (AI) <date> Total Cost Basis …`), not by the section's name.
2. **The gate now reads the SECOND column too.** 198 cost-basis checks across 51 statements, and it
   is not vacuous: disabling the fix above turns 1 failure into **18**. Skipped rather than failed
   where the statement cannot support it — a Core Account prints `not applicable` for basis and
   omits the figure from its own subtotal.
3. **Name healing was defeated by its own cache.** `resolveSecurity` returned early on a cache hit,
   so `healName` ran at most **once per symbol per run** — on the OLDEST statement, since the corpus
   is read in date order. The rule says the most recent statement wins; the code made the first one
   win, which is the exact defect the rule was written to kill. `AGG` kept
   `Mar 31, 2017 Fixed Income ETPs ISHARES CORE U.S. AGGREGATE BOND ETF` from its first sighting
   while **61 later sightings** said `ISHARES CORE US AGGREGATE BOND ETF`, and re-running the ingest
   could never repair it. Two further header variants (bond tables end in `Coupon Rate`; the 2016
   layout ends in a bare date) are now furniture. **0 statement-furniture names remain.**

### Decisions taken here, and why

- **A split rating takes the LOWER grade** — the market's own convention, and the only safe
  direction to round. Rounding up would understate exactly the risk the panel exists to show.
- **Letter grades, not notches.** `Baa3` and `BBB-` are kept verbatim on the holding; the BUCKET is
  the letter. A distribution across twenty notches is a list, not a picture.
- **⚠️ Four reasons a bond has no rating, and they are four buckets.** A CD is **FDIC-insured**, not
  unrated — filing $694,010 beside genuinely unrated corporate paper would say this portfolio
  carries credit risk it does not carry. A bond fund has no single rating. `not_rated` is a real
  answer. `no_terms` is the only one that should shrink, and it does so unaided.
- **The same split applies to the maturity ladder and the coupon table.** One `no_maturity` bucket
  merged $566,878 of funds with $348,563 of unstatemented bonds and labelled the whole **40.8%**
  "funds". Caught by reading the rendered output.
- **Coupon is the structural field; EAI is not shipped.** §4 records why they are different columns.

## 4. P2 — Risk · P3 — Income

**P2 (risk):** concentration by sector, issuer and single name; credit-quality distribution.
⚠️ **True cross-fund overlap is NOT available** under decision 2 — SPY, QQQ, DIA and FBCG all hold
the same mega-caps, and without constituents that overlap cannot be computed. P2 must say so rather
than present sector concentration as if it were name concentration.

**P3 (income):** bond coupons, the maturity ladder as an income schedule, fund distribution yields,
projected annual income.

🔴 **EAI is a FORWARD ESTIMATE, not `coupon × face`, and it decays near maturity.** Measured
2026-09-05: three of four bonds give `face × coupon = EAI` exactly (12,000 × 4.500% = 540.00), while
**BLACKSTONE PRIVATE CREDIT FUND, maturing 2026-12-15**, shows **$196.87 against a coupon-implied
$393.75** — exactly half, because only **one coupon remains inside the next twelve months**. So:
**coupon is the structural field, EAI is an estimate, and they are different columns.** Dividing EAI
by market value gives a forward yield that legitimately falls as a bond runs off; labelling that
"yield" without saying which is how a maturing bond looks like a yield cut.

## 5. The security detail chart (owner-requested)

Click a ticker → a chart of that security, with:

- selectable period (1M / 3M / 6M / 1Y / 3Y / 5Y — **~6 years is the ceiling**, see §0)
- **% gain/loss** over the selected period
- **index overlay**: S&P 500 and Dow, rebased to the same start so shapes compare
- **MACD 12/26/9** — the conventional parameterisation (fast EMA 12, slow EMA 26, signal 9); the
  owner's "9/26/12" is read as the same three numbers reversed
- **the "other relevant details" the owner asked for**, pinned rather than left vague — the first
  draft dropped it, which is the wrong way to handle an ambiguous ask. Three groups: **our position**
  (quantity, cost basis, unrealized, share of account, and which accounts hold it — DIA is held in
  two), **the instrument** (asset class, price basis, sector once known; for a bond its rating,
  coupon and maturity, all statement-derived), and **the quote** (last close and its date, 52-week
  range, and the freshness band [CR090](cr-090-investments-section.md) §2 already defines).
  ⚠️ Nothing the level series cannot support — no annualized return, no volatility, no beta (§6).

### 🔴 It is blocked on a price backfill, and would be wrong without one

We hold **44 trading days**. MACD 12/26/9 produces **no value at all** until ~35 points, and its slow
EMA is not trustworthy until roughly 3× its period. On 44 days it yields about **nine usable points**
— a line that looks like an indicator and is warm-up. Any period longer than 2M would be empty.

**Backfill first**: ~46 quotable securities × ~1,500 trading days ≈ **69,000 rows** against the 2,023
stored, from `/prices/{sym}/history` which is already used and already works with `start`/`end`.

⚠️ **Only 46 of 273 securities can be charted at all.** Bonds, CDs and money-market funds have no
ticker and no quote. Clicking one must say *why* there is no chart — the instrument is not quoted —
never render an empty axis, which reads as "no movement" rather than "no data".

⚠️ **Rebase the overlay, never plot two price axes.** DIA at ~$534 against a $25 holding on one axis
makes the holding a flat line. Both series start at 100.

## 5a. Shipped — the security detail chart (v3.57.0)

`GET /api/v2/investments/securities/:id/chart?period=…`, opened by clicking a symbol in the
positions register. No migration: it reads the Tradier backfill already in `security_prices`.

**§5's blocker is gone.** The backfill landed in v3.54.0 — **426,614 closes over 146 securities,
2014-01-02 -> 2026-09-04**, against the 2,023 rows and 44 days §5 was written under. 1M through Max
all have data, and MACD is a real indicator rather than warm-up.

### 🔴 The warm-up has to be computed and then thrown away

MACD 12/26/9 emits nothing for 26 bars (the slow EMA) plus 9 more (the signal seeded on top of it),
and the slow EMA is not worth trusting for roughly 3x its period. Computing it over the **display
window** would mean a 1M chart drew almost nothing and a 3M chart drew mostly warm-up **while
looking exactly like a chart that drew signal**. So the query fetches **120 trading days before the
window**, the indicator runs over the whole thing, and only points inside the window are returned —
measured on IBM/1Y, 121 lead-in bars and every returned point a computed value. The response carries
`macd_complete`, and the page says which case it is instead of leaving the reader to assume.

⚠️ **The signal line is seeded from the first DEFINED MACD value**, not from index 0. Seeding it
across the leading nulls drags the line toward zero and shifts every crossover — a defect that looks
like a slightly different indicator rather than a broken one. Pinned by a test on a steadily rising
series, where signal must converge *to* MACD rather than approach it from below.

### The three numbers that all look like "gain"

| | what it is | what it is not |
|---|---|---|
| **price change** | what the quote did over the chosen period | not total return — **no dividends** |
| **unrealized G/L** | this position against its own cost basis | over a holding period that is **not** the chosen one |
| **the overlay's %** | what SPY or DIA did in the same window | not the index itself |

Measured 2026-09-05: IBM over 1Y is **-4.97%** while its position shows **+$8,761 unrealized**. Both
are true and they are not in conflict — and a page that showed them without saying which is which
would be the same error [CR056](cr-056-investment-returns.md) §3.3 and
[CR058](cr-058-quicken-valuation-anchors.md) §12.8 have each settled once already.

### Decisions

- **The overlay is SPY and DIA, and the label says so.** They track the S&P 500 and the Dow but
  carry fees and their own dividend treatment; a line labelled "S&P 500" that is really SPY would be
  a small permanent lie on every chart. They also cost nothing — both are holdings this portfolio
  already prices, so the overlay needs no vendor call.
- **A security is never overlaid on itself** — SPY charted against SPY drew two identical lines.
- **Rebased to 100**, per §5. Both series' shapes compare; neither price level intrudes.
- ⚠️ **An unquoted instrument gets a sentence and its bond terms, not an empty axis.** This is the
  MAJORITY case, not an edge: **45 of 91 live holdings, $2,026,180 — 52% of the value** — are bonds,
  CDs and deposits with no market quote by nature. Every row is clickable, and the dialog is where
  the reason lives, so a bond row is not a dead end.

### 🔴 Two defects the RENDERED PAGE caught that reading the code did not

1. **`Sector: not classified yet` on a brokered CD** — which reads as outstanding work on something
   that can never carry an equity sector. It is the same not-applicable / not-covered split §3
   already makes, and it had simply not been carried into the detail panel. Now three answers, with
   `price_basis = 'par'` as the structural tell for the FDIC deposits classed `unknown`.
2. **`per_1_face` and `per_share` rendered raw** — internal enum values in a document the owner
   reads.

Both now live in `securityDetail.js` with tests, extracted from the component so the rules can be
pinned without rendering a dialog.

## 5b. Shipped — the yield, and it is a different question on each side (v3.57.1)

Owner-asked, after seeing §5a: *"we should show the yield (div or coupon) — for fixed income both
coupon and current yield."* Migration **079**, `Scripts/load-dividends.js`, no new endpoint.

**Only one of the three numbers needed stored data.**

| | source | stale? |
|---|---|---|
| coupon | migration 078, off the custodian statements | up to a quarter |
| **current yield** | **arithmetic** — `coupon x par / price` | never; it moves with the price |
| dividend yield | migration 079, Tradier distributions | as of the last load |

⚠️ **Coupon and current yield are not the same number, which is exactly why both were asked for.**
The coupon is what the bond pays on its FACE and never moves; the current yield is that income
against what it costs TODAY. Measured on the IBM 4.75% of 2031: coupon **4.750%**, price **98.745**,
current yield **4.81%**. ⚠️ And current yield is **not yield to maturity** — YTM adds the pull to par
over the remaining life and needs a reinvestment assumption. Unqualified, "yield" overstates a
discount bond, so the row carries the qualifier on screen.

### 🔴 A capital-gains distribution is not a yield

fin had **no distribution data at all** — `security_transactions` holds 0 rows. Tradier serves it,
including for ETFs, and returns five types: `CD` cash · `SC` special cash · `LT`/`ST` capital gains ·
`NP` non-periodic. **DGRW carries four of them at once.** Summing them lets one year-end turnover
distribution present itself as a permanent income rate — and it would look entirely plausible. The
yield counts **CD only**; the rest is shown beside it rather than hidden, because the money is real.
An unrecognised sixth type is a hard error at parse time rather than a silent addition to the yield.

⚠️ **Trailing twelve months, not `latest x frequency`.** The forward form looks more current and
rests on a field that is not stable — UTF reports frequencies of **12, 0 and 4** across its history.
Twelve months of actual payments is a measurement; the other extrapolates from one data point.

### 🔴 "Pays nothing" is not "we have no data" — the fourth time in this project

After [075](../current/migrations.md) `polled_on`/`valued_on`, 077 `sector_weights_as_of` and 078
`fdic_insured`. Measured: **43 of 47** live quotable holdings return distributions. Of the four that
do not, **BRK/B and KD genuinely pay none** — a fact about the company — while **FCNTX is an
open-end fund Tradier does not cover at all**. `securities.dividends_as_of` records that we asked and
is set even when zero rows come back, so a measured **0.00%** is distinguishable from a blank.

⚠️ **This corrects §2's note in one respect.** Tradier's *fundamentals* return null for funds — that
was measured on `company_profile` and `asset_classification`, and it still holds. Its **dividends**
endpoint does cover ETFs: QQQ, SPY and FLDR all return full histories. The endpoint that failed and
the endpoint that works are different endpoints, and the earlier finding should not be read as
covering both.

### 🔴 Three defects the rendered page caught

1. **`partial_year` fired for every quarterly payer.** The first cut asked whether the first payment
   inside the window was more than a month after it opened — true of IBM, which has paid without
   interruption for decades. The question is about the SECURITY's history, not where its payments
   fall: it is partial only if the whole distribution history begins inside the window.
2. **"Coupon" rendered twice**, once from the yield row and once from the terms block, reading as two
   different rates on one bond.
3. ⚠️ **A bond's `quantity` is units of par, not dollars of face.** 1,000 units priced per $100 of
   face is **$100,000** of face — and printed beside a "coupon on face", the bare quantity invites an
   annual income **100x too small**. The face value is now spelled out. Verified against the
   custodian's own printed EAI: 100,000 x 4.75% = **$4,750**, exactly what the statement shows.

## 4a. Shipped — P3, income (v3.58.0)

`/investments/income` and `GET /api/v2/investments/income`. **No migration** — it reads the bond
terms (078) and distributions (079) already stored.

### 🔴 The derived coupon schedule reproduces the custodian's own EAI, 27 of 27

The strongest validation available: Fidelity prints an Estimated Annual Income per bond, and this
code derives its own from coupon, frequency and maturity. **All 27 bonds on the 2026-06 statement
match to the cent** — including the two the naive form gets wrong.

⚠️ **Annual income is NOT `face x coupon`.** It is the coupons that actually fall inside the window,
which is fewer as a bond runs off. BLACKSTONE 2.625% of 2026-12-15: statement EAI **$196.87**
against a coupon-implied **$393.75**, because only one coupon remains. §4 predicted this; the
schedule now reproduces it.

⚠️ **Walked BACKWARDS from maturity**, which is how a bond's schedule is defined — the last coupon
lands with the principal and every earlier one is a whole period before it. Walking forward would
need an issue date we do not have.

### 🔴 `quantity` does not mean the same thing in every row

Found while validating. One security, `price_basis = 'per_100_face'` on both rows:

| source | quantity | price | market value |
|---|---|---|---|
| bank-feed | **150** | 99.409 | 14,911.35 |
| statement | **100,000** | 100.083 | 100,082.61 |

The feed writes **units of $100**; the statement writes **dollars of face** — a factor of 100 apart,
on the same instrument, under the same label. ⚠️ **Both market values are correct**, each source
being internally consistent, which is exactly why nothing ever complained: `market_value` is the
column the reconciliation gate reads. A coupon computed from `quantity` is wrong by 100x on half the
corpus.

**The fix does not pick a side.** `face = market_value x par / price` uses only the two fields that
are consistent *within* a row, and returns 15,000 and 100,000 respectively — right from either
source, with no assumption about which wrote it.

### Decisions

- ⚠️ **Scheduled and estimated are never one number.** A coupon is contractual and dated; a
  distribution is a projection from the last twelve months that nobody owes. Merged, the page would
  say a fund's distribution is as reliable as a Treasury coupon. Reported apart, then combined.
- **Distributions are spread evenly across the months**, and the page says so — we know what was
  *paid*, not when the next ones land, and projecting last year's dates forward would assert a
  calendar nobody published.
- **A callable bond is counted to maturity and flagged.** A call cannot be predicted and a called
  bond simply stops paying: **$14,231.88** of the scheduled income is callable inside the window.
- **Yield is quoted on the WHOLE portfolio** (2.90%), not on the income-producing part, which would
  read far higher and describe a portfolio the owner does not have.

### What it cannot say, in four groups

**$730,604** states no income, and only one group is a gap in our data:

| | | |
|---|---|---|
| $348,563 | bonds with no statement yet | closes itself next quarter |
| **$193,138** | **cash, money-market, deposits** | 🔴 **these DO pay interest** — the statements print `7-day yield: 3.47%` and `Interest rate: 1.82%` and the parser discards both, so the total **understates** by this much |
| $147,988 | FCNTX | an open-end fund the price provider does not cover |
| $40,916 | BRK/B, KD, SPCX | measured — they pay nothing |

**Open, and named rather than hidden:** parsing the money-market and deposit rates is the one
remaining piece that would make the total complete.

### Measured 2026-09-05

| | |
|---|---|
| scheduled (32 bonds and CDs) | **$60,317.38** |
| estimated (43 holdings) | **$51,980.11** |
| together | **$112,297.49 — 2.90%** on the portfolio |

## 6. Non-goals

- **Constituent-level look-through** — excluded by decision 2. It is what overlap and true
  single-name exposure need; when it is wanted it is its own CR, with a refresh cadence.
- **Returns from the level series** — settled three times already
  ([CR056](cr-056-investment-returns.md) §3.3, [CR058](cr-058-quicken-valuation-anchors.md) §9 step 5
  and §12.8). The X-ray shows exposure and income, never performance; `/investment-returns` owns that.
- **Overriding custodian data with vendor data** — §1 decision 4.
- **Any indicator that cannot be computed from the history we hold.** MACD earns its place only
  after the backfill; anything needing intraday or volume-weighted data does not.

## 7. Depends on

[CR061](cr-061-holdings-and-prices.md) P1/P2 (securities master, positions, the statement corpus and
its bond metadata) and [CR090](cr-090-investments-section.md) P1/P3 (the section, the register, the
history endpoint). Does not block, and is not blocked by, CR090 P2's quote overlay — though both read
`security_prices`, and **this CR's backfill is what makes P2's freshness band meaningful over more
than two months**.
