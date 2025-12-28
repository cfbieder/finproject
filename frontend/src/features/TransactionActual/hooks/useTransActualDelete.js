import { useCallback, useState } from "react";
import Rest from "../../../js/rest.js";

/**
 * Custom hook for managing the delete confirmation modal and operations.
 *
 * @param {Function} onSuccess - Success callback (reload transactions)
 * @returns {Object} Delete modal state and handlers
 */
export function useTransActualDelete(onSuccess) {
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
            fetch(Rest.buildUrl(`/api/budget/actual-entries/${id}`), {
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
        await onSuccess();
      } catch (err) {
        console.error("[useTransActualDelete] Failed to delete entries:", err);
        setDeleteError(err?.message ?? "Failed to delete selected entries");
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
