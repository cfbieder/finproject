import { AccountSelector } from "frontend";

// AccountSelector — filterable, currency-grouped account checklist. `accountOptions`
// is a list of account names (plus optional "All"); `accountCurrencyMap` maps each
// name to its currency so the list groups by currency.

const accountOptions = [
  "All",
  "Checking",
  "Savings",
  "Brokerage",
  "Credit Card (EUR)",
  "Pension (GBP)",
];

const accountCurrencyMap = new Map<string, string>([
  ["Checking", "USD"],
  ["Savings", "USD"],
  ["Brokerage", "USD"],
  ["Credit Card (EUR)", "EUR"],
  ["Pension (GBP)", "GBP"],
]);

// The list caps at 260px with internal scroll; raise it for the preview card.
const Frame = ({ children }: { children: any }) => (
  <>
    <style>{`.account-selector__list { max-height: none !important; }`}</style>
    {children}
  </>
);

export const MultiSelect = () => (
  <Frame>
    <div style={{ width: 320 }}>
      <AccountSelector
        accountOptions={accountOptions}
        accountCurrencyMap={accountCurrencyMap}
        selectedAccounts={["Checking", "Brokerage"]}
        onAccountsChange={() => {}}
        primaryCurrency="USD"
      />
    </div>
  </Frame>
);

export const SingleSelect = () => (
  <Frame>
    <div style={{ width: 320 }}>
      <AccountSelector
        accountOptions={accountOptions}
        accountCurrencyMap={accountCurrencyMap}
        selectedAccounts={["Savings"]}
        onAccountsChange={() => {}}
        singleSelect
        showAll={false}
        primaryCurrency="USD"
      />
    </div>
  </Frame>
);
