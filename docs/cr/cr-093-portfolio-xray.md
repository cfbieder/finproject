# CR-093 — Portfolio X-ray: look-through, sector, credit and the security detail chart

**Status:** DRAFT (2026-09-05) · **Track:** v3 · **Owner-requested**

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
