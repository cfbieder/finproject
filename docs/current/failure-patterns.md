# Failure patterns — the mistakes this project keeps making

Not a list of bugs. A list of the **shapes** bugs here take, kept because each one was found more
than once, and because every instance passed the gates that were supposed to catch it.

Lifted out of [status.md](status.md) on 2026-08-09, when the table reached eight rows and the
snapshot went 135 lines against its own ≤60 budget. Status links here; this file grows, status
does not.

---

## 1. A restatement asserted as the engine's behaviour — found EIGHT times

Someone writes a rule, a comment, a warning sentence or a figure that asserts what the engine does,
derived from a **paraphrase of it** rather than from the formula or the real input.

| | claimed | what was true |
|---|---|---|
| [CR071 §8](../cr/cr-071-forecast-numbers-vs-intent.md) | R5: "sold without realizing any gain" | 334,294 realized — wrong on **30 of 35** modules |
| [CR075 §5](../cr/cr-075-base-year-is-the-budget.md) | R7 compared against PeriodStart | it was handed PeriodStart−2 — **20 disposals** silently missed |
| [CR075 §1](../cr/cr-075-base-year-is-the-budget.md) | the base year was the budget | it was the modules' typed stream amounts |
| [CR073](../cr/cr-073-two-recurrence-guards.md) | the LIST and DETAIL projections agreed | they drifted three times in three days |
| [CR076 §2](../cr/cr-076-forecast-model-review.md) | a SQL roll-up gave net worth | it read a **flow** (`Bank Accounts`) as a **stock** — five published figures wrong by up to 894K |
| [CR076 D1](../cr/cr-076-forecast-model-review.md) | one growth formula | **two copies** of it, drifted since CR072 §8 — and the mirror wrote last (−39,715) |
| [CR076 §3](../cr/cr-076-forecast-model-review.md) | R7's *sentence*, after CR075 fixed its input | false on all 20 rows it fired on — the engine indexes disposals against the **module's** base year |
| [CR076 D4](../cr/cr-076-forecast-model-review.md) | base-year income and the tax on it | income came from the budget, the tax from the typed amount |

**Why it survives review:** the restatement is usually *true of something* — an earlier version, a
neighbouring code path, a different jurisdiction — so it reads as correct to anyone who has not put
it beside the formula.

**The counter-practice:** quote the engine line (`file:line`) beside the claim, and check the
**input the code actually receives**, not the parameter's name. R7 was fed a value whose variable
was called `periodStart` and was not PeriodStart.

## 2. Warning rules tested for FIRING, never for TRUTH — 5 of 8 found wrong

Every gate passed each time, because each test asserted that a warning appeared, and none asserted
that its sentence was true. Three were still wrong after their *inputs* had been fixed.

**Counter-practice:** assert the copy against real rows — and where a rule reports a quantity,
assert the quantity. `unfunded-shortfall` summed a figure that is cumulative by construction and
showed $1.2M for a 1,017,119 gap.

## 3. The before/after gate cannot see a wrongly-derived number

Measuring the same figure before and after a change, on an engine first proven idempotent, is the
project's strongest gate and has caught every regression it was pointed at. But **it compares a
number to itself**, so a figure that was wrong in both runs passes silently — which is exactly how
CR076 §2's five published figures survived it.

**Counter-practice:** derive the headline figure through the **app's own exported functions or the
engine**, never a SQL re-derivation written for the occasion. And check an independent invariant:
the Review's bank line must sit on the sweep's band. Engine and app compute cash by different
routes, and that single number caught two separate divergences ([CR076 §14](../cr/cr-076-forecast-model-review.md), §18).

## 4. Two copies of one formula

`fcbuilder-module` builds the market-value series; `index.js`'s convergence loop rebuilt it and
then **overwrote the builder's rows**, so the stale copy won. Same shape as CR073's two projections
and CR049's hand-copied base-year query.

**A hand-maintained COLUMN LIST is the same shape**, and it has now failed twice on one column:
CR078's `disposal_cost_pct` was dropped by the **variant sync** (fixed v3.25.2) and, a day later,
found dropped by **`copyScenario`** — the other list, never updated. The copy therefore reported the
**full** sale proceeds, so a copied scenario read *better* than its original, and it was caught only
because a scratch copy measured ~890K better than its source for no modelled reason *while being
used to measure something else*. CR064 P6's sweep of hand-kept lists is the same family.

**Counter-practice:** one implementation, called from both sites, plus a test that fails if either
re-derives it. `growthPctForYear` and `getOpeningBankCash` are the two that now exist. Where a list
genuinely must be enumerated, **do not test it by enumerating it again** — derive the expectation
from the source of truth: `copyScenario.columns.test.js` reads `information_schema` and asserts the
copy round-trips every column, so the next column added is covered by a test nobody edits.

## 5. A test whose fixture cannot exhibit the bug

- A UI test whose mock returned **zero rows** passed while the modal crashed the page on the first
  row it rendered.
- A base-year test that "passed" because no budget row existed, not because a window was honoured —
  it would have gone on passing after the behaviour it pinned was deleted.
- An ambient-data test agrees with production only while production happens to agree.

**Counter-practice:** seed the state that exhibits the defect, and **falsify the test against the
unfixed code** before keeping it.

## 6. Proof of absence from a search that did not cover the file

A `head -20`-truncated grep, plus a browser probe that printed nothing, led to two working buttons
being recorded as "never built".

**Counter-practice:** absence needs a search that provably covered the whole file, and a negative
result that is distinguishable from a failed lookup.

## 7. A label that states the opposite of the arithmetic

The stream growth hint read *"0 = flat in today's money"* while the engine compounds at
`inflation × mult`, making **1** flat in today's money and **0** shrink in real terms. **70 of 110**
streams carry a multiplier that may have been chosen against it.

**Counter-practice:** a field whose unit is not obvious states its unit *and* an example, and the
example is checked against the formula. Neighbouring hazard: a value 13× outside every other row
(`OCME` at −20) should be caught by a rule, not by a reader.
