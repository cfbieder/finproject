# CR-054 — Cash Flow "By Account" report (category/account filters + currency toggle)

**Status:** SHIPPED v3.4.0 (2026-07-21); drill-down fixes v3.4.1–v3.4.2 (2026-07-21);
**frozen-column fix + Total column v3.41.0 (2026-08-26, owner-found)**;
**cross-group account selection v3.42.0 (2026-08-26, owner-asked)** · **Track:** v3 ·
**Depends on:** CR008 (HierarchyFilter), CR042 U5 (CashFlowTabs consolidation).

## Problem

The Cash Flow report (Summary / By Period) sums **every** account's transactions in
**USD** (`base_amount`) only. There was no way to ask "what did *this* account (or set of
accounts) spend by category over these periods?", nor to see a non-USD account's flows in
its **own** currency — the owner's PLN/EUR accounts only ever showed a converted USD figure.

## What shipped

A third tab, **By Account**, at `/cash-flow/by-account`
([`CashFlowByAccount.jsx`](../../frontend/src/pages/CashFlowByAccount.jsx)). Same
period-column layout as **By Period** (category tree as rows, one column per
month/quarter/year span), plus:

- **Category + Account filter chips** — the same Budget-Worksheet
  [`HierarchyFilter`](../../frontend/src/components/HierarchyFilter/HierarchyFilter.jsx)
  two-stage control. The group derivation (Income / Expense / Transfers chips; one chip per
  account type) was extracted from `BudgetWorksheetV2` into a shared util
  [`hierarchyFilterGroups.js`](../../frontend/src/utils/hierarchyFilterGroups.js) so both
  screens build the chips identically. Selected leaf names post as repeated
  `category` / `accounts` params.
