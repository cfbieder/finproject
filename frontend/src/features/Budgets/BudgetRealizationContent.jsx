import { memo } from "react";

function BudgetRealizationContent({
  filteredCategoryTree,
  collapsedPaths,
  onTogglePath,
  leafActualTotals,
  actualValueResolver,
  leafBudgetTotals,
  budgetValueResolver,
  showNetRow,
  netBudgetDisplay,
  netActualDisplay,
  netVarianceDisplay,
  renderCategoryRows,
}) {
  return (
    <div className="budget-realization-content">
      <div className="budget-realization-scroll">
        <section className="budget-realization-placeholder">
          <h1 className="page__title">Budget realization</h1>
        </section>
        <section className="budget-realization-table">
          <div className="budget-realization-table__header"></div>
          <div className="budget-realization-table__wrapper">
            <div className="cash-flow-report">
              <table className="balance-report-table">
                <thead className="balance-report-table__head">
                  <tr>
                    <th className="balance-report-table__category" scope="col">
                      Category
                    </th>
                    <th scope="col">Budgeted</th>
                    <th scope="col">Actuals</th>
                    <th scope="col">Variance</th>
                  </tr>
                </thead>
                <tbody>
                  {renderCategoryRows(
                    filteredCategoryTree,
                    collapsedPaths,
                    onTogglePath,
                    leafActualTotals,
                    actualValueResolver,
                    leafBudgetTotals,
                    budgetValueResolver
                  )}
                  {showNetRow && (
                    <tr>
                      <td className="balance-report-table__name">
                        <span className="balance-report-table__name-text">
                          Net cash flow
                        </span>
                      </td>
                      <td className="balance-report-table__value">
                        {netBudgetDisplay}
                      </td>
                      <td className="balance-report-table__value">
                        {netActualDisplay}
                      </td>
                      <td className="balance-report-table__value">
                        {netVarianceDisplay}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
          <p className="budget-realization-table__note">
            Budget and Variance are placeholders; Actuals now respect the
            selected period and filters.
          </p>
        </section>
      </div>
    </div>
  );
}

export default memo(BudgetRealizationContent);
