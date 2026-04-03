import { useState, useEffect, useCallback } from "react";
import PropTypes from "prop-types";
import { formatAmount } from "./utils/fcReviewUtils.js";
import "./FCGraphAdjustModal.css";

/**
 * Quick adjustment modal for graph data points.
 * Allows the user to add/edit a periodic adjustment for a specific year
 * on an FC Exp module directly from the forecast graph.
 */
export default function FCGraphAdjustModal({
  isOpen,
  onClose,
  onSave,
  entry,
  year,
  currentValue,
  seriesLabel,
}) {
  const [flag, setFlag] = useState("Fixed $");
  const [amount, setAmount] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // When modal opens, check for existing change at this year
  useEffect(() => {
    if (!isOpen || !entry || !year) return;
    const existingChange = (entry.Changes || []).find(
      (c) => c.Date && c.Date.slice(0, 4) === String(year)
    );
    if (existingChange) {
      setFlag(existingChange.Flag || "Fixed $");
      setAmount(existingChange.Amount ?? "");
    } else {
      setFlag("Fixed $");
      setAmount("");
    }
    setError("");
    setSaving(false);
  }, [isOpen, entry, year]);

  const handleSave = useCallback(async () => {
    if (amount === "" || amount === null || amount === undefined) {
      setError("Please enter an amount");
      return;
    }
    const numAmount = Number(amount);
    if (!Number.isFinite(numAmount)) {
      setError("Please enter a valid number");
      return;
    }

    setSaving(true);
    setError("");
    try {
      await onSave(entry.id, {
        Date: `${year}-12-31`,
        Amount: numAmount,
        Flag: flag,
      });
    } catch (err) {
      setError(err.message || "Failed to save adjustment");
      setSaving(false);
    }
  }, [amount, flag, year, entry, onSave]);

  if (!isOpen) return null;

  const formatPreview = (val, type) => {
    const num = Number(val);
    if (!Number.isFinite(num) || val === "" || val === null) return "—";
    if (type === "Percent %") return `${num >= 0 ? "" : ""}${num.toFixed(2)}%`;
    return formatAmount(num);
  };

  const existingChange = (entry?.Changes || []).find(
    (c) => c.Date && c.Date.slice(0, 4) === String(year)
  );

  return (
    <div className="fc-graph-adjust-overlay" onClick={onClose}>
      <div
        className="fc-graph-adjust-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="fc-graph-adjust-header">
          <div>
            <p className="fc-graph-adjust-header__label">Quick Adjustment</p>
            <h3 className="fc-graph-adjust-header__title">
              {seriesLabel} &mdash; {year}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="fc-graph-adjust-close"
            disabled={saving}
          >
            Cancel
          </button>
        </div>

        <div className="fc-graph-adjust-info">
          <div className="fc-graph-adjust-info__item">
            <span className="fc-graph-adjust-info__label">Current Value</span>
            <span className="fc-graph-adjust-info__value">
              {formatAmount(currentValue)}
            </span>
          </div>
          <div className="fc-graph-adjust-info__item">
            <span className="fc-graph-adjust-info__label">Entry</span>
            <span className="fc-graph-adjust-info__value">
              {entry?.Name || "—"}
            </span>
          </div>
          {existingChange && (
            <div className="fc-graph-adjust-info__item fc-graph-adjust-info__item--existing">
              <span className="fc-graph-adjust-info__label">
                Existing Change
              </span>
              <span className="fc-graph-adjust-info__value">
                {existingChange.Flag === "Percent %"
                  ? `${existingChange.Amount}%`
                  : formatAmount(existingChange.Amount)}{" "}
                ({existingChange.Flag})
              </span>
            </div>
          )}
        </div>

        <div className="fc-graph-adjust-form">
          <div className="fc-graph-adjust-field">
            <label className="fc-graph-adjust-field__label">Year</label>
            <input
              className="fc-graph-adjust-field__input"
              type="text"
              value={year}
              disabled
            />
          </div>

          <div className="fc-graph-adjust-field">
            <label className="fc-graph-adjust-field__label">Type</label>
            <select
              className="fc-graph-adjust-field__input"
              value={flag}
              onChange={(e) => setFlag(e.target.value)}
              disabled={saving}
            >
              <option value="Fixed $">Fixed Amount ($)</option>
              <option value="Percent %">Percentage (%)</option>
              <option value="One-Off $">One-Off ($)</option>
            </select>
          </div>

          <div className="fc-graph-adjust-field">
            <label className="fc-graph-adjust-field__label">Amount</label>
            <input
              className="fc-graph-adjust-field__input"
              type="number"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              disabled={saving}
              placeholder="0.00"
              autoFocus
            />
          </div>

          <div className="fc-graph-adjust-field">
            <label className="fc-graph-adjust-field__label">Preview</label>
            <div className="fc-graph-adjust-preview">
              <span
                className={`fc-graph-adjust-preview__value ${
                  flag !== "Percent %" && Number(amount) < 0
                    ? "fc-graph-adjust-preview__value--negative"
                    : "fc-graph-adjust-preview__value--positive"
                }`}
              >
                {formatPreview(amount, flag)}
              </span>
            </div>
          </div>
        </div>

        {error && <div className="fc-graph-adjust-error">{error}</div>}

        <div className="fc-graph-adjust-actions">
          <button
            type="button"
            className="fc-graph-adjust-btn fc-graph-adjust-btn--cancel"
            onClick={onClose}
            disabled={saving}
          >
            Cancel
          </button>
          <button
            type="button"
            className="fc-graph-adjust-btn fc-graph-adjust-btn--save"
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? "Saving..." : "Save & Regenerate"}
          </button>
        </div>
      </div>
    </div>
  );
}

FCGraphAdjustModal.propTypes = {
  isOpen: PropTypes.bool,
  onClose: PropTypes.func,
  onSave: PropTypes.func,
  entry: PropTypes.object,
  year: PropTypes.number,
  currentValue: PropTypes.number,
  seriesLabel: PropTypes.string,
};
