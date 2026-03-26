import COATreeRow from "./COATreeRow.jsx";

export default function COATreeTable({
  visibleRows,
  totalRowCount,
  isLoadingCoa,
  coaLoadError,
  selectedRowKeys,
  collapsedPaths,
  onToggleCollapse,
  onToggleRowSelection,
  getRowKey,
  onAddChild,
  onEditRow,
  onDeleteRow,
  onMoveRow,
  analyzeStatus,
  onQuickAddAccount,
  onQuickAddCategory,
}) {
  const missingAccounts = Array.isArray(analyzeStatus?.missingAccounts)
    ? analyzeStatus.missingAccounts
    : [];
  const missingCategories = Array.isArray(analyzeStatus?.missingCategories)
    ? analyzeStatus.missingCategories
    : [];

  return (
    <section className="coa-tree-section">
      {/* Analysis results */}
      {analyzeStatus?.message && (
        <div className="coa-analysis-banner">
          <p
            className={`coa-analysis-banner__msg coa-analysis-banner__msg--${analyzeStatus.type ?? "info"}`}
          >
            {analyzeStatus.message}
          </p>
          {Array.isArray(analyzeStatus?.details) &&
            analyzeStatus.details.length > 0 && (
              <ul className="coa-analysis-banner__details">
                {analyzeStatus.details.map((d) => (
                  <li key={d}>{d}</li>
                ))}
              </ul>
            )}
          {missingAccounts.length > 0 && (
            <div className="coa-quickadd-group">
              <p className="coa-quickadd-group__label coa-quickadd-group__label--account">
                Quick-add missing accounts:
              </p>
              <div className="coa-quickadd-group__buttons">
                {missingAccounts.map((name) => (
                  <button
                    key={name}
                    type="button"
                    className="coa-quickadd-btn coa-quickadd-btn--account"
                    onClick={() => onQuickAddAccount(name)}
                  >
                    + {name}
                  </button>
                ))}
              </div>
            </div>
          )}
          {missingCategories.length > 0 && (
            <div className="coa-quickadd-group">
              <p className="coa-quickadd-group__label coa-quickadd-group__label--category">
                Quick-add missing categories:
              </p>
              <div className="coa-quickadd-group__buttons">
                {missingCategories.map((name) => (
                  <button
                    key={name}
                    type="button"
                    className="coa-quickadd-btn coa-quickadd-btn--category"
                    onClick={() => onQuickAddCategory(name)}
                  >
                    + {name}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Table header info */}
      <div className="coa-tree-section__header">
        <span className="coa-tree-section__count">
          Showing {visibleRows.length} of {totalRowCount} accounts
        </span>
      </div>

      {/* Scrollable table */}
      <div className="coa-tree-scroll">
        <table className="coa-tree-table">
          <thead>
            <tr>
              <th style={{ width: "45%" }}>Account</th>
              <th>Type</th>
              <th>Currency</th>
              <th>Account #</th>
              <th style={{ width: "120px" }}></th>
            </tr>
          </thead>
          <tbody>
            {isLoadingCoa ? (
              <tr>
                <td colSpan="5" className="coa-tree-table__empty">
                  Loading chart of accounts...
                </td>
              </tr>
            ) : coaLoadError ? (
              <tr>
                <td colSpan="5" className="coa-tree-table__empty">
                  {coaLoadError}
                </td>
              </tr>
            ) : visibleRows.length === 0 ? (
              <tr>
                <td colSpan="5" className="coa-tree-table__empty">
                  No accounts match the selected filters.
                </td>
              </tr>
            ) : (
              visibleRows.map((row) => {
                const rowKey =
                  typeof getRowKey === "function"
                    ? getRowKey(row)
                    : `${row.pathLabel}-${row.name}`;
                const pathKey = [...row.path, row.name].join("|");
                return (
                  <COATreeRow
                    key={rowKey}
                    row={row}
                    isSelected={selectedRowKeys.includes(rowKey)}
                    isCollapsed={collapsedPaths.has(pathKey)}
                    onToggleCollapse={onToggleCollapse}
                    onToggleSelect={onToggleRowSelection}
                    onAddChild={onAddChild}
                    onEdit={onEditRow}
                    onDelete={onDeleteRow}
                    onMove={onMoveRow}
                  />
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
