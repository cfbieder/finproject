# CR076 — The forecast model review, and the figures it corrected

**Status:** IN-PROGRESS — **§8 steps 1–3 SHIPPED in v3.20.0 (2026-08-09)** *(⚠️ MOVES NUMBERS; no
migration)*; steps 4–6 open. The §2 documentation correction is applied.
**Track:** v3
**Origin:** owner, 2026-08-09 — *"Use a team of agents including the financial_software_expert to review
the Forecast Model, run test scenarios and provide recommendations for improvement or highlight errors."*

Five reviewers ran in parallel against the engine and a prod copy: the warning rules, the P&L
side, the balance-sheet side, the cash sweep, and a scenario runner doing perturbation tests.
Every finding below was re-verified against the engine's own formula and real rows before being
recorded here; the ones that could not be were dropped or are marked as such.

---

## 1. What is sound

Stated first because it is the larger half, and because a review that lists only defects
misrepresents the thing it reviewed.

- **Growth is one convention, applied to both sides.** `growth_rate` and `growth_mult` are both
  *multipliers of inflation* (`fcbuilder-module.js:251-258`, `fcbuilder-stream.js:80`), compounded
  on the prior level. Income and expense escalate identically; inflation is never applied twice.
- **Cost basis never grows, and contributions raise it** — correct for buy-and-hold.
  Partial disposals apportion basis **pro-rata** and the arithmetic closes exactly over a module's
  life (`CVC Fund VIII`: proceeds 785,376.56 − basis 500,000 = 285,376.55 = Σ of its four realized-gain rows).
- **The half-year convention is real** and verified on both a disposal and a July-1 loan draw.
- **Capital gain is proceeds − basis at the DISPOSAL year**, not at the base date — verified
  numerically, which matters because [CR071 §8](cr-071-forecast-numbers-vs-intent.md) found a
  warning asserting the opposite. Tax is deferred one year. A 0% override is honoured as a real
  rate, not as unset.
- **Loans are clean.** Interest is read off the *realized* balance path and never re-derived, so
  principal and interest cannot drift; the loan retires to exactly zero and accrues nothing after.
- **No balance-sheet stock is summed across years** anywhere in the Review/Compare path. The
  −60.7M class of bug is not present.
- **Sign convention holds end to end** — magnitude + direction, the sign applied once.
- **The sweep's availability cap is forward-looking** (`floorNorm[Y] = min over t ≥ Y`), so a module
  with a scheduled Full disposal cannot be swept before that sale. Unusually careful.
- **Zero orphan streams** on prod and dev — CR073's guard held. **Gates green**: 834 backend,
  465 frontend, engine idempotent, and all five scenarios regenerated on dev came back
  byte-identical to prod (so prod is current).

---

## 2. ⚠️ P0 — the published net-worth figures were wrong, and they were mine

CR075 §6/§10, `status.md` and the roadmap carried five net-worth figures produced by a SQL
roll-up that sums `forecast_entries` by account at the horizon. The engine writes
`account='Bank Accounts'` as **annual cash movements per module**, not a balance:

```
2062 Bank Accounts, Base:  Living Expenses −201,945 · Retirement Home −256,017
                           Travel −85,903 · Healthcare −54,279 · …
```

That is one year's spending. The roll-up read it as a stock. The arithmetic confirms it exactly:

```
3,413,574 (Fidelity Stock) + 797,712 (FFI) + 3,521 − 27,187 (cards) − 682,531 ("Bank Accounts")
  = 3,505,089   ← the figure published for Base
```

The sweep pins cash to a 200k–300k band, so −682,531 cannot be a balance. **The app was never
wrong** — `FCReview.jsx:725` and `fcCompareUtils.js:205-250` both carry `Bank Accounts` as a
running balance seeded from the ledger. Only the roll-up was.

### The corrected figures

Read **through the app's own `buildScenarioMatrix`**, not a fresh restatement of it — the
restatement is what caused this. Script: the app's `parseLevelAccounts` +
`aggregateBalanceReport` + `buildScenarioMatrix` against prod's live endpoints.

| scenario | published (wrong) | **net assets at 2062** | error |
|---|--:|--:|--:|
| 2026 Base | 3,505,089 | **4,398,898** | +893,809 |
| 2026 Buy Business | 8,657,572 | **9,474,620** | +817,048 |
| 2026 Downside | 1,002,558 | **1,881,988** | +879,430 |
| 2026 Upside | 6,890,094 | **7,733,471** | +843,377 |
| 2026 SRQ House Purchase | −745,713 | **−829,508** | −83,795 |

**The error is not a constant** (+894K to −84K), so it contaminated comparisons, not just levels.
A measured delta was off by ~4.4%.

**Cross-validated two ways.** An independent stock-based reconstruction of Base — balance-sheet
stocks at 2062 plus a cash path rebuilt from the entries — gives 4,187,620.68 + 200,000.00 =
**4,387,620.68**, differing from the app's 4,398,897.74 by **exactly 11,277.06**, which is §4's
separately-identified bank-seed defect. And the reconstructed cash path lands on **exactly
200,000.00**, touching 300,000.00 in sweep-deposit years — the band, to the cent.

### What survives, and what does not

CR075's **direction, mechanism and gate discipline were right**, and the before/after was run
correctly on an idempotent engine. What does not survive is the **levels**, and SRQ's shortfall
figures (−3.20M → −1.84M): those are *sums* of a cumulative quantity and double-count on top of
this (§3).

**This is the fifth instance of the pattern `status.md` tracks** — a figure asserted about the
engine from a restatement rather than from the engine's own formula. The restatement was mine,
and it passed every gate because the gates compare a number to itself before and after.

**The rule this earns:** a forecast figure quoted in any document must come from the app's own
exported functions or the engine, never from a SQL re-derivation written for the occasion.

---

## 3. Three warning rules are wrong, and the audit trail describes a discarded forecast

That makes **5 of 8 rules found wrong** in a fortnight. Every gate passed each time, because the
tests assert a warning *fired* — never that what it *said* was true.

