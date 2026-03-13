import { useEffect, useState } from "react";
import Rest from "../../../js/rest.js";
import {
  BASE_CURRENCY,
  normalizeCurrencyOptions,
  buildBudgetRateMap,
} from "../utils/budgetInputUtils.js";

/**
 * Custom hook for loading currency options and exchange rates.
 *
 * Loads all budget FX rates for a year from the budget_fx_rates table,
 * builds a per-month rate map, and exposes both:
 *   - budgetRates: flat map for the current month (backward compat)
 *   - budgetRatesByMonth: { currency -> { month -> rate } } for month-aware lookups
 *
 * Falls back to legacy appdata flat rates if the new API returns empty.
 *
 * @param {Object} [options]
 * @param {number} [options.budgetYear] - Override budget year (otherwise uses defaultBudgetYear)
 * @returns {Object} Currency data state
 */
export function useCurrencyData({ budgetYear: budgetYearOverride } = {}) {
  const [currencyOptions, setCurrencyOptions] = useState([BASE_CURRENCY]);
  const [budgetRates, setBudgetRates] = useState({ USD: 1 });
  const [budgetRatesByMonth, setBudgetRatesByMonth] = useState({});
  const [defaultBudgetYear, setDefaultBudgetYear] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let isActive = true;

    const loadCurrencyMetadata = async () => {
      setLoading(true);
      setError("");
      try {
        const [currencyPayload, appDataPayload] = await Promise.all([
          Rest.fetchCurrencyOptionsV2(),
          Rest.fetchAppDataV2(),
        ]);

        if (!isActive) return;

        const normalizedCurrencies = normalizeCurrencyOptions(
          currencyPayload?.currencies ?? []
        );
        setCurrencyOptions(
          normalizedCurrencies.length ? normalizedCurrencies : [BASE_CURRENCY]
        );

        const appDataDoc =
          Array.isArray(appDataPayload) && appDataPayload.length
            ? appDataPayload[0]
            : {};

        let detectedBudgetYear = null;
        if (appDataDoc.defaultBudgetYear != null) {
          const yr = Number(appDataDoc.defaultBudgetYear);
          if (Number.isFinite(yr)) {
            detectedBudgetYear = yr;
            setDefaultBudgetYear(yr);
          }
        }

        const yearToLoad =
          budgetYearOverride || detectedBudgetYear || new Date().getFullYear();

        // Try loading monthly rates from budget_fx_rates table
        let monthlyRates = {};
        let hasMonthlyRates = false;
        try {
          const fxResponse = await Rest.fetchJson(
            `/api/v2/budget/fx-rates?year=${yearToLoad}`
          );
          const fxRows = fxResponse?.data || [];

          if (fxRows.length > 0) {
            hasMonthlyRates = true;
            // Build { currency -> { month -> rate } }
            const byMonth = {};
            for (const row of fxRows) {
              const currency =
                typeof row.currency === "string"
                  ? row.currency.trim().toUpperCase()
                  : "";
              if (!currency) continue;
              if (!byMonth[currency]) byMonth[currency] = {};
              byMonth[currency][row.month] = Number(row.rate);
            }
            monthlyRates = byMonth;
          }
        } catch {
          // New API not available — fall back to legacy
        }

        if (!isActive) return;

        if (hasMonthlyRates) {
          setBudgetRatesByMonth(monthlyRates);

          // Build flat map for current month (backward compat)
          const currentMonth = new Date().getMonth() + 1;
          const flatMap = { USD: 1 };
          for (const [currency, months] of Object.entries(monthlyRates)) {
            // Use current month rate, or fall back to most recent prior month
            let rate = months[currentMonth];
            if (rate == null) {
              for (let m = currentMonth - 1; m >= 1; m--) {
                if (months[m] != null) {
                  rate = months[m];
                  break;
                }
              }
            }
            if (rate != null && Number.isFinite(rate)) {
              flatMap[currency] = rate;
            }
          }
          setBudgetRates(flatMap);
        } else {
          // Legacy fallback: flat rates from appdata
          setBudgetRates(buildBudgetRateMap(appDataDoc));
          setBudgetRatesByMonth({});
        }
      } catch (err) {
        if (!isActive) return;

        console.error(
          "[useCurrencyData] Failed to load currency metadata:",
          err
        );
        setCurrencyOptions([BASE_CURRENCY]);
        setBudgetRates({ USD: 1 });
        setBudgetRatesByMonth({});
        setError(err.message || "Failed to load currency data");
      } finally {
        if (isActive) {
          setLoading(false);
        }
      }
    };

    loadCurrencyMetadata();

    return () => {
      isActive = false;
    };
  }, [budgetYearOverride]);

  return {
    currencyOptions,
    budgetRates,
    budgetRatesByMonth,
    defaultBudgetYear,
    loading,
    error,
  };
}
