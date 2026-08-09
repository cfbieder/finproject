# CR076 — The forecast model review, and the figures it corrected

**Status:** OPEN — findings recorded, fixes sequenced below · **P0 (§2) is a documentation correction and is already applied**
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

1. **§2 — correct the published figures.** Docs only. *(applied)*
2. **D1**, then **R7 / W2 / R5** copy. One line and three sentences; all visibly wrong today.
3. **Rewrite the sweep CSV after convergence.** An explanation contradicting the warning beside it
   is worse than either alone.
4. **§5's growth hint**, then revisit the 70 multipliers with the owner.
5. **D7 / D8** — fail loud on a missing inflation row; honour a PeriodStart−1 assumption.
6. **D2, D3, D4, D5, D6** — each moves numbers and needs CR075's before/after gate on an engine
   first proven idempotent. Not more than one at a time.

## 9. Not verified

D3, D4 and D5 are recorded from worked arithmetic against the audit CSVs and stored entries, and
were **not** independently re-derived here — they are the three to re-check before acting.
No page was driven in a browser; §2's figures come from the app's own exported functions against
the live API, which is the same code path but not the same as a screenshot.
