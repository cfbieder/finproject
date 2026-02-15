import { useEffect, useMemo, useState } from "react";
import { useToast } from "../../../contexts";
import Rest from "../../../js/rest.js";

/**
 * Hook for loading and managing forecast income/expense entries.
 *
 * @param {string} selectedScenario - Currently selected scenario name
 * @param {Function} getScenarioStartYear - Returns the start year of the current scenario
 */
export function useFCExpEntries(selectedScenario, getScenarioStartYear) {
  const { showSuccess, showError: showErrorToast } = useToast();
  const [incomeExpenseEntries, setIncomeExpenseEntries] = useState([]);
  const [entriesLoading, setEntriesLoading] = useState(false);
  const [entriesError, setEntriesError] = useState("");
  const [selectedEntryId, setSelectedEntryId] = useState("");

  const getEntryId = (entry) =>
    entry?.id || `${entry?.Account || ""}-${entry?.Name || ""}`;

  // Load entries when scenario changes
  useEffect(() => {
    if (!selectedScenario) {
      setIncomeExpenseEntries([]);
      setEntriesError("");
      setSelectedEntryId("");
      return;
    }

    let isMounted = true;
    const loadEntries = async () => {
      setEntriesLoading(true);
      try {
        const payload = await Rest.fetchJson(
          `/api/v2/forecast/incomeexpense?scenario=${encodeURIComponent(selectedScenario)}`
        );
        if (isMounted) {
          setIncomeExpenseEntries(payload?.entries || []);
          setEntriesError("");
          setSelectedEntryId("");
        }
      } catch (err) {
        if (isMounted) {
          setIncomeExpenseEntries([]);
          setEntriesError(err.message || "Failed to load forecast income/expense entries");
        }
      } finally {
        if (isMounted) setEntriesLoading(false);
      }
    };

    loadEntries();
    return () => { isMounted = false; };
  }, [selectedScenario]);

  const sortedEntries = useMemo(() => {
    return [...incomeExpenseEntries].sort((a, b) => {
      const accountCompare = (a.Account || "").localeCompare(b.Account || "");
      if (accountCompare !== 0) return accountCompare;
      return (a.Name || "").localeCompare(b.Name || "");
    });
  }, [incomeExpenseEntries]);

  // Auto-select first entry
  useEffect(() => {
    setSelectedEntryId((prev) => {
      if (incomeExpenseEntries.some((entry) => getEntryId(entry) === prev)) return prev;
      const first = incomeExpenseEntries[0];
      return first ? getEntryId(first) : "";
    });
  }, [incomeExpenseEntries]);

  const selectedEntry =
    sortedEntries.find((entry) => getEntryId(entry) === selectedEntryId) ?? null;

  const handleAddIncomeExpense = async () => {
    if (!selectedScenario) return;

    const existingIds = new Set(incomeExpenseEntries.map((entry) => getEntryId(entry)));
    const prevSelectedId = selectedEntryId;
    const startYear = getScenarioStartYear();
    const baseDate =
      Number.isFinite(startYear) && startYear
        ? new Date(`${startYear - 1}-12-31T00:00:00.000Z`).toISOString()
        : null;

    setEntriesError("");
    setEntriesLoading(true);
    try {
      await Rest.fetchJson("/api/v2/forecast/incomeexpense", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          Scenario: selectedScenario,
          Matched: true,
          Account: "",
          Name: "All",
          Type: "",
          Currency: "USD",
          BaseDate: baseDate,
          BaseValue: 0,
          BaseValueUSD: 0,
          Growth: 1,
          Changes: [],
        }),
      });
      const payload = await Rest.fetchJson(
        `/api/v2/forecast/incomeexpense?scenario=${encodeURIComponent(selectedScenario)}`
      );
      const nextEntries = payload?.entries || [];
      setIncomeExpenseEntries(nextEntries);
      const newlyCreated = nextEntries.find((entry) => !existingIds.has(getEntryId(entry))) || null;
      const nextSelectedId =
        (newlyCreated && getEntryId(newlyCreated)) ||
        (existingIds.has(prevSelectedId) ? prevSelectedId : "") ||
        (nextEntries[0] ? getEntryId(nextEntries[0]) : "");
      setSelectedEntryId(nextSelectedId);
      showSuccess("Forecast entry added");
    } catch (err) {
      setEntriesError(err.message || "Failed to add income/expense entry");
      showErrorToast(err.message || "Failed to add forecast entry");
    } finally {
      setEntriesLoading(false);
    }
  };

  return {
    incomeExpenseEntries,
    setIncomeExpenseEntries,
    entriesLoading,
    entriesError,
    selectedEntryId,
    setSelectedEntryId,
    sortedEntries,
    selectedEntry,
    getEntryId,
    handleAddIncomeExpense,
  };
}
