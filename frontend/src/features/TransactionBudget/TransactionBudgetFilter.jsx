import { useEffect, useState } from "react";
import Rest from "../../js/rest";
import "./TransactionBudgetFilter.css";

const currentYear = new Date().getFullYear();
const YEAR_OPTIONS = Array.from({ length: 7 }, (_, index) =>
  (currentYear - 3 + index).toString()
);
const DEFAULT_YEAR = currentYear.toString();
const MONTH_OPTIONS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const parseAmountValue = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export default function TransactionBudgetFilter({
  onFiltersChange,
  onDeleteClick,
  onSelectAllToggle,
  onEditClick,
  canDelete,
  canEdit,
  isAllSelected,
  filteredTotalsByCurrency = [],
}) {
  const [accountOptions, setAccountOptions] = useState([]);
  const [categoryOptions, setCategoryOptions] = useState([]);
  const [currencyOptions, setCurrencyOptions] = useState([]);
  const [valueFromEnabled, setValueFromEnabled] = useState(false);
  const [valueToEnabled, setValueToEnabled] = useState(false);
  const [valueFrom, setValueFrom] = useState("");
  const [valueTo, setValueTo] = useState("");
  const [yearEnabled, setYearEnabled] = useState(false);
  const [monthEnabled, setMonthEnabled] = useState(false);
  const [accountEnabled, setAccountEnabled] = useState(false);
  const [categoryEnabled, setCategoryEnabled] = useState(false);
  const [currencyEnabled, setCurrencyEnabled] = useState(false);
  const [selectedYear, setSelectedYear] = useState(() =>
    YEAR_OPTIONS.includes(DEFAULT_YEAR)
      ? DEFAULT_YEAR
      : YEAR_OPTIONS[0] ?? ""
  );
  const [selectedMonth, setSelectedMonth] = useState(MONTH_OPTIONS[0] ?? "");
  const [selectedAccount, setSelectedAccount] = useState([]);
  const [selectedCategory, setSelectedCategory] = useState([]);
  const [selectedCurrency, setSelectedCurrency] = useState([]);
  const formatAmount = (amount) =>
    new Intl.NumberFormat(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  const multiSelectSize = 8;

  useEffect(() => {
    if (typeof onFiltersChange !== "function") {
      return;
    }
    const monthIndex = MONTH_OPTIONS.findIndex(
      (option) => option === selectedMonth
    );
    const normalizedMonth = monthIndex >= 0 ? monthIndex : null;
    const normalizedValueFrom = valueFromEnabled
      ? parseAmountValue(valueFrom)
      : null;
    const normalizedValueTo = valueToEnabled
      ? parseAmountValue(valueTo)
      : null;
    onFiltersChange({
      yearEnabled,
      year: selectedYear,
      monthEnabled,
      month: normalizedMonth,
      accountEnabled,
      account: selectedAccount,
      categoryEnabled,
      category: selectedCategory,
      valueFromEnabled,
      valueFrom: normalizedValueFrom,
      valueToEnabled,
      valueTo: normalizedValueTo,
      currencyEnabled,
      currency: selectedCurrency,
    });
  }, [
    accountEnabled,
    categoryEnabled,
    currencyEnabled,
    selectedCurrency,
    monthEnabled,
    selectedAccount,
    selectedCategory,
    selectedMonth,
    selectedYear,
    valueFrom,
    valueFromEnabled,
    valueTo,
    valueToEnabled,
    yearEnabled,
    onFiltersChange,
  ]);

  useEffect(() => {
    let isActive = true;

    const loadOptions = async () => {
      try {
        // Using v2 API (PostgreSQL)
        const [accountsData, categoriesData] = await Promise.all([
          Rest.fetchAccountsV2({ activeOnly: true, section: 'balance_sheet' }),
          Rest.fetchCategoriesV2({ activeOnly: true }),
        ]);
        if (!isActive) {
          return;
        }

        // Extract names from v2 response objects
        const accounts = Array.isArray(accountsData)
          ? accountsData.map((acc) => acc?.name).filter(Boolean)
          : [];
        const categories = Array.isArray(categoriesData)
          ? categoriesData.map((cat) => cat?.name).filter(Boolean)
          : [];

        setAccountOptions(accounts);
        setCategoryOptions(categories);
      } catch (error) {
        console.error("[TransactionBudgetFilter] Failed to load options:", error);
      }
    };

    loadOptions();

    return () => {
      isActive = false;
    };
  }, []);

  useEffect(() => {
    let isActive = true;

    const loadCurrencies = async () => {
      try {
        const payload = await Rest.fetchCurrencyOptions();
        if (!isActive) {
          return;
        }
        const currencies = payload?.currencies ?? [];
        setCurrencyOptions(Array.isArray(currencies) ? currencies : []);
      } catch (error) {
        console.error(
          "[TransactionBudgetFilter] Failed to load currencies:",
          error
        );
      }
    };

    loadCurrencies();

    return () => {
      isActive = false;
    };
  }, []);

  useEffect(() => {
    setSelectedAccount((previous) =>
      Array.isArray(previous)
        ? previous.filter((value) => accountOptions.includes(value))
        : []
    );
  }, [accountOptions]);

  useEffect(() => {
    setSelectedCategory((previous) =>
      Array.isArray(previous)
        ? previous.filter((value) => categoryOptions.includes(value))
        : []
    );
  }, [categoryOptions]);

  useEffect(() => {
    setSelectedCurrency((previous) =>
      Array.isArray(previous)
        ? previous.filter((value) => currencyOptions.includes(value))
        : []
    );
  }, [currencyOptions]);

  const handleMultiChange = (event, setter) => {
    const values = Array.from(event.target.selectedOptions).map(
      (option) => option.value
    );
    setter(values);
  };

  return (
    <section className="section-filters" aria-label="Budget filters">
      <h2 className="section-filters-title">Budget Transaction</h2>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: "0.75rem",
          marginBottom: "0.5rem",
        }}
      >
        <strong style={{ fontSize: "0.95rem" }}>Filtered totals:</strong>
        {filteredTotalsByCurrency.length ? (
          filteredTotalsByCurrency.map(({ currency, amount }) => (
            <span
              key={currency}
              style={{
                padding: "0.25rem 0.5rem",
                borderRadius: "6px",
                background: "var(--surface-muted)",
                border: "1px solid var(--border)",
                fontWeight: 600,
                fontSize: "0.9rem",
              }}
            >
              {currency}: {formatAmount(amount)}
            </span>
          ))
        ) : (
          <span style={{ color: "var(--muted)", fontSize: "0.9rem" }}>
            No totals available
          </span>
        )}
      </div>
      <div className="filters-grid">
        <label className="filter-field">
          <span className="filter-with-checkbox">
            <input
              type="checkbox"
              aria-label="Enable year filter"
              checked={yearEnabled}
              onChange={(event) => setYearEnabled(event.target.checked)}
            />
            Year
          </span>
          <select
            className="form-input"
            name="year"
            disabled={!yearEnabled}
            value={selectedYear}
            onChange={(event) => setSelectedYear(event.target.value)}
          >
            {YEAR_OPTIONS.map((year) => (
              <option value={year} key={year}>
                {year}
              </option>
            ))}
          </select>
        </label>
        <label className="filter-field">
          <span className="filter-with-checkbox">
            <input
              type="checkbox"
              aria-label="Enable month filter"
              checked={monthEnabled}
              onChange={(event) => setMonthEnabled(event.target.checked)}
            />
            Month
          </span>
          <select
            className="form-input"
            name="month"
            disabled={!monthEnabled}
            value={selectedMonth}
            onChange={(event) => setSelectedMonth(event.target.value)}
          >
            {MONTH_OPTIONS.map((month) => (
              <option value={month} key={month}>
                {month}
              </option>
            ))}
          </select>
        </label>
        <label className="filter-field">
          <span className="filter-with-checkbox">
            <input
              type="checkbox"
              aria-label="Enable account filter"
              checked={accountEnabled}
              onChange={(event) => setAccountEnabled(event.target.checked)}
            />
            Account
          </span>
          <select
            multiple
            size={multiSelectSize}
            className="form-input"
            name="account"
            disabled={!accountEnabled || !accountOptions.length}
            value={selectedAccount}
            onChange={(event) => handleMultiChange(event, setSelectedAccount)}
          >
            {accountOptions.length ? (
              accountOptions.map((account) => (
                <option value={account} key={account}>
                  {account}
                </option>
              ))
            ) : (
              <option value="" disabled>
                Loading...
              </option>
            )}
          </select>
        </label>
        <label className="filter-field">
          <span className="filter-with-checkbox">
            <input
              type="checkbox"
              aria-label="Enable category filter"
              checked={categoryEnabled}
              onChange={(event) => setCategoryEnabled(event.target.checked)}
            />
            Category
          </span>
          <select
            multiple
            size={multiSelectSize}
            className="form-input"
            name="category"
            disabled={!categoryEnabled || !categoryOptions.length}
            value={selectedCategory}
            onChange={(event) => handleMultiChange(event, setSelectedCategory)}
          >
            {categoryOptions.length ? (
              categoryOptions.map((category) => (
                <option value={category} key={category}>
                  {category}
                </option>
              ))
            ) : (
              <option value="" disabled>
                Loading...
              </option>
            )}
          </select>
        </label>
        <label className="filter-field">
          <span className="filter-with-checkbox">
            <input
              type="checkbox"
              aria-label="Enable currency filter"
              checked={currencyEnabled}
              onChange={(event) => setCurrencyEnabled(event.target.checked)}
            />
            Currency
          </span>
          <select
            multiple
            size={multiSelectSize}
            className="form-input"
            name="currency"
            disabled={!currencyEnabled || !currencyOptions.length}
            value={selectedCurrency}
            onChange={(event) => handleMultiChange(event, setSelectedCurrency)}
          >
            {currencyOptions.length ? (
              currencyOptions.map((currency) => (
                <option value={currency} key={currency}>
                  {currency}
                </option>
              ))
            ) : (
              <option value="" disabled>
                Loading...
              </option>
            )}
          </select>
        </label>
      </div>
      <div className="range-inputs">
        <div className="range-input-group">
          <label className="filter-field range-field">
            <span>Value from</span>
            <div className="range-controls">
              <input
                type="checkbox"
                className="range-checkbox"
                name="value-from-enabled"
                aria-label="Enable lower bound"
                checked={valueFromEnabled}
                onChange={(event) => {
                  const checked = event.target.checked;
                  setValueFromEnabled(checked);
                  if (!checked) {
                    setValueFrom("");
                  }
                }}
              />
              <input
                className="form-input"
                type="number"
                name="value-from"
                placeholder="0.00"
                inputMode="decimal"
                step="any"
                value={valueFromEnabled ? valueFrom : ""}
                disabled={!valueFromEnabled}
                onChange={(event) => {
                  if (!valueFromEnabled) {
                    return;
                  }
                  setValueFrom(event.target.value);
                }}
              />
            </div>
          </label>
        </div>
        <div className="range-input-group">
          <label className="filter-field range-field">
            <span>Value to</span>
            <div className="range-controls">
              <input
                type="checkbox"
                className="range-checkbox"
                name="value-to-enabled"
                aria-label="Enable upper bound"
                checked={valueToEnabled}
                onChange={(event) => {
                  const checked = event.target.checked;
                  setValueToEnabled(checked);
                  if (!checked) {
                    setValueTo("");
                  }
                }}
              />
              <input
                className="form-input"
                type="number"
                name="value-to"
                placeholder="0.00"
                inputMode="decimal"
                step="any"
                value={valueToEnabled ? valueTo : ""}
                disabled={!valueToEnabled}
                onChange={(event) => {
                  if (!valueToEnabled) {
                    return;
                  }
                  setValueTo(event.target.value);
                }}
              />
            </div>
          </label>
        </div>
        <div className="range-input-group range-input-actions">
          <button
            className="generate-report-button"
            type="button"
            onClick={onEditClick}
            disabled={!canEdit}
          >
            Edit
          </button>
          <button
            className="generate-report-button"
            type="button"
            onClick={onSelectAllToggle}
          >
            All
          </button>
          <button
            className={`generate-report-button trans-budget-filter__delete-button${
              canDelete ? " trans-budget-filter__delete-button--active" : ""
            }`}
            type="button"
            onClick={onDeleteClick}
            disabled={!canDelete}
          >
            Delete
          </button>
        </div>
      </div>
    </section>
  );
}
