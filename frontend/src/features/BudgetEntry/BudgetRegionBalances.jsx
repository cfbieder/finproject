import "./BudgetRegionBalances.css";

const computeTotals = (rows) =>
  rows.reduce(
    (acc, row) => ({
      actual: acc.actual + row.actual,
      budget: acc.budget + row.budget,
      difference: acc.difference + row.difference,
    }),
    { actual: 0, budget: 0, difference: 0 }
  );

const getNumericCellClassName = (value, { interactive = false } = {}) => {
  const classNames = ["balances-table__numeric"];
  if (value < 0) {
    classNames.push("balances-table__numeric--negative");
  }
  if (interactive) {
    classNames.push("balances-table__numeric--interactive");
  }
  return classNames.join(" ");
};

export default function BudgetRegionBalances({
  balanceRows = [],
  balancesStatus = {},
  formatCurrencyValue = (value) => value,
  onActualDoubleClick,
  onBudgetDoubleClick,
}) {
  const totals = computeTotals(balanceRows);

  return (
    <section className="budget-region balances-area">
      <div className="balances-area__header">
        <div>
          <p className="budget-region__label">Balances</p>
          <p className="budget-region__description">
            Comparing actual and budget BaseAmount for the selected months.
          </p>
        </div>
        {balancesStatus.loading && (
          <p className="balances-area__status">Loading balances…</p>
        )}
      </div>

      {balancesStatus.error && (
        <p className="balances-area__status balances-area__status--error">
          {balancesStatus.error}
        </p>
      )}

      <div className="balances-area__table-wrapper">
        <table className="balances-table">
          <thead>
            <tr>
              <th>Month</th>
              <th className="balances-table__numeric">Actual</th>
              <th className="balances-table__numeric">Budget</th>
              <th className="balances-table__numeric">Difference</th>
            </tr>
          </thead>
          <tbody>
            {balanceRows.map((row) => (
              <tr key={`balance-${row.monthNumber}`}>
                <td>{row.monthLabel}</td>
                <td
                  className={getNumericCellClassName(row.actual, {
                    interactive: true,
                  })}
                  onDoubleClick={() => onActualDoubleClick?.(row)}
                  title="Double click to view entries"
                >
                  {formatCurrencyValue(row.actual)}
                </td>
                <td
                  className={getNumericCellClassName(row.budget, {
                    interactive: true,
                  })}
                  onDoubleClick={() => onBudgetDoubleClick?.(row)}
                  title="Double click to view budget entries"
                >
                  {formatCurrencyValue(row.budget)}
                </td>
                <td className={getNumericCellClassName(row.difference)}>
                  {formatCurrencyValue(row.difference)}
                </td>
              </tr>
            ))}
            {!balanceRows.length && !balancesStatus.loading && (
              <tr>
                <td colSpan={4} className="balances-table__empty">
                  No balance data available for the selected months.
                </td>
              </tr>
            )}
          </tbody>
          {balanceRows.length ? (
            <tfoot>
              <tr>
                <td>Total</td>
                <td className={getNumericCellClassName(totals.actual)}>
                  {formatCurrencyValue(totals.actual)}
                </td>
                <td className={getNumericCellClassName(totals.budget)}>
                  {formatCurrencyValue(totals.budget)}
                </td>
                <td className={getNumericCellClassName(totals.difference)}>
                  {formatCurrencyValue(totals.difference)}
                </td>
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>
    </section>
  );
}
