import { memo } from "react";
import { DollarSign, TrendingUp, TrendingDown, Target, ChevronDown, ChevronUp } from "lucide-react";
import PeriodSelector from "../../components/PeriodSelector/PeriodSelector.jsx";
import { KpiCard, KpiCardRow } from "../../components/KpiCards.jsx";

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
  onExport,
  canExport = false,
  kpiData,
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
            <button type="button" className="btn btn--sm btn--outline btn--icon" onClick={toggleProps.onExpandOneLayer} disabled={!toggleProps.hasCollapsiblePaths || toggleProps.isFullyExpanded} title="Expand one level"><ChevronDown size={16} /></button>
            <button type="button" className="btn btn--sm btn--outline btn--icon" onClick={toggleProps.onCollapseOneLayer} disabled={!toggleProps.hasCollapsiblePaths || toggleProps.isFullyCollapsed} title="Collapse one level"><ChevronUp size={16} /></button>
            {canExport && onExport && (
              <button
                type="button"
                className="realization-toolbar__action-button"
                onClick={onExport}
              >
                Export
              </button>
            )}
          </div>
        </section>
      )}

      {kpiData && (
        <KpiCardRow>
          <KpiCard
            title="Income"
            value={kpiData.incomeActual}
            icon={<TrendingUp size={16} />}
            changeValue={kpiData.incomeActual - kpiData.incomeBudget}
            changeLabel="vs budget"
            positiveIsGood={true}
            chartData={[
              { value: kpiData.incomeBudget },
              { value: kpiData.incomeActual },
            ]}
            chartType="bar"
            chartColor="#5B8C5B"
          />
          <KpiCard
            title="Expenses"
            value={kpiData.expenseActual}
            icon={<TrendingDown size={16} />}
            changeValue={kpiData.expenseActual - kpiData.expenseBudget}
            changeLabel="vs budget"
            positiveIsGood={false}
            chartData={[
              { value: Math.abs(kpiData.expenseBudget) },
              { value: Math.abs(kpiData.expenseActual) },
            ]}
            chartType="bar"
            chartColor="#C0504D"
          />
          <KpiCard
            title="Net Cash Flow"
            value={kpiData.netActualValue}
            icon={<DollarSign size={16} />}
            changeValue={kpiData.netVarianceValue}
            changeLabel="variance"
            positiveIsGood={true}
            chartData={[
              { value: kpiData.netBudgetValue },
              { value: kpiData.netActualValue },
            ]}
            chartType="bar"
            chartColor="#567856"
          />
          <KpiCard
            title="Savings Rate"
            value={0}
            formattedValue={
              kpiData.incomeActual !== 0
                ? `${((kpiData.netActualValue / kpiData.incomeActual) * 100).toFixed(1)}%`
                : "N/A"
            }
            icon={<Target size={16} />}
            subtitle={
              kpiData.incomeActual !== 0
                ? `${((kpiData.netActualValue / kpiData.incomeActual) * 100).toFixed(1)}% of income saved`
                : ""
            }
            chartType="area"
            chartColor="#8b5cf6"
          />
        </KpiCardRow>
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
