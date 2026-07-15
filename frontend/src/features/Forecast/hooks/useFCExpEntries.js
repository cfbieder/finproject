import { useEffect, useMemo, useState } from "react";
import Rest from "../../../js/rest.js";

/**
 * Hook for loading and managing forecast income/expense entries.
 *
 * Adding an entry lives in useFCExpCrud (openAddDraft — a draft in the edit modal); this hook only
 * loads, sorts, and tracks selection.
 *
 * @param {string} selectedScenario - Currently selected scenario name
 */
export function useFCExpEntries(selectedScenario) {
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

  // Adding an entry is now a DRAFT in the edit modal (useFCExpCrud.openAddDraft) — nothing is
  // written until Save. The old immediate-POST-a-blank-"All"-row handler was removed with that
  // change (it was the very pattern CR042 removed for modules).

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
  };
}
