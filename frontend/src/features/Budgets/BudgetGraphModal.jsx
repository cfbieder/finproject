import PropTypes from "prop-types";
import { useState } from "react";
import EmptyState from "../../components/EmptyState.jsx";
import { chartSeries, chartVariances, compareFlags, varianceOf } from "./latestEstimate.js";
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

// `null` is an UNKNOWN figure (an LE with no line, a variance with a missing
// operand) and renders `—`, never `$0.00` (CR087 §4c).
const formatCurrencyShort = (value) =>
  value == null
    ? "—"
    : chartCurrencyFormatter.format(Number.isFinite(Number(value)) ? Number(value) : 0);

const formatCurrencyValue = (value) => {
  if (value == null) return "—";
  const amount = Number.isFinite(Number(value)) ? Number(value) : 0;
  const formatted = currencyFormatter.format(Math.abs(amount));
  return amount < 0 ? `(${formatted})` : formatted;
};

// The Act vs Bud default, for a caller that does not pass a compare mode.
const DEFAULT_FLAGS = compareFlags("act-bud");

const BudgetGraphModal = ({
  category,
  onClose,
  onCategoryClick,
  series = chartSeries(DEFAULT_FLAGS),
  variances = chartVariances(DEFAULT_FLAGS),
  leName = "LE",
}) => {
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

  const { name, children = [] } = category;

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
            {variances.map((v) => v.label).join(" · ")} by subcategory
          </p>
        </div>

        <div className="fc-scenarios-modal__body">
          <div className="budget-graph-modal-summary">
            {series.map((sub) => (
              <div key={sub.key} className="budget-graph-modal-summary-item">
                <span className="budget-graph-modal-summary-label">
                  {sub.key === "le" ? leName : sub.label}:
                </span>
                <span className="budget-graph-modal-summary-value">
                  {formatCurrencyValue(category[sub.key])}
                </span>
              </div>
            ))}
            {variances.map((v) => {
              const value = varianceOf(category, v);
              return (
                <div key={v.key} className="budget-graph-modal-summary-item">
                  <span className="budget-graph-modal-summary-label">{v.label}:</span>
                  <span
                    className={`budget-graph-modal-summary-value ${
                      value < 0 ? "budget-graph-modal-summary-value--negative" : ""
                    }`}
                  >
                    {formatCurrencyValue(value)}
                  </span>
                </div>
              );
            })}
          </div>

          {children.length === 0 ? (
            <EmptyState variant="empty" message="No subcategories available for this category." />
          ) : (
            <div className="budget-graph-modal-bars">
              {children.map((child, childIndex) => {
                const maxValue = Math.max(
                  ...series.map(({ key }) => Math.abs(child[key] ?? 0))
                );

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
                      {series.map((sub) => {
                        const width =
                          maxValue > 0 ? (Math.abs(child[sub.key] ?? 0) / maxValue) * 100 : 0;
                        const subLabel = sub.key === "le" ? leName : sub.label;
                        return (
                          <div key={sub.key} className="budget-graph-modal-bar-row">
                            <span className="budget-graph-modal-bar-type">{sub.label}</span>
                            <div className="budget-graph-modal-bar-container">
                              <div
                                className={`budget-graph-modal-bar budget-graph-modal-bar--${sub.key}`}
                                style={{ width: `${width}%` }}
                                onMouseEnter={(e) => {
                                  const rect = e.target.getBoundingClientRect();
                                  setTooltip({
                                    x: rect.left + rect.width / 2,
                                    y: rect.top,
                                    label: `${child.name} - ${subLabel}`,
                                    value: child[sub.key],
                                  });
                                }}
                                onMouseLeave={() => setTooltip(null)}
                              />
                            </div>
                            <span className="budget-graph-modal-bar-value">
                              {formatCurrencyShort(child[sub.key])}
                            </span>
                          </div>
                        );
                      })}
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
    le: PropTypes.number,
    children: PropTypes.arrayOf(
      PropTypes.shape({
        name: PropTypes.string.isRequired,
        actual: PropTypes.number,
        budget: PropTypes.number,
        le: PropTypes.number,
      })
    ),
  }),
  series: PropTypes.arrayOf(PropTypes.shape({ key: PropTypes.string, label: PropTypes.string })),
  variances: PropTypes.arrayOf(PropTypes.object),
  leName: PropTypes.string,
  onClose: PropTypes.func.isRequired,
  onCategoryClick: PropTypes.func,
};

BudgetGraphModal.defaultProps = {
  category: null,
  onCategoryClick: null,
};

export default BudgetGraphModal;
