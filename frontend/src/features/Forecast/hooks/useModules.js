import { useCallback, useEffect, useState } from "react";
import Rest from "../../../js/rest.js";

/**
 * Generates a unique identifier for a module.
 * Attempts multiple ID fields before falling back to composite key.
 *
 * @param {Object} module - The module object
 * @returns {string} Unique module identifier
 */
export const getModuleId = (module) =>
  module?.id ??
  `${module?.Scenario ?? "module"}-${module?.Account ?? module?.Name ?? ""}`;

/**
 * Custom hook for loading and managing forecast modules for a selected scenario.
 * Provides module data, selection state, and refresh capability.
 *
 * @param {string} selectedScenario - Currently selected scenario name
 * @returns {Object} Modules state
 * @property {Array} modules - Filtered list of modules for selected scenario
 * @property {string} selectedModuleId - Currently selected module ID
 * @property {Function} setSelectedModuleId - Update selected module ID
 * @property {Object|null} selectedModule - Currently selected module object
 * @property {boolean} loading - Whether modules are being loaded
 * @property {string} error - Error message if loading failed
 * @property {Function} reload - Manually reload modules for current scenario
 * @property {Function} getModuleId - Utility function to get module ID
 */
export function useModules(selectedScenario) {
  const [modules, setModules] = useState([]);
  const [selectedModuleId, setSelectedModuleId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [reloadTrigger, setReloadTrigger] = useState(0);

  /**
   * Loads modules for the selected scenario from the API.
   * Filters results by scenario and updates selected module if needed.
   */
  useEffect(() => {
    if (!selectedScenario) {
      setModules([]);
      setSelectedModuleId("");
      setError("");
      setLoading(false);
      return;
    }

    let isMounted = true;

    const loadModules = async () => {
      setLoading(true);
      try {
        // unwrap(): tolerates the bare array this endpoint returns today AND the {data}
        // envelope it moves to (CR043 N8) — so the server can migrate with no flag day.
        const data = Rest.unwrap(
          await Rest.fetchJson(
            `/api/v2/forecast/modules?scenario=${encodeURIComponent(selectedScenario)}`
          )
        );
        if (!isMounted) return;

        const filtered = Array.isArray(data) ? data : [];
        setModules(filtered);
        setError("");

        // Update selected module if current selection is no longer valid
        setSelectedModuleId((prev) => {
          if (filtered.some((entry) => getModuleId(entry) === prev)) {
            return prev;
          }
          const firstId = filtered[0] ? getModuleId(filtered[0]) : "";
          return firstId || "";
        });
      } catch (err) {
        if (!isMounted) return;
        setModules([]);
        setError(err.message || "Failed to load modules");
        setSelectedModuleId("");
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    loadModules();
    return () => {
      isMounted = false;
    };
  }, [selectedScenario, reloadTrigger]);

  /**
   * Manually reload modules for current scenario.
   * Useful after create/update/delete operations.
   */
  const reload = useCallback(() => {
    setReloadTrigger((prev) => prev + 1);
  }, []);

  /**
   * Get the currently selected module object.
   */
  const selectedModule =
    modules.find((module) => getModuleId(module) === selectedModuleId) ?? null;

  return {
    modules,
    selectedModuleId,
    setSelectedModuleId,
    selectedModule,
    loading,
    error,
    reload,
    getModuleId,
  };
}
