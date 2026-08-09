# CR075 — The base year is the budget

**Status:** COMPLETED — **v3.19.0 (2026-08-08)** · ⚠️ **MOVES FORECAST NUMBERS** (owner sign-off via `/close`) · no migration
**Track:** v3
**Origin:** owner, 2026-08-07 — *"On Forecast module in budget year 2026 why are CVC, Dividend and
Interest Income all zero?"*, then *"To be clear forecast year −2 = ACTUAL, forecast year −1 =
BUDGET, forecast year 0 = start forecast."*

---

## 1. The question, and what was behind it

Three income lines read **zero** in the 2026 column while 2025 showed real money:

| line | 2025 actual | 2026 shown | 2026 budget |
|---|--:|--:|--:|
| CVC Dividend | 21,860 | **–** | 41,000 |
| Dividend Income | 52,532 | **–** | 42,000 |
| Interest Income | 83,949 | **–** | 46,000 |

They are all **yield-mode** streams (CVC Fund VIII + IX, Fidelity Stocks, Fidelity Fixed Income).
A yield stream's `amount` is **0 by construction** — the card hides the box because the yield is a
rate, not a figure. And `getBaseYearValues` summed each stream's typed `amount`.

So the base year was never the budget. It was the modules' typed inputs, and it diverged two ways:

- **yield streams contributed nothing** — 129,000 of budgeted investment income over 3.3M of
  market value, reading as zero;
- **amount streams disagreed anyway** — `UB Income` carried 128,205 against a budget of 192,266,
  because a typed base-year amount is not a budget.

Income was understated by **193,071**; the net by **152,802**.

### The engine already knew this was a trap

`getBaseYearValues` carried a special branch for LOAN streams, with this reasoning:

> *"A loan's base-year expense is interest on the balance it already carries, DERIVED, so its
> stream `amount` says nothing about it… the stream amount is 0 on a derived stream by
> construction."*

Word for word true of yield streams. **The branch was written for `derived` and never extended.**

## 2. Why it was not only a display defect

`index.js` does `startingCash += budgetNCF + transfers`, where `budgetNCF` is this function's sum.
It is the **cash sweep's opening cash**, and the sweep pins cash to its band every year — so the
error rides all 36 forecast years instead of washing out.

That is the CR049 §1 failure mode for the **third** time in this one function, after the ~65K
liability-gated expense branch and the ~400K unconverted-FX one. Both of those were also found by
someone reading a base-year number that looked wrong.

## 3. What was built

`getBaseYearValues` reads **`budget_entries`, grouped by FC line**, using the same recursive CTE as
`fcLines.getBudgetTotals` — so the base-year column and the stream cards' budget reference cannot
disagree about which accounts a line covers.

Reading the budget **deletes** the machinery the two previous bugs lived in, which is most of the
argument for it:

| gone | because |
|---|---|
| the CR046 window filter + July-1 half-year | a budget entry is **dated** — six monthly rows are six months of money |
| the CR062 loan-interest derivation | budgeted interest is a budgeted row |
| the CR064 P8 per-currency conversion | `base_amount` is already USD (verified: PLN 3.227, EUR 0.860) |

Verified against the budget **line by line: 15 lines, zero mismatches, totals equal to the cent.**

### Owner decisions, 2026-08-07

**Budget only — no derived fallback.** Asked explicitly. A derived figure beside a budgeted one
double-counts the moment a line is partly budgeted, and cannot be told apart on screen. The gap is
made visible instead (§4) rather than papered over.

**The budget's own recorded rates**, not the scenario's FX assumption. 2025 actual and 2026 budget
then agree with each other, and the FX break sits where the projection begins — which is where it
belongs. The 2026 column ties to the budget report.

### A consequence worth stating plainly

`budget_entries` has no `scenario_id`. **All five scenarios now share one base year** (−137,555),
where before they differed — Upside −226,254, Downside −291,934. Those differences were never
different budgets; they were different module inputs. There is one 2026 budget, so one base year is
the correct consequence of the owner's definition. If per-scenario base years are ever wanted, that
is a different design (scenario-scoped budgets), not a tweak.

## 4. R9 — the gap is reported, not hidden

The cost of budget-only is that an unbudgeted cost reads as a real zero. The new
`unbudgeted-base-year-<module>` rule pays it: if a module says it earns or spends on a line in the
budget year and the budget carries nothing there, the Cash Health panel says so.

