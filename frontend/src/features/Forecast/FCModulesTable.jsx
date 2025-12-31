import { useMemo, useState } from "react";
import "./FCModulesTable.css";

/**
 * Formats a currency value without decimal places.
 * Handles negative values with proper sign placement.
 *
 * @param {number|string|null|undefined} value - The value to format
 * @returns {string} Formatted currency string with $ sign or "-" if invalid
 */
const formatCurrencyNoDecimals = (value) => {
  if (value === undefined || value === null || Number.isNaN(Number(value))) {
    return "-";
  }
  const numberValue = Number(value);
  const formatted = Math.abs(numberValue).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
  return numberValue < 0 ? `-$${formatted}` : `$${formatted}`;
};

/**
 * Formats a currency value with two decimal places.
 *
 * @param {number|string|null|undefined} value - The value to format
 * @returns {string} Formatted currency string or "-" if invalid
 */
const formatCurrency = (value) => {
  if (value === undefined || value === null || Number.isNaN(Number(value))) {
    return "-";
  }
  return Number(value).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
};

/**
 * Formats a date value to locale date string.
 *
 * @param {Date|string|null|undefined} value - The date value to format
 * @returns {string} Formatted date string or "-" if invalid
 */
const formatDate = (value) => {
  if (!value) {
    return "-";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }
  return date.toLocaleDateString();
};

/**
 * Renders transfer entries (Invest/Dispose) as a formatted grid.
 * Displays Date, Amount, and Flag columns with proper formatting.
 *
 * @param {Array<Object>|null|undefined} transfers - Array of transfer objects
 * @returns {JSX.Element|string} Formatted transfer grid or "-" if no transfers
 */
const renderTransfers = (transfers) => {
  if (!Array.isArray(transfers) || !transfers.length) {
    return "-";
  }
  return (
    <div className="fc-modules-details__transfers">
      <div className="fc-modules-details__transfers-header">
        <span>Date</span>
        <span>Amount</span>
        <span>Flag</span>
      </div>
      {transfers.map((transfer, index) => {
        if (!transfer || typeof transfer !== "object") {
          return null;
        }
        const date = transfer.Date ? formatDate(transfer.Date) : "-";
        const amount = formatCurrency(transfer.Amount);
        const flag = transfer.Flag;
        return (
          <div key={index} className="fc-modules-details__transfer-row">
            <span>{date}</span>
            <span>{amount}</span>
            <span className="fc-modules-details__transfer-flag">
              {flag && flag !== "" ? flag : "-"}
            </span>
          </div>
        );
      })}
    </div>
  );
};

/**
 * Renders IncomePct entries with date and percentage columns.
 *
 * @param {Array<Object>|null|undefined} incomePct - Array of income percentage objects
 * @returns {JSX.Element|string} Formatted list or "-" if no entries
 */
const renderIncomePct = (incomePct) => {
  if (!Array.isArray(incomePct) || !incomePct.length) {
    return "-";
  }

  return (
    <div className="fc-modules-details__transfers">
      <div className="fc-modules-details__transfers-header">
        <span>Date</span>
        <span>Income %</span>
        <span />
      </div>
      {incomePct.map((entry, index) => {
        if (!entry || typeof entry !== "object") {
          return null;
        }
        const date = entry.Date ? formatDate(entry.Date) : "-";
        const rawValue =
          entry.Value === null || entry.Value === undefined
            ? entry.Amount
            : entry.Value;
        const value =
          rawValue === null ||
          rawValue === undefined ||
          Number.isNaN(Number(rawValue))
            ? "-"
            : `${Number(rawValue)}%`;

        return (
          <div key={index} className="fc-modules-details__transfer-row">
            <span>{date}</span>
            <span>{value}</span>
            <span />
          </div>
        );
      })}
    </div>
  );
};

/**
 * FCModulesTable component displays forecast modules in a two-panel layout.
 *
 * Features:
 * - Left panel: Scrollable table of all modules with key metrics
 * - Right panel: Detailed view of selected module
 * - Row selection highlighting
 * - Loading and error state handling
 * - Formatted display of currency, dates, and transfer data
 *
 * @component
 * @param {Object} props - Component props
 * @param {Array<Object>} props.modules - Array of module objects to display
 * @param {string} props.modulesError - Error message to display
 * @param {boolean} props.modulesLoading - Loading state for modules
 * @param {Object|null} props.selectedModule - Currently selected module object
 * @param {string} props.selectedModuleId - ID of the selected module
 * @param {Function} props.onSelectModule - Callback when a module row is clicked
 * @param {Function} props.getModuleId - Function to extract unique ID from a module
 * @param {Function} props.onRowDoubleClick - Callback when a module row is double clicked
 * @returns {JSX.Element} The modules table and details panel section
 */
