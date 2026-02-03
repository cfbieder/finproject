import { useCallback, useState } from "react";
import Rest from "../../../js/rest.js";
import {
  createEditFieldMap,
  getConsensusValue,
  formatEditInputValue,
  parseEditFormValue,
} from "../transActualUtils.js";
import {
  computeTransactionActualBaseAmount,
  DEFAULT_TRANSACTION_BASE_CURRENCY,
} from "../TransactionActualTable.jsx";

/**
 * Custom hook for managing the edit modal state and operations.
 *
 * @param {Array} editFields - Field configuration array
 * @param {Object} actualRates - Exchange rates
 * @param {Function} onSuccess - Success callback (reload transactions)
 * @returns {Object} Edit modal state and handlers
 */
export function useTransActualEdit(editFields, actualRates, onSuccess) {
  const [showEditModal, setShowEditModal] = useState(false);
  const [editFormValues, setEditFormValues] = useState(() =>
    createEditFieldMap(editFields, "")
  );
  const [editTouchedFields, setEditTouchedFields] = useState(() =>
    createEditFieldMap(editFields, false)
  );
  const [editConsensusFields, setEditConsensusFields] = useState(() =>
    createEditFieldMap(editFields, false)
  );
  const [isEditing, setIsEditing] = useState(false);
  const [editError, setEditError] = useState("");

  const handleEditRequest = useCallback(
    (selectedRows) => {
      if (!selectedRows.size) {
        return;
      }
      const entries = Array.from(selectedRows.values());
      const nextValues = {};
      const nextConsensus = {};
      for (const field of editFields) {
        const consensus = getConsensusValue(entries, field.key);
        nextConsensus[field.key] =
          consensus !== null && consensus !== undefined;
        nextValues[field.key] = formatEditInputValue(consensus, field.type);
      }
      setEditFormValues(nextValues);
      setEditTouchedFields(createEditFieldMap(editFields, false));
      setEditConsensusFields(nextConsensus);
      setEditError("");
      setShowEditModal(true);
    },
    [editFields]
  );

  const handleEditFieldChange = useCallback((fieldKey, value) => {
    setEditFormValues((previous) => ({
      ...previous,
      [fieldKey]: value,
    }));
    setEditTouchedFields((previous) => ({
      ...previous,
      [fieldKey]: true,
    }));
  }, []);

  const buildEditPayload = useCallback(() => {
    const payload = {};
    for (const field of editFields) {
      const shouldInclude =
        editTouchedFields[field.key] || editConsensusFields[field.key];
      if (!shouldInclude) {
        continue;
      }
      const { valid, parsed } = parseEditFormValue(
        editFormValues[field.key],
        field.type
      );
      if (!valid) {
        return {
          payload: null,
          error: `Invalid ${field.label.toLowerCase()} value.`,
        };
      }
      if (parsed === null) {
        continue;
      }
      payload[field.key] = parsed;
    }

    const shouldRecalculateBaseAmount =
      payload.Amount !== undefined || payload.Currency !== undefined;

    if (shouldRecalculateBaseAmount) {
      const derivedBaseAmount = computeTransactionActualBaseAmount(
        editFormValues.Amount,
        editFormValues.Currency,
        actualRates,
        DEFAULT_TRANSACTION_BASE_CURRENCY
      );
      if (Number.isFinite(derivedBaseAmount)) {
        payload.BaseAmount = derivedBaseAmount;
      } else if (payload.BaseAmount !== undefined) {
        delete payload.BaseAmount;
      }
    }

    return { payload, error: null };
  }, [editFields, editFormValues, editTouchedFields, editConsensusFields, actualRates]);

  const handleEditCancel = useCallback(() => {
    if (isEditing) {
      return;
    }
    setShowEditModal(false);
    setEditError("");
  }, [isEditing]);

  const handleEditSubmit = useCallback(
    async (event, selectedRows) => {
      event.preventDefault();
      if (!selectedRows.size) {
        return;
      }
      const { payload, error: payloadError } = buildEditPayload();
      if (payloadError) {
        setEditError(payloadError);
        return;
      }
      if (!payload || !Object.keys(payload).length) {
        setEditError("Please make a change before saving.");
        return;
      }
      setIsEditing(true);
      setEditError("");
      try {
        await Promise.all(
          Array.from(selectedRows.values()).map((entry) => {
            // Use numeric id for v2 API, fall back to _id for v1 compatibility
            const id = entry?.id ?? entry?._id;
            if (!id) {
              throw new Error("Some selected entries cannot be edited.");
            }
            // Using v2 API (PostgreSQL) - accepts both v1 field names and v2 snake_case
            return fetch(Rest.buildUrl(`/api/v2/transactions/${id}`), {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(payload),
            }).then(async (response) => {
              if (!response.ok) {
                const responseBody = await response.json().catch(() => null);
                throw new Error(
                  responseBody?.error || "Failed to update entry"
                );
              }
              return response.json().catch(() => null);
            });
          })
        );
        setShowEditModal(false);
        await onSuccess();
      } catch (err) {
        console.error("[useTransActualEdit] Failed to update entries:", err);
        setEditError(err?.message ?? "Failed to update selected entries");
      } finally {
        setIsEditing(false);
      }
    },
    [buildEditPayload, onSuccess]
  );

  return {
    showEditModal,
    editFormValues,
    setEditFormValues,
    isEditing,
    editError,
    handleEditRequest,
    handleEditFieldChange,
    handleEditCancel,
    handleEditSubmit,
  };
}
