import { memo } from "react";
import { DollarSign, TrendingUp, TrendingDown, Target, ChevronDown, ChevronUp } from "lucide-react";
import PeriodSelector from "../../components/PeriodSelector/PeriodSelector.jsx";
import { KpiCard, KpiCardRow } from "../../components/KpiCards.jsx";
import FyLandingStrip from "./FyLandingStrip.jsx";
import { LeCompareControl, LeCompareNotes } from "./LeCompare.jsx";
import "../../components/ReportTable.css";
import "./BudgetVaTable.css";

function BudgetRealizationContent({
  filteredCategoryTree,
  rowContext,
  showNetRow,
  netBudgetDisplay,
  netActualDisplay,
  netVarianceDisplay,
  netBudgetCellClass,
  netActualCellClass,
  netVarianceCellClass,
  netLeDisplay,
  netLeBudVarianceDisplay,
  netActLeVarianceDisplay,
  netLeCellClass,
  netLeBudVarianceCellClass,
  netActLeVarianceCellClass,
  renderCategoryRows,
  periodProps,
  toggleProps,
  compareProps,
  onExport,
  canExport = false,
  kpiData,
  fyLanding,
}) {
  const { showBudget, showActual, showLe, varActBud, varLeBud, varActLe } = rowContext;
  const leLabel = compareProps && compareProps.leName ? compareProps.leName : "LE";
  // The seam between SUBJECT and VARIANCE columns hangs off whichever variance
  // comes first — see the note in BudgetVaTable.css for why this is not CSS.
  const firstVar = varActBud ? "actbud" : varLeBud ? "lebud" : varActLe ? "actle" : null;
  const seam = (key) => (firstVar === key ? " budget-va__var-first" : "");

  return (
    <div className="budget-realization-content">
      <div className="report-toolbar-header">
        <div className="report-toolbar-header__text">
          <h1 className="report-toolbar-header__title">Budget Analysis</h1>
          <p className="report-toolbar-header__description">
            Compare any two of budget, actual and latest estimate by category.
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
            <LeCompareControl compareProps={compareProps} />
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

      <FyLandingStrip landing={fyLanding} />

      <LeCompareNotes compareProps={compareProps} />

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
        <section className="realization-table-section budget-va-section">
          <div className="budget-realization-table__wrapper">
            <div className="budget-va report-table">
              <table className="balance-report-table">
                <thead className="balance-report-table__head">
                  <tr>
                    <th className="balance-report-table__category" scope="col">
                      Category
                    </th>
                    {/* SUBJECTS in a fixed order, then the VARIANCES — and
                        EVERY variance header names its own pair. That rule comes
                        straight from §11: a column called just "Variance" is
                        unambiguous only while there is one comparison on screen,
                        and the moment there were two it was read as naming a
                        benchmark it did not name. With three subjects the budget
                        is not privileged, so nothing here may rely on it being
                        the implied other half. */}
                    {showBudget && <th scope="col">Budgeted</th>}
                    {showActual && <th scope="col">Actuals</th>}
                    {showLe && (
                      <th scope="col" className="budget-va__le-cell">{leLabel}</th>
                    )}
                    {varActBud && (
                      <th scope="col" className={`budget-va__var-cell${seam("actbud")}`}>Act vs Bud</th>
                    )}
                    {varLeBud && (
                      <th scope="col" className={`budget-va__var-cell${seam("lebud")}`}>LE vs Bud</th>
                    )}
                    {varActLe && (
                      <th scope="col" className={`budget-va__var-cell${seam("actle")}`}>Act vs LE</th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {renderCategoryRows(filteredCategoryTree, rowContext)}
                  {showNetRow && (
                    <tr className="balance-report-table__totals-row">
                      <td className="balance-report-table__name">
                        <span className="balance-report-table__name-text balance-report-table__name-text--bold">
                          Net Cash Flow
                        </span>
                      </td>
                      {showBudget && (
                        <td className={netBudgetCellClass}>{netBudgetDisplay}</td>
                      )}
                      {showActual && (
                        <td className={netActualCellClass}>{netActualDisplay}</td>
                      )}
                      {showLe && (
                        <td className={`${netLeCellClass} budget-va__le-cell`}>
                          {netLeDisplay}
                        </td>
                      )}
                      {varActBud && (
                        <td className={`${netVarianceCellClass} budget-va__var-cell${seam("actbud")}`}>
                          {netVarianceDisplay}
                        </td>
                      )}
                      {varLeBud && (
                        <td className={`${netLeBudVarianceCellClass}${seam("lebud")}`}>
                          {netLeBudVarianceDisplay}
                        </td>
                      )}
                      {varActLe && (
                        <td className={`${netActLeVarianceCellClass}${seam("actle")}`}>
                          {netActLeVarianceDisplay}
                        </td>
                      )}
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
