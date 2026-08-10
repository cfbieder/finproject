# CR079 — The plan in today's money

**Status:** SHIPPED — increments 1 and 2 on the Review at **v3.25.0 (2026-08-09)**, increment 3 on
**Compare** (§7). No migration; **no forecast number moves** — a display transform over data
already loaded, and each release verified prod's entries fingerprint **unchanged**. **Open:** the
Home hero is still nominal-only.
**Track:** v3
**Origin:** [CR076 §7 Q3](cr-076-forecast-model-review.md) — *"Everything is nominal and nothing
says so… For a plan whose whole point is a 2062 number, this is the highest-value output
addition."*

---

## 1. The gap

Every figure the forecast produces is **nominal**, and no surface says so. At 2.5% inflation,
2026 → 2062 is a **2.43× factor**:

| scenario | headline 2062 | in 2026 dollars |
|---|--:|--:|
| Base | 4,674,650 | **≈ 1,921,719** |
| Buy Business | 9,750,208 | ≈ 4,008,300 |
| Downside | 2,574,049 | ≈ 1,058,200 |
| SRQ House Purchase | −596,919 | ≈ −245,400 |

The headline is **2.4× the purchasing power it represents**, and nothing on the page distinguishes
the two.

It is also the question the owner has actually been answering. `Social Security` at full CPI versus
0.25, `Purchases` at 0.5, `Retirement Home`'s 200,000 dated 2052 — every one of those is a
real-terms judgement, made against a display that could only show nominal.

## 2. Increment 1 — the deflator (built)

`utils/fcRealTerms.js`, pure and tested:

- **`inflationRateFor`** reads the SAME step function `fcbuilder-setup.buildRates` walks — a rate
  declared for a year carries forward, and a year before the first row keeps that row's rate.
  Deliberate: a deflator built from a *different* reading of the same rows would silently disagree
  with the very numbers it deflates, which is [failure-patterns](../current/failure-patterns.md) §1.
- **`buildDeflators`** returns `year → divisor`, with the base year (PeriodStart − 1) at exactly 1.
- **Years before the base year are INFLATED**, not left alone. Same product read the other way, and
  it is what makes the 2025 actual column comparable with everything to its right. Leaving it at 1
  would put the actual in 2025 money on a page headed *"2026 dollars"*.
- **No inflation ⇒ returns null**, so the caller disables the view. A deflator of 1.0 would claim
  nominal and real are the same thing — the display-side twin of CR076 D7, which made a missing
  inflation rate fail loud in the engine for exactly this reason.
- **`toRealTerms` passes null and blank straight through.** A missing cell is not a zero, and
  inventing one is the single thing a display transform must never do.

**A test caught a real defect:** `Number(null)` is `0` and passes `Number.isFinite`, so a missing
base year silently anchored the series on **year zero** and produced deflators around 10³⁰⁰. Now
rejected before the coercion.

16 tests. `1.025³⁶` and the Base headline are both pinned, so the figure this feature exists to
show is asserted rather than described.

## 3. ⚠️ Increment 2 — the wiring, and why it is NOT half-done

**A partially deflated page is worse than a nominal one.** Some rows in today's money and some in
2062 money, under one heading, is precisely the class of silent inconsistency this whole review has
spent itself removing — and it would be *invisible*, because both look like money.

There is no single choke point. Money reaches FCReview by **four** independent paths:

| path | feeds |
|---|---|
| `getCellValue` | balance-sheet cells, and the forecast-year P&L |
| `baseYearBudget` prop | the base-year and last-actual P&L columns — `getCellValue` returns `null` for these by design |
| `balanceDisplayValues` | the Bank Accounts **running balance**, which accumulates rather than reads |
| `totalAssetsByYear` / `totalLiabilitiesByYear` / `netAssetsByYear` / `kpis` | the totals, derived from the above |

Deflating the accumulating bank series is the subtle one: it must be deflated **per year after
accumulation**, never during, or each year's addition would be divided by the wrong factor.

The base year needs no deflation at all — its factor is exactly 1, which is a useful property to
verify against rather than a coincidence to rely on.

