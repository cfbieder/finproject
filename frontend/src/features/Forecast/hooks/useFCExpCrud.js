import { useEffect, useState } from "react";
import { useToast } from "../../../contexts";
import Rest from "../../../js/rest.js";

/**
 * Hook for managing CRUD operations on forecast entries (edit and delete modals).
 *
 * @param {string} selectedScenario - Currently selected scenario
 * @param {Object|null} selectedEntry - Currently selected entry object
 * @param {Function} setIncomeExpenseEntries - Setter to update entries after CRUD
 * @param {Function} getScenarioStartYear - Returns scenario start year
 * @param {Object} accountNameOptions - Map of account names to leaf names
 * @param {Object} leafAccountLookup - Map of leaf names to parent account
 */
export function useFCExpCrud(
  selectedScenario,
  selectedEntry,
  setIncomeExpenseEntries,
  getScenarioStartYear,
  accountNameOptions,
  leafAccountLookup,
  setSelectedEntryId
) {
  const { showSuccess, showError: showErrorToast } = useToast();

  // Delete modal state
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteSaving, setDeleteSaving] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  // Edit modal state
  const [showEditModal, setShowEditModal] = useState(false);
  const [editForm, setEditForm] = useState(null);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState("");

  // Delete handlers
  const openDeleteModal = () => {
    if (!selectedEntry) return;
    setDeleteError("");
    setShowDeleteModal(true);
  };

  const closeDeleteModal = () => {
    if (deleteSaving) return;
    setShowDeleteModal(false);
    setDeleteError("");
  };

  const handleDeleteEntry = async () => {
    if (!selectedEntry?.id) {
      setDeleteError("Cannot delete entry without an identifier.");
      return;
    }
    setDeleteError("");
    setDeleteSaving(true);
    try {
      await Rest.fetchJson(
        `/api/v2/forecast/incomeexpense/${encodeURIComponent(selectedEntry.id)}`,
        { method: "DELETE" }
      );
      const payload = await Rest.fetchJson(
        `/api/v2/forecast/incomeexpense?scenario=${encodeURIComponent(selectedScenario)}`
      );
      setIncomeExpenseEntries(payload?.entries || []);
      setShowDeleteModal(false);
      showSuccess("Forecast entry deleted");
    } catch (err) {
      setDeleteError(err.message || "Failed to delete entry");
      showErrorToast(err.message || "Failed to delete forecast entry");
    } finally {
      setDeleteSaving(false);
    }
  };

  // Add handler — open the SAME modal as Edit, but as an unsaved DRAFT (id: null). Nothing is
  // written until Save, so cancelling leaves nothing behind. This mirrors the module editor
  // (CR042); the old Add immediately POSTed a blank "All" row, which is the very pattern CR042
  // removed for modules.
  const openAddDraft = () => {
    if (!selectedScenario) return;
    setEditError("");
    const startYear = getScenarioStartYear();
    const baseDate =
      Number.isFinite(startYear) && startYear
        ? new Date(`${startYear - 1}-12-31T00:00:00.000Z`).toISOString()
        : "";
    setEditForm({
      id: null, // ⇒ draft: handleSaveEdit POSTs instead of PUTs
      Scenario: selectedScenario,
      Account: "",
      Name: "",
      Type: "Expense",
      Currency: "USD",
      BaseDate: baseDate,
      BaseValue: 0,
      BaseValueUSD: 0,
      Growth: 1,
      Matched: false,
      Comment: "",
      SetupStatus: "new",
      Changes: [],
    });
    setShowEditModal(true);
  };

  // Edit handlers
  const openEditModal = () => {
    if (!selectedEntry) return;
    setEditError("");
    const startYear = getScenarioStartYear();
    const baseDate =
      Number.isFinite(startYear) && startYear
        ? new Date(`${startYear - 1}-12-31T00:00:00.000Z`).toISOString()
        : selectedEntry.BaseDate || "";
    setEditForm({
      ...selectedEntry,
      Scenario: selectedEntry.Scenario || selectedScenario || "",
      Account: selectedEntry.Account || "",
      Name: selectedEntry.Name || "",
      Type: selectedEntry.Type || "",
      // CR051 — load the row's real currency (was hard-pinned to "USD", which is why every line
      // read back as USD however it was saved).
      Currency: selectedEntry.Currency || "USD",
      BaseDate: baseDate,
      BaseValue: selectedEntry.BaseValue ?? 0,
      BaseValueUSD: selectedEntry.BaseValueUSD ?? 0,
      Growth:
        selectedEntry.Growth === null || selectedEntry.Growth === undefined
          ? ""
          : selectedEntry.Growth,
      Matched: Boolean(selectedEntry.Matched),
      Comment: selectedEntry.Comment || "",
      Changes: Array.isArray(selectedEntry.Changes)
        ? selectedEntry.Changes.map((change) => ({
            ...change,
            Date: change?.Date
              ? new Date(change.Date).toISOString().slice(0, 10)
              : "",
            Amount:
              change?.Amount === null || change?.Amount === undefined
                ? ""
                : change.Amount,
            Flag: change?.Flag || "",
          }))
        : [],
    });
    setShowEditModal(true);
  };

  const closeEditModal = () => {
    if (editSaving) return;
    setShowEditModal(false);
    setEditForm(null);
    setEditError("");
  };

  const handleEditFieldChange = (field, value) => {
    setEditForm((prev) => ({ ...(prev || {}), [field]: value }));
  };

  const normalizeNumber = (value) => {
    if (value === "" || value === null || value === undefined) return null;
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
  };

  const normalizeChanges = (changes) => {
    if (!Array.isArray(changes)) return [];
    return changes
      .map((change) => {
        const dateValue =
          change?.Date && !Number.isNaN(new Date(change.Date).getTime())
            ? new Date(change.Date).toISOString()
            : null;
        const amountValue = normalizeNumber(change?.Amount);
        const flagValue = (change?.Flag || "").trim();
        if (!dateValue && amountValue === null && !flagValue) return null;
        return { Date: dateValue, Amount: amountValue, Flag: flagValue };
      })
      .filter(Boolean);
  };

  const handleSaveEdit = async () => {
    if (!editForm) return;
    const isDraft = !editForm.id; // a draft from openAddDraft POSTs; an existing row PUTs

    const payload = {
      Scenario: (editForm.Scenario || "").trim(),
      Account: (editForm.Account || "").trim(),
      Name: (editForm.Name || "").trim(),
      Type: (editForm.Type || "").trim(),
      // CR051 — send the chosen currency (was hard-pinned to "USD"). Income lines have no picker
      // and stay USD; the server derives base_value_usd for a non-USD line, ignoring the client USD.
      Currency: editForm.Currency || "USD",
      Matched: Boolean(editForm.Matched),
      BaseDate:
        editForm.BaseDate &&
        !Number.isNaN(new Date(editForm.BaseDate).getTime())
          ? new Date(editForm.BaseDate).toISOString()
          : null,
      BaseValue: normalizeNumber(editForm.BaseValue),
      BaseValueUSD: normalizeNumber(editForm.BaseValueUSD),
      Growth: normalizeNumber(editForm.Growth),
      Comment: (editForm.Comment || "").trim(),
      SetupStatus: editForm.SetupStatus || "new",
      Changes: normalizeChanges(editForm.Changes),
    };

    setEditError("");
    setEditSaving(true);
    try {
      const created = await Rest.fetchJson(
        isDraft
          ? "/api/v2/forecast/incomeexpense"
          : `/api/v2/forecast/incomeexpense/${encodeURIComponent(editForm.id)}`,
        {
          method: isDraft ? "POST" : "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );
      const refreshed = await Rest.fetchJson(
        `/api/v2/forecast/incomeexpense?scenario=${encodeURIComponent(selectedScenario)}`
      );
      setIncomeExpenseEntries(refreshed?.entries || []);
      // Select the row we just created, so the toolbar's Edit/Delete act on it.
      if (isDraft && setSelectedEntryId && created?.data?.id) {
        setSelectedEntryId(String(created.data.id));
      }
      setShowEditModal(false);
      showSuccess(isDraft ? "Forecast entry added" : "Forecast entry updated");
    } catch (err) {
      setEditError(err.message || (isDraft ? "Failed to add entry" : "Failed to update entry"));
      showErrorToast(err.message || "Failed to save forecast entry");
    } finally {
      setEditSaving(false);
    }
  };

  // Auto-correct Account/Name when Matched mode is enabled (skip for FC Line items)
  useEffect(() => {
    if (!editForm?.Matched || editForm?.FcLineId) return;
    const account = editForm.Account;
    const name = editForm.Name;

    const ensureAccount =
      accountNameOptions[account] ||
      leafAccountLookup[name] ||
      leafAccountLookup[account] ||
      null;

    const targetAccount =
      typeof ensureAccount === "string"
        ? ensureAccount
        : Array.isArray(ensureAccount)
        ? account
        : account;

    if (targetAccount && targetAccount !== account) {
      setEditForm((prev) =>
        prev ? { ...prev, Account: targetAccount } : prev
      );
      return;
    }

    const names = accountNameOptions[targetAccount] || [];
    const allowAll = name === "All";
    if (names.length && !names.includes(name) && !allowAll) {
      setEditForm((prev) => (prev ? { ...prev, Name: names[0] || "" } : prev));
    }
  }, [
    accountNameOptions,
    editForm?.Account,
    editForm?.Matched,
    editForm?.Name,
    leafAccountLookup,
  ]);

  return {
    // Delete
    showDeleteModal,
    deleteSaving,
    deleteError,
    openDeleteModal,
    closeDeleteModal,
    handleDeleteEntry,
    // Edit
    showEditModal,
    editForm,
    editSaving,
    editError,
    openAddDraft,
    openEditModal,
    closeEditModal,
    handleEditFieldChange,
    handleSaveEdit,
  };
}
