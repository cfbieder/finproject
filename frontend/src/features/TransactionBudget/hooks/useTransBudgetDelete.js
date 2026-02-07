import { useState, useCallback } from "react";
import { useToast } from "../../../contexts";
import Rest from "../../../js/rest.js";

/**
 * Custom hook for deleting budget transactions.
 * Manages delete confirmation modal state and deletion logic.
 *
 * @param {Map} selectedRows - Map of selected row IDs to entries
 * @param {Function} onSuccess - Callback after successful deletion
 * @returns {Object} Delete state and methods
 */
export function useTransBudgetDelete(selectedRows, onSuccess) {
  const { showSuccess, showError } = useToast();
  const [showDeleteConfirmation, setShowDeleteConfirmation] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  /**
   * Opens the delete confirmation modal.
   */
  const handleDeleteRequest = useCallback(() => {
    if (!selectedRows.size) {
      return;
    }
    setDeleteError("");
    setShowDeleteConfirmation(true);
  }, [selectedRows]);

  /**
   * Closes the delete confirmation modal.
   */
  const handleDeleteCancel = useCallback(() => {
    if (isDeleting) {
      return;
    }
    setDeleteError("");
    setShowDeleteConfirmation(false);
  }, [isDeleting]);

  /**
   * Deletes all selected transactions via API DELETE requests.
   * Calls onSuccess callback after successful deletion.
   */
  const handleConfirmDelete = useCallback(async () => {
    // Use numeric id for v2 API, fall back to _id for v1 compatibility
    const ids = Array.from(selectedRows.values())
      .map((entry) => entry?.id ?? entry?._id)
      .filter(Boolean);

    if (!ids.length) {
      setDeleteError("No deleteable transactions selected.");
      return;
    }

    setIsDeleting(true);
    try {
      // Using v2 API (PostgreSQL)
      await Promise.all(
        ids.map((id) =>
          fetch(Rest.buildUrl(`/api/v2/budget/entries/${id}`), {
            method: "DELETE",
          }).then(async (response) => {
            if (!response.ok) {
              const payload = await response.json().catch(() => null);
              throw new Error(payload?.error || "Failed to delete entry");
            }
            // v2 API returns 204 No Content on success
            return true;
          })
        )
      );
      setShowDeleteConfirmation(false);
      showSuccess("Budget entries deleted successfully");
      if (onSuccess) {
        await onSuccess();
      }
    } catch (err) {
      console.error("[useTransBudgetDelete] Failed to delete entries:", err);
      setDeleteError(err?.message ?? "Failed to delete selected entries");
      showError(err?.message ?? "Failed to delete selected entries");
    } finally {
      setIsDeleting(false);
    }
  }, [selectedRows, onSuccess]);

  return {
    showDeleteConfirmation,
    isDeleting,
    deleteError,
    handleDeleteRequest,
    handleDeleteCancel,
    handleConfirmDelete,
  };
}
