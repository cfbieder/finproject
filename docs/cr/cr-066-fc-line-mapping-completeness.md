# CR066 — Every category with activity reaches an FC line, and nothing silently sits outside the forecast — 🔴 OPEN (P0 scoped, not built)

Twelve Chart-of-Accounts categories carrying **−78,689 of 2025 expense and +31,474 of 2025 income**
map to no FC line at all. They are therefore absent from the forecast's base-year P&L, absent from
every FC-line row on the Review page, and absent from the modelled years — and **nothing anywhere
says so**. Found by building [v3.11.14](../current/project-roadmap.md)'s graph fix, which put the
actuals column on the Review page's stacked charts and made the stack disagree with the row above
it. The unmapped set is **identical on dev and prod**, so it is the mapping, not a stale snapshot.
[Roadmap](../current/project-roadmap.md#cr066)

**Opened:** 2026-08-03 · **Track:** v3 · **Migration:** none expected (mapping rows, not schema)
**Depends on:** [CR004](cr-004-fc-lines-mapping.md) (the FC-line mapping layer itself)

**Phases.**

| | scope | gate |
|---|---|---|
| **P0** | Decide an FC line for each of the twelve categories (or record it as deliberately excluded) — §2 | **Owner decision per row.** Data entry through the existing `/forecast-mapping` page; no code. |
| **P1** | The app says when a category is unmapped, instead of dropping it — §3 | Scoped, not built. Prevents recurrence; a new COA category is unmapped by default. |
| **P2** | The Review page's Expense/Income header reconciles with its own children — §4 | Depends on P0/P1; may become unnecessary once nothing is unmapped. |

---

## 1. How it surfaced

The Forecast Review page's stacked breakdown charts had never shown the two pre-forecast
columns — the graph read `getCellValue`, which returns null for both, so the bars were zero and
`buildBreakdownSeries` dropped them. v3.11.14 fixed that. Reconciling the result against the table
is what exposed this:

| Column | Table `Expense` row | Chart stack | Δ |
|---|---:|---:|---:|
| 2025 · Actual | (566,586) | **(487,897)** | **78,689** |
| 2026 · Budget | (502,392) | (502,392) | — |
| 2027 | (547,380) | (547,380) | — |

2026 and 2027 tie exactly. 2025 does not, and **neither number is wrong**: the header row reads the
ledger's COA level-1 total, while every child row beneath it is an FC line resolved through
`categoryToLineMap`. A COA leaf with no FC line is counted by the first and by neither the second
nor the chart. The two have always disagreed in that column — the table just never drew them
side by side.

The chart is not the defect. It is the first thing that made the defect visible.

## 2. P0 — the twelve categories

From dev, 2025, `transfers=exclude`, `includeUnrealizedGL=false` (prod's totals differ slightly;
dev's Taxes are an older snapshot):

| COA category | 2025 USD | first read |
|---|---:|---|
| Property One-Off | −47,187 | plausibly belongs on `Property Costs` |
| Patrick - Exp | −15,495 | the `Patrick - *` cluster is five rows, −36,500 together |
| Patrick - Rent | −13,087 | |
| Patrick - Medical | −3,864 | |
| Patrick - Insurance | −3,338 | |
| Travel - Patrick | −2,502 | sits beside the cluster but under Travel |
| Patrick - USF | −716 | |
| Healthcare - Other | −303 | almost certainly `Healthcare`, an oversight |
| Utilities - Garden | −276 | almost certainly `Property Costs` |
| Tax Adjustment | **+8,078** | a *credit* in the Expense section — check before mapping |
| **total** | **−78,689** | |

**The first reads above are guesses and must not be applied as such.** Two of these are real
questions, not oversights:

- **The `Patrick - *` cluster (−36,500/yr + −2,502 travel)** looks like a dependent's costs held
  deliberately apart from `Living Expenses` / `Children`. If that spend continues, the forecast is
  understating expense by ~39K/yr; if it is ending, excluding it is correct and should be
  *recorded* as excluded rather than left looking like an oversight. `Children` already exists as
  an FC line and runs 2027–2031 in `2026 Base`, which suggests the modelling intent is there and
  this cluster is simply outside it.
- **`Tax Adjustment` (+8,078)** is positive inside Expense. Mapping it onto `Taxes` without
  understanding it would move a credit into a modelled cost line.

`Property One-Off` (−47,187) is the largest single row and the most likely plain oversight — a
one-off by name, which may argue for exclusion from a run-rate forecast on purpose. Same
requirement: decide, then record the decision.

### 2.1 The income side — two rows, and probably only one question

| COA category | 2025 USD | first read |
|---|---:|---|
| Rental - Spain | +31,306 | **likely fine, and that is the point** — see below |
| Other Inc | +167 | immaterial; map or exclude and move on |
| **total** | **+31,474** | |

`Rental - Spain` is the interesting one. The FC-line list carries a `CR046 Rent Line` of type
`bs_module_income` **with no categories attached**, and the SP property modules generate their
income through the module path rather than through a category→line mapping. So Spanish rent is
plausibly *already* in the forecast, arriving by a different route — in which case mapping the
category as well would **double-count it**.

That is exactly why P1 matters more than P0. "Unmapped" currently means two indistinguishable
things — *modelled elsewhere, correctly* and *not modelled at all* — and no screen tells them
apart. Verify against a generated scenario's `SP - *` income before touching this row.

## 3. P1 — the app should say so

The mapping is a join with no coverage check anywhere: `/forecast-mapping` shows what *is*
mapped, and a category with no FC line is invisible on every screen that matters. Any new COA
category is unmapped by default, so this recurs by construction — these ten did not arrive all at
once.

Options, cheapest first:

1. **A coverage line on `/forecast-mapping`** — "12 categories with activity carry no FC line
   (−78,689 expense, +31,474 income in 2025)", listing them with the amount that would be pulled
   in, and letting a row be marked *deliberately excluded* so the list converges on zero instead of
   being permanently non-empty. Read-only otherwise, no schema beyond that flag.
2. **A `Scripts/` check** in the ratchet family (may only shrink), so an unmapped category with
   activity fails a gate rather than waiting to be noticed.
3. **A residual band on the chart** — draw the unmapped remainder as an explicit "Unmapped" segment
   in the actuals column so the stack always totals the row. Honest, but it puts a band in one
   column only, which is the pattern v3.11.14 deliberately avoided elsewhere (see
   `fcBreakdown.js`'s note on the engine-data filter). Prefer 1 + 2; revisit if the gap is
   permanent by decision rather than by oversight.

(1) is the one that pays for itself immediately: it answers "what is my forecast not looking at?",
which is the question this CR exists to stop being unanswerable.

## 4. P2 — the header and its children

Once nothing with activity is unmapped, the Review page's 2025 `Expense` header and the FC-line
rows beneath it agree on their own, and the chart ties out with both. If the owner decides some
categories stay deliberately excluded, the header keeps reading a bigger number than its children
sum to, and the page should say which convention it is using rather than leave the discrepancy to
be rediscovered. Do not build P2 before P0 answers whether a permanent gap exists.

## 5. What is deliberately not in scope

- **Changing how `getCellValue` resolves the header row.** The COA total is the truthful ledger
  figure for that year. The fix is the mapping, not a number that hides the mapping.
- **Re-opening v3.11.14.** The chart change is correct as shipped: a breakdown totals its children,
  and that is what it now does. It stays as-is whatever P0 decides.

## 6. Reproducing the numbers

Both figures come from the two endpoints the Review page itself uses, joined the way
`resolveCashValue` joins them — every COA leaf in the cash-flow report, checked against the
`categories` array of every FC line:

```
GET /api/v2/fc-lines/review-structure
GET /api/v2/reports/cash-flow?fromDate=2025-01-01&toDate=2025-12-31
      &transfers=exclude&includeUnrealizedGL=false
```

Leaf totals live on `totalUSD` when present and `total` otherwise (the report emits the latter in
plain USD mode — reading only `totalUSD` returns zeros and looks like "no data").