### R7 `disposal-before-start-*` — false on all 20 rows it fires on

Claims a 2026 disposal *"never happens — the balance it was meant to clear stays on the books for
the whole plan."* The engine indexes a disposal against the **module's own base year**
(`fcbuilder-module.js:434`, `startyear = base_date`), not PeriodStart. Every affected module has
`base_date` 2025, so a 2026 disposal is index 1 — executed. Prod:

```
US - Nokomis 2026-2029:  Bank Accounts 394,875 · Transfer - Bank 394,875 · and NO balance row
```

CR075 §5 fixed R7's *input* (it was fed PeriodStart−2) and took the panel 13→17. Nobody then
checked its *sentence*. The four modules it names are cleared correctly, their proceeds reach
opening cash, and `SP - Panorama Mar 4`'s CGT defers to 2027 exactly as a scheduled disposal
should. **Fix:** threshold `< periodStart − 1`; the live case needs a different, true sentence.

### W2 `unfunded-shortfall` — the headline double-counts

`runningCash` is declared once outside the year loop (`cash-sweep.js:87`) and the shortfall entry
never adds back to it, so each row is the **cumulative** gap to the band. Prod SRQ: 2061
−169,573.32, 2062 −1,017,119.05. The rule sums them → **$1.2M**. The true terminal gap is
**1,017,119**; the bank hole is **817,119**. **Fix:** report the worst year, not the sum.
`forecastAutoAdjust.js:44-52,152-160` sums the same rows.

### R5 `disposal-no-gain-*`, loss branch — claims an offset that does not exist

Says a loss *"may offset gains elsewhere"*. `fcbuilder-module.js:513` is
`if (gainsFactor !== 0 && realizedGainValues[i] > 0)` — negative gains are skipped, with no
netting and no carry-forward anywhere. Live on `OCME` across 5 scenarios.

### The cash-sweep CSV is written before the sweep is re-run

`index.js:594-617` writes the audit CSV from the **first** sweep pass; Step 7b then deletes the
`_cash_sweep`/`_sweep_bal`/`_rebalance` rows, re-runs to convergence and inserts different
entries — without rewriting the CSV. `FCCashSweepModal.jsx:25` serves it. Verified on prod:

| SRQ 2062 | audit CSV (what the owner reads) | committed entries |
|---|---|---|
| action | `sweep_out −1,005,326.29` | **no sweep transfer** |
| cash after | **200,000.00** | `Cash Shortfall −1,017,119.05` |

`shortfall` is not even a column in the CSV header. The explanation screen contradicts the
warning panel. Base is wrong too — its CSV claims Fidelity **Stocks** was liquidated in 2061-62;
the entries show only Fidelity Fixed Income.

### Rules verified correct
`negative-cash`, `below-low-band`, `configured-but-excluded` (4 live firings, all true),
`module-over-drained`, `loan-over-scheduled`, `type-data-loan`. Latent divergences found in
`no-sweep-module` (requires rank 1; the engine accepts any rank, or `cash_sweep_target`),
`foreign-income-no-tax-override` (names the scenario rate where the engine applies a module
override), `stream-no-line` (its invisibility claim holds only for valuation modules),
`loan-bullet`/`loan-balloon` (use principal where the engine uses outstanding balance), and
`unbudgeted-base-year` (no window check; blind to base-year change rows) — all 0 live firings,
all reachable by one ordinary owner edit.

---

## 4. Defects that move money

| id | defect | evidence | cost |
|---|---|---|--:|
| **D1** | **The convergence loop keeps a stale copy of the growth formula and overwrites the builder with it.** `index.js:726` lacks CR072 §8's `rateIdx` clamp (`fcbuilder-module.js:256`), so the pre-horizon year does not compound. The loop then UPDATEs the builder's rows. | Prod: 2027 dividend **27,723.71** = avg(1,369,072 · 1,403,299) × 2%, beside a 2027 balance of **1,438,381**. Same module, same year, two market values. The stored 2028 figure IS the builder's 2027 figure. | −39,715 |
| **D2** | **The sweep's opening cash uses `closing_balance`**, the method the rest of Fin abandoned as *"prone to stale PS data"* (`reports.js:76-83`). `PKO EUR` reads −4,848.85 EUR where the book says +151.15; `PKO TFI` has no row so 6,000 PLN counts as zero. | Review displays **211,277** where the engine held **200,000** — constant to the cent across all five scenarios, and independently reproduced in §2. W1/W4 judge "below band" against it. | 11,277 |
| **D3** | **Foreign cost basis is re-translated every year** (`fcbuilder-module.js:530`), so a gain carries an FX movement never booked as a gain. No FX gain/loss line exists. | `United Beverages`: USD basis 1,113,492 at acquisition vs 888,889 used → 224,603 of basis vanishes; over-taxed **51,659** in 2037. | −51,659 |
| **D4** | **Base-year tax still reads the typed stream amount** (`fcbuilder-module.js:485-508`) after CR075 moved base-year income to the budget. Income and the tax on it now come from different sources. | `UB Income`: budget 192,266 vs typed 128,205. 2027 Taxes reconciles to the typed figure exactly. | −14,734 |
| **D5** | **A stream's final year is halved twice** — window end (`fcbuilder-stream.js:241`) then Full disposal (`fcbuilder-module.js:440`). The acquisition path guards against exactly this; the disposal path does not. | `Sarasota House` 2048 Property Costs **19,368** vs an honest 38,736. | −19,368 |
| **D6** | **Same-year gains and losses never net**, per module, with no carry-forward. | 2026: `Panorama Mar 4` +40,000 taxed at 30%; `Sea Senses` −21,124 discarded. | −7,368 |
| **D7** | **An empty inflation list silently yields 0% for 36 years.** `buildRates` returns `entries[0]?.Rate ?? 0` (`fcbuilder-setup.js:31`). Since growth is a *multiplier* of inflation, that stops every asset appreciating and every stream escalating. The FX path already fails loud on this exact shape. | latent | catastrophic |
| **D8** | **The assumption row dated PeriodStart−1 is discarded.** `buildRates` starts the series at PeriodStart, so a PeriodStart−1 row survives only as a seed and is overwritten. `2026 Downside` declares FX 2026 = 3.9 and the engine strikes 2026 at **4.5**. | Downside | large |

