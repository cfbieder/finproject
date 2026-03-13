import { useCallback, useEffect, useMemo, useState } from "react";
import { useToast } from "../contexts/ToastContext.jsx";
import Rest from "../js/rest.js";
import {
  BUDGET_YEAR_OPTIONS,
  MONTH_OPTIONS,
  getMonthLabel,
} from "../features/BudgetEntry/utils/budgetInputUtils.js";
import "./PageLayout.css";
import "./BudgetFX.css";

const CURRENT_MONTH = new Date().getMonth() + 1;
const CURRENT_YEAR = new Date().getFullYear();

export default function BudgetFX() {
  const { addToast } = useToast();

  // --- State ---
  const [selectedYear, setSelectedYear] = useState(() => {
    const idx = BUDGET_YEAR_OPTIONS.indexOf(CURRENT_YEAR);
    return idx >= 0 ? CURRENT_YEAR : BUDGET_YEAR_OPTIONS[0];
  });
  const [rates, setRates] = useState([]);
  const [currencies, setCurrencies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Editing
  const [editingCell, setEditingCell] = useState(null); // { currency, month }
  const [editingValue, setEditingValue] = useState("");

  // Recalculate preview modal
  const [previewMonth, setPreviewMonth] = useState(null);
  const [previewData, setPreviewData] = useState([]);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [recalcLoading, setRecalcLoading] = useState(false);

  // --- Load default budget year from appdata ---
  useEffect(() => {
    (async () => {
      try {
        const appData = await Rest.fetchAppDataV2();
        const doc =
          Array.isArray(appData) && appData.length > 0 ? appData[0] : {};
        if (doc?.defaultBudgetYear != null) {
          const yr = Number(doc.defaultBudgetYear);
          if (Number.isFinite(yr) && BUDGET_YEAR_OPTIONS.includes(yr)) {
            setSelectedYear(yr);
          }
        }
      } catch {
        // ignore — use default
      }
    })();
  }, []);

  // --- Load rates and currencies for selected year ---
  const fetchRates = useCallback(async (year) => {
    setLoading(true);
    setError("");
    try {
      const [ratesResponse, currenciesResponse] = await Promise.all([
        Rest.fetchJson(`/api/v2/budget/fx-rates?year=${year}`),
        Rest.fetchJson("/api/v2/util/currencies"),
      ]);

      const rateRows = ratesResponse?.data || [];
      setRates(rateRows);

      const rawCurrencies = Array.isArray(currenciesResponse?.currencies)
        ? currenciesResponse.currencies
        : [];
      const nonUsd = rawCurrencies
        .map((c) => (typeof c === "string" ? c.trim().toUpperCase() : ""))
        .filter((c) => c && c !== "USD")
        .sort();
      setCurrencies(nonUsd);
    } catch (err) {
      setError(err.message || "Failed to load budget FX rates");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRates(selectedYear);
  }, [selectedYear, fetchRates]);

  // --- Build pivot: { currency -> { month -> rate } } ---
  const rateMap = useMemo(() => {
    const map = {};
    for (const row of rates) {
      const currency = row.currency?.trim();
      if (!currency) continue;
      if (!map[currency]) map[currency] = {};
      map[currency][row.month] = row.rate;
    }
    return map;
  }, [rates]);

  // --- Double-click editing ---
  const handleCellDoubleClick = (currency, month) => {
    const currentRate = rateMap[currency]?.[month];
    setEditingCell({ currency, month });
    setEditingValue(
      currentRate != null ? Number(currentRate).toFixed(4) : ""
    );
  };

  const stopEditing = () => {
    setEditingCell(null);
    setEditingValue("");
  };

  const commitEdit = async (currency, month) => {
    if (
      !editingCell ||
      editingCell.currency !== currency ||
      editingCell.month !== month
    ) {
      return;
    }

    const trimmed = editingValue.trim();
    if (!trimmed) {
      stopEditing();
      return;
    }

    const parsedRate = Number(trimmed);
    if (!Number.isFinite(parsedRate) || parsedRate <= 0) {
      addToast("Rate must be a positive number", "error");
      stopEditing();
      return;
    }

    stopEditing();

    try {
      await Rest.fetchJson("/api/v2/budget/fx-rates", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          currency,
          year: selectedYear,
          month,
          rate: parsedRate,
        }),
      });

      // Update local state
      setRates((prev) => {
        const existing = prev.find(
          (r) => r.currency?.trim() === currency && r.month === month
        );
        if (existing) {
          return prev.map((r) =>
            r.currency?.trim() === currency && r.month === month
              ? { ...r, rate: parsedRate }
              : r
          );
        }
        return [
          ...prev,
          { currency, year: selectedYear, month, rate: parsedRate },
        ];
      });

      addToast(
        `${currency} ${getMonthLabel(month)} ${selectedYear} rate set to ${parsedRate.toFixed(4)}`,
        "success"
      );
    } catch (err) {
      addToast(err.message || "Failed to save rate", "error");
    }
  };

  const handleKeyDown = (event, currency, month) => {
    if (event.key === "Enter") {
      event.preventDefault();
      commitEdit(currency, month);
    } else if (event.key === "Escape") {
      stopEditing();
    }
  };

  const handleBlur = () => {
    if (editingCell) {
      commitEdit(editingCell.currency, editingCell.month);
    }
  };

  // --- Recalculate flow ---
  const isMonthRecalculable = (month) => {
    if (selectedYear < CURRENT_YEAR) return true;
    if (selectedYear === CURRENT_YEAR) return month <= CURRENT_MONTH;
    return false;
  };

  const handleRecalcClick = async (month) => {
    setPreviewMonth(month);
    setPreviewLoading(true);
    setPreviewData([]);

    try {
      const response = await Rest.fetchJson(
        `/api/v2/budget/fx-rates/preview?year=${selectedYear}&month=${month}`
      );
      setPreviewData(response?.data || []);
    } catch (err) {
      addToast(err.message || "Failed to load recalculation preview", "error");
      setPreviewMonth(null);
    } finally {
      setPreviewLoading(false);
    }
  };

  const closePreview = () => {
    setPreviewMonth(null);
    setPreviewData([]);
  };

  const confirmRecalculate = async () => {
    if (!previewMonth || previewData.length === 0) return;

    setRecalcLoading(true);
    let totalEntries = 0;
    const updated = [];

    try {
      for (const item of previewData) {
        if (!item.newRate) continue;
        const response = await Rest.fetchJson(
          "/api/v2/budget/fx-rates/recalculate",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              currency: item.currency,
              year: selectedYear,
              month: previewMonth,
            }),
          }
        );
        const result = response?.data;
        if (result) {
          totalEntries += result.entriesUpdated || 0;
          updated.push(result.currency);
        }
      }

      addToast(
        `${getMonthLabel(previewMonth)} ${selectedYear}: Updated ${updated.join(", ")} rates. ${totalEntries} budget entries recalculated.`,
        "success"
      );

      closePreview();
      fetchRates(selectedYear);
    } catch (err) {
      addToast(err.message || "Recalculation failed", "error");
    } finally {
      setRecalcLoading(false);
    }
  };

  // --- Year change ---
  const handleYearChange = (event) => {
    setSelectedYear(parseInt(event.target.value));
  };

  // --- Render ---
  if (loading) {
    return (
      <main className="page-main">
        <div className="budget-fx-container">
          <p className="budget-fx-loading">Loading budget FX rates…</p>
        </div>
      </main>
    );
  }

  if (error) {
    return (
      <main className="page-main">
        <div className="budget-fx-container">
          <p className="budget-fx-error">{error}</p>
        </div>
      </main>
    );
  }

  return (
    <main className="page-main">
      <div className="budget-fx-container">
        <header className="budget-fx-header">
          <h1 className="budget-fx-header__title">Budget FX Rates</h1>
          <p className="budget-fx-header__subtitle">
            Monthly exchange rates by currency (per 1 USD). Double-click a cell
            to edit.
          </p>
        </header>

        <section className="budget-fx-section">
          <div className="budget-fx-toolbar">
            <label className="budget-fx-toolbar__label" htmlFor="budget-fx-year">
              Budget Year
            </label>
            <select
              id="budget-fx-year"
              className="budget-fx-toolbar__select"
              value={selectedYear}
              onChange={handleYearChange}
            >
              {BUDGET_YEAR_OPTIONS.map((yr) => (
                <option key={yr} value={yr}>
                  {yr}
                </option>
              ))}
            </select>
          </div>

          {currencies.length === 0 ? (
            <p className="budget-fx-empty">
              No non-USD currencies found. Budget entries must exist with
              foreign currencies to manage FX rates.
            </p>
          ) : (
            <div className="budget-fx-table-wrapper">
              <table className="budget-fx-table">
                <thead>
                  <tr>
                    <th className="budget-fx-table__th-month">Month</th>
                    {currencies.map((currency) => (
                      <th key={currency}>{currency}</th>
                    ))}
                    <th className="budget-fx-table__th-action">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {MONTH_OPTIONS.map((mo) => {
                    const monthNum = parseInt(mo.value);
                    const canRecalc = isMonthRecalculable(monthNum);

                    return (
                      <tr key={mo.value}>
                        <td className="budget-fx-table__td-month">
                          {mo.label}
                        </td>
                        {currencies.map((currency) => {
                          const rate = rateMap[currency]?.[monthNum];
                          const isEditing =
                            editingCell?.currency === currency &&
                            editingCell?.month === monthNum;

                          return (
                            <td
                              key={currency}
                              className="budget-fx-table__td-rate"
                              onDoubleClick={() =>
                                handleCellDoubleClick(currency, monthNum)
                              }
                            >
                              {isEditing ? (
                                <input
                                  className="budget-fx-table__input"
                                  type="number"
                                  step="0.0001"
                                  value={editingValue}
                                  onChange={(e) =>
                                    setEditingValue(e.target.value)
                                  }
                                  onBlur={handleBlur}
                                  onKeyDown={(e) =>
                                    handleKeyDown(e, currency, monthNum)
                                  }
                                  autoFocus
                                />
                              ) : rate != null ? (
                                Number(rate).toFixed(4)
                              ) : (
                                <span className="budget-fx-table__empty">
                                  —
                                </span>
                              )}
                            </td>
                          );
                        })}
                        <td className="budget-fx-table__td-action">
                          {canRecalc && (
                            <button
                              type="button"
                              className="budget-fx-table__recalc-btn"
                              onClick={() => handleRecalcClick(monthNum)}
                              title={`Recalculate ${mo.label} from average actual FX`}
                            >
                              Recalculate
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      {/* Recalculate Preview Modal */}
      {previewMonth !== null && (
        <div
          className="budget-fx-modal-overlay"
          onClick={(e) => {
            if (e.target === e.currentTarget) closePreview();
          }}
        >
          <div className="budget-fx-modal">
            <h2 className="budget-fx-modal__title">
              Recalculate — {getMonthLabel(previewMonth)} {selectedYear}
            </h2>
            <p className="budget-fx-modal__subtitle">
              Replace budget rates with average actual FX from market data and
              recalculate affected budget entry amounts.
            </p>

            {previewLoading ? (
              <p className="budget-fx-modal__loading">Loading preview…</p>
            ) : previewData.length === 0 ? (
              <p className="budget-fx-modal__empty">
                No non-USD budget entries found for this month.
              </p>
            ) : (
              <table className="budget-fx-modal__table">
                <thead>
                  <tr>
                    <th>Currency</th>
                    <th>Current Rate</th>
                    <th>New Avg Actual</th>
                    <th>Data Points</th>
                    <th>Entries Affected</th>
                  </tr>
                </thead>
                <tbody>
                  {previewData.map((item) => (
                    <tr key={item.currency}>
                      <td>{item.currency}</td>
                      <td>
                        {item.currentRate != null
                          ? Number(item.currentRate).toFixed(4)
                          : "—"}
                      </td>
                      <td>
                        {item.newRate != null
                          ? Number(item.newRate).toFixed(4)
                          : "N/A"}
                      </td>
                      <td>{item.dataPoints}</td>
                      <td>{item.entriesAffected}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            <div className="budget-fx-modal__actions">
              <button
                type="button"
                className="budget-fx-modal__btn budget-fx-modal__btn--cancel"
                onClick={closePreview}
                disabled={recalcLoading}
              >
                Cancel
              </button>
              <button
                type="button"
                className="budget-fx-modal__btn budget-fx-modal__btn--confirm"
                onClick={confirmRecalculate}
                disabled={
                  recalcLoading ||
                  previewLoading ||
                  previewData.length === 0 ||
                  previewData.every((d) => !d.newRate)
                }
              >
                {recalcLoading ? "Updating…" : "Confirm Recalculate"}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
