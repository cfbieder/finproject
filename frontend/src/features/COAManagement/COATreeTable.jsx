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
  onReorderRow,
  canReorder,
}) {
  return (
    <section className="coa-tree-section">
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
              <th style={{ width: "185px" }}></th>
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
                    onReorder={onReorderRow}
                    canReorder={canReorder}
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