---

## 5. Two labels teach the owner the wrong model

**The growth hint is backwards.** `FCModulesStreams.jsx:197` says *"Blank = 1 = inflation. 0 = flat
in today's money."* The engine compounds at `inflation × mult` — so **1** is flat in today's money
and **0** is flat in *cash*, shedding 2.5%/yr in real terms. The clauses are swapped, and **70 of
110** amount streams carry an explicit multiplier, most below 1: `Purchases` 0.5 sheds 36% of
purchasing power over the horizon, `Social Security` 0.25 against a statutory full-CPI COLA.

**`growth_rate` is a multiplier, not a rate** — `OCME`'s `−20` means **−50%/yr**, halving annually
to nothing by 2033. Nothing flags a value 13× outside every other module's range (max 1.5).

**A yield stream has no rate field at all.** `fcbuilder-stream.js:171` is `inflation + spread`, and
the card offers no spread box — it is reachable only via a "Changes over time" row. Both CVC funds
have none, so they pay **exactly 2.5%**, forever, a number nobody typed. The 2026 budget for that
line implies 3.6%. `growth_mult` is silently **inert** on yield streams.

**Hiding Amount on a yield stream does not clear it**, and `fcbuilder-module.js:485-508` reads it
regardless of mode. All 20 live yield streams are at 0.00, so it is the path, not a live number.

---

## 6. What the stress tests found

Tax, FX, disposal-timing and sweep-band responses are all **linear and symmetric**. The
tax-override check passes quantitatively: 1pp of `United Beverages`' gain compounded to 2062
predicts **60,385** against **60,500** measured. A one-off expense past the horizon is correctly
dropped (0.00).

**Inflation is the master dial for the entire model.** ±1pp moves the horizon **+70% / −45%**.
And it is asymmetric in the wrong direction: doubling inflation multiplies cumulative income
**2.60×** and expense only **1.63×**, because yields are charged on assets that themselves
compounded at inflation. **Raising the inflation assumption makes the plan look better.**

"Zero growth" needed decomposing before it made sense: turning off both dials makes the owner
**richer by 708,671**, because `growth_rate` is worth +6.05M and `growth_mult` costs −6.77M. Two
opposite things share the word "growth".

---

## 7. Design questions for the owner

1. **Price the cash.** Idle cash earns 0% while the sweep sells a 3.75% asset every year to defend
   the floor (~7,500/yr forgone, >300,000 compounded); an overdraft costs nothing. Two scalars —
   a cash rate and a shortfall borrowing rate — not a facility model.
2. **Selling costs.** No disposal-cost input exists. The base year alone books **1,239,753** of
   gross property proceeds, landing straight in opening cash; at 3–6% that is 37,000–74,000 the
   plan has and would not.
3. **Nominal vs real.** 2.5% over 36 years is 2.43×; the 2062 figure is ~41% of its headline in
   today's money, and no surface says so. An "in 2026 dollars" toggle on Review is the
   highest-value output addition.
4. **`OCME` at −20**, and whether the 70 sub-1 multipliers still say what was meant once §5's hint
   is corrected.
5. **The base year and the first forecast year disagree on 12 of 15 lines** (UB Income −32%, CVC
   Dividend −37%, Interest Income +66%, Financial Expenses −100%) and nothing reports it. R9 asks
   only whether a line is budgeted, never whether the module agrees with it.
6. **Polish real estate carries the US 30% default** while the Polish businesses carry 19%/23%
   overrides — worth ~304,755 on `PL - Niemena` alone. Deliberate or oversight?
7. **CVC distributes three ways at once** — NAV growth, a yield stream, and a capital-return
   schedule. Is the growth rate net of distributions?

---

## 8. Fix order

1. ✅ **§2 — correct the published figures.** Docs only. *(v3.20.0)*
2. ✅ **D1**, then **R7 / W2 / R5** copy. One line and three sentences. *(v3.20.0)*
3. ✅ **Rewrite the sweep CSV after convergence.** An explanation contradicting the warning beside
   it is worse than either alone. *(v3.20.0)*
4. ✅ **§5's growth hint** + **R10**, an outlier guard. *(step 4, below)* — the multipliers
   themselves are now an owner question, stated in §11.
5. ✅ **D7 / D8** — fail loud on a missing inflation row *(§12)*; honour a PeriodStart−1
   assumption *(§13, ⚠️ MOVES NUMBERS — measured)*.
6. ✅ **D2 (§14) · D3 (§15) · D4 (§16) · D5 (§17) · D6 (§18)** — each moved numbers and each was
   measured behind CR075's gate on an engine first proven idempotent, one at a time.

**§8 is COMPLETE.** [CR077](cr-077-assumption-advisor-tab.md) is unblocked.

## 10. Shipped in v3.20.0 (2026-08-09)

**D1 — one growth formula.** `growthPctForYear` now lives once in `fcbuilder-common.js`; both the
builder and the convergence loop call it, and `growth-formula-parity.test.js` fails if either
re-derives it (it strips comments first, so the formula may still be *described*). Measured on dev
against an engine proven idempotent, then the extraction itself verified **byte-identical** to the
measured fix:

| scenario | before | after | delta |
|---|--:|--:|--:|
| Base | 4,398,898 | **4,442,681** | **+43,783** |
| Buy Business | 9,474,620 | 9,518,358 | +43,738 |
| Downside | 1,881,988 | 1,937,950 | +55,962 |
| Upside | 7,733,471 | 7,777,205 | +43,734 |
| SRQ House Purchase | −829,508 | −783,305 | +46,203 |

Mechanism confirmed directly: `Fidelity Stocks` 2027 dividend now reads **28,416.80** — the
builder's own figure — where the mirror had been emitting it a year late.

