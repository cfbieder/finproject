/**
 * FCExpTable - Main table displaying forecast income/expense entries
 *
 * Shows a list of all forecast entries for the selected scenario with sortable columns.
 * Handles selection, loading states, and empty states.
 *
 * @component
 * @param {Object} props - Component props
 * @param {boolean} props.entriesLoading - Whether entries are loading
 * @param {string} props.entriesError - Error message to display
 * @param {string} props.selectedScenario - Currently selected scenario
 * @param {Array} props.sortedEntries - Sorted array of forecast entries
 * @param {string} props.selectedEntryId - ID of selected entry
 * @param {Function} props.onSelectEntry - Callback when an entry is selected
 * @param {Function} props.onRowDoubleClick - Callback when an entry row is double clicked
 * @param {Function} props.getEntryId - Function to get unique ID for an entry
 * @param {Function} props.formatDate - Function to format date values
 * @param {Function} props.formatNumber - Function to format number values
 * @returns {JSX.Element} The forecast entries table
 */
import EmptyState from "../../components/EmptyState.jsx";
import FCInheritanceBadge from "./FCInheritanceBadge.jsx";

export default function FCExpTable({
  entriesLoading,
  entriesError,
  selectedScenario,
  sortedEntries,
 selectedEntryId,
  onSelectEntry,
  getEntryId,
  formatDate,
  formatNumber,
  onRowDoubleClick,
}) {
  return (
    <section
      className="exp-setup-table section-table"
      aria-label="Forecast income and expense"
    >
      <div className="section-table__content">
        <h3>Forecast Income/Expense</h3>
        <div className="trans-budget-table-wrapper">
          {entriesLoading ? (
            <p className="trans-budget-table__message">
              Loading forecast income/expense entries...
            </p>
          ) : entriesError ? (
            <p className="trans-budget-table__message trans-budget-table__message--error">
              {entriesError}
            </p>
          ) : !selectedScenario ? (
            <p className="trans-budget-table__message">
              Select a scenario to view forecast income/expense entries.
            </p>
          ) : !sortedEntries.length ? (
            <EmptyState variant="empty" message="No forecast income/expense entries to display." />
          ) : (
            <table className="trans-budget-table">
              <thead>
                <tr>
                  <th>Account</th>
                  <th>Name</th>
                  <th>Type</th>
                  <th>Base Date</th>
                  <th className="trans-budget-table__value">
                    Base Value (USD)
                  </th>
                  <th className="trans-budget-table__value">Growth</th>
                  <th>Matched</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {sortedEntries.map((entry) => {
                  const entryId = getEntryId(entry);
                  const isSelected = entryId === selectedEntryId;
                  return (
                    <tr
                      key={entryId}
                      className={`trans-budget-table__row ${
                        isSelected ? "trans-budget-table__row--selected" : ""
                      }`}
                      onClick={() => onSelectEntry(entryId)}
                      onDoubleClick={() => {
                        onSelectEntry(entryId);
                        if (onRowDoubleClick) {
                          onRowDoubleClick(entry);
                        }
                      }}
                    >
                      <td className="trans-budget-table__value">
                        {entry.Account || "—"}
                      </td>
                      <td className="trans-budget-table__value">
                        {entry.Name || "—"}
                        {/* CR050 — Inherited · Overridden · Local (nothing on a plain scenario) */}
                        <FCInheritanceBadge inheritance={entry.Inheritance} />
                      </td>
                      <td className="trans-budget-table__value">
                        {entry.Type || "—"}
                      </td>
                      <td className="trans-budget-table__value">
                        {formatDate(entry.BaseDate)}
                      </td>
                      <td className="trans-budget-table__value trans-budget-table__value--numeric">
                        {formatNumber(entry.BaseValueUSD)}
                      </td>
                      <td className="trans-budget-table__value trans-budget-table__value--numeric">
                        {typeof entry.Growth === "number"
                          ? `${entry.Growth.toFixed(2)}%`
                          : "—"}
                      </td>
                      <td className="trans-budget-table__value">
                        {entry.Matched ? "Yes" : "No"}
                      </td>
                      <td className="trans-budget-table__value">
                        <span style={{
                          display: "inline-block", padding: "0.15rem 0.5rem", borderRadius: "1rem",
                          fontSize: "0.75rem", fontWeight: 600,
                          background: (entry.SetupStatus || "new") === "complete" ? "var(--success-subtle)" : entry.SetupStatus === "in_progress" ? "var(--warning-subtle)" : entry.SetupStatus === "exclude" ? "var(--danger-subtle)" : "var(--surface-muted)",
                          color: (entry.SetupStatus || "new") === "complete" ? "var(--success-strong)" : entry.SetupStatus === "in_progress" ? "var(--warning-strong)" : entry.SetupStatus === "exclude" ? "var(--danger-strong)" : "var(--muted)",
                        }}>
                          {(entry.SetupStatus || "new") === "complete" ? "Complete" : entry.SetupStatus === "in_progress" ? "In Progress" : entry.SetupStatus === "exclude" ? "Exclude" : "New"}
                        </span>
                      </td>
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
