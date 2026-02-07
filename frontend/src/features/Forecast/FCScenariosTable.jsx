import PropTypes from "prop-types";
import { TrendingUp } from "lucide-react";

/**
 * FCScenariosTable Component
 *
 * Displays data tables for inflation rates and FX rates for the selected scenario.
 * Provides inline edit/delete actions for each entry.
 *
 * Features:
 * - Two side-by-side tables: Inflation and FX rates
 * - Add new entries via "Add Entry" buttons
 * - Edit/delete existing entries with icon buttons
 * - Loading and empty states
 * - Formatted number display
 */
export default function FCScenariosTable({
  inflationRows,
  fxRows,
  fxKeys,
  openInflationModal,
  openDeleteModal,
  openFxModal,
  isLoading,
  selectedScenario,
}) {
  /**
   * Formats inflation rate as percentage with 2 decimal places
   */
  const formatRate = (rate) => {
    return typeof rate === "number" ? `${rate.toFixed(2)}%` : rate;
  };

  /**
   * Formats FX rate with 4 decimal places
   */
  const formatFxRate = (rate) => {
    return typeof rate === "number" ? rate.toFixed(4) : "-";
  };

  return (
    <section className="section-table fc-scenarios-table">
      <div className="section-table__content">
        {isLoading ? (
          <div className="fc-scenarios-loading">
            <div className="fc-scenarios-loading__spinner"></div>
            <p>Loading scenario data...</p>
          </div>
        ) : !selectedScenario ? (
          <div className="fc-scenarios-empty-state">
            <p>Please select a scenario to view and edit assumptions</p>
          </div>
        ) : (
          <div className="fc-scenarios-data">
            <div className="fc-scenarios-data__section">
              <div className="fc-scenarios-data__header">
                <h3 className="fc-scenarios-data__title">
                  <span className="fc-scenarios-data__icon"><TrendingUp size={18} /></span>
                  Inflation Assumptions
                </h3>
                <button
                  type="button"
                  className="fc-scenarios-add-button"
                  onClick={() => openInflationModal(null, true)}
                >
                  <span>+</span> Add Entry
                </button>
              </div>
              <div className="fc-scenarios-table__wrapper">
                <table className="fc-scenarios-table__grid">
                  <thead>
                    <tr>
                      <th>Year</th>
                      <th>Rate</th>
                      <th className="fc-scenarios-table__actions-header">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {inflationRows.length === 0 ? (
                      <tr>
                        <td colSpan={3} className="fc-scenarios-empty">
                          No inflation rates defined for this scenario
                        </td>
                      </tr>
                    ) : (
                      inflationRows.map((row) => (
                        <tr key={row.Year} className="fc-scenarios-table__row">
                          <td className="fc-scenarios-table__year">
                            {row.Year}
                          </td>
                          <td className="fc-scenarios-table__value">
                            {formatRate(row.Rate)}
                          </td>
                          <td className="fc-scenarios-table__actions">
                            <div className="fc-scenarios-year-actions">
                              <button
                                type="button"
                                className="fc-scenarios-icon-button fc-scenarios-icon-button--edit"
                                aria-label={`Edit inflation ${row.Year}`}
                                title="Edit"
                                onClick={() => openInflationModal(row, false)}
                              >
                                ✏
                              </button>
                              <button
                                type="button"
                                className="fc-scenarios-icon-button fc-scenarios-icon-button--delete"
                                aria-label={`Delete inflation ${row.Year}`}
                                title="Delete"
                                onClick={() =>
                                  openDeleteModal("deleteInflation", row)
                                }
                              >
                                🗑
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="fc-scenarios-data__section">
              <div className="fc-scenarios-data__header">
                <h3 className="fc-scenarios-data__title">
                  <span className="fc-scenarios-data__icon">💱</span>
                  FX Rate Assumptions
                </h3>
                <button
                  type="button"
                  className="fc-scenarios-add-button"
                  onClick={() => openFxModal(null, true)}
                >
                  <span>+</span> Add Entry
                </button>
              </div>
              <div className="fc-scenarios-table__wrapper">
                <table className="fc-scenarios-table__grid">
                  <thead>
                    <tr>
                      <th>Year</th>
                      {fxKeys.map((key) => (
                        <th key={key}>{key}</th>
                      ))}
                      <th className="fc-scenarios-table__actions-header">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {fxRows.length === 0 ? (
                      <tr>
                        <td
                          colSpan={Math.max(1, fxKeys.length) + 2}
                          className="fc-scenarios-empty"
                        >
                          No FX rates defined for this scenario
                        </td>
                      </tr>
                    ) : (
                      fxRows.map((row) => (
                        <tr key={row.Year} className="fc-scenarios-table__row">
                          <td className="fc-scenarios-table__year">
                            {row.Year}
                          </td>
                          {fxKeys.map((key) => (
                            <td key={key} className="fc-scenarios-table__value">
                              {formatFxRate(row.Rates?.[key])}
                            </td>
                          ))}
                          <td className="fc-scenarios-table__actions">
                            <div className="fc-scenarios-year-actions">
                              <button
                                type="button"
                                className="fc-scenarios-icon-button fc-scenarios-icon-button--edit"
                                aria-label={`Edit FX ${row.Year}`}
                                title="Edit"
                                onClick={() => openFxModal(row, false)}
                              >
                                ✏
                              </button>
                              <button
                                type="button"
                                className="fc-scenarios-icon-button fc-scenarios-icon-button--delete"
                                aria-label={`Delete FX ${row.Year}`}
                                title="Delete"
                                onClick={() =>
                                  openDeleteModal("deleteFX", row)
                                }
                              >
                                🗑
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

FCScenariosTable.propTypes = {
  inflationRows: PropTypes.arrayOf(PropTypes.object),
  fxRows: PropTypes.arrayOf(PropTypes.object),
  fxKeys: PropTypes.arrayOf(PropTypes.string),
  openInflationModal: PropTypes.func.isRequired,
  openDeleteModal: PropTypes.func.isRequired,
  openFxModal: PropTypes.func.isRequired,
  isLoading: PropTypes.bool,
  selectedScenario: PropTypes.string,
};