**R7 / W2 / R5.** R7 becomes `disposal-in-base-year-*` at `info`, saying what actually happens
(the sale executes, proceeds land in opening cash, CGT falls the year after); the original claim
survives only for a disposal before the *base* year, which prod has none of. W2 reports the worst
year instead of a sum. R5's loss branch says the engine applies no offset. **Three tests that
pinned the wrong claims were rewritten, not deleted** — W2's now uses prod's real SRQ rows, so it
fails against the old code with exactly the figure the owner was shown.

**The sweep audit CSV** is written after the convergence loop from the committed run, and gained
the `Shortfall` column the header never had (`sweepLog` always carried the field). Verified on dev:
the CSV's 114,652.46 / 970,915.88 now match the committed `Cash Shortfall` entries to the cent, and
2062 reports `shortfall` rather than a `sweep_out` that never happened. `rebalanceEntries` is also
now taken from the committed run (§6 F8).

**Gate:** 839 backend · 466 frontend · 8/8 e2e · lint 0 errors · six ratchets · no migration.

### Deployed to prod 2026-08-09

D1 changes the engine's **output**, so — unlike CR075, where it changed the input — a deploy alone
still moves nothing until the stored entries are rebuilt. All five scenarios were regenerated after
the deploy (backup `fin_backup_20260809_024702.dump`).

Prod's pre-regenerate state was **exactly** the §2 corrected figures, confirming nothing had drifted
between the dev measurement and the deploy. After regenerating, **prod's entry fingerprint is
byte-identical to dev's measured post-D1 state** (`b3e6684b…`), so the prediction did not merely
match at the horizon — it matched at every row of every year of every scenario:

| scenario | before | **prod now** | delta |
|---|--:|--:|--:|
| 2026 Base | 4,398,897.74 | **4,442,680.51** | **+43,782.77** |
| 2026 Buy Business | 9,474,619.81 | **9,518,357.56** | +43,737.75 |
| 2026 Downside | 1,881,988.37 | **1,937,949.90** | +55,961.53 |
| 2026 Upside | 7,733,471.04 | **7,777,204.75** | +43,733.71 |
| 2026 SRQ House Purchase | −829,507.74 | **−783,304.50** | +46,203.24 |

Prod is **idempotent** (two consecutive regenerates byte-identical). Unlike CR075's deploy, nothing
else rode along: no un-regenerated owner edits were pending, which is why the before-state matched
the prediction exactly and the decomposition needed no unpicking this time.

The audit trail now agrees with the entries on prod — SRQ's CSV reports
`2062 shortfall … Shortfall 970,915.88` against a committed `Cash Shortfall −970,915.88`, where
before the deploy it would have claimed a `sweep_out` landing at exactly 200,000.00.

## 9. Not verified

D3, D4 and D5 are recorded from worked arithmetic against the audit CSVs and stored entries, and
were **not** independently re-derived here — they are the three to re-check before acting.
No page was driven in a browser; §2's figures come from the app's own exported functions against
the live API, which is the same code path but not the same as a screenshot.

---

## 11. Step 4 — the growth hint, R10, and the question it leaves the owner

### The hint said the opposite of the arithmetic

`FCModulesStreams.jsx` read *"Blank = 1 = inflation. 0 = flat in today's money."* The engine is
`pct[i] = inflation × mult`, compounded on the prior level — so **1** is what holds its value in
today's money and **0** freezes the *cash* amount, shedding ~2.5%/yr in real terms. Both clauses
were backwards. It now reads:

> Blank = 1 = keeps pace with inflation, so it holds its value in today's money. 0 = the same cash
> every year, which buys less each year. 0.5 = rises at half inflation, so it still shrinks in real
> terms.

The third clause is the one that matters, because sub-1 is where the live data sits.

### R10 — a multiplier that reads like a typed percentage

`growth_rate` is a multiplier of inflation, and nothing checked its magnitude. Prod's real
distribution across valuation modules:

| growth_rate | modules | |
|---:|---:|---|
| −20 | 5 | **`OCME Sp. z o.o.` — a 13× outlier, read as −50%/yr** |
| −1 … 1.5 | 105 | everything else |

`OCME` decays 56,500 PLN to 113 by 2032 and nothing said so. The only plausible reading is a
percentage typed into a multiplier box. R10 fires at `|growth_rate| ≥ 5` — set well clear of 1.5,
the largest value legitimately in use, so it cannot fire on a real choice while still catching a
two-digit typo. **Verified against prod: exactly 5 firings (`OCME`, once per scenario), 105 modules
silent.** A flow module is exempt: it has no valuation to grow.

### ⚠️ Open for the owner — the multipliers were chosen against the wrong hint

The hint is fixed; the numbers entered while it was wrong are not. Every amount stream on Base:

| multiplier | streams | what it now means |
|---:|---:|---|
| blank (= 1) | 8 | tracks inflation |
| 0.0 | 1 | `Tax` — deliberate, the stream ends at 2027 anyway |
| **0.25** | 1 | **`Social Security`** — 0.625%/yr against a statutory full-CPI COLA |
| **0.5** | 1 | **`Purchases`** — sheds ~36% of purchasing power by 2062 |
| **0.8** | 2 | `Total Salary`, `Travel` — ~17% |
| **0.9** | 2 | `Car Expenses`, `New Business` |
| 1.0 | 6 | tracks inflation |
| 1.1 | 1 | `Healthcare` — above inflation, which is the conventional assumption |

`Healthcare` at 1.1 and `Tax` at 0 look deliberate. **`Social Security` at 0.25 is the one to check
first** — statutory COLA is full CPI, so 0.25 is hard to justify as an assumption and easy to
explain as "0.25 read as *a quarter of the way to inflation-proof*" under the old wording. The
sub-1 expense multipliers are defensible as a real-terms belief that spending falls with age, but
they should be a stated belief rather than a side-effect of the label.

This is a data question, not a code one: changing any of them **moves numbers** and needs the §8
step 6 gate.

