export default function COAManagementFilters({
  typeOptions,
  currencyOptions,
  typeFilter,
  currencyFilter,
  searchTerm,
  onTypeChange,
  onCurrencyChange,
  onSearchChange,
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
    </section>
  );
}
