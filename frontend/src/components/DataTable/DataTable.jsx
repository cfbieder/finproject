import { useMemo, useState } from "react";
import "./DataTable.css";

/**
 * DataTable (CR042 U4) — the shared read/report table primitive.
 *
 * Codifies the best-in-repo BudgetWorksheetV2 table pattern (sticky header,
 * uppercase micro-label headers, right-aligned tabular-nums numerics, hover
 * rows, sortable column headers) so pages stop redefining `.balance-report-table`
 * in four places. Hand-rolled by design (owner decision CR042 §4) — no table
 * library — but with sorting built in, replacing FCModulesTable's `<select>`.
 *
 * Columns:
 *   key        unique column id (also the default cell accessor `row[key]`)
 *   header     column label (uppercase micro-label)
 *   numeric    right-align + tabular-nums mono
 *   sortable   show a sort affordance on the header
 *   render     (row, index) => node — overrides the default `row[key]`
 *   sortValue  (row) => comparable — overrides the default sort accessor
 *   className  extra class on <td>
 *
 * Sorting is uncontrolled by default (internal state). Pass `sort` +
 * `onSortChange` to control it (e.g. to share sort state with a toolbar).
 */
export default function DataTable({
  columns,
  rows,
  rowKey,
  sort,
  onSortChange,
  emptyMessage = "No data.",
  hint,
  className = "",
  onRowClick,
}) {
  const [internalSort, setInternalSort] = useState(null);
  const controlled = onSortChange != null;
  const activeSort = controlled ? sort : internalSort;

  const handleSort = (col) => {
    if (!col.sortable) return;
    const dir =
      activeSort?.key === col.key && activeSort?.dir === "asc" ? "desc" : "asc";
    const next = { key: col.key, dir };
    if (controlled) onSortChange(next);
    else setInternalSort(next);
  };

  const sortedRows = useMemo(() => {
    if (!activeSort) return rows;
    const col = columns.find((c) => c.key === activeSort.key);
    if (!col) return rows;
    const accessor = col.sortValue || ((row) => row[col.key]);
    const factor = activeSort.dir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const av = accessor(a);
      const bv = accessor(b);
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === "number" && typeof bv === "number") {
        return (av - bv) * factor;
      }
      return String(av).localeCompare(String(bv)) * factor;
    });
  }, [rows, columns, activeSort]);

  return (
    <div className={`data-table-wrap ${className}`.trim()}>
      <div className="data-table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              {columns.map((col) => {
                const isActive = activeSort?.key === col.key;
                return (
                  <th
                    key={col.key}
                    className={
                      (col.numeric ? "data-table__th--right " : "") +
                      (col.sortable ? "data-table__th--sortable" : "")
                    }
                    aria-sort={
                      col.sortable
                        ? isActive
                          ? activeSort.dir === "asc"
                            ? "ascending"
                            : "descending"
                          : "none"
                        : undefined
                    }
                    onClick={col.sortable ? () => handleSort(col) : undefined}
                  >
                    {col.header}
                    {col.sortable && (
                      <span className="data-table__sort-caret" aria-hidden="true">
                        {isActive ? (activeSort.dir === "asc" ? "▲" : "▼") : "⇅"}
                      </span>
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {sortedRows.length === 0 ? (
              <tr>
                <td className="data-table__empty" colSpan={columns.length}>
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              sortedRows.map((row, index) => (
                <tr
                  key={rowKey ? rowKey(row, index) : index}
                  className={onRowClick ? "data-table__row--clickable" : undefined}
                  onClick={onRowClick ? () => onRowClick(row, index) : undefined}
                >
                  {columns.map((col) => (
                    <td
                      key={col.key}
                      className={
                        (col.numeric ? "data-table__td--numeric " : "") +
                        (col.className || "")
                      }
                    >
                      {col.render ? col.render(row, index) : row[col.key]}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {hint && <div className="data-table-hint">{hint}</div>}
    </div>
  );
}