**This wants a browser check, not just unit tests.** Every prior visual assumption in this project
has been wrong at least once, and `nested-modal.spec.js` exists because jsdom cannot see what a
page actually renders.

## 4. Open questions for increment 2

1. **Where does the toggle live** — the Review only, or Review + Compare + the KPI hero? Compare is
   arguably where it matters most, since comparing two scenarios 36 years out in nominal terms
   flatters both equally.
2. **How is the state labelled?** A toggle that can be left on is a toggle that will be
   screenshotted in the wrong state. The column headers, or a persistent banner, should carry
   *"in 2026 dollars"* — not just the control.
3. **Does it persist?** localStorage like the sidebar flag, or reset per visit. Leaning reset: the
   nominal figures are what tie to the exported spreadsheet.
4. **Excel export** — nominal only, or follow the toggle? Nominal only is safer; an exported file
   loses the banner that says which basis it is in.


---

## 5. Owner decisions, 2026-08-09

Taken one at a time before any wiring, because each changed the shape of the next:

| | decision |
|---|---|
| scope | **Review only.** It carries all four money paths, so doing it completely there proves the approach on the hardest surface. Compare reaches its numbers through a separate path (`buildScenarioMatrix`) and would have doubled the area a partial application could hide in. |
| labelling | **Banner + labelled KPIs.** A screenshot crops to the figures, not the control. |
| persistence | **Resets to nominal every visit.** Nominal is the basis the export, the audit CSVs and every figure in the docs speak, so the page agrees with its surroundings by default. |
| export | **Always nominal.** An exported file loses the banner, and money with no stated basis is the failure this whole review has been removing. |

## 6. Increment 2 — built

### Wired at the prop boundary, not inside the table

All five money paths are deflated where they are handed to `FCReviewTable`, so `FCReviewTable`
itself is untouched. Each deflated view is derived from its **nominal** memo and never chained off
another, so nothing can be deflated twice.

| path | treatment |
|---|---|
| `getCellValue` | wrapped — table cells and forecast-year P&L |
| `balanceDisplayValues` | deflated **per year after accumulation** — the running bank balance |
| `totalAssets` / `totalLiabilities` / `netAssets` / KPIs | deflated from the nominal series |
| `baseActualTotalsByYear` | the 2025 actual column, **inflated** into base-year money |
| `baseYearBudget` | **untouched** — its factor is exactly 1 |

The bank series is the one that had to be got right: it *accumulates*, so deflating during
accumulation would divide each year's addition by a different factor and produce a balance that is
nobody's money. It is deflated once, after.

### ⚠️ A naming trap, avoided rather than hit

`FCReview` already has a `baseYear`, and it is **`sortedYears[0]` = PeriodStart − 2** — the last
ACTUAL year — while `baseYears` (plural) holds PeriodStart − 1. Anchoring the deflator on the
obvious-looking variable would have deflated to **2025** money and labelled it 2026: R7's shape
exactly, a value taken from a variable whose name is not what it holds. The anchor is written as
`periodStart − 1` explicitly, with the reason recorded at the line.

### The browser check, which is why this was not shipped on unit tests alone

`real-terms.spec.js` asserts what jsdom cannot see: with the toggle on, a real money cell in the
rendered table **changes**, the banner declaring the basis **is visible with the numbers**, and
unchecking returns the cell to its original string. A page showing some rows in today's money and
some in 2062 money would look entirely normal — both are money — so "it renders" is not the
assertion; "it changes, says so, and comes back" is.

The first run **skipped**, because the Review is empty until the engine has run and the toggle
needs real years to build a deflator over. That is the graceful-degradation path working, and it
would have read as a pass on a less explicit spec.

### One more thing the tests could not see

`FCReview.css` did not exist — the page imports `PageLayout.css` only — so the new stylesheet was
**orphaned**: never imported, never loaded. Every gate passed anyway, including the browser check,
because they all assert behaviour and text rather than appearance. Caught by reading the staged
file list and noticing the file was **added** rather than modified.