- **USD ⇄ Original currency toggle.** USD sums `base_amount` (unchanged); Original sums
  `amount` (the transaction's native currency).

### The currency caveat (by design)

With **categories as rows**, an *Original* total that spans accounts of different
currencies (e.g. USD + PLN under one category) is not a real number. So the report:

- defaults to **USD**;
- in Original mode, formats each figure with the selected currency's symbol **only when the
  fetched transactions are single-currency**, otherwise a plain decimal;
- renders a **warning banner** when an Original total mixes currencies
  ("… mix N currencies — filter Accounts to a single currency to total meaningfully").

Filter Accounts to one account (or a single-currency set) and the Original total is exact.
This is why Original pairs naturally with the account filter.

## Implementation

**Backend** — additive, backward-compatible (absent params ⇒ byte-identical output, so the
Summary / By Period tabs are untouched):

- [`server/src/services/reports.js`](../../server/src/services/reports.js) —
  `buildCashFlowReport` / `fetchCategoryTotals` gained optional `categories`, `accounts`,
  `currency`. The SQL adds `LEFT JOIN accounts a ON t.account_id = a.id` with
  `a.name IN (...)` / `c.name IN (...)` filters (mirroring `budget.getSummary`) and picks
  `t.amount` vs `t.base_amount`. It also `ARRAY_AGG(DISTINCT t.currency)` so the response
  carries `meta: { currency, currencies[] }` for the mixed-currency warning.
- [`server/src/v2/routes/reports.js`](../../server/src/v2/routes/reports.js) — `GET
  /cash-flow` parses `category` (repeatable), `accounts` (repeatable), `currency`.

**Frontend** —

- New tab wired in [`CashFlowTabs.jsx`](../../frontend/src/pages/CashFlowTabs.jsx)
  (deep-links via the existing `/cash-flow/:view` route).
- [`CashFlowReport.jsx`](../../frontend/src/features/CashFlow/CashFlowReport.jsx) takes an
  optional `currencyCode` prop; the value formatter is threaded through the recursive row
  renderer (default `"USD"` ⇒ Summary / By Period unchanged).
- REST: `Rest.fetchCashFlowByAccountV2` returns `{ report, meta }`.

**No migration. No new secret.**

## Tests / verification

- Route contract tests extended
  ([`reports.routes.test.js`](../../server/src/v2/routes/__tests__/reports.routes.test.js)):
  the filter+currency call returns 200 with `meta.currency='original'`; the default returns
  `meta.currency='usd'`. All 12 reports-route tests green against the dev DB.
- Verified against dev-DB data that USD vs Original sums diverge correctly (e.g. *Kasia
  Spending* $41,686 USD vs zł151,777 PLN) and that mixed-currency categories (EUR+PLN)
  surface in `meta.currencies`.
- Frontend: build ✓, lint ✓, 195 tests ✓, all four CI guards ✓ (dead-tokens, inline-hex,
  button-css, modal-adoption).

## v3.4.1 — drill-down fix (owner-found, 2026-07-21)

Owner clicked the shipped tab (PKO-only + Original) and double-clicked a cell: the
transaction modal showed **other accounts'** rows (Fidelity, etc.) with **USD amounts
mislabeled "PLN"**. Two coupled defects in the drill-down:

1. **No account filter.** `handleValueDoubleClick` → `fetchCashFlowTransactions` passed only
   the category, so the modal pulled that category across *all* accounts. Fixed: the
   drill-down now carries the report's account filter — `GET /cash-flow/transactions` +
   `getCashFlowTransactions` accept a repeatable `accounts` param (`AND a.name = ANY(...)`),
   and the report snapshots the accounts used at Generate.
2. **Wrong amount field/currency.** The modal (and its Summarize panel) preferred `BaseAmount`
   (USD) and formatted it with the report's symbol. Fixed: in Original mode both show the
   **native `Amount`** — the transaction list formats each row in its **own** `Currency`
   (correct even for a mixed selection), and the summary totals native amounts using the
   report's currency-aware formatter. USD mode unchanged.

New route-contract test asserts every drill-down row is on the filtered account. 13
reports-route tests + 195 frontend tests + all CI guards green.

### v3.4.2 — drill-down category filter (owner-found, 2026-07-21)

Same drill-down, next click: with a **category** filter set, double-clicking a row still
listed categories *outside* the filter. Cause: the filtered report keeps the **full** P&L
tree (unselected categories total 0 and are hidden by the frontend), so
`collectLeafCategories(node)` returned every leaf under the clicked node regardless of the
chip selection. Fix (frontend-only): the report snapshots the category filter at Generate and
the drill-down **intersects** the node's leaves with it before querying — empty filter ⇒ no
restriction, so Summary/By-Period are unaffected. The `/cash-flow/transactions` endpoint
already restricts to the category list it is given; the bug was passing it the unfiltered
list.

## v3.41.0 — the frozen column stopped at the total row, and a Total column (owner-found, 2026-08-26)

Two changes to the same table, both raised by the owner scrolling the report sideways.

### 1. `NET CASH FLOW` scrolled out from under its own label

Scrolling the period columns right carried the **Net Cash Flow** row's label away with them
while `CATEGORY`, `INCOME` and `EXPENSE` stayed frozen — so the totals row's figures sat
under the wrong month headers.

**Cause — a CSS specificity accident, not a missing rule.** The frozen first column comes
from a two-part selector in
[PageLayout.css:2573](../../frontend/src/pages/PageLayout.css#L2573):
`.balance-report-table tbody td:first-child, .balance-report-table__name { position: sticky; left: 0 }`.
The hierarchy tree-lines in
[CashFlowReport.css:15](../../frontend/src/features/CashFlow/CashFlowReport.css#L15) set
`position: relative` on `.cash-flow-report .balance-report-table__name` (0,2,0) to anchor
their `::before`/`::after`. Body rows survive only because the **other** half of that
selector — `tbody td:first-child` (0,2,2) — is more specific. The Net Cash Flow row is
rendered in **`<tfoot>`**, so it never matched that half, fell back to `relative`, and
scrolled. Fixed by re-asserting `position: sticky; left: 0; z-index: 7` on
`.cash-flow-report .balance-report-table__net-cash-flow .balance-report-table__name` (0,3,0),
and suppressing the tree-line pseudo-elements there — a total row is not a node in the tree.

⚠️ **The first attempt shipped a worse bug and only a measurement caught it.** Scoping the
tree-line rule to `tbody` instead reads as the cleaner fix, and it *silently unpinned the
entire body column*: with `tbody` added, the two rules **tie at (0,2,2)** and the later
import wins. Reasoning about the cascade produced the wrong answer twice; a DOM probe
(`getBoundingClientRect().left` of the first cell against the scroll wrapper, at
`scrollLeft = scrollWidth`) reported `bodyLeft: -324` and settled it. **The lesson is the
project's own: measure the rendered page, do not argue about it.** Note that the Balance
Sheet's `Net Worth` row — the same `<tfoot>` pattern in
[BalanceReport.css](../../frontend/src/features/Balances/BalanceReport.css) — was never
affected, because that page has no tree-line rule to collide with; the defect existed only
where the two files met.

### 2. A `Total` column after the months

The report answers "what did this account spend by category **per month**" but could not
answer it **for the range** without adding the columns by hand. A trailing `TOTAL` column now
sums each row across the period columns, at every level of the category tree and on the
`Net Cash Flow` footer row.

**Opt-in via a `showTotalColumn` prop, and that is a correctness fence, not caution.**
`CashFlowReport` is shared by all three tabs. On **By Account** and **By Period** the columns
come from `getPeriods(from, to, frequency)` — contiguous and non-overlapping — so the sum is a
genuine range total. The **Summary** tab's columns are arbitrary user-picked comparison
ranges that may **overlap**, where the same transaction would be counted twice. Only
`CashFlowByAccount` passes the prop; By Period is one prop away if the owner wants it.

The footer row's per-period values were being computed inline mid-render, so they were
collected into a `netValues` array first and the total reuses them — the total cannot
disagree with the cells above it.

**Verification** — driven in a browser against dev data, 8 monthly columns, **every** row
expanded: **117 rows, 0 mismatches** between the sum of a row's period cells and its Total
cell; `thead` `<th>` count, `<colgroup>` `<col>` count and every row's cell count all agree
at 10. Rendered in **both themes**. 582 frontend tests green, eslint clean.

⚠️ **Not done, deliberately:** the Total column **scrolls with the months** rather than being
frozen at the right edge, and the Excel export (`exportCashFlow(reports, periodLabels)`)
still writes only the period columns — no Total.

## v3.42.0 — selecting accounts from two groups at once (owner-asked, 2026-08-26)

> *"I would like to select accounts from two places, Bank Accounts and PLN Credit Cards."*

The Accounts chips were **mutually exclusive**: clicking a second group **replaced** the first,
so the owner's Polish picture — PLN bank accounts **plus** PLN credit cards — could only be got
by running the report twice and adding the columns by hand. The Accounts filter now uses
`HierarchyFilter`'s new opt-in **`multiGroup`** mode: the pills toggle, the checklist stacks the
active groups under sticky sub-headers, and the selection is the union. The mechanism, the fence
that keeps the other six consumers on the old semantics, and the three semantics the mode had to
settle live in [CR008](cr-008-hierarchy-filter.md#extended-v3420--multigroup-a-selection-that-spans-groups).

**Nothing on the server changed.** `GET /api/v2/cash-flow` already took `accounts` as a
repeatable param matched with `a.name = ANY(...)` — the wire has always been a **flat list of
account names**, and the single-group limit existed only in the frontend component.

**Verified in a browser against dev data.** Bank Accounts → 21 checked, no sub-headers,
*"21 selected across 1 group"*; add PLN Credit Cards → both pills lit, both headings,
**25 checked**, *"25 selected across 2 groups"*; uncheck one in each → 23. **The request carries
23 names spanning both groups** (20 bank + 3 PLN cards), identical across all 8 period requests.
The five reachable standard-mode consumers (`/trans-actual`, `/trans-budget`,
`/budget-worksheet`, `/balance-trends`, `/ledger`) each report **one active pill after clicking
two different pills** — replace semantics intact, no summary, no sub-headers, `hf--multi`
absent; the FC line drill-down is covered by its unit test. Zero page errors on any route. Both
themes. 582 frontend tests, eslint clean, three CSS gates at baseline.

⚠️ **A known inconsistency this created, left for the owner.** The **Categories** filter sits
beside Accounts on this same page and still **replaces**, so two adjacent controls now have
different pill semantics. Enabling it is adding `multiGroup` to the Categories
`<HierarchyFilter>` in `CashFlowByAccount.jsx` — deliberately not done, because the request was
about accounts and it changes what category filtering does.

**Side effect worth knowing:** in **Original** currency mode a cross-group selection is more
likely to mix currencies, so the existing mixed-currency warning fires more often. That is the
warning working, not a new defect.

## Open / follow-ups

- Filters + currency are **Generate-driven** (not reactive), matching the other Cash Flow
  tabs; only `frequency` auto-regenerates.
- Possible later polish: a per-currency subtotal split in Original mode instead of a warning.
- **Freeze the Total column** at the right edge so it stays visible while scrolling months,
  and **add it to the Excel export** — both deferred in v3.41.0, neither asked for.
- **`showTotalColumn` on the By Period tab** — correct there (contiguous periods), just not
  requested.
- **`multiGroup` on the Categories filter** — one prop; left off in v3.42.0, and until it is
  flipped the two filters on this page behave differently from each other.
