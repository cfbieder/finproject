import { HierarchyFilter } from "frontend";

// HierarchyFilter — grouped leaf picker with group tabs + a type-to-narrow
// checklist. `groups`: [{ key, label, node: { name, children:[{name}] } }].
// singleSelect + selectedLeaf auto-opens the leaf's group so the checklist shows.

const groups = [
  {
    key: "assets",
    label: "Assets",
    node: {
      name: "Assets",
      children: [{ name: "Checking" }, { name: "Savings" }, { name: "Brokerage" }],
    },
  },
  {
    key: "expenses",
    label: "Expenses",
    node: {
      name: "Expenses",
      children: [{ name: "Groceries" }, { name: "Rent" }, { name: "Utilities" }],
    },
  },
];

export const SingleSelect = () => (
  <div style={{ width: 340 }}>
    <HierarchyFilter
      groups={groups}
      label="Account"
      singleSelect
      selectedLeaf="Brokerage"
      onSelectionChange={() => {}}
      onGroupChange={() => {}}
    />
  </div>
);

export const ExpensesSelected = () => (
  <div style={{ width: 340 }}>
    <HierarchyFilter
      groups={groups}
      label="Category"
      singleSelect
      selectedLeaf="Rent"
      onSelectionChange={() => {}}
      onGroupChange={() => {}}
    />
  </div>
);
