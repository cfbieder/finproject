import { useCallback, useEffect, useState } from "react";
import Rest from "../../../js/rest.js";

/**
 * Custom hook for loading and managing forecast scenarios.
 * Loads available scenarios on mount and auto-selects the first one.
 *
 * @returns {Object} Scenarios state and handlers
 * @property {Array} scenarios - List of available forecast scenarios
 * @property {string} selectedScenario - Currently selected scenario name
 * @property {Function} setSelectedScenario - Function to change selected scenario
 * @property {boolean} isLoading - Whether scenarios are being loaded
 * @property {string} loadError - Error message if loading failed
 */
export function useScenarios() {
  const [scenarios, setScenarios] = useState([]);
  const [inflationRows, setInflationRows] = useState([]);
  const [selectedScenario, setSelectedScenario] = useState("");
  const [loadError, setLoadError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  /**
   * Loads available forecast scenarios on component mount.
   * Auto-selects default scenario from localStorage if available,
   * otherwise selects the first scenario.
   */
  const loadScenarios = useCallback(async () => {
    setIsLoading(true);
    try {
      // Using assumptions endpoint which merges PeriodStart/PeriodEnd from FCAssump.json
      const response = await Rest.fetchJson("/api/v2/forecast/assumptions");
      const list = response?.scenarios || [];
      setScenarios(list);
      // CR079 — the same document already carries the inflation rows, and the real-terms view
      // needs them. Kept rather than re-fetched: a second read could resolve a different series
      // from the one the scenarios came from, and a deflator that disagrees with the numbers it
      // deflates is the failure this whole feature exists to remove.
      setInflationRows(Array.isArray(response?.inflation) ? response.inflation : []);

      setSelectedScenario((current) => {
        // Keep current selection if already set
        if (current) {
          return current;
        }

        // Check localStorage for default scenario
        const defaultScenario = localStorage.getItem("forecast_default_scenario");
        if (defaultScenario && list.some((s) => s.Name === defaultScenario)) {
          return defaultScenario;
        }

        // Fall back to first scenario
        return list[0]?.Name || "";
      });

      setLoadError("");
    } catch (error) {
      setLoadError(error.message || "Failed to load scenarios");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadScenarios();
  }, [loadScenarios]);

  return {
    scenarios,
    inflationRows,   // CR079 — for the real-terms deflator
    selectedScenario,
    setSelectedScenario,
    isLoading,
    loadError,
    reload: loadScenarios, // CR053: refresh after an auto-adjust creates a variant
  };
}
