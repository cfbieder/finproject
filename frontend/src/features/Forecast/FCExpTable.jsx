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
 * @param {Function} props.getEntryId - Function to get unique ID for an entry
 * @param {Function} props.formatDate - Function to format date values
 * @param {Function} props.formatNumber - Function to format number values
 * @returns {JSX.Element} The forecast entries table
 */
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
            <p className="trans-budget-table__message">
              No forecast income/expense entries to display.
            </p>
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
                </tr>
              </thead>
              <tbody>
                {sortedEntries.map((entry) => (
                  <tr
                    key={getEntryId(entry)}
                    className={`trans-budget-table__row ${
                      getEntryId(entry) === selectedEntryId
                        ? "trans-budget-table__row--selected"
                        : ""
                    }`}
                    onClick={() => onSelectEntry(getEntryId(entry))}
                  >
                    <td className="trans-budget-table__value">
                      {entry.Account || "—"}
                    </td>
                    <td className="trans-budget-table__value">
                      {entry.Name || "—"}
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
