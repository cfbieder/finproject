# CR100 — Itemised budget lines (a line built from listed items, by month, in any currency) — DRAFT

**Status:** DRAFT (2026-11-05) — not yet reviewed. Owner decisions taken 2026-11-05 (§3).
**Depends on:** CR098 (budget builder: lines, policies, monthly split, stored rates, publish token)
**Roadmap anchor:** [project-roadmap.md#cr100](../current/project-roadmap.md#cr100)
**Deadline context:** the builder code freeze is **2026-12-03**, and the first 2027 publish is due **2026-12-10**
([status.md](../current/status.md)). This is the last builder change planned before that publish.

## 1. The ask

Some budget lines are a list of separate items, not a figure scaled from last year. The owner's example is
*Travel – Flights*: one row per trip, each placed in the month it is paid, some priced in PLN, some in USD or
EUR. Today the builder offers Recurring (estimate × inflation), One-off (0) or Fixed (one typed figure,
spread by a split). The trips have to be added up and converted by hand, outside Fin, and the list
is lost once the total is typed into the Fixed field.

The ask: a fourth input mode that opens a modal with this year's actual and budget for reference at
the top, and below it a grid of described rows by month, each in its own currency, summed into the
line's total.

## 2. What exists (read from the code, 2026-11-05, v3.84.1)

- A builder line is a **(category, currency)** pair (`budget_build_lines`, `currency CHAR(3)`). A category
  spent in two currencies has two lines.
- `annualFor()` gives a line's annual figure from its policy; `computeCells()` splits it into
  account × month cells with `splitLine()`. The **monthly** split (`split_method = 'custom'`) reads
  `split_weights` as proportions, so twelve month totals used as weights reproduce those totals exactly
  (v3.84.0).
- A draft's FX comes from its scenario (`scenarioRates`); a published build reads its stored
  `published_rates` and stored cells. Rates are local-per-USD for `USD`, `PLN`, `EUR` only (`CURRENCIES`).
- **The publish token hashes every cell a publish would write** (`cellsHash`), so any edit that changes
  a figure invalidates an earlier preview. Nothing new is needed for that.
- `budget_category_policy` remembers **one** row per category at publish. `policyLines()` picks the line
  with the largest |LE full year| in USD. `createBuild()` applies that row to **every** currency line of
  the category.
- The reference data exists on the server: `previewPublish` returns each line's `priorActual` by
  month; `loadGrids()` loads this year's budget by month (`budget`) but does not send it to the page.
- `/budget-worksheet` is a different page (budget entry with a balance comparison). Hence the name
  *Itemised*, not *worksheet*.

## 3. Decisions (owner, 2026-11-05)

| # | Question | Decision |
|---|---|---|
| D1 | Where it lives | A **policy**, *Itemised*, beside Recurring · One-off · Fixed. It sets the annual figure as well as the months, which is what a policy decides; as a Months option it would contradict the Fixed box beside it. |
| D2 | The category's lines in other currencies | **Set to One-off automatically** when the items are saved, and the page says which lines it changed. Otherwise those lines would budget the same trips a second time. |
| D3 | Next year's draft | **Copies the rows as a starting point**, amounts included, on the same currency line; the other currency lines start as One-off. |
| D4 | What publish writes | **Totals, as now:** one budget entry per account and month. The item descriptions stay in the builder. Per-item budget entries are a non-goal (§6). |
| D5 | Name | **Itemised.** |
| — | Budget-currency selector | **Not built.** The worksheet totals into the currency of the line it was opened from; choosing that line is the currency choice. |

## 4. Design

### 4.1 Storage (migration 088)

```sql
CREATE TABLE budget_build_line_items (
  id          SERIAL PRIMARY KEY,
  line_id     INTEGER NOT NULL REFERENCES budget_build_lines(id) ON DELETE CASCADE,
  position    SMALLINT NOT NULL,
  description VARCHAR(200) NOT NULL CHECK (btrim(description) <> ''),
  currency    CHAR(3) NOT NULL CHECK (currency IN ('USD', 'PLN', 'EUR')),
  months      NUMERIC(15,2)[] NOT NULL
              CHECK (cardinality(months) = 12 AND array_position(months, NULL) IS NULL),
  UNIQUE (line_id, position)
);
-- policy CHECKs widened on both tables:
--   budget_build_lines.bbl_policy_chk, budget_category_policy.bcp_policy_chk → + 'itemised'
ALTER TABLE budget_category_policy
  ADD COLUMN IF NOT EXISTS items_line_id INTEGER REFERENCES budget_build_lines(id) ON DELETE SET NULL;
```

`items_line_id` points at the itemised line of the **published** build. Published and superseded builds
are never deleted (only drafts are), so the rows stay readable for next year's copy without being
stored twice. Its line's `currency` says which currency line is itemised next year (D3).

### 4.2 The annual figure is derived, never stored

For an Itemised line in currency *C*, with build rates *r* (local per USD):

```
month_m  = Σ_items  item.months[m] × r[C] / r[item.currency]      (rounded to cents per month)
annual   = Σ_m month_m
```

- The total is **recomputed on every read** from the rows and the build's rates. A stored total
  would go stale when the scenario's FX changes, which is Fin's recurring defect class: state that exists,
  renders, and has no effect. A published build is frozen by its stored cells and rates, as today.
- **Sign:** rows are typed as amounts. Positives take the line's sign (the sign of its estimate, else
  negative on an expense category and positive on income); negatives stay negative. **All rows of one line
  must share a sign**, and the save is refused otherwise, with the reason on the page (v3.84.1's rule).
- **A row in a currency the build has no rate for** makes the annual `null`. Publish already refuses a
  `null` annual, but with the *no inflation rate* message. Itemised lines get their own message, naming the
  currency.
- **The month split** reuses the monthly path: `computeCells` passes the line to `splitLine` as
  `{ split_method: 'custom', split_weights: |month totals| }`, so accounts are still split by last year's
  actuals and the month totals land exactly.

### 4.3 Endpoints

- `PUT /budget-builder/:id/lines/:lineId/items` — `{ items: [{ description, currency, months[12] }] }`
  **replaces** the line's rows in one transaction, sets its policy to `itemised`, sets every other
  currency line of the same category in this build to `one_off` (D2), and returns the build view plus
  `{ setOneOff: [{ lineId, currency }] }`. Drafts only. At least one row is required, and an empty list is refused:
  *use One-off for nothing*.
- `PATCH /:id/lines/:lineId` with a policy other than `itemised` on an Itemised line **deletes its rows**.
  The page confirms first when rows exist. Rows that would come back on a later switch are not kept: inert
  hidden state is the defect class named in §4.2.
- `GET /:id` returns `items` on each Itemised line. `GET /:id/preview` adds `thisYearMonths` (this year's
  budget by month, from the grid `loadGrids` already reads) beside `priorActual`.

### 4.4 Copies and memory

- **Start from** (`createBuild` with a parent) copies an Itemised line's rows with the line.
- **`policyLines()`** prefers an Itemised line over its siblings, whatever their estimates. Without
  this, an auto-One-off sibling with a larger estimate would be remembered, and Itemised would be lost.
- **`rememberPolicies()`** writes `items_line_id` for an Itemised category.
- **`createBuild()` without a parent:** for a category remembered as Itemised, the line in
  `items_line_id`'s currency becomes Itemised with a copy of those rows; the category's other currency
  lines start as **One-off**, not Itemised. Every existing category behaves as today. If that currency has no
  line in the new LE, the line is still created (`le_fy` 0), as a Fixed line from a parent build already is.

### 4.5 The page

- **Grid row:** the policy dropdown gains *Itemised*. The Fixed cell shows the derived annual
  (read-only), and the Months cell shows a button, **Items (N)**, which opens the modal.
- **A sibling set to One-off by D2** shows a muted note, *itemised on the PLN line*. If it is switched back to
  Recurring or Fixed, the note becomes a flag, *⚠ also itemised on the PLN line: counted twice*.
- **Modal** (the shared `Modal` component):
  1. Header: category, line currency, the build's rates used for conversion.
  2. Reference: **Actual {LE year}** and **Budget {LE year}** by month, category-wide: every currency
     line of the category, converted into the line's currency at the build's rates. The page has all of it
     once the preview carries `thisYearMonths`.
  3. Grid: one row per item: description · currency · Jan…Dec · row total (own currency) · row total
     (line currency). Add a row, delete a row. Blank is zero.
  4. Footer: month totals and the annual, in the line currency, signed like the Budget row.
  5. Save sends the `PUT`, and Cancel discards. If the save is refused (mixed signs, empty description, no
     rows), the reason is shown in the modal and the rows are kept.
- A published or superseded build shows the rows read-only.

## 5. Verification

Server (`budgetBuilder.test.js`, dev DB):
1. Items in PLN, USD and EUR on a PLN line give month totals and an annual equal to the hand conversion
   at the build's rates; the preview's months equal those totals to the cent.
2. A scenario FX change moves a draft's Itemised annual, and leaves a published build's stored figures
   unchanged.
3. Saving items sets the category's other currency lines to One-off and reports them.
4. Mixed signs, a blank description, an unknown currency, eleven months, or an empty list are each
   refused with a message.
5. Leaving Itemised deletes the rows; deleting a draft cascades.
6. *Start from* copies the rows; editing the copy leaves the parent unchanged.
7. Publish, then a new year's draft from a later LE: the remembered currency line is Itemised with the
   rows copied, the sibling is One-off, and `policyLines` chose the Itemised line, **including when the
   sibling's estimate is larger**.
8. A preview token goes stale when an item amount changes (no new code; this test proves it).

Page: the modal walked on dev in **both themes**, with typed **negative and positive** amounts. v3.84.0
shipped a sign defect because the walk typed positives only.

## 6. Non-goals

- **Per-item budget entries** (D4). The real budget gets totals. If item names are wanted in budget-vs-actual
  later, that is its own CR, after the first publish has run once.
- Inflation on items. Rows are typed for the target year.
- Currencies beyond USD, PLN and EUR (the engine's FX has no others).
- Itemising outside the builder (the official budget, the LE).

## 7. Phasing and cost

One phase, **P1**: migration 088, the service changes in §4.2–4.4, two endpoints, the modal. Estimated at one to
two sessions. **Target: on prod by 2026-11-20**, leaving two weeks before the 2026-12-03 freeze for
the owner to itemise lines and for a fix if needed. If it cannot ship by the freeze, it waits until after the
2027 publish. It does not go in late.

## 8. Review log

*(pass 1 `cr-technical-reviewer`, pass 2 `cr-signoff-pm` — pending)*
