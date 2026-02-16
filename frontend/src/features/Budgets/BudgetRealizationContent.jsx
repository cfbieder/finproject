import { memo } from "react";
import PeriodSelector from "../../components/PeriodSelector/PeriodSelector.jsx";

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
  periodProps,
  toggleProps,
}) {
  return (
    <div className="budget-realization-content">
      <div className="realization-toolbar-header">
        <div className="realization-toolbar-header__text">
          <h1 className="realization-toolbar-header__title">Budget vs Actual</h1>
          <p className="realization-toolbar-header__description">
            Compare budgeted amounts with actual performance by category, and
            track variance.
          </p>
        </div>
      </div>

      {periodProps && (
        <section className="realization-toolbar" aria-label="Report filters">
          <div className="realization-toolbar__group realization-toolbar__group--selectors">
            <PeriodSelector {...periodProps} />
          </div>
          <div className="realization-toolbar__group realization-toolbar__group--toggles">
            <label className="realization-toolbar__toggle" htmlFor="budget-include-unrealized">
              <input
                id="budget-include-unrealized"
                type="checkbox"
                className="realization-toolbar__checkbox"
                checked={toggleProps.includeUnrealized}
                onChange={(event) => toggleProps.onIncludeUnrealizedChange(event.target.checked)}
              />
              <span className="realization-toolbar__toggle-text">Unrealized</span>
            </label>
            <label className="realization-toolbar__toggle" htmlFor="budget-include-transfers">
              <input
                id="budget-include-transfers"
                type="checkbox"
                className="realization-toolbar__checkbox"
                checked={toggleProps.includeTransfers}
                onChange={(event) => toggleProps.onIncludeTransfersChange(event.target.checked)}
              />
              <span className="realization-toolbar__toggle-text">Transfers</span>
            </label>
            {!toggleProps.isFullyExpanded && (
              <button
                type="button"
                className="realization-toolbar__action-button"
                onClick={toggleProps.onExpandOneLayer}
                disabled={!toggleProps.hasCollapsiblePaths}
              >
                Expand +
              </button>
            )}
            {!toggleProps.isFullyCollapsed && (
              <button
                type="button"
                className="realization-toolbar__action-button"
                onClick={toggleProps.onCollapseOneLayer}
                disabled={!toggleProps.hasCollapsiblePaths}
              >
                Collapse −
              </button>
            )}
          </div>
        </section>
      )}

      <div className="budget-realization-scroll">
        <section className="realization-table-section">
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
