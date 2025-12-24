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
