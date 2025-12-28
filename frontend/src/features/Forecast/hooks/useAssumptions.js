import { useEffect, useState } from "react";
import Rest from "../../../js/rest.js";

/**
 * Custom hook for loading forecast assumptions and managing scenario selection.
 * Loads assumptions on mount and maintains selected scenario state.
 *
 * @returns {Object} Assumptions state
 * @property {Object|null} assumptions - Forecast assumptions data with scenarios array
 * @property {string} selectedScenario - Currently selected scenario name
 * @property {Function} setSelectedScenario - Update selected scenario
 * @property {boolean} isLoading - Whether assumptions are being loaded
 * @property {string} error - Error message if loading failed
 */
export function useAssumptions() {
  const [assumptions, setAssumptions] = useState(null);
  const [selectedScenario, setSelectedScenario] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  /**
   * Loads forecast assumptions from the API on component mount.
   * Handles cleanup to prevent state updates on unmounted component.
   */
  useEffect(() => {
    let isMounted = true;
    const loadAssumptions = async () => {
      setIsLoading(true);
      try {
        const data = await Rest.fetchJson("/api/forecast/assumptions");
        if (isMounted) {
          setAssumptions(data);
          setError("");
        }
      } catch (err) {
        if (isMounted) {
          setError(err.message || "Failed to load assumptions");
          setAssumptions(null);
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };

    loadAssumptions();
    return () => {
      isMounted = false;
    };
  }, []);

  /**
   * Updates selected scenario when assumptions load or change.
   * Preserves previous selection if still valid, otherwise defaults to first scenario.
   */
  useEffect(() => {
    const availableScenarios = assumptions?.scenarios || [];
    if (!availableScenarios.length) {
      setSelectedScenario("");
      return;
    }

    setSelectedScenario((prev) => {
      if (
        prev &&
        availableScenarios.some((scenario) => scenario.Name === prev)
      ) {
        return prev;
      }
      return availableScenarios[0].Name || "";
    });
  }, [assumptions]);

  return {
    assumptions,
    selectedScenario,
    setSelectedScenario,
    isLoading,
    error,
  };
}
