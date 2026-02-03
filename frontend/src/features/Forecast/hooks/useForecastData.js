import { useCallback, useEffect, useState } from "react";
import Rest from "../../../js/rest.js";

/**
 * Custom hook for loading forecast years and entries for a selected scenario.
 * Loads data when scenario changes, clears data when no scenario is selected.
 *
 * @param {string} selectedScenario - Name of the selected forecast scenario
 * @returns {Object} Forecast data state
 * @property {Array} years - Sorted array of forecast years
 * @property {Array} entries - Array of forecast entries { Year, Account, Amount }
 * @property {boolean} yearsLoading - Whether years are being loaded
 * @property {boolean} entriesLoading - Whether entries are being loaded
 * @property {string} yearsError - Error message if years loading failed
 * @property {string} entriesError - Error message if entries loading failed
 * @property {Function} reload - Manually triggers a reload of years and entries
 */
export function useForecastData(selectedScenario) {
  const [years, setYears] = useState([]);
  const [yearsLoading, setYearsLoading] = useState(false);
  const [yearsError, setYearsError] = useState("");

  const [entries, setEntries] = useState([]);
  const [entriesLoading, setEntriesLoading] = useState(false);
  const [entriesError, setEntriesError] = useState("");

  const [reloadTrigger, setReloadTrigger] = useState(0);

  /**
   * Loads forecast years for the selected scenario.
   * Years are sorted chronologically for display.
   */
  useEffect(() => {
    if (!selectedScenario) {
      setYears([]);
      return;
    }

    let isMounted = true;

    const loadYears = async () => {
      setYearsLoading(true);
      setYearsError("");
      try {
        // Using v2 API (PostgreSQL)
        const encodedScenario = encodeURIComponent(selectedScenario);
        const data = await Rest.fetchJson(
          `/api/v2/forecast/scenarios/years/${encodedScenario}`
        );
        if (!isMounted) return;

        const list = Array.isArray(data?.years) ? data.years : [];
        const sorted = [...list].sort((a, b) => Number(a) - Number(b));
        setYears(sorted);
      } catch (error) {
        if (isMounted) {
          setYearsError(error.message || "Failed to load forecast years");
        }
      } finally {
        if (isMounted) {
          setYearsLoading(false);
        }
      }
    };

    loadYears();
    return () => {
      isMounted = false;
    };
  }, [selectedScenario, reloadTrigger]);

  /**
   * Loads forecast entries for the selected scenario.
   * Entries contain Year, Account, and Amount for each forecast line item.
   */
  useEffect(() => {
    if (!selectedScenario) {
      setEntries([]);
      return;
    }

    let isMounted = true;

    const loadEntries = async () => {
      setEntriesLoading(true);
      setEntriesError("");
      try {
        // Using v2 API (PostgreSQL)
        const encoded = encodeURIComponent(selectedScenario);
        const data = await Rest.fetchJson(
          `/api/v2/forecast/entries?scenario=${encoded}`
        );
        if (!isMounted) return;

        const list = Array.isArray(data?.entries) ? data.entries : [];
        setEntries(list);
      } catch (error) {
        if (isMounted) {
          setEntriesError(error.message || "Failed to load forecast entries");
        }
      } finally {
        if (isMounted) {
          setEntriesLoading(false);
        }
      }
    };

    loadEntries();
    return () => {
      isMounted = false;
    };
  }, [selectedScenario, reloadTrigger]);

  /**
   * Manually triggers a reload of years and entries data.
   * Useful after generating a new forecast.
   */
  const reload = useCallback(() => {
    setReloadTrigger((prev) => prev + 1);
  }, []);

  return {
    years,
    entries,
    yearsLoading,
    entriesLoading,
    yearsError,
    entriesError,
    reload,
  };
}