---

## 12. Step 5a — D7, a missing inflation rate now fails loud

`buildRates` returns `entries[0]?.Rate ?? 0`, so a scenario with no inflation row silently produced
**0% for the whole horizon**. That is not "a scenario with no inflation": since CR072 §8 a module's
growth is `growth_rate × inflation` and a yield is `inflation + spread`, so zero inflation stops
every asset appreciating, every yield paying and every stream escalating — 36 years of a plan
quietly flat-lining, with no error and a page that renders perfectly.

The asymmetry is the argument for fixing it: **the FX path already fails loud on exactly this
shape**, and FX moves far less of the model than inflation does. The four assumption documents key
scenarios **by name**, so a rename is one edit away from this state — which is also the realistic
shape of the bug, and what the test seeds.

`loadScenarioConfig` now throws when the scenario has no inflation row, and separately when a rate
is non-numeric (which `Number()` would otherwise read as 0). The message names the scenario and
points at Forecast Settings, because a guard the owner cannot act on is half a guard.

**A rate of 0 is a REAL rate and is deliberately allowed through** — deliberate zero inflation is a
legitimate thing to model, and conflating absence with zero would make the guard refuse a valid
plan. That test is also the falsification: it returns `[0,0,0,0]`, which is exactly what the old
code produced for an *absent* rate, so the pair demonstrates the distinction the guard creates.

**Moves nothing:** all five scenarios regenerated on dev came back byte-identical
(`b3e6684b…`). All five prod scenarios and the e2e seed carry an inflation row, so nothing live is
in the refused state. 845 backend across 61 suites.

---

## 13. Step 5b — D8, the base year now reads the rate declared for it

`buildRates` builds its series from **PeriodStart**, so a row dated **PeriodStart − 1** survived
only as the loop's seed and was overwritten on the first iteration whenever a PeriodStart row also
existed. But the frame's first column **is** PeriodStart − 1 (`index.js: buildColumns` →
`result[0] = years[0] - 1`), so the base year was reading an assumption the owner never declared
for it.

`2026 Downside` declares **FX 2026: PLN 3.9** and **FX 2027: PLN 4.5**, and the engine struck the
**2026** column at 4.5 — the 2026 declaration was inert. The other four scenarios declare a single
2026 row, which carries forward, so they were never affected.

`loadScenarioConfig` now resolves `scenario.BaseYearRates` (inflation · PLN · EUR) with
`rateAtYear`, the same step-function walk `buildRates` uses, and the two `idx < 0` sites consume it
— the builder's FX loop and growth series, and **the convergence loop's mirrors of both**, because
that loop overwrites the builder's rows and a difference there would be [§10](#10-shipped-in-v3200-2026-08-09)'s
D1 all over again in the FX column. A year with nothing declared for it keeps the old
backwards-carry, which is the no-change guarantee for the other four scenarios.

**Inflation gets the same treatment though nothing moves today** — every scenario declares a single
inflation row. It is not defensive padding: `fcbuilder-module.js`'s own comment argues CR072 §8 was
right *because* inflation is declared for 2026, and that argument dies the moment a 2027 row is
added. The latent half is closed with the live one.

### Measured, engine proven idempotent

| scenario | before | after | delta |
|---|--:|--:|--:|
| Base | 4,442,680.51 | 4,442,680.51 | **0.00** |
| Buy Business | 9,518,357.56 | 9,518,357.56 | **0.00** |
| Upside | 7,777,204.75 | 7,777,204.75 | **0.00** |
| SRQ House Purchase | −783,304.50 | −783,304.50 | **0.00** |
| **Downside** | 1,937,949.90 | **2,050,287.01** | **+112,337.11** |

Exactly the scenario predicted, and nothing else — to the cent.

**The mechanism is exact.** Every PLN module's 2026 value scales by **4.5 / 3.9 = 1.153846**:
`United Beverages` 3,250,000 → 3,750,000, `Barkeria` 888,304.85 → 1,024,967.14, `PL - Niemena`
976,589.35 → 1,126,833.87.

**The clincher:** all five scenarios now report the SAME 2026 value for `Barkeria`
(**1,024,967.14**), where Downside alone used to read 888,304.85. That is the correct shape — the
five scenarios declare the *same* 2026 FX, so their base years must agree, and Downside's stress
belongs in 2027 where it is declared. A scenario should diverge from the year its assumptions
diverge, not a year early.

**Gate:** 849 backend across 61 suites, engine idempotent (two regenerates byte-identical).

### Deployed to prod 2026-08-09 as v3.21.0

Backup `fin_backup_20260809_140647.dump`. Prod's pre-regenerate state was exactly the post-v3.20.0
figures, and after regenerating **prod's fingerprint is byte-identical to dev's**
(`589830961ece…`) — so the prediction held at every row, not just at the horizon. Prod idempotent
across two further regenerates.

| scenario | before | **prod now** | delta |
|---|--:|--:|--:|
| Base · Buy Business · Upside · SRQ | — | unchanged | **0.00** |
| **2026 Downside** | 1,937,949.90 | **2,050,287.01** | **+112,337.11** |

Shipped alongside §11's step 4 (the growth hint and R10) and §12's D7, neither of which moves a
number — so this regenerate carried exactly one number-moving change, which is the property CR075
§10 warned was lost when two landed together.
---

## 14. Step 6a — D2, the sweep's opening cash is now the canonical balance

The sweep read the `closing_balance` **column** off each account's latest transaction. Every other
balance in Fin is `opening_balance + Σ(amount)` from `opening_balance_date` — `services/reports.js`
says so, and its own comment calls the column approach *"prone to stale PS data"*. The sweep was
the last reader still on the old method, and it is the one whose number rides all 36 years:
`startingCash` is what the sweep pins its band to, every year.

**Measured on prod at 2025-12-31 — 12 of 17 bank accounts agree exactly, 5 do not:**

