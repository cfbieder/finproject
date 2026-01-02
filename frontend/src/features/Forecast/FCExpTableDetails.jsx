/**
 * FCExpTableDetails - Detail panel for selected forecast entry
 *
 * Displays comprehensive information about the selected forecast entry including:
 * - Basic entry details (account, name, type, currency)
 * - Base values and dates
 * - Growth rate
 * - List of all periodic changes with formatting
 *
 * @component
 * @param {Object} props - Component props
 * @param {string} props.selectedScenario - Currently selected scenario
 * @param {Object} props.selectedEntry - The selected forecast entry
 * @param {Function} props.formatDate - Function to format date values
 * @param {Function} props.formatNumber - Function to format number values
 * @returns {JSX.Element} The entry details panel
 */
import "./FCExpTableDetails.css";

export default function FCExpTableDetails({
  selectedScenario,
  selectedEntry,
  formatDate,
  formatNumber,
}) {
  /**
   * Format change amount based on flag type
   * @param {number} amount - Amount value
   * @param {string} flag - Type flag ("Fixed $" or "Percent %")
   * @returns {string} Formatted amount string
   */
  const formatChangeAmount = (amount, flag) => {
    const num = Number(amount);
    if (!Number.isFinite(num)) return "—";
    if (flag === "Percent %") {
      return `${num.toFixed(2)}%`;
    }
    const abs = Math.abs(num).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    return num < 0 ? `($${abs})` : `$${abs}`;
  };

  const formatBaseValue = (value) => {
    const num = Number(value);
    if (!Number.isFinite(num)) {
      return { text: "—", isNegative: false };
    }
    const formatted = formatNumber(Math.abs(num), 2);
    return {
      text: num < 0 ? `(${formatted})` : formatted,
      isNegative: num < 0,
    };
  };

  const baseValue = formatBaseValue(selectedEntry?.BaseValue);
  const baseValueUsd = formatBaseValue(selectedEntry?.BaseValueUSD);

  return (
    <section
      className="exp-setup-table section-table"
      aria-label="Income and expense details"
    >
      <div className="section-table__content">
        <h3>Income/Expense Details</h3>
        <div className="trans-budget-table-wrapper">
          {!selectedScenario ? (
            <p className="trans-budget-table__message">
              Select a scenario to view income/expense details.
            </p>
          ) : !selectedEntry ? (
            <p className="trans-budget-table__message">
              Choose an income/expense entry to see details.
            </p>
          ) : (
            <>
              <div className="fc-exp-details-grid">
                <div className="fc-exp-details-item">
                  <span className="fc-exp-details-label">Account</span>
                  <span className="fc-exp-details-value">
                    {selectedEntry.Account || "—"}
                  </span>
                </div>
                <div className="fc-exp-details-item">
                  <span className="fc-exp-details-label">Name</span>
                  <span className="fc-exp-details-value">
                    {selectedEntry.Name || "—"}
                  </span>
                </div>
                <div className="fc-exp-details-item">
                  <span className="fc-exp-details-label">Type</span>
                  <span className="fc-exp-details-value">
                    {selectedEntry.Type || "—"}
                  </span>
                </div>
                <div className="fc-exp-details-item">
                  <span className="fc-exp-details-label">Currency</span>
                  <span className="fc-exp-details-value">
                    {selectedEntry.Currency || "—"}
                  </span>
                </div>
                <div className="fc-exp-details-item">
                  <span className="fc-exp-details-label">Base Date</span>
                  <span className="fc-exp-details-value">
                    {formatDate(selectedEntry.BaseDate)}
                  </span>
                </div>
                <div className="fc-exp-details-item">
                  <span className="fc-exp-details-label">Base Value</span>
                  <span
                    className={`fc-exp-details-value ${
                      baseValue.isNegative ? "fc-exp-details-value--negative" : ""
                    }`}
                  >
                    {baseValue.text}
                  </span>
                </div>
                <div className="fc-exp-details-item">
                  <span className="fc-exp-details-label">Base Value (USD)</span>
                  <span
                    className={`fc-exp-details-value fc-exp-details-value--primary ${
                      baseValueUsd.isNegative
                        ? "fc-exp-details-value--negative"
                        : ""
                    }`}
                  >
                    {baseValueUsd.text}
                  </span>
                </div>
                <div className="fc-exp-details-item">
                  <span className="fc-exp-details-label">Growth Rate</span>
                  <span className="fc-exp-details-value fc-exp-details-value--success">
                    {typeof selectedEntry.Growth === "number"
                      ? `${selectedEntry.Growth.toFixed(2)}%`
                      : "—"}
                  </span>
                </div>
                <div className="fc-exp-details-item">
                  <span className="fc-exp-details-label">Changes</span>
                  <span className="fc-exp-details-value">
                    {Array.isArray(selectedEntry.Changes)
                      ? selectedEntry.Changes.length
                      : 0}
                  </span>
                </div>
                <div className="fc-exp-details-item">
                  <span className="fc-exp-details-label">Matched</span>
                  <span
                    className={`fc-exp-details-status ${
                      selectedEntry.Matched
                        ? "fc-exp-details-status--yes"
                        : "fc-exp-details-status--no"
                    }`}
                  >
                    {selectedEntry.Matched ? "Yes" : "No"}
                  </span>
                </div>
                <div className="fc-exp-details-item">
                  <span className="fc-exp-details-label">Scenario</span>
                  <span className="fc-exp-details-value">
                    {selectedEntry.Scenario || selectedScenario || "—"}
                  </span>
                </div>
                <div className="fc-exp-details-comment">
                  <span className="fc-exp-details-label">Comment</span>
                  <span className="fc-exp-details-comment__text">
                    {(selectedEntry.Comment || "").trim() || "—"}
                  </span>
                </div>
              </div>
              {!!(selectedEntry.Changes || []).length && (
                <div className="fc-exp-details-changes">
                  <div className="fc-exp-details-changes__title">
                    Periodic Changes ({(selectedEntry.Changes || []).length})
                  </div>
                  <div className="fc-exp-details-changes__list">
                    {(selectedEntry.Changes || []).map((change, idx) => {
                      const formattedAmount = formatChangeAmount(
                        change?.Amount,
                        change?.Flag
                      );
                      const isNegative =
                        change?.Flag !== "Percent %" &&
                        Number(change?.Amount) < 0;
                      return (
                        <div
                          key={idx}
                          className="fc-exp-details-change"
                        >
                          <div
                            className="fc-exp-change-group"
                          >
                            <span className="fc-exp-change-label">Year</span>
                            <span className="fc-exp-change-value">
                              {formatDate(change?.Date) || "—"}
                            </span>
                          </div>
                          <div
                            className="fc-exp-change-group"
                          >
                            <span className="fc-exp-change-label">Amount</span>
                            <span
                              className={`fc-exp-change-amount ${
                                isNegative ? "fc-exp-change-amount--negative" : ""
                              }`}
                            >
                              {formattedAmount}
                            </span>
                          </div>
                          <div>
                            <span
                              className={`fc-exp-change-flag ${
                                change?.Flag === "Percent %"
                                  ? "fc-exp-change-flag--percent"
                                  : "fc-exp-change-flag--fixed"
                              }`}
                            >
                              {change?.Flag || "—"}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </section>
  );
}
