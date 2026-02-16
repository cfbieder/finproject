import { useCallback, useMemo, useState } from "react";
import "./AccountSelector.css";

// ============================================================================
// Helpers
// ============================================================================

/**
 * Groups account names by currency using the provided currency map.
 * Accounts without a currency mapping are placed under "Other".
 * Groups are sorted: the primary currency (default "USD") first, then
 * remaining currencies alphabetically, with "Other" last.
 *
 * @param {string[]} accounts - Account names (excluding "All")
 * @param {Map<string,string>} currencyMap - Account name → currency code
 * @param {string} primaryCurrency - Currency to sort first
 * @returns {Array<{currency: string, accounts: string[]}>}
 */
function groupByCurrency(accounts, currencyMap, primaryCurrency = "USD") {
  const groups = new Map();

  for (const name of accounts) {
    const currency = currencyMap.get(name) ?? "Other";
    if (!groups.has(currency)) {
      groups.set(currency, []);
    }
    groups.get(currency).push(name);
  }

  // Sort each group's accounts alphabetically
  for (const list of groups.values()) {
    list.sort((a, b) => a.localeCompare(b));
  }

  // Build sorted output: primary first, then alpha, "Other" last
  const result = [];
  if (groups.has(primaryCurrency)) {
    result.push({ currency: primaryCurrency, accounts: groups.get(primaryCurrency) });
    groups.delete(primaryCurrency);
  }

  const otherAccounts = groups.get("Other");
  groups.delete("Other");

  const remaining = Array.from(groups.entries()).sort(([a], [b]) =>
    a.localeCompare(b)
  );
  for (const [currency, accts] of remaining) {
    result.push({ currency, accounts: accts });
  }

  if (otherAccounts?.length) {
    result.push({ currency: "Other", accounts: otherAccounts });
  }

  return result;
}

/**
 * Filters grouped accounts by search text, keeping currency headers only
 * if they contain at least one matching account.
 */
function filterGroups(groups, searchText) {
  if (!searchText.trim()) return groups;
  const lower = searchText.trim().toLowerCase();

  const result = [];
  for (const group of groups) {
    const matched = group.accounts.filter((name) =>
      name.toLowerCase().includes(lower)
    );
    if (matched.length) {
      result.push({ currency: group.currency, accounts: matched });
    }
  }
  return result;
}

// ============================================================================
// Component
// ============================================================================

/**
 * Searchable, currency-grouped account multi-select.
 *
 * Reusable shared component — accepts an account list and a currency map
 * to render accounts grouped by currency with type-to-filter search.
 * Visually matches the CategorySelector component.
 *
 * @param {Object} props
 * @param {string[]}          props.accountOptions    – Account names (may include "All")
 * @param {Map<string,string>} props.accountCurrencyMap – Account name → currency code
 * @param {string[]}          props.selectedAccounts  – Currently selected values
 * @param {Function}          props.onAccountsChange  – (nextSelected: string[]) => void
 * @param {boolean}           [props.showAll]         – Show "All" option (default: true)
 * @param {string}            [props.primaryCurrency] – Currency to show first (default: "USD")
 * @param {string}            [props.id]              – Root element ID
 * @param {string}            [props.className]       – Additional CSS class
 */
export default function AccountSelector({
  accountOptions = [],
  accountCurrencyMap = new Map(),
  selectedAccounts = [],
  onAccountsChange,
  showAll = true,
  primaryCurrency = "USD",
  id = "account-selector",
  className = "",
}) {
  const [filterText, setFilterText] = useState("");

  // Separate "All" from real accounts
  const realAccounts = useMemo(
    () => accountOptions.filter((a) => a && a.toLowerCase() !== "all"),
    [accountOptions]
  );

  const hasAll = useMemo(
    () => showAll && accountOptions.some((a) => a === "All"),
    [accountOptions, showAll]
  );

  // Group by currency
  const currencyGroups = useMemo(
    () => groupByCurrency(realAccounts, accountCurrencyMap, primaryCurrency),
    [realAccounts, accountCurrencyMap, primaryCurrency]
  );

  // Apply search filter
  const filteredGroups = useMemo(
    () => filterGroups(currencyGroups, filterText),
    [currencyGroups, filterText]
  );

  // O(1) lookup
  const selectedSet = useMemo(
    () => new Set(selectedAccounts),
    [selectedAccounts]
  );

  const handleItemClick = useCallback(
    (accountName) => {
      const next = selectedSet.has(accountName)
        ? selectedAccounts.filter((a) => a !== accountName)
        : [...selectedAccounts, accountName];
      onAccountsChange(next);
    },
    [selectedAccounts, selectedSet, onAccountsChange]
  );

  const handleAllClick = useCallback(() => {
    const next = selectedSet.has("All")
      ? selectedAccounts.filter((a) => a !== "All")
      : [...selectedAccounts, "All"];
    onAccountsChange(next);
  }, [selectedAccounts, selectedSet, onAccountsChange]);

  const handleFilterClear = () => setFilterText("");

  const handleItemKeyDown = useCallback(
    (event, accountName) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        handleItemClick(accountName);
      }
    },
    [handleItemClick]
  );

  const handleAllKeyDown = useCallback(
    (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        handleAllClick();
      }
    },
    [handleAllClick]
  );

  const totalFiltered = filteredGroups.reduce(
    (sum, g) => sum + g.accounts.length,
    0
  );

  return (
    <div
      className={`account-selector${className ? ` ${className}` : ""}`}
      id={id}
    >
      {/* Search */}
      <div className="account-selector__search">
        <input
          type="text"
          className="account-selector__search-input"
          placeholder="Filter accounts\u2026"
          value={filterText}
          onChange={(e) => setFilterText(e.target.value)}
          aria-label="Filter accounts"
        />
        {filterText && (
          <button
            type="button"
            className="account-selector__search-clear"
            onClick={handleFilterClear}
            aria-label="Clear filter"
          >
            &times;
          </button>
        )}
      </div>

      {/* Scrollable list */}
      <div
        className="account-selector__list"
        role="listbox"
        aria-multiselectable="true"
        aria-label="Account list"
      >
        {/* "All" option — pinned, only shown when not filtering */}
        {hasAll && !filterText.trim() && (
          <div
            role="option"
            aria-selected={selectedSet.has("All")}
            className={`account-selector__all-item${selectedSet.has("All") ? " account-selector__all-item--selected" : ""}`}
            onClick={handleAllClick}
            onKeyDown={handleAllKeyDown}
            tabIndex={0}
          >
            All
          </div>
        )}

        {/* Empty state */}
        {totalFiltered === 0 && filterText.trim() && (
          <div className="account-selector__empty">No matching accounts</div>
        )}

        {/* Currency-grouped accounts */}
        {filteredGroups.map((group) => (
          <div key={`cg-${group.currency}`}>
            <div className="account-selector__currency-header">
              {group.currency}
            </div>
            {group.accounts.map((name) => {
              const isSelected = selectedSet.has(name);
              return (
                <div
                  key={`a-${name}`}
                  role="option"
                  aria-selected={isSelected}
                  className={`account-selector__item${isSelected ? " account-selector__item--selected" : ""}`}
                  onClick={() => handleItemClick(name)}
                  onKeyDown={(e) => handleItemKeyDown(e, name)}
                  tabIndex={0}
                >
                  {name}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
