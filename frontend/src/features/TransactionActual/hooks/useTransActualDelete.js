import { useCallback, useState } from "react";
import { useToast } from "../../../contexts";
import Rest from "../../../js/rest.js";

/**
 * Custom hook for managing the delete confirmation modal and operations.
 *
 * @param {Function} onSuccess - Success callback (reload transactions)
 * @returns {Object} Delete modal state and handlers
 */
export function useTransActualDelete(onSuccess) {
  const { showSuccess, showError } = useToast();
  const [showDeleteConfirmation, setShowDeleteConfirmation] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  const handleDeleteRequest = useCallback(() => {
    setDeleteError("");
    setShowDeleteConfirmation(true);
  }, []);

  const handleDeleteCancel = useCallback(() => {
    if (isDeleting) {
      return;
    }
    setDeleteError("");
    setShowDeleteConfirmation(false);
  }, [isDeleting]);

  const handleConfirmDelete = useCallback(
    async (selectedRows) => {
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
            fetch(Rest.buildUrl(`/api/v2/transactions/${id}`), {
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
        showSuccess("Transactions deleted successfully");
        await onSuccess();
      } catch (err) {
        console.error("[useTransActualDelete] Failed to delete entries:", err);
        setDeleteError(err?.message ?? "Failed to delete selected entries");
        showError(err?.message ?? "Failed to delete selected entries");
      } finally {
        setIsDeleting(false);
      }
    },
    [onSuccess]
  );

  return {
    showDeleteConfirmation,
    isDeleting,
    deleteError,
    handleDeleteRequest,
    handleDeleteCancel,
    handleConfirmDelete,
  };
}
