# CR101 — Accounts inactive from a date (sold properties, finished schools: out of later reports and planning) — IN-PROGRESS

**Status:** IN-PROGRESS rev 4 (2026-11-06). **P0 live v3.86.0:** the date on the Chart of Accounts, and the budget builder hiding lines (§10). The owner moved the builder part forward (D7).

Rev 3 (2026-11-05):
- Pass 1 `cr-technical-reviewer`: REVISE on rev 1, addressed in rev 2.
- Pass 2 `cr-signoff-pm`: **GO** on rev 2, on four conditions, applied in rev 3 (§7, §8).
- Owner decisions D1–D6 taken 2026-11-05 (§3).
- **Order:** the 2027 publish first. P1a after 2026-12-10 by default, or before the 2026-11-26 hard stop only if
  it is already done. P1b before the first 2027 month-end.
**Depends on:** CR063 (the Chart of Accounts order and `getTree`); CR098/CR100 (the budget builder, frozen
2026-12-03 until the first 2027 publish)
**Roadmap anchor:** [project-roadmap.md#cr101](../current/project-roadmap.md#cr101)

## 1. The ask

Some accounts had real activity and then ended:
- two sold Spanish properties;
- a son's university (Patrick - USF, last posting 2026-05-15);
- old bank accounts and cards.

From the year after, they only take up space: One-off lines in the budget builder, zero rows in every report,
entries in every picker. The ask is to mark an account **inactive from a date**, so it drops out of later
periods without touching the periods in which it was used.

Measured on prod (2026-11-05). Accounts with postings since 2025 and none since 2026-08-01: **54**. They include:
- the 12 leaves of `Property - SP - SS` and `Property - SP - PM4`, and the balance-sheet assets `SP - Sea Senses`
  and `SP - Panorama Mar 4`;
- `Patrick - USF`;
- five old bank and card accounts with no 2026 activity;
- **annual or seasonal accounts that must stay active**: the property taxes, Car - Insurance, Tax Reserve, the CVC
  funds.

The owner chooses which to mark; nothing in this CR guesses. A *Last activity* column (§4.2) shows where to look.

## 2. What exists, and why it cannot be used

`accounts.is_active` exists. All 230 accounts are TRUE. It is all-or-nothing, and it is filtered inside every
tree and list walk (`getTree`, `SORT_PATH_CTE`, `/accounts/categories`). Turning it off rewrites history:

- Report rows come from the tree, while totals come from transactions keyed by name. A deactivated category's
  money therefore vanishes from **every past period**.
- `fetchAccountBalances` filters `is_active`, so balance-sheet history changes too.

`is_active` keeps its meaning, *deleted*, and this CR does not touch it.

**Surfaces**, mapped 2026-11-05 (file:line in §9):
- **Reports.** They rebuild their own nodes. `buildCashFlowNode` returns `{name, total[, children]}`,
  `buildBalanceSheetNode` returns `{name, totalUSD, currency, total}`, and the budget cash-flow builder is
  similar. **No field on the tree reaches a report page unless a builder copies it.**
  - Multi-period pages take their row structure from the **first** response: `CashFlowReport.jsx` `reports[0]`,
    `BalanceSheetPeriods`, `BalanceV2`.
  - Budget Realization and Graph take their structure from the `useCoa` tree. Budget Variances joins by name maps.
- **Pickers versus filters.**
  - `HierarchyFilter` is only ever a filter.
  - `CategorySelector` is a picker in the transaction edit, manual entry and feed review, and a filter on the
    transaction filter bars.
  - `/categories` and `/accounts` are fetched directly from 11 files.
- **Inheritance has at least four walks:** `getTree`, `SORT_PATH_CTE`, `/accounts/categories`, and the forecast
  and fcLines CTEs. Transaction list queries join `accounts` flat, with no path.
- **Flags.** `NEEDS_OFFSET_SQL` is a per-row badge pattern; the attention summary is count-only and expects to
  read zero.

## 3. Decisions (owner, 2026-11-05)

| # | Question | Decision |
|---|---|---|
| D1 | Name | **Inactive from** (`inactive_from`), not "closed". |
| D2 | A balance-sheet account not at zero on the date | **Refused**, naming the account and its balance in its own currency. |
| D3 | A transaction dated on or after the date | **Flagged, allowed.** |
| D4 | An inactive account with nothing in a report period | **Hidden.** |
| D5 | Inactive accounts on **filter** controls (searching past data) | **In place, muted**, with an *inactive* marker, keeping their tree position. |
| D7 | When the builder hides inactive lines (owner, 2026-11-06) | **Now, for the 2027 budget being built**, not after the publish. Pulled forward as **P0**: the date and the builder hiding only. Reports, pickers and the flag stay as planned. |
| D6 | Parent and child dates | **Parent wins**, with no override: a child is inactive from the earlier of its own date and any ancestor's. If one child must stay active, set the dates on its siblings instead of the parent. |

## 4. Design

### 4.1 One definition of "inactive", in the database (migration 089)

```sql
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS inactive_from DATE
  CHECK (inactive_from IS NULL OR EXTRACT(DAY FROM inactive_from) = 1);   -- first of a month
-- The inherited date, defined ONCE (D6: the earliest date on the path to the root wins).
CREATE OR REPLACE VIEW account_inactive_effective AS
WITH RECURSIVE walk AS (
  SELECT id, inactive_from AS eff FROM accounts WHERE parent_id IS NULL
  UNION ALL
  SELECT a.id, LEAST(w.eff, a.inactive_from)        -- LEAST ignores NULLs
    FROM accounts a JOIN walk w ON a.parent_id = w.id
)
SELECT id, eff AS inactive_from_eff FROM walk;
```

- **Every consumer joins this view and never re-walks the tree:** `getTree`, `SORT_PATH_CTE` users (`findAll`,
  `findPLeaves`), `/accounts/categories`, and the transaction flag. It is exposed as **`inactiveFromEffective`**,
  so it cannot be mistaken for an account's own `inactive_from`, which `findAll`'s `a.*` already returns.
- **One JS helper, `isInactiveFor(effectiveDate, onDate)`, used everywhere in the frontend.** It returns true when
  `effectiveDate` is set and `effectiveDate <= onDate`. The dates are ISO strings compared as strings, never
  through `new Date()` (Known Issue #3, timezones). Its SQL twin is
  `eff.inactive_from_eff IS NOT NULL AND eff.inactive_from_eff <= $date`.
- **Untouched:** `is_active`, every leaf definition, and `remove`.
- **Safe on prod before the code:** a nullable column, a CHECK that holds because every row is NULL, and a view.

### 4.2 Setting it: the Chart of Accounts

- **`COAEditModal`** gains an *Inactive from* field (month picker, first of month) for the account's **own** date,
  with Clear to reactivate it. Under a dated ancestor it shows *inherited from Property - SP - PM4 (2027-01)*
  (D6). The COA nodes carry both the own and the effective date.
- **The page:**
  - an *inactive from 2027-01* badge on every account inactive today or later;
  - a *Hide inactive* toolbar filter, off by default (**deferred to the roadmap**);
  - a **Last activity** column: the newest transaction date, as category or account. It is read-only, from one
    grouped query, and shows where to look.
- **Write path:**
  - `/util/coa/update` accepts `inactiveFrom`, where `undefined` means unchanged and `null` clears, as
    `accountNumber` already does.
  - `accountsRepo.update`'s `allowedFields` gains `inactive_from`. Without it the field would be **silently
    dropped** (the CR046/CR047 class).
  - Validation and the D2 check run **before** `update`, so a refusal leaves the whole row unchanged, including a
    rename sent in the same request.
- **The D2 check** runs on a balance-sheet account, and on a balance-sheet parent for every descendant leaf.
  - The native balance on the day before the date must be zero:
    `opening_balance + SUM(amount) WHERE transaction_date <= $1::date - 1`. "Day before" is computed in SQL.
  - It uses the **account's own currency, never USD**, so the refusal names *€1,234*, not a converted figure.
  - It comes from a small extracted balance query, with an `accountIds` filter and the feed-override lateral that
    `fetchAccountBalances` uses. It makes **no FX refresh** and no network call.
  - Future-dated postings already fall inside `<= date − 1`, so no special case is needed.
- **Known limit:** a posting entered later but dated *before* the inactive date can leave the account non-zero
  without a D3 flag. No money hides, because reports still show a non-zero row. The account stays out of pickers
  for dates after it, but it is offered for the posting's own date (§4.4), which is where a correction goes.

### 4.3 Reports: the date travels with the rows; hiding happens in the page

**Plumbing.** The server's report **totals do not change**. Each builder copies the field on:
- `getNestedTree` nodes;
- `buildCashFlowNode` and `buildBalanceSheetNode` (`services/reports.js`);
- the budget cash-flow node builder (`services/budget.js`);
- the `/accounts/tree` nodes that `useCoa` serves to Budget Realization and Graph.

All of them gain `inactiveFromEffective`, on leaves and parents. Without this the page would have no date to hide
by: the "exists, renders, no effect" defect class.

**One helper: `pruneInactive(structure, { earliestDate, hasActivity(node, pathKey) })`.**
- **`earliestDate`** is the **minimum** of the page's column start (or as-of) dates. It is never assumed to be
  column 0, because Balance V2's dates are user-chosen and unordered.
- **A leaf is hidden** when `isInactiveFor(leaf.inactiveFromEffective, earliestDate)` and `hasActivity` is false.
  A parent is hidden when all its children are.
- **`hasActivity` is decided by each page:**
  - Cash Flow and Balance pages: a non-zero value in **any** column. This is non-zero *net*: a +100/−100 pair
    nets to 0 and the row hides, but D3 still flags both postings and the attention count shows them.
  - Budget vs Actual: actual non-zero, budget non-zero, **or an LE line present**, since Realization treats an LE
    of exactly 0 as an answer.
- **It runs after every column has loaded, on the merged view.** Rows come from column 1, so per-column pruning on
  the server would drop a late posting in a later column. That money would vanish.
- **A shown inactive row** gets a muted *inactive from 2027* marker in an existing muted token. Colour stays
  reserved for sign.

**In scope:**
- Cash Flow and Cash Flow Periods;
- Balance Sheet, Balance Sheet Periods, Balance V2;
- Budget vs Actual: Variances, Realization, Graph;
- **Deferred to the roadmap:** the four mobile report pages (MobileCashFlow, MobileBudgetRealization,
  MobileBudgetGraph, MobileBalanceTrends). Until then they show zero rows as today, and never a wrong number.

**Non-goals:** BalanceTrends, CashFlowByAccount, BalanceChart, Category Trend, Net Worth Bridge and Investment
Returns. They chart chosen accounts.

### 4.4 Pickers and filters

- **`CategorySelector` gains `mode="picker" | "filter"` and `selectedValue`.**
  - **Picker** (transaction edit, manual entry, feed review): leaves out accounts inactive for the form's
    **transaction date**, and for today only where the form has no date. The value already selected is always
    kept. A late final bill dated 2026 and entered in 2027 can still be categorised.
  - **Filter** (the transaction filter bars): keeps them, **muted in place** (D5).
- **`HierarchyFilter`** is always a filter and never drops anything. It mutes in place (D5).
- **The direct callers of `/categories` and `/accounts`:** both endpoints, and `/accounts/categories`, return
  `inactiveFromEffective` on every row.
  - The **picker** sites in §9 apply `isInactiveFor` in P1b.
  - Muting at the roughly nine direct-caller **filter** sites is **deferred to the roadmap**. They keep listing
    inactive accounts unmuted, as today, which loses nothing.
- **`categorySuggest.suggestForIds`** skips categories inactive for the transaction's date. Otherwise it would
  propose the Spanish categories from merchant history and *generate* D3 flags.

### 4.5 D3: postings on or after the date

- **The flag.** `INACTIVE_POSTING_SQL` joins `account_inactive_effective` twice, once for the account and once for
  the category. It is true when either is inactive for `t.transaction_date`. It is added to the transaction list
  queries and the review queue, and rendered as `trans-badge--warn` *inactive account*, desktop and mobile.
- **The attention count** `inactivePostings` counts only flagged rows **not yet accepted** (`accepted IS NOT
  TRUE`), as the review queue does, so the bar returns to zero once each is looked at.
- **The link.** It opens Transactions with a new `inactivePosting=1` filter parameter on `transactions.findAll`.
- **Write paths are unchanged.** Postings are flagged, not refused.
- **Reconciliation surfaces: deferred to the roadmap (pass 2, condition 3).** The claim that a closed bank
  would nag the attention bar forever is unverified, and the code points the other way:
  - fed reconciliation covers only mapped feeds, and a closed bank's mapping can be set to `ignored`;
  - D2 forces a balance-sheet account to zero before it can be dated, so manual drift could only come from a
    stale non-zero manual target.

  Build it only once a real account is seen nagging.

**`services/budgetLe.js`** (§9) has **no P1 change**. It reads `getNestedTree` and receives the new field
unused. Its scope change is P2 (§4.6).

### 4.6 Planning (P2, after the 2027 publish)

For a target year Y, an account inactive for `Y-01-01`:

- **Budget builder `createBuild`:** no line for it. It is reported in `dropped` and named in the notice. A
  remembered Itemised pointer (CR100) to such a category is skipped with a notice.
- **LE:** a year keeps it if it had activity that year. A future LE for a year on or after the date leaves it out.
- **Budget entry:** not offered for an entry dated on or after the date.
- **FC line mapping's unassigned pool:** leaves it out for `budgetYear` on or after the date. With no
  `budgetYear`, it uses today.
- **Forecast add-from-actuals:** for base year B the forecast starts at B+1, so it leaves out accounts inactive
  for `(B+1)-01-01`.

## 5. Verification

**Server:**
1. **089:** the CHECK refuses a mid-month date. `account_inactive_effective` gives the earliest ancestor date
   (D6) and NULL where none applies. It applies on a fresh database (`Scripts/test-fresh-db.sh`).
2. **Report totals unchanged:** every report endpoint returns the same totals before and after dates are set.
   This compares **totals**, not bodies, which gain a field. A `/reports/cash-flow` leaf and parent, a
   balance-sheet leaf and a `/budget/cash-flow` leaf each carry `inactiveFromEffective`.
3. **The COA write:**
   - the date round-trips;
   - `null` clears it and `undefined` leaves it unchanged;
   - a mid-month date is refused;
   - a D2 refusal, sent together with a rename, leaves the row unchanged;
   - D2 is refused with the native balance named; succeeds at zero; works on a balance-sheet parent; counts a
     future-dated posting; and makes no FX call.
4. **The flag:** `INACTIVE_POSTING_SQL` is true on or after the date, through either account or category,
   including through an inherited parent date, and false before. The attention count drops when the row is
   accepted. The `inactivePosting=1` filter returns exactly the counted rows.
5. **Suggestions:** `categorySuggest` does not offer an inactive category for a date on or after its date.
6. **Reconciliation:** an inactive balance-sheet account leaves manual-recon eligibility and fed reconciliation.
7. **P2:**
   - a builder draft for Y omits inactive categories, names them, and skips an Itemised pointer;
   - the FC pool leaves them out;
   - add-from-actuals for base B leaves out accounts inactive from B+1.

**Frontend (Vitest):**
- `pruneInactive`:
  - inactive and zero in every column, hidden;
  - non-zero in **any** column, kept and marked (the late-posting case);
  - active at the **minimum** date of an unordered Balance V2 set, kept;
  - a parent emptied by transfer exclusion carries the inherited date;
  - a parent whose children all hide, hidden;
  - Budget vs Actual: an LE line present but zero, kept.
- `isInactiveFor` string compare.
- `CategorySelector`: the picker drops by transaction date and keeps the selected value; the filter mutes in place.

**Page, on a dev copy.** Set the Spanish properties and Patrick - USF inactive from 2027-01-01. Then, in both
themes:
- the 2026 Cash Flow is unchanged to the cent against a pre-change export;
- a 2027 period hides them;
- a planted 2027 posting brings its row back, marked, with the badge and the attention count;
- Cash Flow Periods spanning 2026 and 2027 keeps the 2026 rows;
- the COA badge, *inherited from*, Last activity and the D2 refusal all show;
- the transaction filter shows them muted, and the edit picker for a 2027 transaction omits them.

## 6. Non-goals

- Changing Delete (`is_active`) or making it check balances. That is a separate gap, now on the roadmap.
- A per-report *show inactive* toggle (D4).
- Blocking postings (D3).
- A child override under an inactive parent (D6).
- The chosen-account charts listed in §4.3.
- Inactive *to* / reopen history. Clearing the date reactivates the account outright.

## 7. Phasing, freeze and deploy

**P1 pays off from 2027-01-01.** Dates of 2027-01-01 change no 2026 view, and the 2027 budget is published before
P2. Only the old banks and cards with no 2026 activity could take an earlier date.

| Phase | What | When |
|---|---|---|
| **P0** ✅ | 089 and the view; the COA *Inactive from* field (own date, inherited badge, last activity in the form, D2 refusal); the budget builder hides lines inactive from the target year, and on a draft they read 0 and publish nothing (D7). | **v3.86.0, 2026-11-06**, before the freeze. Freeze gate: both prod 2027 drafts give an identical cell hash and USD total before and after. |
| **P1a** | `inactiveFromEffective` through `getTree`/`getNestedTree` and the report builders; a *Last activity* column and the *Hide inactive* filter on the COA tree (the field, badge and D2 shipped in P0); `pruneInactive` on the **desktop** report pages (Cash Flow, Cash Flow Periods, the three Balance pages, the three Budget vs Actual pages). | **After the 2026-12-10 publish, by default.** Before the **2026-11-26 hard stop** only if already done. **No CR101 deploy between 11-26 and the publish.** |
| **P1b** | `CategorySelector` picker and filter modes, and the picker call sites; the `categorySuggest` skip; the D3 flag, badge, attention count and `inactivePosting` filter. | Before the first 2027 month-end. It shares no surface with CR098 P3c, so the two can run side by side. |
| **P2a** | LE scope for future years, the FC line-mapping pool, add-from-actuals. | From January, **not in the days around CR064's annual-close run**. |
| **P2b** | `createBuild` and the Itemised pointer. | Before the 2028 build (autumn 2027), after CR098 P3c. |
| **Roadmap** | Mobile report pages; filter muting at the direct-caller sites; the COA *Hide inactive* filter; the reconciliation exclusion (only if a real account nags). | Not scheduled. None can produce a wrong number. |

- **P1a reaches the builder** even though it touches no builder file. `budgetBuilder.getBuild` reads
  `getNestedTree`, and P1a changes `services/budget.js` and the Budget vs Actual pages used to review the
  budget. **Freeze gate for any pre-11-26 deploy:**
  - `getTree` keeps the same rows in the same order: a LEFT JOIN to the view, with no new filter;
  - the builder suites pass;
  - `GET /budget-builder/compare` on the open 2027 draft is byte-identical before and after.
- **No `inactive_from` dates are set on prod before the publish.** The owner trial runs on a dev copy; prod
  dates come after 12-10.
- **Deploy:** 089 applies at `deploy-to-production.sh` Step 2b, before the code. **Rollback:** clearing a date
  undoes it for data; dropping the view and the column undoes the schema.
- **§9 line numbers drift.** Refresh them at build time; they are not a checklist.

## 10. As built — P0 (2026-11-06, v3.86.0)

- **Migration 089:** the `accounts.inactive_from` column, with a first-of-month CHECK, and the
  `account_inactive_effective` view (parent wins), which walks every account.
- **`services/accountInactive.js`:**
  - `listInactive` gives each account's own date, inherited date and last posting
    (`GET /util/coa/inactive`).
  - `checkInactiveFrom` enforces the first-of-month rule and D2. D2 compares each leaf's native balance on the
    day before the date, using `reports.nativeBalanceRows`. That query was extracted from
    `fetchAccountBalances` with the same SQL plus an id filter, so the balance sheet and the check cannot
    disagree. It makes no FX call.
- **`/util/coa/update`** accepts `inactiveFrom`: absent leaves it, null clears it, and it is checked before
  `update()`. `accountsRepo.update` whitelists the column.
- **The COA page:**
  - an *Inactive from* month field, multi-select capable, which also works on a category;
  - an *inherited* hint and *Last activity* in the form;
  - a muted *inactive from 2027-01 (inherited)* badge in the tree.
- **Budget builder `getBuild`:** each line carries `inactive` and `inactiveFrom`, where `inactive` means
  inactive from the target year's 1 January. On a draft the line reads 0, so it has no cells, no total and no
  blocker. A missing rate in its currency is ignored. The page hides these lines (*N line(s) hidden … show
  them*); shown, they are marked *inactive from … publishes nothing*. The done count excludes them.
- **A defect found and fixed on the way.** Saving any *category* in the COA editor posted the placeholder
  currency "—", and the server stored it. Prod had no such row, because no category had been saved there.
  On dev it broke every balance-sheet read that converts by currency, and three suites caught it. The page no
  longer sends a category's currency, and the route refuses anything that is not a 3-letter code (tested).
- **Verification:**
  - `accountInactive.test.js`: 5 tests. Inheritance and parent-wins; the first-of-month rule, in the service and
    in the CHECK; D2 on a leaf and on a parent, naming the leaf and its EUR balance; a posting after the date
    not counted; `listInactive`.
  - Builder: an inactive line is flagged, reads 0, has an all-zero month split, and the USD total drops by
    exactly its figure; a later date and a cleared date bring it back.
  - Route tests: the currency refusal; the date round-trip; a refused date leaves a rename undone.
  - The full server suite: 130 suites, 1,614 tests.
- **Dev walk, in both themes:**
  - `Property - SP - PM4` set from 2027-01 in the COA form;
  - its six leaves show *(inherited)*;
  - a new draft hides 6 lines and its USD total moves from −84,058 to −80,046;
  - `SP - Panorama Mar 4` from 2026-04 is refused: *holds 347,535.00 EUR* on 2026-03-31. From 2027-01 it is
    allowed, because the sale zeroed it in April;
  - the currency stays USD after a category save.

## 8. Review log

**Pass 1 — `cr-technical-reviewer`, rev 1 (2026-11-05): REVISE.** All findings addressed in rev 2:

- **Blocking:**
  - B1, inheritance computed in several walks: one view in 089, §4.1.
  - B2, report builders drop tree fields: the plumbing is listed and tested, §4.3 and §5.2. Verified by the
    author: `buildCashFlowNode` returns `{name, total}`, and `getNestedTree` copies only
    `id/display_order/name/children`.
  - B3, picker versus filter: `mode` on `CategorySelector`, with `HierarchyFilter` as a filter (§4.4). Owner D5.
- **Should-fix:**
  - S1, own versus inherited date: both carried; owner D6, parent wins.
  - S2, the D2 check:
    - native currency;
    - SQL date arithmetic;
    - no FX refresh;
    - the "future date" claim made precise;
    - the false "re-checked" claim replaced by the stated limit.
  - S3: whitelisted, `undefined` versus `null`, validation before the update.
  - S4: picker by transaction date.
  - S5: `isInactiveFor` plus the classified call-site list.
  - S6: the count excludes accepted rows; the `inactivePosting` filter added.
  - S7: activity defined as non-zero net, with LE presence for Budget vs Actual.
  - S8: suggestions and reconciliation surfaces added.
  - S9: the `pruneInactive` signature and the minimum date.
- **Nits:**
  - N1: CHECK.
  - N2: add-from-actuals uses B+1; the FC pool rule is stated.
  - N3: in-scope and non-goal pages enumerated.
  - N4: `/accounts/categories` listed.
  - N5: deploy order.
  - N6: muted token.
- **Owner addition (2026-11-05):** a *Last activity* column on the COA page, and Patrick - USF and the old banks
  in scope as examples.
**Pass 2 — `cr-signoff-pm`, rev 2 (2026-11-05): GO, on four conditions, applied in rev 3:**
1. Freeze treatment: the 11-26 hard stop and the gate, with after-publish as the default (§7).
2. A minimal P1a, with P1b, P2a and P2b, and the long tail moved to the roadmap (§7).
3. The reconciliation exclusion deferred as unverified (§4.5).
4. The index and roadmap drift fixed, and the status set to PLANNED.

Recommendations applied: Last activity kept in P1a; no prod dates before the publish; P2 re-timed around CR064;
rollback stated; `budgetLe.js` marked P2-only; D3 noted as a backstop (a posting to an inactive account always
shows in reports, because hiding needs a zero).

## 9. Surface map (2026-11-05)

- **Inheritance walks:** `accounts.js` `getTree` (:140), `SORT_PATH_CTE` (:28) for `findAll` (:43), `getBalances`
  (:206) and `findPLeaves` (:247); `routes/accounts.js:64` `/accounts/categories`; `forecast/crud.js:228`;
  `fcLines.js:262`.
- **Report builders:** `services/reports.js` `buildBalanceSheetNode` (:219), `buildCashFlowNode` (:428),
  `fetchAccountBalances` (:63/:103); `services/budget.js` budget cash-flow (:644/~689); `services/budgetLe.js`
  (:110, :712).
- **Multi-period pages:** `CashFlowReport.jsx:218-223`, `BalanceSheetPeriods.jsx:96/133`, `BalanceV2.jsx:98/101`.
  Budget: `BudgetVariances.jsx:186/231`, `BudgetRealization.jsx:628/700/721`, `BudgetRealizationGraph.jsx:216`.
  Mobile: MobileCashFlow, MobileBudgetRealization (:87/93), MobileBudgetGraph (:90/96), MobileBalanceTrends (:70).
- **Pickers (drop by date):**
  - `CategorySelector` in picker mode, in `TransactionEditModal`, `ManualTransactionEntry`, `RefreshFeeds` and
    `MobileCategoryPicker`;
  - `TransactionTable.jsx:410/442` (inline edit);
  - `BookAtSourceModal.jsx:70`;
  - `TransferToAccountModal.jsx:23`;
  - `ManualTransactionEntry.jsx:55/62`;
  - `QuickenImport.jsx:1103`.
- **Filters (mute in place):**
  - `HierarchyFilter`, everywhere it is used;
  - `CategorySelector` in filter mode, in `TransactionFilterActual` and `TransactionFilterBudget`;
  - `TransactionFilter.jsx:153/154`;
  - `Ledger.jsx:217/401/731/737`;
  - `useFilterOptions.js:53/54`;
  - `MobileLedger.jsx:37`;
  - `InvestmentReturns.jsx:76`;
  - `BalanceReconciliation.jsx:181`;
  - `TransferAnalysis.jsx:53`.
- **Unchanged:** `BankFeedDiagnostic.jsx:116/129`, which maps feeds and must see every account.
- **Flag pattern:** `NEEDS_OFFSET_SQL` (`repositories/transactions.js:29`, used at :69/:161/:264);
  `ingestPs.js:574`; attention summary `util/ops.js:54`.
- **Suggestions and reconciliation:** `categorySuggest.js:122-147`; `manualReconciliation.js:38-46`;
  `bankFeedReconciliation.js:44/145`.
- **COA:** `COAManagement.jsx`, `COAEditModal.jsx`; `/util/coa/update` (`coa.js:172`, name-keyed);
  `accountsRepo.update` `allowedFields` (`accounts.js:357-362`).