Worth recording as its own small pattern: *a new stylesheet is not wired by existing.* The e2e
suite deliberately asserts values rather than styling ([test-overview](../current/test-overview.md)),
which is the right trade — but it means CSS arrives unverified and has to be checked another way.

**Gate:** 491 frontend · **9/9 e2e** (one new) · lint 0 errors · six ratchets · no migration.
---

## 7. Increment 3 — Compare, in today's money

§5 deferred this deliberately, on the reasoning that the Review carried all four money paths and
was the harder proof. That held: Compare needed **one** conversion, not four.

### One choke point, because deflation is linear

`deflateMatrix` is applied to **matA and matB before `compareMatrices`**, not to the comparison it
produces. `deflate(B) − deflate(A)` equals `deflate(B − A)`, so the two are arithmetically the same
— but converting the *inputs* means the table, the charts, the commentary and the four KPI cards
all read one already-converted set of numbers. There is no path to a partially converted page
because there is only one conversion. Converting the output would have left four call sites each
having to remember, which is precisely the shape §3 warned about.

`FCCompareAIPanel` is unaffected: it takes only the two scenario NAMES and fetches server-side, so
the LLM keeps seeing nominal figures. Compare has no Excel export, so §5's "always nominal" export
decision has nothing to bind here.

### Each scenario deflates by its OWN inflation

Not a detail — the main reason this belongs on Compare at all. If `Downside` assumed higher
inflation than `Base`, its nominal 2062 figure would be larger for a reason that has nothing to do
with the plan, and comparing the two nominally would flatter it. Today all five scenarios sit at
2.5%, so the deflators happen to coincide; the code does not depend on that.

**The anchor is shared, though.** Each scenario's own base year is its `PeriodStart − 1`, and the
two need not agree. Anchoring each on its own would put A in one year's money and B in another
while the page called both "today" — every delta then being the difference of two different
currencies. The **earlier** of the two is used for both, and the banner names it.

And it is **both or neither**: if only one side can build a deflator, none is applied. One column in
today's money beside another in 2062 money would make every delta meaningless while still looking
exactly like money.

### ⚠️ The hand-listed field set, guarded this time

`deflateMatrix` works off named fields (`MATRIX_MONEY_SERIES` / `MATRIX_MONEY_MAPS`). That is the
same construction that silently dropped `disposal_cost_pct` from the variant sync eight days of
work ago — code that keeps working and just stops covering one thing.

So `fcCompareRealTerms.test.js` asserts the lists against the keys a **real** matrix actually
carries. A new series added to `buildScenarioMatrix` fails the test **by name** rather than
rendering nominal on a page headed "2026 dollars". Verified by adding a probe field and watching it
fail with `expected [ 'tempProbeSeries' ] to deeply equal []`, then removing it — a guard that has
never failed is not known to be a guard.

The suite also pins that `deflateMatrix` does not mutate its input: FCCompare derives the deflated
view from the nominal memo on every render, and writing through would deflate an already-deflated
matrix on the second pass — producing a plausible smaller number rather than an error.

### What the browser check found

`compare-real-terms.spec.js` failed on its first real run, and the reason was worth keeping: the
e2e world has a second scenario, **`Base Case`**, which exists in `forecast_scenarios` but carries
no `PeriodStart` in the assumptions doc. It is Compare's DEFAULT baseline. With no base year there
is no honest deflator, and the toggle correctly rendered **disabled**.

That is the graceful-degradation path taken by a genuinely half-configured scenario, so the spec
now asserts **both** states — disabled on `Base Case`, enabled once A is switched to a scenario
that declares a period — rather than stepping around the default.

**Known limit, stated rather than papered over:** the seed has one *generated* scenario, so the
browser runs with A ≡ B, where every delta is zero and zero deflates to zero. The delta path is
covered by unit test; the browser covers the A/B value path.

**Gate:** 498 frontend (+7) · **10/10 e2e** (one new) · lint 0 errors · six ratchets · no migration
· no engine change, so no regenerate and no fingerprint movement.