Keyed to catch the case that caused this CR — a **yield** stream drives base-year money despite
`amount = 0`, so a rule testing the amount alone would miss exactly what CR075 was about. A loan's
derived interest is covered the same way. A stream with **no line at all** is R6's finding and is
deliberately not reported twice.

**Silent when the budget map is absent**, which is not the same as empty: warning on every module
because a fetch failed would be worse than not warning.

On prod data it fires **zero times** — every module implying base-year money is budgeted, which is
consistent with nothing disappearing in the switch. Proven able to fire by parking `Interest
Income`'s 2026 budget on dev and watching it appear, then restoring.

## 5. ⚠️ A second bug, found by R9 printing a wrong year

R9's first render said *"Nothing is budgeted … in **2024**"*. The budget year is 2026.

`computeForecastWarnings` passed `periodStart: years[0]`. FCReview unshifts **PeriodStart−1 and
PeriodStart−2** onto `sortedYears` for the actual and budget columns, so `years[0]` is
**PeriodStart−2** — 2025, not 2027.

**R7 compares disposal dates against that value.** On prod it silently missed **20 disposals dated
2026-07-01 across all five scenarios** — `US - Nokomis`, `SP - Sea Senses`, `Tax Liabilities`,
`SP - Panorama Mar 4`, four per scenario. Every one is a **Full** disposal in the budget year that
the engine never executes, so the balance it was meant to clear stays on the books for the whole
plan, and nothing said so. That is precisely what R7 exists to catch.

