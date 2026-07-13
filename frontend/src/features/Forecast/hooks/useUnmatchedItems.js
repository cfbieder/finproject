import { useCallback, useState } from "react";
import Rest from "../../../js/rest.js";
import { normalizeUnmatchedItems } from "../utils/fcModuleManageUtils.js";

/**
 * Custom hook for loading unmatched items that can be converted to forecast modules.
 * Provides manual trigger for loading items and manages loading state.
 *
 * @returns {Object} Unmatched items state
 * @property {Array} unmatchedItems - Array of {name, category} objects
 * @property {boolean} loading - Whether items are being loaded
 * @property {string} error - Error message if loading failed
 * @property {Function} loadUnmatched - Manually load unmatched items for a scenario
 * @property {Function} clear - Clear unmatched items and reset state
 */
export function useUnmatchedItems() {
  const [unmatchedItems, setUnmatchedItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  /**
   * Loads unmatched items for the specified scenario.
   *
   * @param {string} scenario - Scenario name to load unmatched items for
   */
  const loadUnmatched = useCallback(async (scenario) => {
    if (!scenario) {
      setUnmatchedItems([]);
      setError("");
      return;
    }

    setLoading(true);
    setError("");
    try {
      // Using v2 API (PostgreSQL)
      const data = Rest.unwrap(
        await Rest.fetchJson(
          `/api/v2/forecast/modules/unmatched?scenario=${encodeURIComponent(scenario)}`
        )
      );
      const items = normalizeUnmatchedItems(data);
      setUnmatchedItems(items);
    } catch (err) {
      setUnmatchedItems([]);
      setError(err.message || "Failed to load unmatched items");
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * Clears unmatched items and resets state.
   */
  const clear = useCallback(() => {
    setUnmatchedItems([]);
    setError("");
    setLoading(false);
  }, []);

  return {
    unmatchedItems,
    loading,
    error,
    loadUnmatched,
    clear,
  };
}