| account | sweep read | the book says | |
|---|--:|--:|---|
| `PKO EUR` | **−4,848.85** EUR | **+151.15** | the sign is simply wrong |
| `PKO TFI` | *(no row)* | 6,000.00 PLN | no `closing_balance` anywhere, so it counted as **zero** |
| `PKO` | 69,013.28 | 81,390.57 PLN | +12,377.29 |
| `PKO Savings` | 183,965.69 | 186,292.43 PLN | +2,326.74 |
| `Wise - USD` | 1,327.45 | 1,545.76 USD | +218.31 |
| `WISE - EUR` | 598.41 | 104.93 EUR | −493.48 |

Totals: **358,267.30 vs 369,544.23 — a gap of 11,276.93**, which is exactly the constant offset the
Review's Bank Accounts row carried in *every year of every scenario*. And `fcWarnings` W1/W4 judge
"cash below the low band" against that series, so a warning rule was being fed the wrong input too.

**The app was never wrong here either** — it seeds from the canonical balance report. That is why
it displayed 211,276.90 against a 200,000 band while the engine held 200,000. After the fix the two
agree: **the bank row now reads 199,999.92–200,000.01, the band itself.** That agreement is the
verification, not the delta.

Extracted to `crud.getOpeningBankCash` so it could be **tested against seeded rows rather than
asserted** — six DB-backed cases, each seeding an account whose stored `closing_balance` is wrong,
so the old implementation fails them by construction. The CR024 `balance_from_feed` override is
deliberately not replicated (0 accounts in this tree carry it), and currency comes from the account
(verified: 0 bank transactions carry a different one).

**The extraction caught its own regression.** Making `startingCash` a `const` broke CR075's
`startingCash += correctedBaseYearDelta` — and the DB-backed transactionality suite failed with
*"Assignment to constant variable"*. Five tests that exist for a different reason caught it before
it reached a measurement.

| scenario | before | after | delta |
|---|--:|--:|--:|
| Base | 4,442,680.51 | **4,459,563.37** | **+16,882.86** |
| Buy Business | 9,518,357.56 | **9,535,950.30** | +17,592.74 |
| Downside | 2,050,287.01 | **2,074,699.78** | +24,412.77 |
| Upside | 7,777,204.75 | **7,794,060.94** | +16,856.19 |
| SRQ House Purchase | −783,304.50 | **−758,384.65** | +24,919.85 |

All five rise, which is the right direction: the seed rose 11,276.93 and compounds. Engine
idempotent; the extraction itself verified byte-identical to the measured fix. 855 backend across
62 suites. **Not yet deployed.**
---

## 15. Step 6b — D3, the USD cost basis is carried, not re-translated

### ⚠️ This one needed an owner decision first, and the review's own figure rested on it

The reported mechanism was confirmed exactly: `baseValuesUSD` was `baseValues.map(v => v / fxrates[i])`,
so a foreign asset's cost basis was **restated at every year's rate**.

But *"over-taxed by 51,659"* did **not** follow automatically. The engine computes the gain **and
the tax** in local currency and converts the tax at the sale-year rate — which is **correct** if
the gain is taxed where the asset is. It is wrong only for a **USD-functional** taxpayer, where
basis is fixed in USD at acquisition. That is a tax-position question, not a bug, and picking the
wrong answer would have produced an authoritative wrong tax number — the exact failure this CR
exists to stop. **§9 flagged D3 as unverified for good reason.**

**Owner decision, 2026-08-09: USD-functional (US person, worldwide gains).** The engine's own tax
comment already assumed it — UB's dividend is described as *"paid net of Polish tax… while a future
sale of the business is still a normal capital gain at the full rate"*, and a US capital gain is
measured in USD.

### What changed

The USD basis is now walked through **the same recurrence as its local-currency twin**: initial
basis at the module's own acquisition rate, each contribution at the rate of the year it is made,
and releases pro-rata on the same fraction (the fraction is currency-independent — both its terms
are LC). The realized gain becomes `proceeds at the SALE rate − basis at the ACQUISITION rate`.

Capital-gains tax is accumulated in USD and folded back into the local-currency audit column at the
paying year's rate, so both tax rows describe the same payment. **Income tax stays in local
currency** — it is earned and taxed there year by year, which is why the stream override exists.

The base-year `baseValuesUSD[0]` pin is removed: it existed only to undo the restatement, and is
now redundant when nothing happens in the base year and *wrong* when something does.

### Verified on the mechanism, not just the total

`United Beverages` in Downside, 2036 disposal — proceeds **unchanged** at 2,555,418.34:

| | old | new |
|---|--:|--:|
| USD basis | 4,000,000 / 4.5 = **888,889** | **1,113,492** (at its stored 3.5923) |
| gain | 1,666,529 | 1,441,926 |
| 2037 tax | **−399,658.41** | **−347,999.69** |

**−51,658.72**, matching §4's predicted 51,659 to the cent, and 23% of the 224,603 of basis that
had been disappearing.

| scenario | before (post-D2) | after | delta |
|---|--:|--:|--:|
| Base | 4,459,563.37 | **4,575,988.58** | +116,425.21 |
| Buy Business | 9,535,950.30 | **9,652,386.21** | +116,435.91 |
| **Downside** | 2,074,699.78 | **2,467,223.65** | **+392,523.87** |
| Upside | 7,794,060.94 | **7,910,476.34** | +116,415.40 |
| SRQ House Purchase | −758,384.65 | **−641,945.18** | +116,439.47 |

**Downside moves 3.4× the others, and that is the coherence check.** It is the only scenario whose
FX assumption moves (3.9 → 4.5), so it is where basis erosion was worst. The other four still move
~116,4xx because their basis was ALSO being restated — from the acquisition rate of **3.5923** to
the scenario assumption of **3.9**, a 7.9% haircut on every foreign basis with no FX change in the
scenario at all. That is the same boundary the review recorded as an unlabelled −536,862
revaluation between the 2025 and 2026 columns.

**Gate:** 855 backend across 62 suites, engine idempotent. **Not yet deployed.**
---

## 16. Step 6c — D4, the base year's income tax follows the budget

