import { useEffect, useState } from "react";
import NavigationMenu from "../components/NavigationMenu.jsx";
import Rest from "../js/rest.js";
import "./BudgetInput.css";

const MONTH_OPTIONS = [
  { value: "01", label: "January" },
  { value: "02", label: "February" },
  { value: "03", label: "March" },
  { value: "04", label: "April" },
  { value: "05", label: "May" },
  { value: "06", label: "June" },
  { value: "07", label: "July" },
  { value: "08", label: "August" },
  { value: "09", label: "September" },
  { value: "10", label: "October" },
  { value: "11", label: "November" },
  { value: "12", label: "December" },
];

const CURRENT_YEAR = new Date().getFullYear();
const YEAR_OPTIONS = Array.from(
  { length: 6 },
  (_, index) => CURRENT_YEAR - index
);

const BUDGET_YEAR_OPTIONS = Array.from(
  { length: 6 },
  (_, index) => CURRENT_YEAR - 1 + index
);

const ensureAllOption = (values) => {
  if (!Array.isArray(values)) {
    values = [];
  }

  const normalized = values
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter((value) => value.length > 0);

  const unique = Array.from(new Set(normalized));
  const rest = unique.filter((value) => value !== "All");

  return ["All", ...rest];
};

const DEFAULT_ACCOUNT_OPTIONS = ensureAllOption([
  "Checking",
  "Savings",
  "Credit Card",
  "Investments",
  "Payables",
]);

const DEFAULT_CATEGORY_OPTIONS = [
  "Revenue",
  "Cost of Goods Sold",
  "Operating Expenses",
  "Investments",
  "Other Income",
];

const normalizeMonthNumber = (value, fallback) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  const normalized = Math.floor(parsed);
  if (normalized < 1) {
    return fallback;
  }
  if (normalized > 12) {
    return fallback;
  }

  return normalized;
};

const buildMonthSequence = (fromValue, toValue) => {
  const fromMonth = normalizeMonthNumber(fromValue, 1);
  const toMonth = normalizeMonthNumber(toValue, 12);
  const start = Math.min(fromMonth, toMonth);
  const end = Math.max(fromMonth, toMonth);
  const months = [];
  for (let next = start; next <= end; next += 1) {
    months.push(next);
  }
  return months;
};

const getMonthLabel = (monthNumber) => {
  const found = MONTH_OPTIONS.find(
    (option) => Number(option.value) === monthNumber
  );
  return found ? found.label : `Month ${monthNumber}`;
};

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});

const formatCurrencyValue = (value) => {
  const normalized = Number.isFinite(value) ? value : 0;
  return currencyFormatter.format(normalized);
};

