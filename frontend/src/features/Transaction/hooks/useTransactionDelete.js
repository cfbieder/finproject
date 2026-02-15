import { useState, useCallback } from "react";
import { useToast } from "../../../contexts";
import Rest from "../../../js/rest.js";

/**
 * Shared hook for managing the delete confirmation modal and operations.
 *
 * @param {Object} config - Transaction config (ACTUAL_CONFIG or BUDGET_CONFIG)
 * @param {Map} selectedRows - Map of selected row IDs to entries
 * @param {Function} onSuccess - Success callback (reload transactions)
 * @returns {Object} Delete modal state and handlers
 */
export function useTransactionDelete(config, selectedRows, onSuccess) {
  const { endpoint, deleteSuccessMessage, logPrefix } = config;
  const { showSuccess, showError } = useToast();
  const [showDeleteConfirmation, setShowDeleteConfirmation] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  const handleDeleteRequest = useCallback(() => {
    if (!selectedRows.size) {
      return;
    }
    setDeleteError("");
    setShowDeleteConfirmation(true);
  }, [selectedRows]);

  const handleDeleteCancel = useCallback(() => {
    if (isDeleting) {
      return;
    }
    setDeleteError("");
    setShowDeleteConfirmation(false);
  }, [isDeleting]);

  const handleConfirmDelete = useCallback(async () => {
    const ids = Array.from(selectedRows.values())
      .map((entry) => entry?.id ?? entry?._id)
      .filter(Boolean);

    if (!ids.length) {
      setDeleteError("No deleteable transactions selected.");
      return;
    }

    setIsDeleting(true);
    try {
      await Promise.all(
        ids.map((id) =>
          fetch(Rest.buildUrl(`${endpoint}/${id}`), {
            method: "DELETE",
          }).then(async (response) => {
            if (!response.ok) {
              const payload = await response.json().catch(() => null);
              throw new Error(payload?.error || "Failed to delete entry");
            }
            return true;
          })
        )
      );
      setShowDeleteConfirmation(false);
      showSuccess(deleteSuccessMessage);
      if (onSuccess) {
        await onSuccess();
      }
    } catch (err) {
      console.error(`[${logPrefix}] Failed to delete entries:`, err);
      setDeleteError(err?.message ?? "Failed to delete selected entries");
      showError(err?.message ?? "Failed to delete selected entries");
    } finally {
      setIsDeleting(false);
    }
  }, [selectedRows, onSuccess, endpoint, deleteSuccessMessage, logPrefix]);

  return {
    showDeleteConfirmation,
    isDeleting,
    deleteError,
    handleDeleteRequest,
    handleDeleteCancel,
    handleConfirmDelete,
  };
}
