import { CategorySelector } from "frontend";

// CategorySelector — filterable P&L category checklist built from a tree.
// `plTree` nodes: depth-0 with children = header, nested = parent/leaf.
// The list has a 260px internal scroll cap; for the preview we raise it so the
// whole checklist is visible on the card.

const Frame = ({ children }: { children: any }) => (
  <>
    <style>{`.category-selector__list { max-height: none !important; }`}</style>
    {children}
  </>
);

const plTree = [
  {
    name: "Income",
    children: [{ name: "Salary" }, { name: "Dividends" }, { name: "Interest" }],
  },
  {
    name: "Expenses",
    children: [
      { name: "Groceries" },
      { name: "Rent" },
      { name: "Utilities" },
      { name: "Transport" },
    ],
  },
];

export const MultiSelect = () => (
  <Frame>
    <div style={{ width: 320 }}>
      <CategorySelector
        plTree={plTree}
        selectedCategories={["Salary", "Groceries", "Rent"]}
        onCategoriesChange={() => {}}
        multiSelect
      />
    </div>
  </Frame>
);

export const SingleSelect = () => (
  <Frame>
    <div style={{ width: 320 }}>
      <CategorySelector
        plTree={plTree}
        selectedCategories={["Utilities"]}
        onCategoriesChange={() => {}}
      />
    </div>
  </Frame>
);
