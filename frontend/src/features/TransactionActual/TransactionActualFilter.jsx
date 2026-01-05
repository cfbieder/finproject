import { useEffect, useState } from "react";
import Rest from "../../js/rest";
import "./TransactionActualFilter.css";

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

export default function TransactionActualFilter({
  onFiltersChange,
  onDeleteClick,
  onSelectAllToggle,
  onEditClick,
  canDelete,
  canEdit,
  isAllSelected,
}) {
  const [accountOptions, setAccountOptions] = useState([]);
  const [categoryOptions, setCategoryOptions] = useState([]);
  const [valueFromEnabled, setValueFromEnabled] = useState(false);
  const [valueToEnabled, setValueToEnabled] = useState(false);
  const [valueFrom, setValueFrom] = useState("");
  const [valueTo, setValueTo] = useState("");
  const [accountEnabled, setAccountEnabled] = useState(false);
  const [categoryEnabled, setCategoryEnabled] = useState(false);
  const [descriptionEnabled, setDescriptionEnabled] = useState(false);
  const [descriptionValue, setDescriptionValue] = useState("");
  const currentMonthIndex = new Date().getMonth();
  const defaultMonth =
    MONTH_OPTIONS[currentMonthIndex] ?? MONTH_OPTIONS[0] ?? "";
  const [selectedYear, setSelectedYear] = useState(() =>
    YEAR_OPTIONS.includes(DEFAULT_YEAR) ? DEFAULT_YEAR : YEAR_OPTIONS[0] ?? ""
  );
  const [selectedMonth, setSelectedMonth] = useState(defaultMonth);
  const yearEnabled = true;
  const [monthEnabled, setMonthEnabled] = useState(true);
  const [selectedAccount, setSelectedAccount] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("");

  useEffect(() => {
    if (typeof document !== "undefined") {
      document.title = "Actual Transactions History";
    }
  }, []);

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
    const normalizedValueTo = valueToEnabled ? parseAmountValue(valueTo) : null;
    onFiltersChange({
      yearEnabled,
      year: selectedYear,
      monthEnabled,
      month: normalizedMonth,
      accountEnabled,
      account: selectedAccount,
      categoryEnabled,
      category: selectedCategory,
      descriptionEnabled,
      description: descriptionValue,
      valueFromEnabled,
      valueFrom: normalizedValueFrom,
      valueToEnabled,
      valueTo: normalizedValueTo,
    });
  }, [
    accountEnabled,
    categoryEnabled,
    selectedAccount,
    selectedCategory,
    selectedMonth,
    selectedYear,
    valueFrom,
    valueFromEnabled,
    valueTo,
    valueToEnabled,
    descriptionEnabled,
    descriptionValue,
    yearEnabled,
    monthEnabled,
    onFiltersChange,
  ]);

  useEffect(() => {
    let isActive = true;

    const loadOptions = async () => {
      try {
        const payload = await Rest.fetchPsDataOptions();
        if (!isActive) {
          return;
        }

        const { accounts = [], categories = [] } = payload ?? {};

        setAccountOptions(Array.isArray(accounts) ? accounts : []);
        setCategoryOptions(Array.isArray(categories) ? categories : []);
      } catch (error) {
        console.error(
          "[TransactionActualFilter] Failed to load psdata options:",
          error
        );
      }
    };

    loadOptions();

    return () => {
      isActive = false;
    };
  }, []);

  useEffect(() => {
    if (!accountOptions.length) {
      setSelectedAccount("");
      return;
    }
    setSelectedAccount((previous) =>
      accountOptions.includes(previous) ? previous : accountOptions[0]
    );
  }, [accountOptions]);

  useEffect(() => {
    if (!categoryOptions.length) {
      setSelectedCategory("");
      return;
    }
    setSelectedCategory((previous) =>
      categoryOptions.includes(previous) ? previous : categoryOptions[0]
    );
  }, [categoryOptions]);

  return (
    <section className="section-filters" aria-label="Actual filters">
      <h2 className="section-filters-title">Actual Transaction History</h2>
      <div className="filters-grid">
        <label className="filter-field">
          <span>Year</span>
          <select
            className="form-input"
            name="year"
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
            value={selectedMonth}
            disabled={!monthEnabled}
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
            className="form-input"
            name="account"
            disabled={!accountEnabled || !accountOptions.length}
            value={selectedAccount}
            onChange={(event) => setSelectedAccount(event.target.value)}
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
            className="form-input"
            name="category"
            disabled={!categoryEnabled || !categoryOptions.length}
            value={selectedCategory}
            onChange={(event) => setSelectedCategory(event.target.value)}
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
              aria-label="Enable description search"
              checked={descriptionEnabled}
              onChange={(event) => setDescriptionEnabled(event.target.checked)}
            />
            Description
          </span>
          <input
            className="form-input"
            type="text"
            name="description"
            placeholder="Search description"
            value={descriptionValue}
            disabled={!descriptionEnabled}
            onChange={(event) => setDescriptionValue(event.target.value)}
          />
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
