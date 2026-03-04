import { useEffect, useState } from "react";
import Rest from "../../../js/rest.js";
import {
  BASE_CURRENCY,
  normalizeCurrencyOptions,
  buildBudgetRateMap,
} from "../utils/budgetInputUtils.js";

/**
 * Custom hook for loading currency options and exchange rates.
 * Fetches available currencies and budget exchange rates from app data.
 *
 * @returns {Object} Currency data state
 * @property {Array} currencyOptions - Available currency codes
 * @property {Object} budgetRates - Map of currency code -> exchange rate (vs USD)
 * @property {boolean} loading - Whether currency data is being loaded
 * @property {string} error - Error message if loading failed
 */
export function useCurrencyData() {
  const [currencyOptions, setCurrencyOptions] = useState([BASE_CURRENCY]);
  const [budgetRates, setBudgetRates] = useState({ USD: 1 });
  const [defaultBudgetYear, setDefaultBudgetYear] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  /**
   * Loads currency options and exchange rates on mount.
   */
  useEffect(() => {
    let isActive = true;

    const loadCurrencyMetadata = async () => {
      setLoading(true);
      setError("");
      try {
        // Using v2 API (PostgreSQL)
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
        setBudgetRates(buildBudgetRateMap(appDataDoc));

        if (appDataDoc.defaultBudgetYear != null) {
          const yr = Number(appDataDoc.defaultBudgetYear);
          if (Number.isFinite(yr)) setDefaultBudgetYear(yr);
        }
      } catch (err) {
        if (!isActive) return;

        console.error("[useCurrencyData] Failed to load currency metadata:", err);
        setCurrencyOptions([BASE_CURRENCY]);
        setBudgetRates({ USD: 1 });
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
  }, []);

  return {
    currencyOptions,
    budgetRates,
    defaultBudgetYear,
    loading,
    error,
  };
}
