import { useState, useCallback } from "react";
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
    const ids = Array.from(selectedRows.values())
      .map((entry) => entry?._id)
      .filter(Boolean);

    if (!ids.length) {
      setDeleteError("No deleteable transactions selected.");
      return;
    }

    setIsDeleting(true);
    try {
      await Promise.all(
        ids.map((id) =>
          fetch(Rest.buildUrl(`/api/budget/${id}`), {
            method: "DELETE",
          }).then(async (response) => {
            if (!response.ok) {
              const payload = await response.json().catch(() => null);
              throw new Error(payload?.error || "Failed to delete entry");
            }
            return response.json().catch(() => null);
          })
        )
      );
      setShowDeleteConfirmation(false);
      if (onSuccess) {
        await onSuccess();
      }
    } catch (err) {
      console.error("[useTransBudgetDelete] Failed to delete entries:", err);
      setDeleteError(err?.message ?? "Failed to delete selected entries");
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
