import "./BudgetRegionSelectors.css";

export default function BudgetRegionSelectors({
  monthOptions = [],
  yearOptions = [],
  budgetYearOptions = [],
  fromMonth,
  toMonth,
  actualYear,
  budgetYear,
  accountOptions = [],
  categoryOptions = [],
  categoryGroupOptions = [],
  selectedAccounts = [],
  selectedCategories = [],
  onFromMonthChange = () => {},
  onToMonthChange = () => {},
  onActualYearChange = () => {},
  onBudgetYearChange = () => {},
  onAccountsChange = () => {},
  onCategoriesChange = () => {},
}) {
  const CATEGORY_SELECTOR_BASE_SIZE = 5;
  const categorySelectorSize = Math.ceil(
    CATEGORY_SELECTOR_BASE_SIZE * 1.75
  );

  return (
    <section className="budget-region selector-area">
      <p className="budget-region__label">Filter Controls</p>
      <p className="budget-region__description">
        Choose the period and slices that drive the budget comparison.
      </p>
      <div className="selector-grid">
        <div className="selector-grid__row">
          <div className="selector-control">
            <label htmlFor="month-from" className="selector-control__label">
              Month (from)
            </label>
            <select
              id="month-from"
              className="selector-control__input"
              value={fromMonth}
              onChange={(event) => onFromMonthChange(event.target.value)}
            >
              {monthOptions.map((month) => (
                <option key={`from-${month.value}`} value={month.value}>
                  {month.label}
                </option>
              ))}
            </select>
          </div>
          <div className="selector-control">
            <label htmlFor="month-to" className="selector-control__label">
              Month (to)
            </label>
            <select
              id="month-to"
              className="selector-control__input"
              value={toMonth}
              onChange={(event) => onToMonthChange(event.target.value)}
            >
              {monthOptions.map((month) => (
                <option key={`to-${month.value}`} value={month.value}>
                  {month.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="selector-grid__row">
          <div className="selector-control">
            <label htmlFor="actual-year" className="selector-control__label">
              Actual Year
            </label>
            <select
              id="actual-year"
              className="selector-control__input"
              value={actualYear}
              onChange={(event) =>
                onActualYearChange(Number(event.target.value))
              }
            >
              {yearOptions.map((year) => (
                <option key={`actual-${year}`} value={year}>
                  {year}
                </option>
              ))}
            </select>
          </div>
          <div className="selector-control">
            <label htmlFor="budget-year" className="selector-control__label">
              Budget Year
            </label>
            <select
              id="budget-year"
              className="selector-control__input"
              value={budgetYear}
              onChange={(event) =>
                onBudgetYearChange(Number(event.target.value))
              }
            >
              {budgetYearOptions.map((year) => (
                <option key={`budget-${year}`} value={year}>
                  {year}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="selector-control selector-control--spanning">
          <label htmlFor="account-selector" className="selector-control__label">
            Accounts
          </label>
          <select
            id="account-selector"
            className="selector-control__input"
            value={selectedAccounts}
            multiple
            size={4}
            onChange={onAccountsChange}
          >
            {accountOptions.map((account) => (
              <option key={`account-${account}`} value={account}>
                {account}
              </option>
            ))}
          </select>
        </div>
        <div className="selector-control selector-control--spanning">
          <label
            htmlFor="category-selector"
            className="selector-control__label"
          >
            Categories
          </label>
          <select
            id="category-selector"
            className="selector-control__input"
            value={selectedCategories}
            multiple
            size={categorySelectorSize}
            onChange={onCategoriesChange}
          >
            {categoryGroupOptions.map((groupOption) => (
              <option
                key={`category-group-${groupOption.value}`}
                value={groupOption.value}
                className={groupOption.className}
              >
                {groupOption.label}
              </option>
            ))}
            {categoryOptions.map((category) => (
              <option key={`category-${category}`} value={category}>
                {category}
              </option>
            ))}
          </select>
        </div>
      </div>
    </section>
  );
}
