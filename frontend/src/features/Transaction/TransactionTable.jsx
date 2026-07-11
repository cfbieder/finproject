import { useEffect, useState } from "react";
import { ChevronUp, ChevronDown, ChevronsUpDown } from "lucide-react";
import RowActionMenu from "./RowActionMenu.jsx";
import Rest from "../../js/rest";
import { EARLIEST_ACTUAL_YEAR } from "../../utils/yearOptions";

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
  const mm = String(next.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(next.getUTCDate()).padStart(2, "0");
  const yy = String(next.getUTCFullYear()).slice(-2);
  return `${mm}/${dd}/${yy}`;
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

// CR022 G3: human-readable label for a transaction's import source. Generic by
// design (the upstream provider, e.g. fintable, is deliberately hidden behind
// 'bank-feed' — see CR022 §3.3), so we show "Bank feed", not "FT".
const SOURCE_LABELS = {
  pocketsmith: "PS",
  "bank-feed": "Bank feed",
  "quicken-import": "Quicken",
};
const formatSourceValue = (value) =>
  value ? SOURCE_LABELS[value] || value : "";

// Cluster sorted rows by a field (e.g. "Account"). Groups are ordered
// alphabetically; rows within each group keep their incoming (already-sorted)
// order. Empty/missing values fall into a "—" group.
function buildAccountGroups(rows, key) {
  const groups = new Map();
  for (const row of rows) {
    const raw = row?.entry?.[key];
    const name =
      (raw === undefined || raw === null ? "" : String(raw).trim()) || "—";
    if (!groups.has(name)) {
      groups.set(name, []);
    }
    groups.get(name).push(row);
  }
  return [...groups.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([name, groupRows]) => ({ name, rows: groupRows }));
}

const SOURCE_COLUMN = {
  key: "Source",
  label: "Source",
  render: formatSourceValue,
  noWrap: true,
};

const TRANSACTION_COLUMNS = [
  { key: "Date", label: "Date", render: formatDateValue, noWrap: true },
  { key: "Description1", label: "Description", render: formatTextValue, style: { maxWidth: "220px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } },
  {
    key: "Amount",
    label: "LC Amount",
    render: formatNumberValue,
    alignRight: true,
    noWrap: true,
  },
  { key: "Currency", label: "Currency", render: formatTextValue },
  {
    key: "BaseAmount",
    label: "USD Amount",
    render: formatNumberValue,
    alignRight: true,
    noWrap: true,
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

export default function TransactionTable({
  config,
  isLoading,
  error,
  hasTransactions,
  hasFilteredTransactions,
  sortedTransactions = [],
  sortConfig = { key: "", direction: "" },
  onSort,
  onRowToggle,
  showSelection = true,
  onDateClick,
  onDescriptionClick,
  onCategoryClick,
  onAcceptClick,
  onSplitClick,
  onNeutralizeClick,
  onTransferClick,
  neutralizingId = null,
  acceptingId = null,
  groupByKey = null,
}) {
  const hasRowActions = !!(onAcceptClick || onSplitClick || onNeutralizeClick || onTransferClick);
  const label = config.logPrefix === "TransActual" ? "Actual"
    : config.logPrefix === "ReviewNew" ? "New"
    : "Budget";
  const lcLabel = label.toLowerCase();
  // CR022 G3: surface the source column only in the review queue, where PS and
  // bank-feed rows mix. Ledger/actuals views keep their original columns.
  const columns = config.logPrefix === "ReviewNew"
    ? [...TRANSACTION_COLUMNS, SOURCE_COLUMN]
    : TRANSACTION_COLUMNS;

  const totalColumnCount =
    (showSelection || hasRowActions ? 1 : 0) + columns.length;
  // When grouping is on, interleave a header row before each account's rows.
  const renderRows = groupByKey
    ? buildAccountGroups(sortedTransactions, groupByKey).flatMap((group) => [
        {
          __groupHeader: true,
          key: `grp-${group.name}`,
          name: group.name,
          count: group.rows.length,
        },
        ...group.rows,
      ])
    : sortedTransactions;

  return (
    <section className="section-table" aria-label={`${label} table`}>
      <div className="section-table__content">
        <div className="trans-budget-table-wrapper">
          {isLoading && renderMessage(`Loading ${lcLabel} transactions...`, false)}
          {!isLoading && error && renderMessage(error, true)}
          {!isLoading &&
            !error &&
            !hasTransactions &&
            renderMessage(`No ${lcLabel} transactions available.`)}
          {!isLoading &&
            !error &&
            hasTransactions &&
            !hasFilteredTransactions &&
            renderMessage(`No ${lcLabel} transactions match the filters.`)}
          {!isLoading && !error && hasFilteredTransactions && (
            <table className="trans-budget-table">
              <thead>
                <tr>
                  {(showSelection || hasRowActions) &&
                    (showSelection ? (
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
                                ? <ChevronDown size={14} />
                                : <ChevronUp size={14} />
                              : <ChevronsUpDown size={14} />}
                          </span>
                        </button>
                      </th>
                    ) : (
                      <th aria-label="Row actions" />
                    ))}
                  {columns.map((column) => (
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
                              ? <ChevronDown size={14} />
                              : <ChevronUp size={14} />
                            : <ChevronsUpDown size={14} />}
                        </span>
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {renderRows.map((item) => {
                  if (item.__groupHeader) {
                    return (
                      <tr key={item.key} className="trans-budget-table__group-header">
                        <td colSpan={totalColumnCount}>
                          {item.name}
                          <span className="trans-budget-table__group-count">
                            ({item.count})
                          </span>
                        </td>
                      </tr>
                    );
                  }
                  const { entry, rowId, isSelected } = item;
                  const entryId = entry?.id ?? entry?._id;
                  const isNeutralizing = neutralizingId != null && neutralizingId === entryId;
                  const isAccepting = acceptingId != null && acceptingId === entryId;
                  // While an async per-row action runs, lock that row's actions to
                  // avoid same-row races (e.g. accepting a row mid-neutralize).
                  const rowBusy = isNeutralizing || isAccepting;
                  return (
                  <tr
                    key={rowId}
                    className={`trans-budget-table__row${showSelection ? "" : " trans-budget-table__row--no-select"}`}
                    onClick={showSelection ? () => onRowToggle?.(rowId, entry) : undefined}
                  >
                    {(showSelection || hasRowActions) && (
                      <td className="trans-budget-table__checkbox-cell">
                        <div className="trans-budget-table__rowctrl">
                        {showSelection && (
                          <input
                            type="checkbox"
                            checked={isSelected}
                            readOnly
                            aria-label={`Select transaction ${rowId}`}
                          />
                        )}
                        {hasRowActions && (
                          <RowActionMenu
                            busy={rowBusy}
                            items={[
                              onCategoryClick && {
                                key: "category",
                                label: "Edit category",
                                tone: "category",
                                disabled: rowBusy,
                                onClick: () => onCategoryClick(rowId, entry),
                              },
                              onSplitClick && {
                                key: "split",
                                label: "Split",
                                tone: "split",
                                disabled: rowBusy,
                                onClick: () => onSplitClick(rowId, entry),
                              },
                              onNeutralizeClick && {
                                key: "neutralize",
                                label: isNeutralizing ? "Neutralizing…" : "Neutralize",
                                tone: "neutralize",
                                disabled: rowBusy,
                                onClick: () => onNeutralizeClick(rowId, entry),
                              },
                              onTransferClick && {
                                key: "transfer",
                                label: "Transfer",
                                tone: "neutralize",
                                disabled: rowBusy,
                                onClick: () => onTransferClick(rowId, entry),
                              },
                              onAcceptClick && {
                                key: "accept",
                                label: isAccepting ? "Accepting…" : "Accept",
                                tone: "accept",
                                disabled: rowBusy,
                                onClick: () => onAcceptClick(rowId, entry),
                              },
                            ].filter(Boolean)}
                          />
                        )}
                        </div>
                      </td>
                    )}
                    {columns.map((column) => {
                      const isClickable =
                        (column.key === "Date" && onDateClick) ||
                        (column.key === "Description1" && onDescriptionClick) ||
                        (column.key === "Category" && onCategoryClick);
                      const handleCellClick = isClickable
                        ? (event) => {
                            event.stopPropagation();
                            if (column.key === "Date") onDateClick(rowId, entry);
                            else if (column.key === "Description1") onDescriptionClick(rowId, entry);
                            else if (column.key === "Category") onCategoryClick(rowId, entry);
                          }
                        : undefined;
                      return (
                        <td
                          key={column.key}
                          className={`trans-budget-table__value${
                            column.alignRight
                              ? " trans-budget-table__value--numeric"
                              : ""
                          }${isClickable ? " trans-budget-table__value--clickable" : ""}`}
                          style={{
                            ...(column.noWrap ? { whiteSpace: "nowrap" } : undefined),
                            ...column.style,
                          }}
                          onClick={handleCellClick}
                        >
                          {column.render(entry[column.key])}
                        </td>
                      );
                    })}
                  </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </section>
  );
}

// ---------- Shared reference data hooks ----------

export function useTransactionCategoryOptions() {
  const [categoryOptions, setCategoryOptions] = useState([]);

  useEffect(() => {
    let isActive = true;

    (async () => {
      try {
        const categories = await Rest.fetchCategoriesV2({ activeOnly: true });
        if (!isActive) {
          return;
        }
        const names = Array.isArray(categories)
          ? categories.map((cat) => cat?.name).filter(Boolean)
          : [];
        setCategoryOptions(names);
      } catch (error) {
        console.error(
          "[TransactionCategoryOptions] Failed to load categories:",
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

export function useTransactionAccountOptions() {
  const [accountOptions, setAccountOptions] = useState([]);

  useEffect(() => {
    let isActive = true;

    (async () => {
      try {
        const accounts = await Rest.fetchAccountsV2({ activeOnly: true, section: 'balance_sheet', leafOnly: true });
        if (!isActive) {
          return;
        }
        const names = Array.isArray(accounts)
          ? accounts.map((acc) => acc?.name).filter(Boolean)
          : [];
        setAccountOptions(names);
      } catch (error) {
        console.error(
          "[TransactionAccountOptions] Failed to load accounts:",
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

export function useTransactionCurrencyOptions() {
  const [currencyOptions, setCurrencyOptions] = useState([]);

  useEffect(() => {
    let isActive = true;

    (async () => {
      try {
        const payload = await Rest.fetchCurrencyOptionsV2();
        if (!isActive) {
          return;
        }
        const currencies = payload?.currencies ?? [];
        setCurrencyOptions(Array.isArray(currencies) ? currencies : []);
      } catch (error) {
        console.error(
          "[TransactionCurrencyOptions] Failed to load currencies:",
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

// ---------- Exchange rates ----------

export const DEFAULT_TRANSACTION_BASE_CURRENCY = "USD";

const normalizeCurrencyCode = (value) => {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim().toUpperCase();
};

const buildRateMap = (doc) => {
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

const resolveExchangeRate = (
  currencyValue,
  rates,
  baseCurrency = DEFAULT_TRANSACTION_BASE_CURRENCY
) => {
  const normalizedBaseCurrency = normalizeCurrencyCode(baseCurrency);
  const normalizedCurrency = normalizeCurrencyCode(currencyValue);
  if (!normalizedCurrency || normalizedCurrency === normalizedBaseCurrency) {
    return 1;
  }
  const rate =
    rates && typeof rates === "object"
      ? rates[normalizedCurrency]
      : undefined;
  return Number.isFinite(rate) ? rate : undefined;
};

export const computeTransactionBaseAmount = (
  amountValue,
  currencyValue,
  rates,
  baseCurrency = DEFAULT_TRANSACTION_BASE_CURRENCY
) => {
  const parsedAmount = Number(amountValue);
  if (!Number.isFinite(parsedAmount)) {
    return undefined;
  }
  const rate = resolveExchangeRate(
    currencyValue,
    rates,
    baseCurrency
  );
  if (!Number.isFinite(rate)) {
    return undefined;
  }
  return parsedAmount / rate;
};

const createDefaultRateMap = () => ({
  [DEFAULT_TRANSACTION_BASE_CURRENCY]: 1,
});

export function useTransactionExchangeRates() {
  const [rates, setRates] = useState(createDefaultRateMap);

  useEffect(() => {
    let isActive = true;

    (async () => {
      try {
        const payload = await Rest.fetchJson("/api/v2/util/appdata");
        if (!isActive) {
          return;
        }
        const appData =
          Array.isArray(payload) && payload.length ? payload[0] : {};
        setRates(buildRateMap(appData));
      } catch (error) {
        if (!isActive) {
          return;
        }
        console.error(
          "[TransactionExchangeRates] Failed to load rates:",
          error
        );
        setRates(createDefaultRateMap());
      }
    })();

    return () => {
      isActive = false;
    };
  }, []);

  return rates;
}

// ---------- Date selector ----------

const TRANSACTION_DATE_YEAR_RANGE = 4;
const TRANSACTION_DATE_CURRENT_YEAR = new Date().getUTCFullYear();
// Span EARLIEST_ACTUAL_YEAR → currentYear + RANGE so historical transaction dates
// (e.g. Quicken backfill back to ~2014) can be entered/edited.
const TRANSACTION_DATE_YEAR_OPTIONS = Array.from(
  { length: TRANSACTION_DATE_CURRENT_YEAR + TRANSACTION_DATE_YEAR_RANGE - EARLIEST_ACTUAL_YEAR + 1 },
  (_, index) => (EARLIEST_ACTUAL_YEAR + index).toString()
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

const getYearMonthDayFromValue = (value) => {
  if (!value) {
    return { year: "", month: "", day: "" };
  }
  const normalized =
    typeof value === "string"
      ? value
      : value instanceof Date
      ? value.toISOString()
      : "";
  if (!normalized) {
    return { year: "", month: "", day: "" };
  }
  const parsed = new Date(normalized);
  if (!Number.isFinite(parsed.getTime())) {
    return { year: "", month: "", day: "" };
  }
  return {
    year: parsed.getUTCFullYear().toString(),
    month: parsed.getUTCMonth().toString(),
    day: parsed.getUTCDate().toString(),
  };
};

const getIsoFromYearMonthDay = (yearValue, monthValue, dayValue) => {
  const normalizedYear = Number.parseInt(yearValue, 10);
  const normalizedMonth = Number.parseInt(monthValue, 10);
  const normalizedDay = Number.parseInt(dayValue, 10);
  if (!Number.isFinite(normalizedYear) || !Number.isFinite(normalizedMonth)) {
    return "";
  }
  const day = Number.isFinite(normalizedDay) ? normalizedDay : 1;
  const date = new Date(Date.UTC(normalizedYear, normalizedMonth, day));
  return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : "";
};

const getDaysInMonth = (yearValue, monthValue) => {
  const year = Number.parseInt(yearValue, 10);
  const month = Number.parseInt(monthValue, 10);
  if (!Number.isFinite(year) || !Number.isFinite(month)) {
    return 31;
  }
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
};

export function TransactionDateSelector({
  value,
  onChange,
  disabled = false,
}) {
  const { year, month, day } = getYearMonthDayFromValue(value);
  const maxDay = getDaysInMonth(year, month);

  const triggerChange = (nextYear, nextMonth, nextDay) => {
    if (typeof onChange !== "function") {
      return;
    }
    if (!nextYear || nextMonth === "" || !nextDay) {
      onChange("");
      return;
    }
    // Clamp day if it exceeds the new month's max
    const clampedDay = Math.min(
      Number.parseInt(nextDay, 10),
      getDaysInMonth(nextYear, nextMonth)
    ).toString();
    onChange(getIsoFromYearMonthDay(nextYear, nextMonth, clampedDay));
  };

  return (
    <div className="trans-budget-edit-modal__date-selector">
      <select
        className="form-input"
        aria-label="Select day"
        disabled={disabled}
        value={day}
        onChange={(event) => triggerChange(year, month, event.target.value)}
      >
        <option value="">Day</option>
        {Array.from({ length: maxDay }, (_, i) => i + 1).map((d) => (
          <option value={d.toString()} key={d}>
            {d}
          </option>
        ))}
      </select>
      <select
        className="form-input"
        aria-label="Select month"
        disabled={disabled}
        value={month}
        onChange={(event) => triggerChange(year, event.target.value, day)}
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
        onChange={(event) => triggerChange(event.target.value, month, day)}
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
