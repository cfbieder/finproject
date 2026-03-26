import { Search, Plus, Pencil, Trash2, ScanSearch, X } from "lucide-react";

export default function COAManagementToolbar({
  searchTerm,
  onSearchChange,
  typeFilter,
  onTypeChange,
  typeOptions,
  currencyFilter,
  onCurrencyChange,
  currencyOptions,
  onAddNew,
  onAnalyzeClick,
  isAnalyzing,
  selectedCount,
  onEditSelected,
  onDeleteSelected,
  onClearSelected,
  editDisabled,
  deleteDisabled,
}) {
  return (
    <div className="coa-toolbar">
      <div className="coa-toolbar__filters">
        <div className="coa-toolbar__search">
          <Search size={16} className="coa-toolbar__search-icon" />
          <input
            className="form-input coa-toolbar__search-input"
            type="search"
            placeholder="Search accounts..."
            value={searchTerm}
            onChange={(e) => onSearchChange(e.target.value)}
          />
        </div>
        <select
          className="form-input coa-toolbar__select"
          value={typeFilter}
          onChange={(e) => onTypeChange(e.target.value)}
        >
          {typeOptions.map((opt) => (
            <option key={opt} value={opt}>
              {opt === "all" ? "All types" : opt}
            </option>
          ))}
        </select>
        <select
          className="form-input coa-toolbar__select"
          value={currencyFilter}
          onChange={(e) => onCurrencyChange(e.target.value)}
        >
          {currencyOptions.map((opt) => (
            <option key={opt} value={opt}>
              {opt === "all" ? "All currencies" : opt}
            </option>
          ))}
        </select>
      </div>

      <div className="coa-toolbar__actions">
        {selectedCount > 0 && (
          <>
            <span className="coa-toolbar__selection-badge">
              {selectedCount} selected
            </span>
            <button
              type="button"
              className="coa-toolbar-btn coa-toolbar-btn--ghost"
              onClick={onClearSelected}
              title="Clear selection"
            >
              <X size={16} />
            </button>
            <button
              type="button"
              className="coa-toolbar-btn coa-toolbar-btn--edit"
              onClick={onEditSelected}
              disabled={editDisabled}
              title="Edit selected"
            >
              <Pencil size={16} />
              <span>Edit</span>
            </button>
            <button
              type="button"
              className="coa-toolbar-btn coa-toolbar-btn--delete"
              onClick={onDeleteSelected}
              disabled={deleteDisabled}
              title="Delete selected"
            >
              <Trash2 size={16} />
              <span>Delete</span>
            </button>
            <div className="coa-toolbar__divider" />
          </>
        )}
        <button
          type="button"
          className="coa-toolbar-btn coa-toolbar-btn--add"
          onClick={onAddNew}
        >
          <Plus size={16} />
          <span>Add</span>
        </button>
        <button
          type="button"
          className="coa-toolbar-btn coa-toolbar-btn--analyze"
          onClick={onAnalyzeClick}
          disabled={isAnalyzing}
        >
          <ScanSearch size={16} />
          <span>{isAnalyzing ? "Analyzing..." : "Analyze PS Data"}</span>
        </button>
      </div>
    </div>
  );
}
