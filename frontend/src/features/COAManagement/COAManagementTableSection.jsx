export default function COAManagementTableSection({
  filteredRows,
  totalRowCount,
  isAnalyzing,
  onAnalyzeClick,
  analyzeStatus,
  isLoadingCoa,
  coaLoadError,
  selectedRowKeys = [],
  onToggleRowSelection,
  getRowKey,
  onQuickAddAccount,
}) {
  const getRowShade = (depth) => {
    const lightness = Math.max(98 - depth * 6, 70);
    return `hsl(215, 45%, ${lightness}%)`;
  };

  const missingAccounts = Array.isArray(analyzeStatus?.missingAccounts)
    ? analyzeStatus.missingAccounts
    : [];

  return (
    <section className="coa-management-table-section">
      <div className="coa-management-table-header">
        <div>
          <h2 className="coa-management-table-header__title">Accounts</h2>
          <p className="coa-management-table-header__count">
            Showing {filteredRows.length} of {totalRowCount} accounts
          </p>
        </div>
        <div className="coa-management-actions">
          <button
            className="coa-action-button coa-action-button--analyze"
            type="button"
            onClick={onAnalyzeClick}
            disabled={isAnalyzing}
          >
            <span className="coa-action-button__icon" aria-hidden="true">
              🔍
            </span>
            <span>{isAnalyzing ? "Analyzing..." : "Analyze PS Data"}</span>
          </button>
        </div>
      </div>
      <div className="coa-management-status">
        {analyzeStatus?.message && (
          <p
            className={`upload-feedback upload-feedback_${analyzeStatus.type ?? "info"}`}
          >
            {analyzeStatus.message}
          </p>
        )}
        {Array.isArray(analyzeStatus?.details) &&
          analyzeStatus.details.length > 0 && (
            <ul className="upload-feedback-details">
              {analyzeStatus.details.map((detail) => (
                <li key={detail}>{detail}</li>
              ))}
            </ul>
          )}
        {missingAccounts.length > 0 && (
          <div className="coa-missing-accounts-actions">
            <p
              style={{
                fontWeight: 700,
                margin: "0 0 0.5rem",
                fontSize: "0.875rem",
                color: "#166534",
              }}
            >
              Quick-add missing accounts:
            </p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
              {missingAccounts.map((name) => (
                <button
                  key={name}
                  type="button"
                  className="coa-action-button coa-action-button--add"
                  style={{ fontSize: "0.85rem", padding: "0.4rem 0.75rem" }}
                  onClick={() =>
                    typeof onQuickAddAccount === "function" &&
                    onQuickAddAccount(name)
                  }
                >
                  <span aria-hidden="true">+</span> {name}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
      <div className="budget-options-table-wrapper coa-table-scroll">
        <table
          className="budget-options-table coa-table"
          style={{ minWidth: "100%", width: "max-content" }}
        >
          <thead>
            <tr>
              <th style={{ width: "50%" }}>Account</th>
              <th>Type</th>
              <th>Currency</th>
              <th style={{ width: "18%" }}>Account #</th>
            </tr>
          </thead>
          <tbody>
            {isLoadingCoa ? (
              <tr>
                <td colSpan="4" style={{ textAlign: "center" }}>
                  Loading chart of accounts...
                </td>
              </tr>
            ) : coaLoadError ? (
              <tr>
                <td colSpan="4" style={{ textAlign: "center" }}>
                  {coaLoadError}
                </td>
              </tr>
            ) : filteredRows.length === 0 ? (
              <tr>
                <td colSpan="4" style={{ textAlign: "center" }}>
                  No accounts match the selected filters.
                </td>
              </tr>
            ) : (
              filteredRows.map((row) => {
                const rowKey =
                  typeof getRowKey === "function"
                    ? getRowKey(row)
                    : `${row.pathLabel}-${row.name}`;
                const isSelected = selectedRowKeys.includes(rowKey);
                return (
                  <tr
                    key={rowKey}
                    className={[
                      row.isCategory ? "coa-table-row--category" : "",
                      isSelected ? "coa-table-row--selected" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    style={{
                      backgroundColor: isSelected
                        ? "#d8e8ff"
                        : getRowShade(row.depth),
                    }}
                    onClick={(event) =>
                      typeof onToggleRowSelection === "function" &&
                      onToggleRowSelection(row, { multi: event.shiftKey })
                    }
                  >
                    <td style={{ paddingLeft: `${row.depth * 16}px` }}>
                      {row.name}
                    </td>
                    <td>{row.type}</td>
                    <td>{row.currency}</td>
                    <td>{row.accountNumber || "—"}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