CR075 made year −1 the budget. The base-year income-tax block went on taxing `stream.amount`, the
**typed** figure — so the income and the tax charged on it came from different sources. That is the
divergence CR075 §1 named and only half closed.

Only **two streams** reach this block on prod, and each owns its FC line outright (verified:
`streams_on_line = 1`), so the line's budget *is* that stream's base-year income and no
apportionment is needed today:

| module | typed | in USD @3.9 | 2026 budget | gap |
|---|--:|--:|--:|--:|
| `Barkeria Sp. z o.o.` | 260,518 PLN | 66,799 | 66,799 | **0** — its budget was derived from the typed amount |
| `United Beverages` | 500,000 PLN | 128,205 | **192,266** | **64,061** |

At 23% that is **14,734** of tax the plan was not charging. Verified after the fix: UB's 2027 tax
reads **−44,221.09**, which is 192,265.63 × 23% exactly, against 29,487.18 before — a difference of
**14,733.91**.

The budget is USD (`base_amount`, at the budget's own recorded rates), so this tax joins the gains
tax in a USD accumulator rather than being converted out of local currency. **Forecast-year income
tax is untouched** and stays in local currency — it is earned and taxed there year by year, which
is what the stream-level override exists for. The map is read **once**, before the module loop, and
reused for the opening-cash fold, so there is one read and one source. Apportioned by claimant
count so a shared line cannot be claimed twice.

**No budget on the line ⇒ falls back to the typed amount.** R9 already reports a module implying
base-year money the budget does not carry, so the gap stays visible rather than becoming silently
untaxed.

| scenario | before (post-D3) | after | delta |
|---|--:|--:|--:|
| Base | 4,575,988.58 | **4,539,146.37** | **−36,842.21** |
| Buy Business | 9,652,386.21 | **9,614,666.38** | −37,719.83 |
| Downside | 2,467,223.65 | **2,402,838.34** | −64,385.31 |
| **Upside** | 7,910,476.34 | **7,910,500.67** | **+24.33** |
| SRQ House Purchase | −641,945.18 | **−691,185.51** | −49,240.33 |

**The first fix in this CR that REDUCES net worth**, which is the coherence check: it charges tax
that was being missed.

**Upside barely moves, and that is the sharpest verification of all.** Its UB stream is typed
**750,000 PLN**, not 500,000 — and 750,000 / 3.9 = **192,308**, which already matches the 192,266
budget. The owner had hand-corrected that scenario at some point. So D4 has nothing to correct
there, and the residual +24.33 is the tail of a 42 USD difference taxed and compounded. **The
effect is exactly proportional to how far each scenario's typed amount had drifted from the
budget.**

**Gate:** 859 backend across 62 suites (4 new), engine idempotent. **Not yet deployed.**
---

## 17. Step 6d — D5, the sale year is halved once

The Full-disposal block halved every stream in the sale year unconditionally. That was too often
in **two independent ways**, and the second was not in this CR's original write-up — it came out of
the balance-sheet review and lands on the same line:

**(a) The CR046 window may already have halved that index.** The acquisition gate twenty lines
above guards against exactly this and says why — *"Don't halve a year the CR046 window already
halved — that would leave 25%"* — and the disposal path had no such check. `Sarasota House` carries
a 45,000 expense windowed to 2048-07-01 **and** a Full disposal on the same date.

**(b) An MV-driven stream is already half by construction.** The disposal block sets
`marketValues[dispIdx] = 0`, and a yield is `avg(mv[i], mv[i−1]) × rate` — so the average **is** the
half-year figure. Halving again leaves a quarter year. The fix reuses the same `gateable` predicate
the ownership gate uses, so the acquisition and disposal sides cannot drift apart.

**Both verified against prod, both exactly 2×:**

| | old | new |
|---|--:|--:|
| `CVC Fund VIII` 2033 dividend (Base) | 3,462.52 | **6,925.05** |
| `Sarasota House` 2048 Property Costs (SRQ) | −19,367.68 | **−38,735.36** |

The second matches §4's predicted 19,368 / 38,736 to the cent.

| scenario | before (post-D4) | after | delta |
|---|--:|--:|--:|
| Base | 4,539,146.37 | **4,549,680.38** | +10,534.01 |
| Buy Business | 9,614,666.38 | **9,625,231.32** | +10,564.94 |
| Downside | 2,402,838.34 | **2,415,406.48** | +12,568.14 |
| Upside | 7,910,500.67 | **7,921,032.53** | +10,531.86 |
| **SRQ House Purchase** | −691,185.51 | **−707,276.47** | **−16,090.96** |

**SRQ moves the opposite way from the other four, and that is the check.** The two halves of the
fix push in opposite directions: (b) raises yield income in a sale year, which lifts every scenario
holding the CVC funds; (a) raises an expense that was being under-charged, and `Sarasota House`
only exists in SRQ. A single fix producing one sign everywhere would have been the suspicious
result here.

**Gate:** 862 backend across 62 suites (3 new, each falsified against the old behaviour — the
window case returned 25 instead of 50), engine idempotent. **Not yet deployed.**
---

## 18. Step 6e — D6, a capital loss offsets a same-year gain

`fcbuilder-module` taxes `realizedGainUSD > 0` and drops anything negative, per module, with no
netting and no carry-forward. Live in all five scenarios in 2026: `SP - Panorama Mar 4` disposes at
a gain and is taxed, while `SP - Sea Senses` disposes at a **loss on the same day** and the loss is
worth nothing. For a US person that is simply wrong — losses offset gains.

Done as a **scenario-level pass**, because an offset is a fact about two modules at once and
`computeModule` is per-module and pure. It is **additive**: a credit on `Taxes` keyed to a
synthetic `_gain_netting` module, so no module's arithmetic is rewritten and the adjustment shows
on its own line instead of being buried inside a module's tax.

**Bucketed by rate**, which is the one real judgement here: netting a gain taxed at 23% against a
loss that would have relieved 30% would invent a number, so like relieves like. A 0%-rate module
(`US - Nokomis`) neither pays nor absorbs — otherwise its untaxed gain would consume relief the
owner is entitled to elsewhere. Capped at the smaller side, so relief can never exceed the tax
actually charged. Deferred a year, exactly as the gains tax it adjusts.

On prod data it produces **one credit of 8,679.67 in 2027, in every scenario**. That is larger than
§4's estimate of 7,368 — and correctly so: that figure predated D3, and once the basis is held at
its acquisition rate the USD loss on `Sea Senses` is bigger (basis 420,302 against proceeds
391,389) than the naive EUR-converted one.

### ⚠️ It reintroduced the exact bug D2 had just closed, and the band caught it

The first implementation wrote only the `Taxes` row. The Review derives its bank balance from
Income + Expense + Transfers, so it saw the relief; the engine's sweep reads `cashDeltaByYear` from
**`Bank Accounts`** rows, so it did not. The bank line read **208,679.67** against a 200,000 band —
an engine-vs-app split of exactly the credit.

A module writes its P&L row **and** a matching cash row (`Fidelity Stocks` 2028: income 28,416.80 −
tax 8,317.11 = cash 20,099.69). The netting now does the same. **Checking the bank line against the
band is the cheapest possible test that the engine and the app still agree**, and it is worth doing
after every one of these changes.

| scenario | before (post-D5) | after | delta |
|---|--:|--:|--:|
| Base | 4,549,680.38 | **4,571,404.45** | +21,724.07 |
| Buy Business | 9,625,231.32 | **9,647,451.85** | +22,220.53 |
| Downside | 2,415,406.48 | **2,442,857.61** | +27,451.13 |
| Upside | 7,921,032.53 | **7,942,686.16** | +21,653.63 |
| SRQ House Purchase | −707,276.47 | **−678,505.22** | +28,771.25 |

**NOT a carry-forward.** `OCME`'s 2045 loss still relieves nothing, because its only companion gain
is in a different year. Real tax rules would carry it — that is a separate decision, involving
rules the owner would have to maintain, and §7 is the place for it.

**Gate:** 870 backend across 63 suites (8 new, pinning the bucketing rules rather than re-testing
the engine around them), engine idempotent. **Not yet deployed.**
---

## 19. Deployed to prod 2026-08-09 as v3.22.0 — and the three owner edits it had to be untangled from

Backup `fin_backup_20260809_150150.dump`. **Prod's pre-regenerate state did NOT match the
prediction**, and stopping to find out why was the whole value of the exercise.

Four scenarios sat exactly where v3.21.0 left them. **`2026 Base` did not** — 4,377,029.95 against
an expected 4,442,680.51. Its inputs had changed. Three edits to `OCME Sp. z o.o.`, made through
the UI and regenerated on Base alone:

| # | edit |
|---|---|
| 1 | `growth_rate` **−20 → −30** |
| 2 | its **2045 Full disposal deleted** |
| 3 | a **100,000 PLN OneTime investment added at 2026-07-01** |

The first diff caught only #1, because it compared too few columns. #3 — a base-year investment,
and therefore a cash outflow that feeds opening cash and rides the horizon — is what the −65,650
actually was. **A narrow diff is worse than none: it produces a confident, incomplete answer.**

### The four variants were stale, and a regenerate was always going to move them

`2026 Buy Business`, `Downside`, `SRQ` and `Upside` are CR050 **variants of Base**, materialised
from base ⊕ overrides at generate time. Base was edited and regenerated; the variants were not. So
prod held a Base carrying the edits and four variants that did not, and **the next regenerate for
any reason would have propagated them** — arriving as an unexplained ~65–85K drop per scenario
alongside whatever else prompted it. That is CR075 §10's hazard with an extra step.

### The decomposition

All three edits were replayed onto dev, dev proven idempotent, and **prod's fingerprint after
regenerating matched dev's byte for byte** (`1431ac99…`), so the split below is measured, not
inferred:

| scenario | prod before | **CR076 D2–D6** | the owner's 3 edits | **prod now** |
|---|--:|--:|--:|--:|
| 2026 Base | 4,377,029.95 | **+129,159.68** | *(already in the before)* | **4,506,189.63** |
| 2026 Buy Business | 9,518,357.56 | +129,094.29 | −65,642.57 | **9,581,809.28** |
| 2026 Downside | 2,050,287.01 | +392,570.60 | −82,222.59 | **2,360,635.02** |
| 2026 Upside | 7,777,204.75 | +165,481.41 | −63,968.06 | **7,878,718.10** |
| 2026 SRQ House Purchase | −783,304.50 | +104,799.28 | −84,678.33 | **−763,183.55** |

Base's whole movement is D2–D6, because its inputs were identical on both sides. The four variants
mix the two, and are split using the dev measurements at each input state.

All five bank lines land on the sweep's band (199,999.97–200,000.19) — the engine-vs-app check §18
earned.

### ✅ Owner decision 2026-08-09: `OCME` at −30 is DELIBERATE

Asked and answered — the business is expected to collapse and the 100,000 PLN contribution is
being written off on purpose. **No code change.** R10 goes on flagging it, which is correct: the
rule cannot tell a deliberate write-off from a percentage typed into a multiplier box, and it
should not try. The owner dismisses it in the Cash Health panel, and CR074's fingerprint brings it
back if the value ever changes — an accepted judgement, behaving exactly as CR074 §1 intended.

**This is the R10 warning earning its keep in the other direction:** it surfaced a number for a
decision, the decision was made, and the record is now explicit rather than tribal.

### The arithmetic, for the record: `OCME` at −30

`growth_rate` is a **multiplier of inflation**, so **−30 is −75%/yr**. The live path on prod:
29,263 USD in 2026 (after the new contribution) → 7,316 in 2027 → 457 in 2029 → 0 by 2034. For a
true −30%/yr the multiplier would be **−12** at the current 2.5% assumption; −20%/yr would be −8.
The module also now has **no disposal**, so it is held to the horizon rather than sold.