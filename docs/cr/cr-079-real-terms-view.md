# CR079 — The plan in today's money

**Status:** IN-PROGRESS — **increment 1 (the deflator core) BUILT and tested**; the wiring is
increment 2 and is deliberately NOT started. No migration; **no forecast number moves** — a display
transform over data already loaded.
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