export default function BudgetInput() {
  const [fromMonth, setFromMonth] = useState(MONTH_OPTIONS[0].value);
  const [toMonth, setToMonth] = useState(MONTH_OPTIONS[11].value);
  const [actualYear, setActualYear] = useState(YEAR_OPTIONS[0]);
  const [budgetYear, setBudgetYear] = useState(BUDGET_YEAR_OPTIONS[2]);
  const [accountOptions, setAccountOptions] = useState(DEFAULT_ACCOUNT_OPTIONS);
  const [categoryOptions, setCategoryOptions] = useState(
    DEFAULT_CATEGORY_OPTIONS
  );
  const [selectedAccounts, setSelectedAccounts] = useState(["All"]);
  const [selectedCategories, setSelectedCategories] = useState([]);
  const [balanceRows, setBalanceRows] = useState([]);
  const [balancesStatus, setBalancesStatus] = useState({
    loading: true,
    error: "",
  });

  useEffect(() => {
    let isActive = true;

    const loadFilters = async () => {
      try {
        const { accounts = [], categories = [] } =
          await Rest.fetchPsDataOptions();
        if (!isActive) {
          return;
        }

        if (Array.isArray(accounts)) {
          setAccountOptions(ensureAllOption(accounts));
        }

        if (Array.isArray(categories) && categories.length) {
          setCategoryOptions(categories);
        }
      } catch (error) {
        console.error("[BudgetInput] Failed to load psdata options:", error);
      }
    };

    loadFilters();

    return () => {
      isActive = false;
    };
  }, []);

  const handleAccountsChange = (event) => {
    const nextValues = Array.from(
      event.target.selectedOptions,
      (option) => option.value
    );
    setSelectedAccounts(nextValues);
  };

  const handleCategoriesChange = (event) => {
    const nextValues = Array.from(
      event.target.selectedOptions,
      (option) => option.value
    );
    setSelectedCategories(nextValues);
  };

  useEffect(() => {
    let isActive = true;

    const fetchBalances = async () => {
      setBalancesStatus({ loading: true, error: "" });
      setBalanceRows([]);

      try {
        const accountsToFilter = selectedAccounts.filter(
          (account) => account && account !== "All"
        );

        const payload = await Rest.fetchBudgetBalances({
          fromMonth,
          toMonth,
          actualYear,
          budgetYear,
          categories: selectedCategories,
          accounts: accountsToFilter,
        });

        if (!isActive) {
          return;
        }

        const monthSequence =
          Array.isArray(payload.months) && payload.months.length
            ? payload.months
            : buildMonthSequence(fromMonth, toMonth);

        const rows = monthSequence.map((monthNumber) => {
          const actualValue = payload.actualByMonth?.[monthNumber];
          const budgetValue = payload.budgetByMonth?.[monthNumber];
          const actual = Number.isFinite(actualValue) ? actualValue : 0;
          const budget = Number.isFinite(budgetValue) ? budgetValue : 0;
          return {
            monthNumber,
            monthLabel: getMonthLabel(monthNumber),
            actual,
            budget,
            difference: actual - budget,
          };
        });

        setBalanceRows(rows);
        setBalancesStatus({ loading: false, error: "" });
      } catch (error) {
        if (!isActive) {
          return;
        }
        console.error("[BudgetInput] Failed to load balance summary:", error);
        setBalanceRows([]);
        setBalancesStatus({
          loading: false,
          error: error?.message || "Unable to load balance data.",
        });
      }
    };

    fetchBalances();

    return () => {
      isActive = false;
    };
  }, [
    fromMonth,
    toMonth,
    actualYear,
    budgetYear,
    selectedCategories,
    selectedAccounts,
  ]);

  const totals = balanceRows.reduce(
    (acc, row) => ({
      actual: acc.actual + row.actual,
      budget: acc.budget + row.budget,
      difference: acc.difference + row.difference,
    }),
    { actual: 0, budget: 0, difference: 0 }
  );

  return (
    <div className="page-shell">
      <NavigationMenu />
      <main className="page-main">
        <div className="budget-input-grid">
          <section className="budget-region selector-area">
            <p className="budget-region__label">Filter Controls</p>
            <p className="budget-region__description">
              Choose the period and slices that drive the budget comparison.
            </p>
            <div className="selector-grid">
              <div className="selector-grid__row">
                <div className="selector-control">
                  <label
                    htmlFor="month-from"
                    className="selector-control__label"
                  >
                    Month (from)
                  </label>
                  <select
                    id="month-from"
                    className="selector-control__input"
                    value={fromMonth}
                    onChange={(event) => setFromMonth(event.target.value)}
                  >
                    {MONTH_OPTIONS.map((month) => (
                      <option key={`from-${month.value}`} value={month.value}>
                        {month.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="selector-control">
                  <label htmlFor="month-to" className="selector-control__label">
                    Month (to)
                  </label>
                  <select
                    id="month-to"
                    className="selector-control__input"
                    value={toMonth}
                    onChange={(event) => setToMonth(event.target.value)}
                  >
                    {MONTH_OPTIONS.map((month) => (
                      <option key={`to-${month.value}`} value={month.value}>
                        {month.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="selector-grid__row">
                <div className="selector-control">
                  <label
                    htmlFor="actual-year"
                    className="selector-control__label"
                  >
                    Actual Year
                  </label>
                  <select
                    id="actual-year"
                    className="selector-control__input"
                    value={actualYear}
                    onChange={(event) =>
                      setActualYear(Number(event.target.value))
                    }
                  >
                    {YEAR_OPTIONS.map((year) => (
                      <option key={`actual-${year}`} value={year}>
                        {year}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="selector-control">
                  <label
                    htmlFor="budget-year"
                    className="selector-control__label"
                  >
                    Budget Year
                  </label>
                  <select
                    id="budget-year"
                    className="selector-control__input"
                    value={budgetYear}
                    onChange={(event) =>
                      setBudgetYear(Number(event.target.value))
                    }
                  >
                    {BUDGET_YEAR_OPTIONS.map((year) => (
                      <option key={`budget-${year}`} value={year}>
                        {year}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="selector-control selector-control--spanning">
                <label
                  htmlFor="account-selector"
                  className="selector-control__label"
                >
                  Accounts
                </label>
                <select
                  id="account-selector"
                  className="selector-control__input"
                  value={selectedAccounts}
                  multiple
                  size={4}
                  onChange={handleAccountsChange}
                >
                  {accountOptions.map((account) => (
                    <option key={`account-${account}`} value={account}>
                      {account}
                    </option>
                  ))}
                </select>
              </div>
              <div className="selector-control selector-control--spanning">
                <label
                  htmlFor="category-selector"
                  className="selector-control__label"
                >
                  Categories
                </label>
                <select
                  id="category-selector"
                  className="selector-control__input"
                  value={selectedCategories}
                  multiple
                  size={5}
                  onChange={handleCategoriesChange}
                >
                  {categoryOptions.map((category) => (
                    <option key={`category-${category}`} value={category}>
                      {category}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </section>

          <section className="budget-region balances-area">
            <div className="balances-area__header">
              <div>
                <p className="budget-region__label">Balances</p>
                <p className="budget-region__description">
                  Comparing actual and budget BaseAmount for the selected months.
                </p>
              </div>
              {balancesStatus.loading && (
                <p className="balances-area__status">Loading balances…</p>
              )}
            </div>

            {balancesStatus.error && (
              <p className="balances-area__status balances-area__status--error">
                {balancesStatus.error}
              </p>
            )}

            <div className="balances-area__table-wrapper">
              <table className="balances-table">
                <thead>
                  <tr>
                    <th>Month</th>
                    <th className="balances-table__numeric">Actual</th>
                    <th className="balances-table__numeric">Budget</th>
                    <th className="balances-table__numeric">Difference</th>
                  </tr>
                </thead>
                <tbody>
                  {balanceRows.map((row) => (
                    <tr key={`balance-${row.monthNumber}`}>
                      <td>{row.monthLabel}</td>
                      <td className="balances-table__numeric">
                        {formatCurrencyValue(row.actual)}
                      </td>
                      <td className="balances-table__numeric">
                        {formatCurrencyValue(row.budget)}
                      </td>
                      <td className="balances-table__numeric">
                        {formatCurrencyValue(row.difference)}
                      </td>
                    </tr>
                  ))}
                  {!balanceRows.length && !balancesStatus.loading && (
                    <tr>
                      <td colSpan={4} className="balances-table__empty">
                        No balance data available for the selected months.
                      </td>
                    </tr>
                  )}
                </tbody>
                {balanceRows.length ? (
                  <tfoot>
                    <tr>
                      <td>Total</td>
                      <td className="balances-table__numeric">
                        {formatCurrencyValue(totals.actual)}
                      </td>
                      <td className="balances-table__numeric">
                        {formatCurrencyValue(totals.budget)}
                      </td>
                      <td className="balances-table__numeric">
                        {formatCurrencyValue(totals.difference)}
                      </td>
                    </tr>
                  </tfoot>
                ) : null}
              </table>
            </div>
          </section>

          <section className="budget-region input-area">
            <p className="budget-region__label">Input_Area</p>
            <p className="budget-region__description">
              Placeholder for budget inputs and detail forms.
            </p>
          </section>
        </div>
      </main>
    </div>
  );
}
