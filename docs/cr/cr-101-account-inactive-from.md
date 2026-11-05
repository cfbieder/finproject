# CR101 — Accounts inactive from a date (a sold property's categories stop cluttering later years) — DRAFT

**Status:** DRAFT (2026-11-05), not yet reviewed. Owner decisions D1–D4 taken 2026-11-05 (§3).
**Depends on:** CR063 (the Chart of Accounts order and `getTree`), CR098/CR100 (the budget builder, frozen
2026-12-03 until the first 2027 publish)
**Roadmap anchor:** [project-roadmap.md#cr101](../current/project-roadmap.md#cr101)

## 1. The ask

The owner sold two Spanish properties. Their categories had real 2026 activity, but from 2027 they only take
up space: twelve One-off lines in the 2027 budget builder, zero rows in every 2027 report, and entries in every
category picker. The ask is a way to mark an account **inactive from a given date**, so it drops out of
reports and planning for later periods without touching the periods it was used in.

Measured on prod (2026-11-05):
- `Property - SP - SS` and `Property - SP - PM4` are parent categories with 6 leaves each. Their last postings
  were 2026-02-27 to 2026-05-14.
- `Property - SP - PM6` is still active, with postings in November 2026, and is not in scope for the owner.

## 2. What exists, and why it cannot be used

`accounts.is_active` exists. All 230 accounts are TRUE on prod. It is all-or-nothing: it has no date, and it
is filtered inside `getTree` (`server/src/v2/repositories/accounts.js`, the recursive CTE), which nearly every
report, planner and picker reads through (`getNestedTree`).

**Turning it off rewrites history.** Report rows come from the tree, while totals come from transactions keyed
by name, and only names in the tree are rendered. Measured by reading the code:

- Cash flow (`services/reports.js` `buildCashFlowReport`) and the LE grid would drop the category's money
  from **every past period**, silently.
- The balance sheet's `fetchAccountBalances` filters `is_active` outright, so balance-sheet history would
  change too.

`is_active` keeps its present meaning, *deleted* (the Chart of Accounts' Delete sets it). This CR adds a
separate column and does not change `is_active`.

**The surface**, mapped 2026-11-05 (file:line list in the review log, §8):
- **Reports:** one tree, every leaf emitted with zeros. Multi-period pages (Cash Flow Periods, the Balance Sheet
  periods, Balance V2) take their **row structure from the first period's response only** (`CashFlowReport.jsx`
  `reports[0]`) and look up the other columns by path.
- **Pickers:** the `useCoa` tree (`CategorySelector`, `HierarchyFilter`, mobile), `/categories` (`findPLeaves`)
  and `/accounts` (`findAll`). All are date-blind except FC line mapping's unassigned pool, which takes
  `budgetYear`.
- **Planning:**
  - The LE and the builder derive their scope from activity, not from `is_active` (`SCOPE_SQL`), so an
    inactive category still gets LE lines and builder lines.
  - FC line mapping (`fcLines.findUnassignedCategories`) and forecast add-from-actuals (`forecast/crud.js`) do
    filter `is_active`, and both are year-aware.
- **Flags:** the per-row `needs_offset` pattern (one SQL fragment, a list-query column, a `trans-badge--warn`)
  and the count-only attention summary (`util/ops.js`) are the existing shapes for a "look at this" signal.

## 3. Decisions (owner, 2026-11-05)

| # | Question | Decision |
|---|---|---|
| D1 | Name | **Inactive from** (`inactive_from`), not "closed". |
| D2 | A balance-sheet account that is not at zero on the date | **Refused**, with the balance named: *PM4 holds €1,234 on 2027-01-01 — book the sale or transfer first*. Net worth never drops a real amount. |
| D3 | A transaction dated on or after the date | **Flagged, allowed.** It is saved as normal and flagged on the transaction. It is counted on the attention summary. The account shows in that period's reports, because it has activity. |
| D4 | An inactive account with no activity in a report period | **Hidden.** An inactive account *with* activity in the period still shows, marked *inactive from 2027*. |

## 4. Design

### 4.1 Storage (migration 089)

```sql
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS inactive_from DATE;   -- NULL = active
```

- **One rule for "inactive for X"** decides every use: `inactive_from IS NOT NULL AND inactive_from <= X`,
  where X is the start of the period or year in question. It is one SQL fragment and one JS helper, never
  re-typed.
- **Inheritance:** a parent's date applies to its descendants. The **effective** date of an account is the
  earliest non-null `inactive_from` on its path to the root. It is computed in `getTree`'s CTE, which already
  walks that path, and returned on every node as `inactiveFrom`. Setting the date on `Property - SP - PM4`
  therefore covers its six leaves.
- **`is_active`, the leaf definitions and `remove` are untouched.**

### 4.2 Setting and clearing it (Chart of Accounts)

- **`COAEditModal`** gains an *Inactive from* date field, and a clear button that reactivates the account.
  Saving goes through `/util/coa/update`, which gains `inactiveFrom`.
- **The page shows inactive accounts** with an *inactive from 2027-01-01* badge, and a toolbar filter
  *Hide inactive* that is off by default. The page lists them because it is where they are reactivated.
- **D2 check:** setting the date on a balance-sheet account, or on a parent with balance-sheet descendants,
  sums `fetchAccountBalances` at the day before the date. Any non-zero leaf refuses with its name and balance.
  - It covers **future** dates too. A date in the future is checked against today's balance plus the dated
    postings up to then.
  - It is re-checked when a transaction is later posted that would make it non-zero. That case is not
    refused; it is flagged by D3.
- **P&L accounts** have no balance, so no check applies.
- **Validation:** the date must be the first of a month. That keeps it aligned with monthly reports and budget
  months, and leaves no half-month column.

### 4.3 Reports: hide in the page, after every column is loaded

The server's report **totals do not change at all**. The server only adds `inactiveFrom` to the tree nodes it
already returns. The hiding is done by one shared frontend helper, `pruneInactive(structure, columns)`:

- A leaf is hidden only when it is inactive for the **earliest column's start** (or as-of date) **and** reads
  zero in **every** column. A parent is hidden when all its children are.
- It runs **after** all periods are loaded, on the merged view. That closes the multi-period trap (§2): rows
  come from period 1, so pruning on the server per period would lose a late posting in a later column. That
  money would vanish, which is the defect this CR must not create.
- A shown inactive leaf gets a muted *inactive from 2027* marker. Colour stays reserved for sign.

**Surfaces:**
- Cash Flow (single and periods);
- Balance Sheet, Balance Sheet Periods, Balance V2;
- Budget vs Actual: Variances, Realization, Graph. These join actual, budget and LE by leaf name, and a row is
  zero only when all three are zero;
- the mobile versions of each.

Category Trend, Net Worth Bridge and Investment Returns take explicit account lists, and are out of scope.

### 4.4 Pickers

A picker leaves out accounts inactive for **today**, except the value already selected on the row being
edited. A 2026 transaction on an inactive category still shows and keeps its category.

- **`useCoa` consumers:** `CategorySelector` and `HierarchyFilter` drop inactive leaves through the same helper.
- **`/categories` and `/accounts`:** gain `inactiveFrom` on each row, and the shared loader filters them.
  The server keeps returning them, because a filter page for 2026 must still offer them.
- **Filter pages** (Transactions, Ledger, Budget entry filters) keep offering inactive accounts. Filtering past
  data by them is legitimate. They are listed last, under *Inactive*.

### 4.5 D3: postings after the date

`INACTIVE_POSTING_SQL` follows the `NEEDS_OFFSET_SQL` pattern. It is true when the transaction's account or
category is inactive for the transaction's date.

- It is added to the transaction list queries and to the review queue.
- It is shown as `trans-badge--warn` *inactive account*, on desktop and mobile.
- It is counted as `inactivePostings` in the attention summary, with a link to the filtered list.

The write paths are not changed: manual entry, edit, split, transfer, the feed and PS ingest all save as today.

### 4.6 Planning (P2, after the 2027 publish)

For a target year Y, an account inactive for `Y-01-01`:

- **Budget builder (`createBuild`):** no line for it. It is reported in `dropped`, and the page's notice names
  them: *12 lines inactive from 2027 were not carried*. If a remembered Itemised pointer (CR100) points at such
  a line, it is skipped with the same notice.
- **LE:** the year's scope keeps it if it had activity in that year. 2026 keeps the Spanish lines, which is
  correct. A *future* LE for a year at or after the date leaves it out.
- **Budget entry (`/budget-worksheet`) and the budget pickers:** not offered for an entry dated on or after the
  date.
- **FC line mapping's unassigned pool, and forecast add-from-actuals:** both are already year-aware, and they
  leave it out for years on or after the date.

## 5. Verification

**Server:**
1. Migration 089 is additive. `getTree` returns the same rows as before, plus `inactiveFrom`, and inherits a
   parent's date. A **snapshot test**: every report endpoint returns byte-identical totals before and after
   dates are set.
2. D2: setting the date on a balance-sheet leaf, or on its parent, with a non-zero balance at the day before
   is refused, naming the balance. At zero it succeeds. A future date counts postings dated up to it. A
   date that is not the first of a month is refused.
3. `INACTIVE_POSTING_SQL` is true for a transaction on or after the date, on either the account or the
   category, and false before. The attention count matches the list.
4. P2: a builder draft for Y omits inactive categories and names them in `dropped`. FC mapping's pool leaves
   them out for Y. A remembered Itemised pointer to an inactive category is skipped with a notice.

**Frontend (Vitest, `pruneInactive`):**
- an inactive leaf zero in every column is hidden;
- non-zero in **any** column, it is kept and marked; this is the late-posting case on a multi-period page;
- active for the earliest column's start, it is kept;
- a parent whose children are all hidden is hidden;
- budget vs actual is zero only when actual, budget and LE are all zero;
- a picker keeps the already-selected inactive value.

**Page:** the Spanish properties are set inactive from 2027-01-01 on a dev copy. Then, in both themes:
- the 2026 Cash Flow is unchanged, to the cent, against a pre-change export;
- a 2027 period hides them;
- a planted 2027 posting on one of them makes it reappear, marked, with the badge and the attention count;
- Cash Flow Periods spanning 2026 and 2027 keeps the 2026 column's rows.

## 6. Non-goals

- Changing what `is_active` (delete) does, or making Delete check balances (a separate gap, now on the roadmap).
- A per-report *show inactive* toggle (D4 chose hidden).
- Blocking postings (D3 chose flag).
- Hiding on Category Trend, Net Worth Bridge or Investment Returns (explicit account lists).
- Inactive *to*/*reopen at* history. Clearing the date reactivates the account outright.

## 7. Phasing

| Phase | What | When |
|---|---|---|
| **P1** | Migration 089; `getTree` inheritance and `inactiveFrom` on nodes and lists; the COA edit field, badge and filter with the D2 check; `pruneInactive` on the report pages (desktop and mobile); pickers; D3's flag, badge and attention count. **The builder is not touched**, because of the 2026-12-03 freeze. | Before 2026-12-03 is not required. Reports and pickers are outside the builder freeze. |
| **P2** | §4.6 planning: builder, future LEs, budget entry, FC mapping, add-from-actuals. | **After the 2026-12-10 publish**, alongside CR098 P3c, which edits the same builder service; P3c goes first. |

**Until P1:** the 2027 One-off lines the owner has set publish nothing; they only take up space.

## 8. Review log

*(pass 1 `cr-technical-reviewer`, pass 2 `cr-signoff-pm`: pending)*

Surface map (2026-11-05), the inputs to §2 and §4:
- **Reports:** `services/reports.js:38` (balance sheet), `:278` (cash flow), `:103` (`fetchAccountBalances`,
  `is_active`); `services/budget.js:644`; `services/budgetLe.js:110`, `:712`; `netWorthBridge.js:171`.
- **Multi-period structure:** `CashFlowReport.jsx:220`, `BalanceSheetPeriods.jsx:96/133`, `BalanceV2.jsx:98/101`.
- **Pickers:** `hooks/useCoa.js:13`; `/categories` → `findPLeaves` (`accounts.js:247`); `/accounts` →
  `findAll` (`:43`); `fcLines.js:262` (year-aware).
- **Flag pattern:** `NEEDS_OFFSET_SQL` (`repositories/transactions.js:29`); attention summary `util/ops.js:54`.
- **COA:** `COAManagement.jsx`, `COAEditModal.jsx`, `/util/coa/update` (`coa.js:172`), keyed by name.
- **Own CTEs that filter `is_active`, untouched by this CR:** `ingestPs.js:44`, `forecast/crud.js:228`,
  `bankFeed.js:196`, `dataAnalyzerUtils.js:166`.
