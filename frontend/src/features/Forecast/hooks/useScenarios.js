import { useEffect, useState } from "react";
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
  const [selectedScenario, setSelectedScenario] = useState("");
  const [loadError, setLoadError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  /**
   * Loads available forecast scenarios on component mount.
   * Auto-selects default scenario from localStorage if available,
   * otherwise selects the first scenario.
   */
  useEffect(() => {
    const loadScenarios = async () => {
      setIsLoading(true);
      try {
        // Using v2 API (PostgreSQL)
        const response = await Rest.fetchJson("/api/v2/forecast/scenarios");
        const rawList = response?.data || [];

        // Transform v2 format (snake_case) to v1 format (PascalCase) for compatibility
        const list = rawList.map((s) => ({
          ...s,
          Name: s.name,
          Description: s.description,
          IsActive: s.is_active,
        }));
        setScenarios(list);

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
    };

    loadScenarios();
  }, []);

  return {
    scenarios,
    selectedScenario,
    setSelectedScenario,
    isLoading,
    loadError,
  };
}
