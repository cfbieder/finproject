import { useState, useEffect, useCallback } from "react";
import PropTypes from "prop-types";
import { formatAmount } from "./utils/fcReviewUtils.js";
import {
  formatTransferForm,
  normalizeTransfers,
} from "./utils/fcModuleManageUtils.js";
import Rest from "../../js/rest.js";
import "./FCGraphModuleAdjustModal.css";

/**
 * Quick adjustment modal for balance sheet graph data points.
 * Loads full FC Module data and allows editing Invest/Dispose transfers.
 */
export default function FCGraphModuleAdjustModal({
  isOpen,
  onClose,
  onSave,
  moduleId,
  year,
  currentValue,
  seriesLabel,
  selectedScenario,
}) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [moduleName, setModuleName] = useState("");
  const [invest, setInvest] = useState([]);
  const [dispose, setDispose] = useState([]);
  const [yearOptions, setYearOptions] = useState([]);
  const [defaultYear, setDefaultYear] = useState("");

  // Load full module data when modal opens
  useEffect(() => {
    if (!isOpen || !moduleId) return;

    setLoading(true);
    setError("");
    setSaving(false);

    (async () => {
      try {
        const res = await Rest.fetchJson(
          `/api/v2/forecast/modules/${encodeURIComponent(moduleId)}`
        );
        const mod = res?.data || res;

        setModuleName(mod?.Name || mod?.name || "");
        setInvest(formatTransferForm(mod?.Invest || mod?.investments || []));
        setDispose(formatTransferForm(mod?.Dispose || mod?.disposals || []));

        // Build year options from scenario
        let periodStart = null;
        let periodEnd = null;
        if (selectedScenario) {
          try {
            const scenarios = await Rest.fetchJson("/api/v2/forecast/scenarios");
            const sc = (Array.isArray(scenarios) ? scenarios : []).find(
              (s) => s.Name === selectedScenario
            );
            if (sc) {
              periodStart = Number(sc.PeriodStart);
              periodEnd = Number(sc.PeriodEnd);
            }
          } catch {
            // fallback
          }
        }

        const startYear = periodStart && periodStart > 1900 ? periodStart - 1 : 2025;
        const endYear = periodEnd && periodEnd > startYear ? periodEnd : startYear + 40;
        const years = [];
        for (let y = startYear; y <= endYear; y++) years.push(y);
        setYearOptions(years);
        setDefaultYear(year ? String(year) : String(startYear));
      } catch (err) {
        setError(err.message || "Failed to load module data");
      } finally {
        setLoading(false);
      }
    })();
  }, [isOpen, moduleId, year, selectedScenario]);

  const updateEntry = useCallback((section, index, key, value) => {
    const setter = section === "Invest" ? setInvest : setDispose;
    setter((prev) =>
      prev.map((entry, i) => (i === index ? { ...entry, [key]: value } : entry))
    );
  }, []);

  const removeEntry = useCallback((section, index) => {
    const setter = section === "Invest" ? setInvest : setDispose;
    setter((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const addEntry = useCallback(
    (section) => {
      const setter = section === "Invest" ? setInvest : setDispose;
      setter((prev) => [
        ...prev,
        { Date: `${defaultYear}-07-01`, Amount: "", Flag: "OneTime" },
      ]);
    },
    [defaultYear]
  );

  const handleSave = useCallback(async () => {
    setSaving(true);
    setError("");
    try {
      const normalizedInvest = normalizeTransfers(invest);
      const normalizedDispose = normalizeTransfers(dispose);
      await onSave(moduleId, normalizedInvest, normalizedDispose);
    } catch (err) {
      setError(err.message || "Failed to save adjustment");
      setSaving(false);
    }
  }, [invest, dispose, moduleId, onSave]);

  if (!isOpen) return null;

  const getYearFromDate = (dateStr) => {
    if (!dateStr) return "";
    const d = new Date(dateStr);
    return !Number.isNaN(d.getTime()) ? String(d.getFullYear()) : dateStr.slice(0, 4);
  };

  const isYearHighlighted = (dateStr) => {
    return year && getYearFromDate(dateStr) === String(year);
  };

  const flagOptionsInvest = ["OneTime", "Periodic"];
  const flagOptionsDispose = ["Full", "OneTime", "Periodic"];

  const renderTransferSection = (title, section, entries, flagOptions) => (
    <div className="fc-graph-mod-section">
      <div className="fc-graph-mod-section__header">
        <h4 className="fc-graph-mod-section__title">{title}</h4>
        <button
          type="button"
          className="fc-graph-mod-section__add"
          onClick={() => addEntry(section)}
          disabled={saving}
        >
          + Add {title.split(" ")[0]}
        </button>
      </div>

      {entries.length === 0 ? (
        <div className="fc-graph-mod-section__empty">
          No {title.toLowerCase()} defined
        </div>
      ) : (
        entries.map((entry, index) => {
          const isPeriodic = entry.Flag === "Periodic";
          const highlighted = isYearHighlighted(entry.Date);
          return (
            <div
              className={`fc-graph-mod-card ${highlighted ? "fc-graph-mod-card--highlighted" : ""}`}
              key={index}
            >
              <div className="fc-graph-mod-card__number">{index + 1}</div>
              <div className="fc-graph-mod-card__fields">
                <div className="fc-graph-mod-card__field">
                  <label className="fc-graph-mod-card__label">Type</label>
                  <select
                    className="fc-graph-mod-card__input"
                    value={entry.Flag || "OneTime"}
                    onChange={(e) => updateEntry(section, index, "Flag", e.target.value)}
                    disabled={saving}
                  >
                    {flagOptions.map((f) => (
                      <option key={f} value={f}>{f}</option>
                    ))}
                  </select>
                </div>

                <div className="fc-graph-mod-card__field">
                  <label className="fc-graph-mod-card__label">
                    {isPeriodic ? "Start Year" : "Year"}
                  </label>
                  <select
                    className="fc-graph-mod-card__input"
                    value={getYearFromDate(entry.Date)}
                    onChange={(e) =>
                      updateEntry(section, index, "Date", e.target.value ? `${e.target.value}-07-01` : "")
                    }
                    disabled={saving}
                  >
                    <option value="">Select year</option>
                    {yearOptions.map((y) => (
                      <option key={y} value={y}>{y}</option>
                    ))}
                  </select>
                </div>

                {isPeriodic && (
                  <div className="fc-graph-mod-card__field">
                    <label className="fc-graph-mod-card__label">End Year (optional)</label>
                    <select
                      className="fc-graph-mod-card__input"
                      value={entry.DateEnd ? getYearFromDate(entry.DateEnd) : ""}
                      onChange={(e) =>
                        updateEntry(
                          section,
                          index,
                          "DateEnd",
                          e.target.value ? `${e.target.value}-07-01` : ""
                        )
                      }
                      disabled={saving}
                    >
                      <option value="">No end (until depleted)</option>
                      {yearOptions
                        .filter((y) => y >= Number(getYearFromDate(entry.Date) || 0))
                        .map((y) => (
                          <option key={y} value={y}>{y}</option>
                        ))}
                    </select>
                  </div>
                )}

                <div className="fc-graph-mod-card__field">
                  <label className="fc-graph-mod-card__label">
                    {isPeriodic ? "Amount / Year" : "Amount"}
                  </label>
                  <input
                    className="fc-graph-mod-card__input"
                    type="number"
                    step="0.01"
                    value={entry.Amount ?? ""}
                    onChange={(e) => updateEntry(section, index, "Amount", e.target.value)}
                    disabled={saving}
                    placeholder="0.00"
                  />
                </div>
              </div>

              <button
                type="button"
                className="fc-graph-mod-card__remove"
                onClick={() => removeEntry(section, index)}
                disabled={saving}
                title="Remove"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                  <path
                    d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14"
                    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                  />
                </svg>
              </button>
            </div>
          );
        })
      )}
    </div>
  );

  return (
    <div className="fc-graph-mod-overlay" onClick={onClose}>
      <div className="fc-graph-mod-modal" onClick={(e) => e.stopPropagation()}>
        <div className="fc-graph-mod-header">
          <div>
            <p className="fc-graph-mod-header__label">Module Adjustment</p>
            <h3 className="fc-graph-mod-header__title">
              {seriesLabel} &mdash; {year}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="fc-graph-mod-close"
            disabled={saving}
          >
            Cancel
          </button>
        </div>

        <div className="fc-graph-mod-info">
          <div className="fc-graph-mod-info__item">
            <span className="fc-graph-mod-info__label">Current Value</span>
            <span className="fc-graph-mod-info__value">
              {formatAmount(currentValue)}
            </span>
          </div>
          <div className="fc-graph-mod-info__item">
            <span className="fc-graph-mod-info__label">Module</span>
            <span className="fc-graph-mod-info__value">
              {loading ? "Loading..." : moduleName || "—"}
            </span>
          </div>
        </div>

        {loading ? (
          <div className="fc-graph-mod-loading">Loading module data...</div>
        ) : (
          <div className="fc-graph-mod-body">
            {renderTransferSection("Invest Transfers", "Invest", invest, flagOptionsInvest)}
            {renderTransferSection("Dispose Transfers", "Dispose", dispose, flagOptionsDispose)}
          </div>
        )}

        {error && <div className="fc-graph-mod-error">{error}</div>}

        <div className="fc-graph-mod-actions">
          <button
            type="button"
            className="fc-graph-mod-btn fc-graph-mod-btn--cancel"
            onClick={onClose}
            disabled={saving}
          >
            Cancel
          </button>
          <button
            type="button"
            className="fc-graph-mod-btn fc-graph-mod-btn--save"
            onClick={handleSave}
            disabled={saving || loading}
          >
            {saving ? "Saving..." : "Save & Regenerate"}
          </button>
        </div>
      </div>
    </div>
  );
}

FCGraphModuleAdjustModal.propTypes = {
  isOpen: PropTypes.bool,
  onClose: PropTypes.func,
  onSave: PropTypes.func,
  moduleId: PropTypes.number,
  year: PropTypes.number,
  currentValue: PropTypes.number,
  seriesLabel: PropTypes.string,
  selectedScenario: PropTypes.string,
};
