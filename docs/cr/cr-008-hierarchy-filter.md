**Status:** COMPLETED — [Plan](../current/project-roadmap.md#cr008)

# CR008 — HierarchyFilter & Transaction Pages Redesign

Two-stage cascading filter component replacing `CategorySelector` + `AccountSelector` on transaction-explorer pages. Plus full redesign of `/trans-actual` and `/trans-budget` with KPI cards, slide-in drawers, and contextual action bars.

## Outcome — HierarchyFilter

- New shared component: `frontend/src/components/HierarchyFilter/HierarchyFilter.jsx`.
- **Stage 1:** Pill buttons for COA hierarchy groups (Categories: All / Income / Expense / Transfers; Accounts: BS COA sub-groups). Each pill shows item count.
- **Stage 2:** Compact scrollable checklist of leaf items under the active group; right-click any item to solo-select.
- Transfer Match Status toggle (All / Matched / Unmatched) appears contextually only when the Transfers group is active.
- Used on: Actual Transactions, Budget Transactions, Budget Worksheet.

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
