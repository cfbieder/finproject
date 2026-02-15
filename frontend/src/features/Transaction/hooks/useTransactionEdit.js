import { useState, useCallback, useEffect } from "react";
import { useToast } from "../../../contexts";
import Rest from "../../../js/rest.js";
import {
  createEditFieldMap,
  getConsensusValue,
  formatEditInputValue,
  parseEditFormValue,
} from "../transactionUtils.js";

/**
 * Shared hook for managing the edit modal state and operations.
 *
 * @param {Object} config - Transaction config (ACTUAL_CONFIG or BUDGET_CONFIG)
 * @param {Map} selectedRows - Map of selected row IDs to entries
 * @param {Object} exchangeRates - Exchange rates for currency conversion
 * @param {Function} computeBaseAmount - Function to compute base amount from amount, currency, rates
 * @param {Function} onSuccess - Success callback (reload transactions)
 * @returns {Object} Edit modal state and handlers
 */
export function useTransactionEdit(
  config,
  selectedRows,
  exchangeRates,
  computeBaseAmount,
  onSuccess
) {
  const { editFields, endpoint, editSuccessMessage, logPrefix } = config;
  const { showSuccess, showError: showErrorToast } = useToast();
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

  const handleEditRequest = useCallback(() => {
    if (!selectedRows.size) {
      return;
    }
    const entries = Array.from(selectedRows.values());
    const nextValues = {};
    const nextConsensus = {};
    for (const field of editFields) {
      const consensus = getConsensusValue(entries, field.key);
      nextConsensus[field.key] = consensus !== null && consensus !== undefined;
      nextValues[field.key] = formatEditInputValue(consensus, field.type);
    }
    setEditFormValues(nextValues);
    setEditTouchedFields(createEditFieldMap(editFields, false));
    setEditConsensusFields(nextConsensus);
    setEditError("");
    setShowEditModal(true);
  }, [selectedRows, editFields]);

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

  // Automatically recalculate base amount when amount or currency changes
  const amountInputValue = editFormValues.Amount;
  const currencyInputValue = editFormValues.Currency;

  useEffect(() => {
    const derivedBaseAmount = computeBaseAmount(
      amountInputValue,
      currencyInputValue,
      exchangeRates
    );
    const nextBaseValue = Number.isFinite(derivedBaseAmount)
      ? String(derivedBaseAmount)
      : "";
    setEditFormValues((previous) => {
      if (previous.BaseAmount === nextBaseValue) {
        return previous;
      }
      return { ...previous, BaseAmount: nextBaseValue };
    });
  }, [amountInputValue, currencyInputValue, exchangeRates, computeBaseAmount]);

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
      const derivedBaseAmount = computeBaseAmount(
        editFormValues.Amount,
        editFormValues.Currency,
        exchangeRates
      );
      if (Number.isFinite(derivedBaseAmount)) {
        payload.BaseAmount = derivedBaseAmount;
      } else if (payload.BaseAmount !== undefined) {
        delete payload.BaseAmount;
      }
    }

    return { payload, error: null };
  }, [
    editFields,
    editFormValues,
    editTouchedFields,
    editConsensusFields,
    exchangeRates,
    computeBaseAmount,
  ]);

  const handleEditCancel = useCallback(() => {
    if (isEditing) {
      return;
    }
    setShowEditModal(false);
    setEditError("");
  }, [isEditing]);

  const handleEditSubmit = useCallback(
    async (event) => {
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
            const id = entry?.id ?? entry?._id;
            if (!id) {
              throw new Error("Some selected entries cannot be edited.");
            }
            return fetch(Rest.buildUrl(`${endpoint}/${id}`), {
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
        showSuccess(editSuccessMessage);
        if (onSuccess) {
          await onSuccess();
        }
      } catch (err) {
        console.error(`[${logPrefix}] Failed to update entries:`, err);
        setEditError(err?.message ?? "Failed to update selected entries");
        showErrorToast(err?.message ?? "Failed to update selected entries");
      } finally {
        setIsEditing(false);
      }
    },
    [selectedRows, buildEditPayload, onSuccess, endpoint, editSuccessMessage, logPrefix]
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
