**Status:** COMPLETED — [Plan](../current/project-roadmap.md#cr008)

# CR008 — HierarchyFilter & Transaction Pages Redesign

Two-stage cascading filter component replacing `CategorySelector` + `AccountSelector` on transaction-explorer pages. Plus full redesign of `/trans-actual` and `/trans-budget` with KPI cards, slide-in drawers, and contextual action bars.

## Outcome — HierarchyFilter

- New shared component: `frontend/src/components/HierarchyFilter/HierarchyFilter.jsx`.
- **Stage 1:** Pill buttons for COA hierarchy groups (Categories: All / Income / Expense / Transfers; Accounts: BS COA sub-groups). Each pill shows item count.
- **Stage 2:** Compact scrollable checklist of leaf items under the active group; right-click any item to solo-select.
- Transfer Match Status toggle (All / Matched / Unmatched) appears contextually only when the Transfers group is active.
- Used on: Actual Transactions, Budget Transactions, Budget Worksheet — and since, Balance
  Trends, Ledger (`singleSelect`), the FC line drill-down (`initialGroupKey`) and Cash Flow
  **By Account** ([CR054](cr-054-cash-flow-by-account.md)).

### Extended v3.42.0 — `multiGroup`: a selection that spans groups

The pills were **mutually exclusive** — `emitSelection` returned only the active group's
leaves — so a selection could never span two groups (the owner's case: *Bank Accounts* **and**
*PLN Credit Cards*). Opt-in `multiGroup` turns the pills into **toggles**: several groups stay
active, the checklist stacks them under sticky sub-headers, and the emitted value is the
**union** of the checked leaves. A summary line reports what the pills add up to, since
otherwise a cross-group selection is only legible by clicking through every pill.

⚠️ **Off by default, and that is the whole design constraint.** In the standard mode a second
pill click **replaces** the selection, and **six** other surfaces depend on that — Ledger,
TransActual, TransBudget, BalanceTrends, BudgetWorksheetV2 and the FC line drill-down. Flipping
the semantics globally would have changed all six without being asked. Internally the single
`activeGroup` became an ordered `activeKeys` list that holds **0 or 1 keys** in the standard
mode, so those six render through the same code path they always did (sub-headers appear only
at 2+ active groups). The union is safe because `buildAccountFilterGroups` emits **one chip per
account-type node** — the groups are disjoint, so no leaf can be counted twice.

Three semantics the mode had to settle, none of them obvious:

- **"All" still means *no filter*, not *everything checked*** — it emits `[]`, as it always has.
- **A group toggled back on starts fully checked**, matching what opening a group has always
  done. (The pre-existing reset-on-open was load-bearing once selections accumulate.)
- **Right-click-to-solo now clears every active group.** "Select only this item" has to mean
  the emitted list is exactly that item, not that item plus another group's whole list.

No server or API change: `GET /api/v2/cash-flow` has always taken `accounts` as a repeatable
param and does `a.name = ANY(...)` — **a flat list of names with no concept of groups**
([reports.js:72](../../server/src/v2/routes/reports.js#L72)). The restriction was created
entirely by the component. Applied so far on the **Accounts** filter of Cash Flow By Account
only; see [CR054](cr-054-cash-flow-by-account.md) for the ask and the open inconsistency.

## Outcome — Transaction page redesign

- `/trans-actual` and `/trans-budget` rewritten with: unified toolbar (instant search + filter toggle + export), active filter chips with one-click removal, collapsible filter panel, KPI summary cards (per-currency totals, income/expenses), contextual selection bar (Edit / Split / Neutralize / Delete) with slide-down animation, custom-styled checkboxes, hover row actions, color-coded amounts, monospace tabular-nums.
- Split modal replaced by slide-in drawer.
- Both pages share `TransactionExplorer.css`.
- Budget retains category group options + this-year default; Actual retains description search + split/neutralize.

## Key references

- Component: `frontend/src/components/HierarchyFilter/`.
- Pages: `frontend/src/pages/TransActual.jsx`, `TransBudget.jsx`.
- Shared CSS: `frontend/src/pages/TransactionExplorer.css`.
- Budget Worksheet integration: `frontend/src/pages/BudgetWorksheetV2.jsx`.
