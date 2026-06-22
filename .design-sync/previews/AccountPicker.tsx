import { AccountPicker } from "frontend";

// AccountPicker — searchable chart-of-accounts combobox. `options` are enriched
// account rows (id, name, section, ancestorPath, searchHaystack); `value` is the
// selected id. Opens its dropdown on focus.

const options = [
  { id: 1, name: "Checking", section: "balance_sheet", ancestorPath: ["Assets", "Cash"], searchHaystack: "assets cash checking" },
  { id: 2, name: "Savings", section: "balance_sheet", ancestorPath: ["Assets", "Cash"], searchHaystack: "assets cash savings" },
  { id: 3, name: "Brokerage", section: "balance_sheet", ancestorPath: ["Assets", "Investments"], searchHaystack: "assets investments brokerage" },
  { id: 4, name: "Credit Card", section: "balance_sheet", ancestorPath: ["Liabilities"], searchHaystack: "liabilities credit card" },
  { id: 5, name: "Salary", section: "profit_loss", ancestorPath: ["Income"], searchHaystack: "income salary" },
  { id: 6, name: "Groceries", section: "profit_loss", ancestorPath: ["Expenses", "Living"], searchHaystack: "expenses living groceries" },
  { id: 7, name: "Transfer", section: "profit_loss", is_transfer: true, ancestorPath: ["Transfers"], searchHaystack: "transfers transfer" },
];

export const WithSelection = () => (
  <div style={{ height: 80 }}>
    <AccountPicker value={3} options={options} onChange={() => {}} placeholder="Search COA…" />
  </div>
);

export const Empty = () => (
  <div style={{ height: 80 }}>
    <AccountPicker value={""} options={options} onChange={() => {}} placeholder="Search chart of accounts…" />
  </div>
);

export const OpenDropdown = () => (
  <div style={{ height: 320 }}>
    <AccountPicker value={""} options={options} onChange={() => {}} autoFocus placeholder="Search COA…" />
  </div>
);
