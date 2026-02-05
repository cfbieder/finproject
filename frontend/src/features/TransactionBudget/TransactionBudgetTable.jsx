import { useEffect, useState } from "react";
import Rest from "../../js/rest";

const numberFormatter = new Intl.NumberFormat(undefined, {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const formatDateValue = (value) => {
  if (!value) {
    return "-";
  }
  const next = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(next.getTime())) {
    return "-";
  }
  const monthNames = [
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
  return `${monthNames[next.getUTCMonth()]} ${next.getUTCFullYear()}`;
};

const formatTextValue = (value) => {
  if (value === undefined || value === null) {
    return "-";
  }
  const text = String(value).trim();
  return text.length ? text : "-";
};

const formatNumberValue = (value) => {
  if (value === undefined || value === null) {
    return "-";
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return "-";
  }
  const isNegative = parsed < 0;
  const formattedValue = numberFormatter.format(Math.abs(parsed));
  const formattedText = isNegative ? `(${formattedValue})` : formattedValue;
  return (
    <span
      className={`trans-budget-table__value-number${
        isNegative ? " trans-budget-table__value-number--negative" : ""
      }`}
    >
      {formattedText}
    </span>
  );
};

const SELECTION_COLUMN = { key: "selected", label: "Selected" };

const TRANSACTION_COLUMNS = [
  { key: "Date", label: "Date", render: formatDateValue },
  { key: "Description1", label: "Description", render: formatTextValue },
  {
    key: "Amount",
    label: "LC Amount",
    render: formatNumberValue,
    alignRight: true,
  },
  { key: "Currency", label: "Currency", render: formatTextValue },
  {
    key: "BaseAmount",
    label: "USD Amount",
    render: formatNumberValue,
    alignRight: true,
  },
  { key: "Account", label: "Account", render: formatTextValue },
  { key: "Category", label: "Category", render: formatTextValue },
];

const renderMessage = (message, isError = false) => (
  <p
    className={`trans-budget-table__message${
      isError ? " trans-budget-table__message--error" : ""
    }`}
  >
    {message}
  </p>
);

export default function TransactionBudgetTable({
  isLoading,
  error,
  hasTransactions,
  hasFilteredTransactions,
  sortedTransactions = [],
  sortConfig = { key: "", direction: "" },
  onSort,
  onRowToggle,
}) {
  return (
    <section className="section-table" aria-label="Budget table">
      <div className="section-table__content">
        <div className="trans-budget-table-wrapper">
          {isLoading && renderMessage("Loading budget transactions...", false)}
          {!isLoading && error && renderMessage(error, true)}
          {!isLoading &&
            !error &&
            !hasTransactions &&
            renderMessage("No budget transactions available.")}
          {!isLoading &&
            !error &&
            hasTransactions &&
            !hasFilteredTransactions &&
            renderMessage("No budget transactions match the filters.")}
          {!isLoading && !error && hasFilteredTransactions && (
            <table className="trans-budget-table">
              <thead>
                <tr>
                  <th>
                    <button
                      type="button"
                      className="trans-budget-table__sort-button"
                      onClick={() => onSort?.(SELECTION_COLUMN.key)}
                    >
                      <span>{SELECTION_COLUMN.label}</span>
                      <span className="trans-budget-table__sort-indicator">
                        {sortConfig.key === SELECTION_COLUMN.key
                          ? sortConfig.direction === "desc"
                            ? "▼"
                            : "▲"
                          : "↕"}
                      </span>
                    </button>
                  </th>
                  {TRANSACTION_COLUMNS.map((column) => (
                    <th key={column.key}>
                      <button
                        type="button"
                        className="trans-budget-table__sort-button"
                        onClick={() => onSort?.(column.key)}
                      >
                        <span>{column.label}</span>
                        <span className="trans-budget-table__sort-indicator">
                          {sortConfig.key === column.key
                            ? sortConfig.direction === "desc"
                              ? "▼"
                              : "▲"
                            : "↕"}
                        </span>
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedTransactions.map(({ entry, rowId, isSelected }) => (
                  <tr
                    key={rowId}
                    className="trans-budget-table__row"
                    onClick={() => onRowToggle?.(rowId, entry)}
                  >
                    <td className="trans-budget-table__checkbox-cell">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        readOnly
                        aria-label={`Select transaction ${rowId}`}
                      />
                    </td>
                    {TRANSACTION_COLUMNS.map((column) => (
                      <td
                        key={column.key}
                        className={`trans-budget-table__value${
                          column.alignRight
                            ? " trans-budget-table__value--numeric"
                            : ""
                        }`}
                      >
                        {column.render(entry[column.key])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </section>
  );
}

export function useTransactionBudgetCategoryOptions() {
  const [categoryOptions, setCategoryOptions] = useState([]);

  useEffect(() => {
    let isActive = true;

    (async () => {
      try {
        // Using v2 API (PostgreSQL)
        const categories = await Rest.fetchCategoriesV2({ activeOnly: true });
        if (!isActive) {
          return;
        }
        // Extract names from v2 response objects
        const names = Array.isArray(categories)
          ? categories.map((cat) => cat?.name).filter(Boolean)
          : [];
        setCategoryOptions(names);
      } catch (error) {
        console.error(
          "[TransactionBudgetCategoryOptions] Failed to load categories:",
          error
        );
      }
    })();

    return () => {
      isActive = false;
    };
  }, []);

  return categoryOptions;
}

export function useTransactionBudgetAccountOptions() {
  const [accountOptions, setAccountOptions] = useState([]);

  useEffect(() => {
    let isActive = true;

    (async () => {
      try {
        // Using v2 API (PostgreSQL)
        const accounts = await Rest.fetchAccountsV2({ activeOnly: true });
        if (!isActive) {
          return;
        }
        // Extract names from v2 response objects
        const names = Array.isArray(accounts)
          ? accounts.map((acc) => acc?.name).filter(Boolean)
          : [];
        setAccountOptions(names);
      } catch (error) {
        console.error(
          "[TransactionBudgetAccountOptions] Failed to load accounts:",
          error
        );
      }
    })();

    return () => {
      isActive = false;
    };
  }, []);

  return accountOptions;
}

export function useTransactionBudgetCurrencyOptions() {
  const [currencyOptions, setCurrencyOptions] = useState([]);

  useEffect(() => {
    let isActive = true;

    (async () => {
      try {
        const payload = await Rest.fetchCurrencyOptions();
        if (!isActive) {
          return;
        }
        const currencies = payload?.currencies ?? [];
        setCurrencyOptions(Array.isArray(currencies) ? currencies : []);
      } catch (error) {
        console.error(
          "[TransactionBudgetCurrencyOptions] Failed to load currencies:",
          error
        );
      }
    })();

    return () => {
      isActive = false;
    };
  }, []);

  return currencyOptions;
}

const TRANSACTION_DATE_YEAR_RANGE = 4;
const TRANSACTION_DATE_CURRENT_YEAR = new Date().getUTCFullYear();
const TRANSACTION_DATE_YEAR_OPTIONS = Array.from(
  { length: TRANSACTION_DATE_YEAR_RANGE * 2 + 1 },
  (_, index) =>
    (
      TRANSACTION_DATE_CURRENT_YEAR -
      TRANSACTION_DATE_YEAR_RANGE +
      index
    ).toString()
);
const TRANSACTION_DATE_MONTH_NAMES = [
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

const getYearMonthFromValue = (value) => {
  if (!value) {
    return { year: "", month: "" };
  }
  const normalized =
    typeof value === "string"
      ? value
      : value instanceof Date
      ? value.toISOString()
      : "";
  if (!normalized) {
    return { year: "", month: "" };
  }
  const parsed = new Date(normalized);
  if (!Number.isFinite(parsed.getTime())) {
    return { year: "", month: "" };
  }
  return {
    year: parsed.getUTCFullYear().toString(),
    month: parsed.getUTCMonth().toString(),
  };
};

const getIsoFromYearMonth = (yearValue, monthValue) => {
  const normalizedYear = Number.parseInt(yearValue, 10);
  const normalizedMonth = Number.parseInt(monthValue, 10);
  if (!Number.isFinite(normalizedYear) || !Number.isFinite(normalizedMonth)) {
    return "";
  }
  const date = new Date(Date.UTC(normalizedYear, normalizedMonth, 1));
  return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : "";
};

export function TransactionBudgetDateSelector({
  value,
  onChange,
  disabled = false,
}) {
  const { year, month } = getYearMonthFromValue(value);

  const triggerChange = (nextYear, nextMonth) => {
    if (typeof onChange !== "function") {
      return;
    }
    if (!nextYear || !nextMonth) {
      onChange("");
      return;
    }
    onChange(getIsoFromYearMonth(nextYear, nextMonth));
  };

  return (
    <div className="trans-budget-edit-modal__date-selector">
      <select
        className="form-input"
        aria-label="Select month"
        disabled={disabled}
        value={month}
        onChange={(event) => triggerChange(year, event.target.value)}
      >
        <option value="">Month</option>
        {TRANSACTION_DATE_MONTH_NAMES.map((monthName, index) => (
          <option value={index.toString()} key={monthName}>
            {monthName}
          </option>
        ))}
      </select>
      <select
        className="form-input"
        aria-label="Select year"
        disabled={disabled}
        value={year}
        onChange={(event) => triggerChange(event.target.value, month)}
      >
        <option value="">Year</option>
        {TRANSACTION_DATE_YEAR_OPTIONS.map((yearOption) => (
          <option value={yearOption} key={yearOption}>
            {yearOption}
          </option>
        ))}
      </select>
    </div>
  );
}

export const TRANSACTION_DESCRIPTION_FIELD_KEY = "Description1";

const DEFAULT_TRANSACTION_BASE_CURRENCY = "USD";

const normalizeCurrencyCode = (value) => {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim().toUpperCase();
};

const buildTransactionBudgetRateMap = (doc) => {
  const map = { [DEFAULT_TRANSACTION_BASE_CURRENCY]: 1 };
  if (!doc || typeof doc !== "object") {
    return map;
  }
  for (const [key, value] of Object.entries(doc)) {
    if (!key || typeof key !== "string") {
      continue;
    }
    const normalizedKey = key.trim().toUpperCase();
    if (!normalizedKey.endsWith("/USD")) {
      continue;
    }
    const [currencyCode] = normalizedKey.split("/USD");
    if (!currencyCode) {
      continue;
    }
    const parsedRate = Number(value);
    if (!Number.isFinite(parsedRate)) {
      continue;
    }
    map[currencyCode] = parsedRate;
  }
  return map;
};

const resolveTransactionBudgetExchangeRate = (
  currencyValue,
  budgetRates,
  baseCurrency = DEFAULT_TRANSACTION_BASE_CURRENCY
) => {
  const normalizedBaseCurrency = normalizeCurrencyCode(baseCurrency);
  const normalizedCurrency = normalizeCurrencyCode(currencyValue);
  if (!normalizedCurrency || normalizedCurrency === normalizedBaseCurrency) {
    return 1;
  }
  const rate =
    budgetRates && typeof budgetRates === "object"
      ? budgetRates[normalizedCurrency]
      : undefined;
  return Number.isFinite(rate) ? rate : undefined;
};

export const computeTransactionBudgetBaseAmount = (
  amountValue,
  currencyValue,
  budgetRates,
  baseCurrency = DEFAULT_TRANSACTION_BASE_CURRENCY
) => {
  const parsedAmount = Number(amountValue);
  if (!Number.isFinite(parsedAmount)) {
    return undefined;
  }
  const rate = resolveTransactionBudgetExchangeRate(
    currencyValue,
    budgetRates,
    baseCurrency
  );
  if (!Number.isFinite(rate)) {
    return undefined;
  }
  return parsedAmount / rate;
};

const createDefaultBudgetRateMap = () => ({
  [DEFAULT_TRANSACTION_BASE_CURRENCY]: 1,
});

export function useTransactionBudgetExchangeRates() {
  const [budgetRates, setBudgetRates] = useState(createDefaultBudgetRateMap);

  useEffect(() => {
    let isActive = true;

    (async () => {
      try {
        // Using v2 API (PostgreSQL)
        const payload = await Rest.fetchJson("/api/v2/util/appdata");
        if (!isActive) {
          return;
        }
        const appData =
          Array.isArray(payload) && payload.length ? payload[0] : {};
        setBudgetRates(buildTransactionBudgetRateMap(appData));
      } catch (error) {
        if (!isActive) {
          return;
        }
        console.error(
          "[TransactionBudgetRates] Failed to load budget rates:",
          error
        );
        setBudgetRates(createDefaultBudgetRateMap());
      }
    })();

    return () => {
      isActive = false;
    };
  }, []);

  return budgetRates;
}

export { DEFAULT_TRANSACTION_BASE_CURRENCY };
