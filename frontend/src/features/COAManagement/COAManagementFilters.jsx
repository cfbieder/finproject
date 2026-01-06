export default function COAManagementFilters({
  typeOptions,
  currencyOptions,
  typeFilter,
  currencyFilter,
  searchTerm,
  onTypeChange,
  onCurrencyChange,
  onSearchChange,
  onEditSelected,
  selectedCount = 0,
  onClearSelected,
}) {
  return (
    <section className="coa-management-filters">
      <h2 className="coa-management-filters__title">Filters</h2>
      <div className="coa-management-filters__grid">
        <label className="filter-field">
          <span className="filter-field__label">Type</span>
          <select
            className="form-input"
            value={typeFilter}
            onChange={(event) => onTypeChange(event.target.value)}
          >
            {typeOptions.map((option) => (
              <option key={option} value={option}>
                {option === "all" ? "All types" : option}
              </option>
            ))}
          </select>
        </label>
        <label className="filter-field">
          <span className="filter-field__label">Currency</span>
          <select
            className="form-input"
            value={currencyFilter}
            onChange={(event) => onCurrencyChange(event.target.value)}
          >
            {currencyOptions.map((option) => (
              <option key={option} value={option}>
                {option === "all" ? "All currencies" : option}
              </option>
            ))}
          </select>
        </label>
        <label className="filter-field">
          <span className="filter-field__label">Search</span>
          <input
            className="form-input"
            type="search"
            placeholder="Search account or path"
            value={searchTerm}
            onChange={(event) => onSearchChange(event.target.value)}
          />
        </label>
      </div>
      <div className="coa-management-filters__actions" style={{ marginTop: 12 }}>
        <button
          type="button"
          className="coa-action-button"
          onClick={onClearSelected}
          disabled={selectedCount === 0}
          style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem", marginRight: "0.5rem" }}
        >
          <span aria-hidden="true">✕</span>
          <span>Clear Selected</span>
        </button>
        <button
          type="button"
          className="coa-action-button coa-action-button--edit"
          onClick={onEditSelected}
          disabled={selectedCount === 0}
          style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem" }}
        >
          <span aria-hidden="true">✎</span>
          <span>
            {selectedCount <= 1 ? "Edit Selected" : `Edit ${selectedCount} Selected`}
          </span>
        </button>
      </div>
    </section>
  );
}
