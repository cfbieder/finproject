import {
  ChevronRight,
  Plus,
  Pencil,
  Trash2,
  MoveRight,
  Rss,
  ArrowUp,
  ArrowDown,
} from "lucide-react";

const capitalize = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

export default function COATreeRow({
  row,
  isSelected,
  isCollapsed,
  onToggleCollapse,
  onToggleSelect,
  onAddChild,
  onEdit,
  onDelete,
  onMove,
  onReorder,
  canReorder,
}) {
  // CR063: reordering is among SIBLINGS, so both arrows are disabled whenever a
  // search or filter is active — the row above in a filtered view is not the row
  // this would swap with.
  const canUp = typeof canReorder === "function" && canReorder(row, -1);
  const canDown = typeof canReorder === "function" && canReorder(row, 1);
  const depthPad = row.depth * 20 + 12;

  return (
    <tr
      className={[
        "coa-tree-row",
        row.isCategory ? "coa-tree-row--category" : "",
        isSelected ? "coa-tree-row--selected" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      style={{ "--row-depth": row.depth }}
      onClick={(e) => onToggleSelect(row, { multi: e.shiftKey })}
    >
      <td style={{ paddingLeft: `${depthPad}px` }}>
        <span className="coa-tree-row__name">
          {row.isCategory && (
            <button
              type="button"
              className={`coa-chevron ${isCollapsed ? "coa-chevron--collapsed" : "coa-chevron--expanded"}`}
              onClick={(e) => {
                e.stopPropagation();
                onToggleCollapse(row);
              }}
              aria-label={isCollapsed ? "Expand" : "Collapse"}
            >
              <ChevronRight size={16} />
            </button>
          )}
          {!row.isCategory && (
            <span className="coa-tree-row__leaf-spacer" />
          )}
          {row.name}
          {row.fed && (
            <span
              className="coa-tree-row__feed-icon"
              title="Linked to bank feed"
              aria-label="Linked to bank feed"
            >
              <Rss size={13} />
            </span>
          )}
        </span>
      </td>
      <td>{capitalize(row.type)}</td>
      <td>{row.currency}</td>
      {/* Masked, and masked at the SOURCE \u2014 the payload behind this cell stopped
          carrying full numbers in CR082 P0a. Rendering `row.accountNumber` here
          would print an empty cell for every account, because nothing fills it
          until the edit form reveals one. */}
      <td>{row.accountNumberMasked || "\u2014"}</td>
      <td className="coa-tree-row__actions-cell">
        <div className="coa-row-actions">
          <button
            type="button"
            className="coa-row-action-btn coa-row-action-btn--reorder"
            onClick={(e) => {
              e.stopPropagation();
              onReorder(row, -1);
            }}
            disabled={!canUp}
            title="Move up"
            aria-label={`Move ${row.name} up`}
          >
            <ArrowUp size={15} />
          </button>
          <button
            type="button"
            className="coa-row-action-btn coa-row-action-btn--reorder"
            onClick={(e) => {
              e.stopPropagation();
              onReorder(row, 1);
            }}
            disabled={!canDown}
            title="Move down"
            aria-label={`Move ${row.name} down`}
          >
            <ArrowDown size={15} />
          </button>
          {row.isCategory && (
            <button
              type="button"
              className="coa-row-action-btn coa-row-action-btn--add"
              onClick={(e) => {
                e.stopPropagation();
                onAddChild(row);
              }}
              title="Add child account or category"
            >
              <Plus size={15} />
            </button>
          )}
          <button
            type="button"
            className="coa-row-action-btn"
            onClick={(e) => {
              e.stopPropagation();
              onEdit(row);
            }}
            title="Edit"
          >
            <Pencil size={15} />
          </button>
          {!row.isCategory && (
            <button
              type="button"
              className="coa-row-action-btn coa-row-action-btn--move"
              onClick={(e) => {
                e.stopPropagation();
                onMove(row);
              }}
              title="Move to..."
            >
              <MoveRight size={15} />
            </button>
          )}
          {!row.isCategory && (
            <button
              type="button"
              className="coa-row-action-btn coa-row-action-btn--delete"
              onClick={(e) => {
                e.stopPropagation();
                onDelete(row);
              }}
              title="Delete"
            >
              <Trash2 size={15} />
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}
