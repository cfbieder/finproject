import { useMemo, useState } from "react";
import { AlertTriangle } from "lucide-react";
import EmptyState from "../../components/EmptyState.jsx";
import FCInheritanceBadge from "./FCInheritanceBadge.jsx";
import { groupTypeOptions } from "./fcModulesEditSections.js";
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
 * FCModulesTable component displays forecast modules.
 *
 * Features:
 * - Full-width scrollable table of all modules with key metrics
 * - Details of the selected module in a modal, on double-click (it used to be a permanent
 *   right-hand column that cost the table ~40% of the page — Name/Account wrapped onto two
 *   lines and Base (USD) was clipped)
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
  selectedModuleId,
  onSelectModule,
  getModuleId,
  onRowDoubleClick,
}) {
  // Double-click a row → read it. `onRowDoubleClick` (the page's edit form) is now reached
  // from this modal's footer instead, so looking at a module no longer drops you straight
  // into an editable form.
  const [typeFilter, setTypeFilter] = useState("all");
  const [matchedFilter, setMatchedFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
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

  // The count beside each type answers "how many rows do I get if I pick this?", so it is
  // taken over the list with every OTHER filter applied and the type filter left out.
  // Counting the raw list instead would overstate the moment an account or status filter is
  // on — a number that is only right when nothing else is set is worse than no number.
  const typeCounts = useMemo(() => {
    const counts = {};
    (modules || []).forEach((module) => {
      const type = module?.Type;
      if (!type) return;
      const matchedMatches =
        matchedFilter === "all" ||
        (matchedFilter === "matched" ? module?.Matched : !module?.Matched);
      const accountMatches =
        accountFilter === "all" || (module?.Account ?? "") === accountFilter;
      const statusMatches =
        statusFilter === "all" || (module?.SetupStatus ?? "new") === statusFilter;
      if (matchedMatches && accountMatches && statusMatches) {
        counts[type] = (counts[type] ?? 0) + 1;
      }
    });
    return counts;
  }, [modules, matchedFilter, accountFilter, statusFilter]);

  const groupedTypeOptions = useMemo(
    () => groupTypeOptions(typeOptions, typeCounts),
    [typeOptions, typeCounts]
  );

  const totalTypeCount = useMemo(
    () => Object.values(typeCounts).reduce((sum, n) => sum + n, 0),
    [typeCounts]
  );

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
      const statusMatches =
        statusFilter === "all" || (module?.SetupStatus ?? "new") === statusFilter;
      return typeMatches && matchedMatches && accountMatches && statusMatches;
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
    statusFilter,
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
                <option value="all">All types ({totalTypeCount})</option>
                {groupedTypeOptions.map(([groupLabel, rows]) => (
                  <optgroup key={groupLabel} label={groupLabel}>
                    {rows.map(({ type, count }) => (
                      <option key={type} value={type}>
                        {type} ({count})
                      </option>
                    ))}
                  </optgroup>
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
                id="fc-filter-status"
                className="form-input fc-modules-table__filter-select"
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value)}
                aria-label="Filter by setup status"
              >
                <option value="all">All Status</option>
                <option value="new">New</option>
                <option value="in_progress">In Progress</option>
                <option value="complete">Complete</option>
                <option value="exclude">Exclude</option>
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
                  <span className="fc-modules-table__error-icon"><AlertTriangle size={16} /></span>
                  <p>{modulesError}</p>
                </div>
              )}
              {!modulesLoading && !modulesError && !modules.length && (
                <EmptyState variant="empty" message="No modules found for this scenario. Select a different scenario or create a new module." />
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
                      <th className="fc-modules-table__th fc-modules-table__th--center">
                        Status
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
                          // CR070 P1 — straight to the editor. This REVERSES the decision
                          // recorded here before ("looking at a module no longer drops you into
                          // an editable form"), and what changed is that the read view stopped
                          // being able to describe a module: six of its rows could never render a
                          // value after CR069 turned flows into stream rows, and it showed no
                          // streams at all. Cancel on the editor is already non-destructive, and
                          // "View Output" there is the read that actually matters.
                          // Select first, then open: the editor loads by id.
                          onDoubleClick={() => {
                            onSelectModule(moduleId);
                            onRowDoubleClick?.(module);
                          }}
                          // The row was mouse-only — no tabIndex, no key handler, no focus ring.
                          tabIndex={0}
                          onKeyDown={(e) => {
                            if (e.key !== "Enter" && e.key !== " ") return;
                            if (e.target !== e.currentTarget) return;  // let controls keep their keys
                            e.preventDefault();
                            onSelectModule(moduleId);
                            if (e.key === "Enter") onRowDoubleClick?.(module);
                          }}
                        >
                          <td className="fc-modules-table__td fc-modules-table__td--name">
                            <span className="fc-modules-table__name-text">
                              {module?.Name || "-"}
                              {/* The badge used to key off CashSweepTarget, which is true only for
                                  the PRIMARY (priority 1). A backup — priority 2, 3, … — never
                                  receives deposits but IS drained when the primary runs dry, so
                                  showing it no badge claimed an asset was outside the sweep when
                                  it was in fact liquidation-eligible. Key off the rank instead. */}
                              {module?.CashSweepPriority != null && (
                                <span
                                  title={
                                    module.CashSweepPriority === 1
                                      ? "Cash sweep: primary — receives deposits, drained first"
                                      : `Cash sweep: backup #${module.CashSweepPriority} — drained after the primary`
                                  }
                                  className={`fc-modules-table__sweep-badge${
                                    module.CashSweepPriority === 1
                                      ? " fc-modules-table__sweep-badge--primary"
                                      : ""
                                  }`}
                                >
                                  SWEEP {module.CashSweepPriority}
                                </span>
                              )}
                              {/* CR050: on a variant, say where this row came from. Null (and so
                                  nothing rendered) on a plain scenario. */}
                              <FCInheritanceBadge inheritance={module?.Inheritance} />
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
                          <td className="fc-modules-table__td fc-modules-table__td--center">
                            {(() => {
                              const status = module?.SetupStatus || "new";
                              const statusStyles = {
                                complete: { bg: "var(--success-subtle)", color: "var(--success-strong)", label: "Complete" },
                                in_progress: { bg: "var(--warning-subtle)", color: "var(--warning-strong)", label: "In Progress" },
                                exclude: { bg: "var(--danger-subtle)", color: "var(--danger-strong)", label: "Exclude" },
                                new: { bg: "var(--surface-muted)", color: "var(--muted)", label: "New" },
                              };
                              const s = statusStyles[status] || statusStyles.new;
                              return (
                                <select
                                  value={status}
                                  onChange={async (e) => {
                                    e.stopPropagation();
                                    const newStatus = e.target.value;
                                    try {
                                      const Rest = (await import("../../js/rest.js")).default;
                                      await Rest.put(`/forecast/modules/${module.id || module.Id}`, { SetupStatus: newStatus });
                                      if (module) module.SetupStatus = newStatus;
                                      onSelectModule?.(selectedModuleId);
                                    } catch (err) {
                                      console.error("Failed to update status:", err);
                                    }
                                  }}
                                  onClick={(e) => e.stopPropagation()}
                                  // CR070 P1 — dblclick was NOT stopped here, only click.
                                  // Harmless while double-click opened a read-only drawer;
                                  // now it would yank the owner into the edit form from
                                  // inside an open dropdown.
                                  onDoubleClick={(e) => e.stopPropagation()}
                                  style={{
                                    appearance: "none", WebkitAppearance: "none",
                                    padding: "0.15rem 0.5rem", borderRadius: "1rem",
                                    fontSize: "0.75rem", fontWeight: 600,
                                    background: s.bg, color: s.color,
                                    border: "1px solid transparent",
                                    cursor: "pointer", textAlign: "center",
                                  }}
                                  onFocus={(e) => { e.target.style.appearance = "auto"; e.target.style.WebkitAppearance = "auto"; }}
                                  onBlur={(e) => { e.target.style.appearance = "none"; e.target.style.WebkitAppearance = "none"; }}
                                >
                                  <option value="new">New</option>
                                  <option value="in_progress">In Progress</option>
                                  <option value="complete">Complete</option>
                                  <option value="exclude">Exclude</option>
                                </select>
                              );
                            })()}
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

        </div>
      </div>
    </section>
  );
}
