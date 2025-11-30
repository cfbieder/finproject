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

export default function BudgetInput() {
  const [fromMonth, setFromMonth] = useState(MONTH_OPTIONS[0].value);
  const [toMonth, setToMonth] = useState(MONTH_OPTIONS[11].value);
  const [actualYear, setActualYear] = useState(YEAR_OPTIONS[0]);
  const [budgetYear, setBudgetYear] = useState(YEAR_OPTIONS[0]);
  const [accountOptions, setAccountOptions] = useState(DEFAULT_ACCOUNT_OPTIONS);
  const [categoryOptions, setCategoryOptions] = useState(
    DEFAULT_CATEGORY_OPTIONS
  );
  const [selectedAccounts, setSelectedAccounts] = useState(["All"]);
  const [selectedCategories, setSelectedCategories] = useState([]);

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
                    {YEAR_OPTIONS.map((year) => (
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
            <p className="budget-region__label">Balances_Area</p>
            <p className="budget-region__description">
              Placeholder for balances, summaries, or charts.
            </p>
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