Same class as [CR071 §8](cr-071-forecast-numbers-vs-intent.md#8-r5-was-wrong--owner-found-2026-08-06-fixed-in-v3181):
a rule fed a value that is not what its name says. The real `PeriodStart` is now passed explicitly,
and a test pins it. The Cash Health panel went from 13 issues to 17 on dev — the four that had been
invisible.

## 6. The measurement

> ⚠️ **CORRECTED 2026-08-09 — the LEVELS below are wrong.** See
> [CR076 §2](cr-076-forecast-model-review.md). They came from a SQL roll-up that summed
> `forecast_entries` by account, which reads `Bank Accounts` — a per-module **annual cash
> movement** — as if it were a balance. The app was never wrong; only the roll-up was.
> Base at 2062 is **4,398,898**, not 3,243,520.
> The **direction, mechanism and gate discipline of this CR stand**: before and after were measured
> by the same method on an idempotent engine, so the deltas are indicative — but they carry the
> same contamination (a comparable measurement was later shown to be off by ~4.4%), and the
> shortfall figures below are *sums of a cumulative quantity*, which double-count (CR076 §3).

Dev re-synced from prod first (it had drifted, and that drift already caused one mis-verification
this week). Engine proven **idempotent** — two consecutive regenerates byte-identical — so every
delta below is attributable to the change.

**Net worth at 2062**, balances read AT the horizon (never summed across years):

| scenario | before | after | delta |
|---|--:|--:|--:|
| Base | 2,845,816 | 3,243,520 | **+397,705** |
| Buy Business | 7,999,021 | 8,396,152 | +397,132 |
| Downside | 163,299 | 677,073 | +513,774 |
| Upside | 6,401,435 | 6,632,101 | +230,666 |
| SRQ House Purchase | −744,428 | −744,766 | −337 |

The mechanism is coherent: Base retains **+391,799** more Fidelity Fixed Income, exactly offsetting
**−391,799** of Transfer-Bank (less swept), which then earns **+341,425** more interest across the
horizon and pays **−102,428** more tax.

**SRQ** barely moves at the horizon because it is in shortfall either way — its improvement shows
in the shortfall shrinking from **−3,195,733 to −1,837,896**, starting a year later (2061, not 2060).

**Nothing disappeared** in the switch: every label present before is present after; four appeared.

## 7. The 14 tests, rewritten rather than deleted

Every failure traced to machinery removed on purpose — but that is a claim to be **proven**, not
asserted, so each was rewritten to the new contract:

- **8 × `crud.baseYearValues.currency.test.js`** → replaced by `crud.baseYearValues.budget.test.js`.
  The CR064 P8 conversion bug is not fixed, it is **structurally unreachable**; one test asserts
  `baseYearFxRate` is never called, so reintroducing a conversion fails.
- **3 × the CR046 window block** → replaced by tests of the budget contract. One of the old tests
  would still have PASSED — "rent starting 2028 is not 2026 income" returns 0 — but **vacuously**,
  because no budget row exists rather than because a window was honoured. The replacement seeds a
  module specifically to prove it is ignored.
- **1 × loan V6** → now asserts an unbudgeted loan contributes nothing *deliberately*, and that
  budgeting it makes it count at the budgeted figure.
- **2 × `generate-transaction`** → the base-year-reaches-the-sweep test now drives the budget
  instead of a module's `setup_status`; the CR048 yield test's drain was raised from 600,000 to
  2,000,000 because more opening cash meant it no longer emptied the backup. Its thresholds were
  **not** softened — the bug it catches produced a flat 35,000 every year, and a threshold that
  tolerated the new 8,288 would tolerate a partial regression too.

## 8. Gate

834 backend · 465 frontend · 8/8 e2e · lint 0 errors · six ratchets · clean build. No migration.
The R9 rule and the PeriodStart fix are pure detections — re-running the whole regenerate after
them produced output **byte-identical** to the measured delta, so they move nothing.

## 9. Shipped

Released as **v3.19.0** on 2026-08-08 with owner sign-off. Because this changes the engine's
INPUT rather than its output, a deploy alone moves nothing — prod's stored entries were generated
by the old code. **All five scenarios were regenerated on prod after the deploy**, and the result
recorded in §10.

---

## 10. Deployed to prod 2026-08-08 — and what else came with it

The deploy alone moves nothing here: this changes the engine's **input**, and prod's stored entries
were produced by the old code. All five scenarios were regenerated after it, and prod is
**idempotent** (two consecutive regenerates byte-identical).

The regenerate moved more than CR075, and the difference is worth recording because it is a hazard
this project has hit before. **Prod's stored entries were stale — 1,328 rows out of date** — because
three owner edits had been made through the UI without a regenerate afterwards:

| module | edit |
|---|---|
| `US - Nokomis` | market value 339,962.17 → **390,000.00** (cost basis unchanged) |
| `US - Nokomis` | capital-gains tax override → **0%** |
| `SP - Panorama Mar 6` | growth 0.0 → **0.5** × inflation |

So one regenerate materialised **two independent changes at once**. That is exactly the shape
recorded against roadmap Known Issue #2 — *"the cost stops being invisible, which is the right
outcome; the hazard is that it lands silently alongside whatever else prompted the regenerate."*

It was decomposed rather than reported as one number. The owner's three edits were replayed onto
the dev copy, and **dev then reproduced prod exactly on all five scenarios**, which is what makes
the split below trustworthy rather than arithmetic:

> ⚠️ **CORRECTED 2026-08-09 — the LEVELS in this table are wrong**, by the same roll-up defect
> recorded above ([CR076 §2](cr-076-forecast-model-review.md)). The **decomposition itself stands** —
> dev reproduced prod exactly on all five scenarios, which is what made the split trustworthy — but
> "prod now" understates every scenario. Correct net assets at 2062: Base **4,398,898** ·
> Buy Business **9,474,620** · Downside **1,881,988** · Upside **7,733,471** · SRQ **−829,508**.

| scenario | prod's STALE stored | recomputed, old code | **CR075** | the owner's 3 edits | **prod now** |
|---|--:|--:|--:|--:|--:|
| 2026 Base | 3,107,436 | 2,845,816 | **+397,705** | +261,569 | **3,505,089** |
| 2026 Buy Business | 6,845,456 | 7,999,021 | **+397,132** | +261,420 | **8,657,572** |
| 2026 Downside | −706,118 | 163,299 | **+513,774** | +325,485 | **1,002,558** |
| 2026 Upside | 4,933,766 | 6,401,435 | **+230,666** | +257,993 | **6,890,094** |
| 2026 SRQ House Purchase | −744,428 | −744,428 | **−337** | −947 | **−745,713** |

Every CR075 figure matches §6's dev measurement to the dollar. Net worth at 2062, balances read AT
the horizon.

**A note on `US - Nokomis`:** its market value now exceeds its cost basis, so R5 no longer reports
it at all; and `SP - Panorama Mar 6` is no longer flat, so R5 moves it from *"sold without
realizing any gain"* to *"taxed only on growth since the base date"* — the v3.18.1 branching
behaving as designed on data that changed underneath it.

**A guard proved itself on the way.** Replaying the edits on dev by raw SQL set `market_value`
without its USD twin, and the CR064 P13 currency guard refused the build with the exact sentence it
was written for. The UI sets both columns, so prod was never at risk — but the guard caught the
hand-edit that would have been.