export default function FCModulesTable({
  modules,
  modulesError,
  modulesLoading,
  selectedModule,
  selectedModuleId,
  onSelectModule,
  getModuleId,
  onRowDoubleClick,
}) {
  const [typeFilter, setTypeFilter] = useState("all");
  const [matchedFilter, setMatchedFilter] = useState("all");
  const [accountFilter, setAccountFilter] = useState("all");
  const [sortField, setSortField] = useState("");
  const [sortDirection, setSortDirection] = useState("asc");

  const typeOptions = useMemo(() => {
    const options = new Set();
    (modules || []).forEach((module) => {
      if (module?.Type) {
        options.add(module.Type);
      }
    });
    return Array.from(options).sort((a, b) => a.localeCompare(b));
  }, [modules]);

  const accountOptions = useMemo(() => {
    const options = new Set();
    (modules || []).forEach((module) => {
      if (module?.Account) {
        options.add(module.Account);
      }
    });
    return Array.from(options).sort((a, b) => a.localeCompare(b));
  }, [modules]);

  const displayedModules = useMemo(() => {
    const baseList = Array.isArray(modules) ? modules : [];
    const filtered = baseList.filter((module) => {
      const typeMatches =
        typeFilter === "all" || (module?.Type ?? "") === typeFilter;
      const matchedMatches =
        matchedFilter === "all" ||
        (matchedFilter === "matched" ? module?.Matched : !module?.Matched);
      const accountMatches =
        accountFilter === "all" || (module?.Account ?? "") === accountFilter;
      return typeMatches && matchedMatches && accountMatches;
    });

    if (!sortField) {
      return filtered;
    }

    const direction = sortDirection === "asc" ? 1 : -1;
    const safeValue = (value) =>
      value === null || value === undefined ? "" : String(value).toLowerCase();

    return [...filtered].sort((a, b) => {
      switch (sortField) {
        case "type":
          return (
            safeValue(a?.Type).localeCompare(safeValue(b?.Type)) * direction
          );
        case "account":
          return (
            safeValue(a?.Account).localeCompare(safeValue(b?.Account)) *
            direction
          );
        case "matched":
          return ((a?.Matched ? 1 : 0) - (b?.Matched ? 1 : 0)) * direction;
        default:
          return 0;
      }
    });
  }, [
    modules,
    typeFilter,
    matchedFilter,
    accountFilter,
    sortField,
    sortDirection,
  ]);

  const toggleSortDirection = () =>
    setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));

  return (
    <section className="section-table fc-modules-table-section">
      <div className="section-table__content">
        <div className="fc-modules-panels">
          {/* Left Panel - Modules List */}
          <div className="fc-modules-panel fc-modules-panel--list">
            <div className="fc-modules-panel__header">
              <h3 className="fc-modules-panel__title">Forecast Modules</h3>
              <span className="fc-modules-panel__count">
                {displayedModules.length}{" "}
                {displayedModules.length === 1 ? "module" : "modules"}
              </span>
            </div>

            <div className="fc-modules-table__controls fc-modules-table__controls--compact">
              <select
                id="fc-filter-type"
                className="form-input fc-modules-table__filter-select"
                value={typeFilter}
                onChange={(event) => setTypeFilter(event.target.value)}
                aria-label="Filter by type"
              >
                <option value="all">All types</option>
                {typeOptions.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>

              <select
                id="fc-filter-matched"
                className="form-input fc-modules-table__filter-select"
                value={matchedFilter}
                onChange={(event) => setMatchedFilter(event.target.value)}
                aria-label="Filter by matched status"
              >
                <option value="all">All</option>
                <option value="matched">Matched</option>
                <option value="unmatched">Unmatched</option>
              </select>

              <select
                id="fc-filter-account"
                className="form-input fc-modules-table__filter-select"
                value={accountFilter}
                onChange={(event) => setAccountFilter(event.target.value)}
                aria-label="Filter by account"
              >
                <option value="all">All accounts</option>
                {accountOptions.map((account) => (
                  <option key={account} value={account}>
                    {account}
                  </option>
                ))}
              </select>

              <div className="fc-modules-table__filter fc-modules-table__filter--sort">
                <div className="fc-modules-table__sort-controls">
                  <select
                    id="fc-filter-sort"
                    className="form-input fc-modules-table__filter-select"
                    value={sortField}
                    onChange={(event) => {
                      const value = event.target.value;
                      setSortField(value);
                      if (!value) {
                        setSortDirection("asc");
                      }
                    }}
                    aria-label="Sort modules"
                  >
                    <option value="">Sort</option>
                    <option value="account">Account</option>
                    <option value="type">Type</option>
                    <option value="matched">Matched</option>
                  </select>
                  <button
                    type="button"
                    className="fc-modules-table__sort-direction"
                    onClick={toggleSortDirection}
                    disabled={!sortField}
                    aria-label={`Toggle sort direction (currently ${sortDirection})`}
                  >
                    {sortDirection === "asc" ? "↑" : "↓"}
                  </button>
                </div>
              </div>
            </div>

            <div className="fc-modules-table-wrapper">
              {modulesLoading && (
                <div className="fc-modules-table__message">
                  <div className="fc-modules-table__spinner" />
                  <p>Loading modules...</p>
                </div>
              )}
              {!modulesLoading && modulesError && (
                <div className="fc-modules-table__message fc-modules-table__message--error">
                  <span className="fc-modules-table__error-icon">⚠</span>
                  <p>{modulesError}</p>
                </div>
              )}
              {!modulesLoading && !modulesError && !modules.length && (
                <div className="fc-modules-table__message fc-modules-table__message--empty">
                  <span className="fc-modules-table__empty-icon">📋</span>
                  <p>No modules found for this scenario.</p>
                  <span className="fc-modules-table__empty-hint">
                    Select a different scenario or create a new module
                  </span>
                </div>
              )}
              {!modulesLoading && !modulesError && modules.length > 0 && (
                <table className="fc-modules-table">
                  <thead>
                    <tr>
                      <th className="fc-modules-table__th fc-modules-table__th--name">
                        Name
                      </th>
                      <th className="fc-modules-table__th">Account</th>
                      <th className="fc-modules-table__th">Type</th>
                      <th className="fc-modules-table__th fc-modules-table__th--center">
                        Matched
                      </th>
                      <th className="fc-modules-table__th fc-modules-table__th--numeric">
                        Base (USD)
                      </th>
                      <th className="fc-modules-table__th fc-modules-table__th--numeric">
                        Market (USD)
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {displayedModules.map((module) => {
                      const moduleId = getModuleId(module);
                      const isSelected = moduleId === selectedModuleId;
                      const baseValue =
                        module?.BaseValueUSD ?? module?.BaseValue;
                      const marketValue =
                        module?.MarketValueUSD ?? module?.MarketValue;
                      return (
                        <tr
                          key={moduleId}
                          className={`fc-modules-table__row ${
                            isSelected ? "fc-modules-table__row--selected" : ""
                          }`}
                          onClick={() => onSelectModule(moduleId)}
                          onDoubleClick={() => {
                            onSelectModule(moduleId);
                            if (onRowDoubleClick) {
                              onRowDoubleClick(module);
                            }
                          }}
                        >
                          <td className="fc-modules-table__td fc-modules-table__td--name">
                            <span className="fc-modules-table__name-text">
                              {module?.Name || "-"}
                            </span>
                          </td>
                          <td className="fc-modules-table__td">
                            {module?.Account || "-"}
                          </td>
                          <td className="fc-modules-table__td">
                            <span className="fc-modules-table__type-badge">
                              {module?.Type || "-"}
                            </span>
                          </td>
                          <td className="fc-modules-table__td fc-modules-table__td--center">
                            <span
                              className={`fc-modules-table__matched-badge ${
                                module?.Matched
                                  ? "fc-modules-table__matched-badge--yes"
                                  : "fc-modules-table__matched-badge--no"
                              }`}
                            >
                              {module?.Matched ? "Yes" : "No"}
                            </span>
                          </td>
                          <td className="fc-modules-table__td fc-modules-table__td--numeric">
                            {formatCurrencyNoDecimals(baseValue)}
                          </td>
                          <td className="fc-modules-table__td fc-modules-table__td--numeric">
                            {formatCurrencyNoDecimals(marketValue)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          {/* Right Panel - Module Details */}
          <div className="fc-modules-panel fc-modules-panel--details">
            <div className="fc-modules-panel__header">
              <h3 className="fc-modules-panel__title">Module Details</h3>
            </div>

            {selectedModule ? (
              <div className="fc-modules-details">
                <div className="fc-modules-details__grid">
                  {[
                    {
                      label: "Scenario",
                      value: selectedModule.Scenario,
                      span: false,
                    },
                    {
                      label: "Account",
                      value: selectedModule.Account,
                      span: false,
                    },
                    { label: "Name", value: selectedModule.Name, span: false },
                    { label: "Type", value: selectedModule.Type, span: false },
                    {
                      label: "Currency",
                      value: selectedModule.Currency,
                      span: false,
                    },
                    {
                      label: "Matched",
                      value: (
                        <span
                          className={`fc-modules-details__matched-badge ${
                            selectedModule.Matched
                              ? "fc-modules-details__matched-badge--yes"
                              : "fc-modules-details__matched-badge--no"
                          }`}
                        >
                          {selectedModule.Matched ? "Yes" : "No"}
                        </span>
                      ),
                      span: false,
                    },
                    {
                      label: "Exp Category",
                      value: selectedModule.ExpCategory,
                      span: false,
                    },
                    {
                      label: "Expense %",
                      value:
                        selectedModule.ExpensePct === null ||
                        selectedModule.ExpensePct === undefined
                          ? null
                          : `${selectedModule.ExpensePct}%`,
                      span: false,
                    },
                    {
                      label: "Income Category",
                      value: selectedModule.IncomeCategory,
                      span: false,
                    },
                    {
                      label: "Income %",
                      value: Array.isArray(selectedModule.IncomePct)
                        ? selectedModule.IncomePct.length > 0
                          ? `${selectedModule.IncomePct.length} entries`
                          : "No entries"
                        : selectedModule.IncomePct === null ||
                          selectedModule.IncomePct === undefined
                        ? null
                        : `${selectedModule.IncomePct}%`,
                      span: false,
                    },
                    {
                      label: "Base Date",
                      value: formatDate(selectedModule.BaseDate),
                      span: false,
                    },
                    {
                      label: "Base Value",
                      value:
                        selectedModule.BaseValue === null ||
                        selectedModule.BaseValue === undefined
                          ? null
                          : formatCurrency(selectedModule.BaseValue),
                      span: false,
                    },
                    {
                      label: "Market Value",
                      value:
                        selectedModule.MarketValue === null ||
                        selectedModule.MarketValue === undefined
                          ? null
                          : formatCurrency(selectedModule.MarketValue),
                      span: false,
                    },
                    {
                      label: "Base Value (USD)",
                      value: formatCurrency(
                        selectedModule.BaseValueUSD ?? selectedModule.BaseValue
                      ),
                      span: false,
                    },
                    {
                      label: "Market Value (USD)",
                      value: formatCurrency(selectedModule.MarketValueUSD),
                      span: false,
                    },
                    {
                      label: "Growth",
                      value:
                        selectedModule.Growth === null ||
                        selectedModule.Growth === undefined
                          ? null
                          : `${selectedModule.Growth}%`,
                      span: false,
                    },
                    {
                      label: "Income % Entries",
                      value: renderIncomePct(selectedModule.IncomePct),
                      span: true,
                    },
                    {
                      label: "Invest",
                      value: renderTransfers(selectedModule.Invest),
                      span: true,
                    },
                    {
                      label: "Dispose",
                      value: renderTransfers(selectedModule.Dispose),
                      span: true,
                    },
                  ].map(({ label, value, span }) => (
                    <div
                      key={label}
                      className={`fc-modules-details__field ${
                        span ? "fc-modules-details__field--full" : ""
                      }`}
                    >
                      <span className="fc-modules-details__label">{label}</span>
                      <span className="fc-modules-details__value">
                        {value === null || value === undefined || value === ""
                          ? "-"
                          : value}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="fc-modules-panel__placeholder">
                <span className="fc-modules-panel__placeholder-icon">👈</span>
                <p>Select a module to view details</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
