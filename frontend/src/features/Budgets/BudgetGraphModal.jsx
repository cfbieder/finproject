import PropTypes from "prop-types";
import { useState } from "react";
import EmptyState from "../../components/EmptyState.jsx";
import "./BudgetGraphModal.css";

const chartCurrencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const formatCurrencyShort = (value) =>
  chartCurrencyFormatter.format(Number.isFinite(Number(value)) ? Number(value) : 0);

const formatCurrencyValue = (value) => {
  const amount = Number.isFinite(Number(value)) ? Number(value) : 0;
  const formatted = currencyFormatter.format(Math.abs(amount));
  return amount < 0 ? `(${formatted})` : formatted;
};

const BudgetGraphModal = ({ category, onClose, onCategoryClick }) => {
  const [tooltip, setTooltip] = useState(null);

  const handleOverlayClick = (event) => {
    if (event.target === event.currentTarget && typeof onClose === "function") {
      onClose();
    }
  };

  const handleCloseClick = () => {
    if (typeof onClose === "function") {
      onClose();
    }
  };

  if (!category) {
    return null;
  }

  const { name, children = [], actual = 0, budget = 0, variance = 0 } = category;

  return (
    <div className="fc-scenarios-modal-overlay" onClick={handleOverlayClick}>
      <div
        className="fc-scenarios-modal budget-graph-modal"
        role="dialog"
        aria-modal="true"
        aria-label={`Budget details for ${name}`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="fc-scenarios-modal__header">
          <h3 className="fc-scenarios-modal__title">{name}</h3>
          <p className="fc-scenarios-modal__description">
            Budget vs Actual comparison by subcategory
          </p>
        </div>

        <div className="fc-scenarios-modal__body">
          <div className="budget-graph-modal-summary">
            <div className="budget-graph-modal-summary-item">
              <span className="budget-graph-modal-summary-label">Budget:</span>
              <span className="budget-graph-modal-summary-value">
                {formatCurrencyValue(budget)}
              </span>
            </div>
            <div className="budget-graph-modal-summary-item">
              <span className="budget-graph-modal-summary-label">Actual:</span>
              <span className="budget-graph-modal-summary-value">
                {formatCurrencyValue(actual)}
              </span>
            </div>
            <div className="budget-graph-modal-summary-item">
              <span className="budget-graph-modal-summary-label">Variance:</span>
              <span
                className={`budget-graph-modal-summary-value ${
                  variance < 0 ? "budget-graph-modal-summary-value--negative" : ""
                }`}
              >
                {formatCurrencyValue(variance)}
              </span>
            </div>
          </div>

          {children.length === 0 ? (
            <EmptyState variant="empty" message="No subcategories available for this category." />
          ) : (
            <div className="budget-graph-modal-bars">
              {children.map((child, childIndex) => {
                const maxValue = Math.max(
                  Math.abs(child.budget),
                  Math.abs(child.actual)
                );
                const budgetWidth =
                  maxValue > 0 ? (Math.abs(child.budget) / maxValue) * 100 : 0;
                const actualWidth =
                  maxValue > 0 ? (Math.abs(child.actual) / maxValue) * 100 : 0;

                const hasSubcategories = child.children && child.children.length > 0;

                return (
                  <div key={childIndex} className="budget-graph-modal-bar-group">
                    <div
                      className={`budget-graph-modal-bar-label ${
                        hasSubcategories ? "budget-graph-modal-bar-label--clickable" : ""
                      }`}
                      onClick={
                        hasSubcategories && typeof onCategoryClick === "function"
                          ? () => onCategoryClick(child)
                          : undefined
                      }
                      title={hasSubcategories ? "Click to view subcategories" : undefined}
                    >
                      {child.name}
                    </div>
                    <div className="budget-graph-modal-bars-wrapper">
                      <div className="budget-graph-modal-bar-row">
                        <span className="budget-graph-modal-bar-type">Budget</span>
                        <div className="budget-graph-modal-bar-container">
                          <div
                            className="budget-graph-modal-bar budget-graph-modal-bar--budget"
                            style={{ width: `${budgetWidth}%` }}
                            onMouseEnter={(e) => {
                              const rect = e.target.getBoundingClientRect();
                              setTooltip({
                                x: rect.left + rect.width / 2,
                                y: rect.top,
                                label: `${child.name} - Budget`,
                                value: child.budget,
                              });
                            }}
                            onMouseLeave={() => setTooltip(null)}
                          />
                        </div>
                        <span className="budget-graph-modal-bar-value">
                          {formatCurrencyShort(child.budget)}
                        </span>
                      </div>
                      <div className="budget-graph-modal-bar-row">
                        <span className="budget-graph-modal-bar-type">Actual</span>
                        <div className="budget-graph-modal-bar-container">
                          <div
                            className="budget-graph-modal-bar budget-graph-modal-bar--actual"
                            style={{ width: `${actualWidth}%` }}
                            onMouseEnter={(e) => {
                              const rect = e.target.getBoundingClientRect();
                              setTooltip({
                                x: rect.left + rect.width / 2,
                                y: rect.top,
                                label: `${child.name} - Actual`,
                                value: child.actual,
                              });
                            }}
                            onMouseLeave={() => setTooltip(null)}
                          />
                        </div>
                        <span className="budget-graph-modal-bar-value">
                          {formatCurrencyShort(child.actual)}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {tooltip && (
            <div
              className="budget-graph-modal-tooltip"
              style={{
                left: tooltip.x,
                top: tooltip.y - 40,
              }}
            >
              <div className="budget-graph-modal-tooltip-label">{tooltip.label}</div>
              <div className="budget-graph-modal-tooltip-value">
                {formatCurrencyValue(tooltip.value)}
              </div>
            </div>
          )}
        </div>

        <div className="fc-scenarios-modal__actions">
          <button
            type="button"
            className="generate-report-button"
            onClick={handleCloseClick}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

BudgetGraphModal.propTypes = {
  category: PropTypes.shape({
    name: PropTypes.string.isRequired,
    actual: PropTypes.number,
    budget: PropTypes.number,
    variance: PropTypes.number,
    children: PropTypes.arrayOf(
      PropTypes.shape({
        name: PropTypes.string.isRequired,
        actual: PropTypes.number.isRequired,
        budget: PropTypes.number.isRequired,
        variance: PropTypes.number.isRequired,
      })
    ),
  }),
  onClose: PropTypes.func.isRequired,
  onCategoryClick: PropTypes.func,
};

BudgetGraphModal.defaultProps = {
  category: null,
  onCategoryClick: null,
};

export default BudgetGraphModal;
