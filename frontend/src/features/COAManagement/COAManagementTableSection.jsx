import UploadFeedback from "../Database/UploadFeedback.jsx";

export default function COAManagementTableSection({
  filteredRows,
  totalRowCount,
  isAnalyzing,
  onAnalyzeClick,
  analyzeStatus,
  isLoadingCoa,
  coaLoadError,
  onEditRow,
}) {
  const getRowShade = (depth) => {
    const lightness = Math.max(98 - depth * 6, 70);
    return `hsl(215, 45%, ${lightness}%)`;
  };

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
        <UploadFeedback
          lastIngestStatus={null}
          lastRefreshStatus={null}
          psDataCountStatus={null}
          uploadStatus={null}
          clearStatus={null}
          ingestStatus={null}
          analyzeStatus={analyzeStatus}
        />
      </div>
      <div className="budget-options-table-wrapper coa-table-scroll">
        <table className="budget-options-table coa-table">
          <thead>
            <tr>
              <th style={{ width: "40%" }}>Account</th>
              <th>Type</th>
              <th>Currency</th>
              <th style={{ width: "18%" }}>Account #</th>
              <th>Add</th>
              <th>Delete</th>
              <th>Edit</th>
            </tr>
          </thead>
          <tbody>
            {isLoadingCoa ? (
              <tr>
                <td colSpan="7" style={{ textAlign: "center" }}>
                  Loading chart of accounts...
                </td>
              </tr>
            ) : coaLoadError ? (
              <tr>
                <td colSpan="7" style={{ textAlign: "center" }}>
                  {coaLoadError}
                </td>
              </tr>
            ) : filteredRows.length === 0 ? (
              <tr>
                <td colSpan="7" style={{ textAlign: "center" }}>
                  No accounts match the selected filters.
                </td>
              </tr>
            ) : (
              filteredRows.map((row) => (
                <tr
                  key={`${row.pathLabel}-${row.name}`}
                  className={row.isCategory ? "coa-table-row--category" : ""}
                  style={{ backgroundColor: getRowShade(row.depth) }}
                >
                  <td style={{ paddingLeft: `${row.depth * 16}px` }}>
                    {row.name}
                  </td>
                  <td>{row.type}</td>
                  <td>{row.currency}</td>
                  <td>{row.accountNumber || "—"}</td>
                  <td style={{ textAlign: "center" }}>
                    {row.isCategory ? (
                      <button
                        className="coa-action-button coa-action-button--add"
                        type="button"
                      >
                        <span
                          className="coa-action-button__icon"
                          aria-hidden="true"
                        >
                          +
                        </span>
                        <span className="coa-action-button__label sr-only">
                          Add (placeholder)
                        </span>
                      </button>
                    ) : (
                      <span aria-hidden="true">—</span>
                    )}
                  </td>
                  <td style={{ textAlign: "center" }}>
                    <button
                      className="coa-action-button coa-action-button--delete"
                      type="button"
                    >
                      <span
                        className="coa-action-button__icon"
                        aria-hidden="true"
                      >
                        -
                      </span>
                      <span className="coa-action-button__label sr-only">
                        Delete (placeholder)
                      </span>
                    </button>
                  </td>
                  <td style={{ textAlign: "center" }}>
                    <button
                      className="coa-action-button coa-action-button--edit"
                      type="button"
                      onClick={() => onEditRow(row)}
                    >
                      <span
                        className="coa-action-button__icon"
                        aria-hidden="true"
                      >
                        ✎
                      </span>
                      <span className="coa-action-button__label sr-only">
                        Edit (placeholder)
                      </span>
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
