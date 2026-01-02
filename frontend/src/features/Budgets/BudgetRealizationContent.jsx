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
  netBudgetCellClass,
  netActualCellClass,
  netVarianceCellClass,
  renderCategoryRows,
  onBudgetCellDoubleClick,
  onActualCellDoubleClick,
}) {
  return (
    <div className="budget-realization-content">
      <div className="budget-realization-scroll">
        <section className="budget-region realization-header">
          <p className="budget-region__label">Budget vs Actual</p>
          <p className="budget-region__description">
            Compare budgeted amounts with actual performance by category, and
            track variance.
          </p>
        </section>
        <section className="budget-region realization-table-section">
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
                    budgetValueResolver,
                    onBudgetCellDoubleClick,
                    onActualCellDoubleClick
                  )}
                  {showNetRow && (
                    <tr className="balance-report-table__totals-row">
                      <td className="balance-report-table__name">
                        <span className="balance-report-table__name-text balance-report-table__name-text--bold">
                          Net Cash Flow
                        </span>
                      </td>
                      <td className={netBudgetCellClass}>{netBudgetDisplay}</td>
                      <td className={netActualCellClass}>{netActualDisplay}</td>
                      <td className={netVarianceCellClass}>
                        {netVarianceDisplay}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

export default memo(BudgetRealizationContent);
