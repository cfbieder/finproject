import { useState, useCallback, useEffect } from "react";
import Rest from "../../../js/rest.js";
import {
  EDIT_FIELDS,
  createEditFieldMap,
  getConsensusValue,
  formatEditInputValue,
  parseEditFormValue,
} from "../utils/transBudgetUtils.js";
import {
  computeTransactionBudgetBaseAmount,
  DEFAULT_TRANSACTION_BASE_CURRENCY,
} from "../TransactionBudgetTable.jsx";

/**
 * Custom hook for editing budget transactions.
 * Manages edit modal state, form values, and submission logic.
 *
 * @param {Map} selectedRows - Map of selected row IDs to entries
 * @param {Array} budgetRates - Exchange rates for currency conversion
 * @param {Function} onSuccess - Callback after successful edit
 * @returns {Object} Edit state and methods
 */
export function useTransBudgetEdit(selectedRows, budgetRates, onSuccess) {
  const [showEditModal, setShowEditModal] = useState(false);
  const [editFormValues, setEditFormValues] = useState(() =>
    createEditFieldMap("")
  );
  const [editTouchedFields, setEditTouchedFields] = useState(() =>
    createEditFieldMap(false)
  );
  const [editConsensusFields, setEditConsensusFields] = useState(() =>
    createEditFieldMap(false)
  );
  const [isEditing, setIsEditing] = useState(false);
  const [editError, setEditError] = useState("");

  /**
   * Opens the edit modal with consensus values from selected transactions.
   * Fields where all selected rows have the same value are pre-filled.
   */
  const handleEditRequest = useCallback(() => {
    if (!selectedRows.size) {
      return;
    }
    const entries = Array.from(selectedRows.values());
    const nextValues = {};
    const nextConsensus = {};
    for (const field of EDIT_FIELDS) {
      const consensus = getConsensusValue(entries, field.key);
      nextConsensus[field.key] = consensus !== null && consensus !== undefined;
      nextValues[field.key] = formatEditInputValue(consensus, field.type);
    }
    setEditFormValues(nextValues);
    setEditTouchedFields(createEditFieldMap(false));
    setEditConsensusFields(nextConsensus);
    setEditError("");
    setShowEditModal(true);
  }, [selectedRows]);

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

  const amountInputValue = editFormValues.Amount;
  const currencyInputValue = editFormValues.Currency;

  // Automatically recalculate base amount when amount or currency changes
  useEffect(() => {
    const derivedBaseAmount = computeTransactionBudgetBaseAmount(
      amountInputValue,
      currencyInputValue,
      budgetRates,
      DEFAULT_TRANSACTION_BASE_CURRENCY
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
  }, [amountInputValue, currencyInputValue, budgetRates]);

  /**
   * Builds the API payload for updating selected transactions.
   * Only includes fields that were touched or had consensus values.
   * Recalculates base amount if amount or currency changed.
   * @returns {{payload: Object|null, error: string|null}}
   */
  const buildEditPayload = useCallback(() => {
    const payload = {};
    for (const field of EDIT_FIELDS) {
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
      const derivedBaseAmount = computeTransactionBudgetBaseAmount(
        editFormValues.Amount,
        editFormValues.Currency,
        budgetRates,
        DEFAULT_TRANSACTION_BASE_CURRENCY
      );
      if (Number.isFinite(derivedBaseAmount)) {
        payload.BaseAmount = derivedBaseAmount;
      } else if (payload.BaseAmount !== undefined) {
        delete payload.BaseAmount;
      }
    }

    return { payload, error: null };
  }, [editFormValues, editTouchedFields, editConsensusFields, budgetRates]);

  /**
   * Closes the edit modal, clearing any errors.
   */
  const handleEditCancel = useCallback(() => {
    if (isEditing) {
      return;
    }
    setShowEditModal(false);
    setEditError("");
  }, [isEditing]);

  /**
   * Submits edit form data to update all selected transactions.
   * Validates payload, sends PATCH requests, and calls onSuccess on completion.
   */
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
            // Use numeric id for v2 API, fall back to _id for v1 compatibility
            const id = entry?.id ?? entry?._id;
            if (!id) {
              throw new Error("Some selected entries cannot be edited.");
            }
            // Using v2 API (PostgreSQL)
            return fetch(Rest.buildUrl(`/api/v2/budget/entries/${id}`), {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(payload),
            }).then(async (response) => {
              if (!response.ok) {
                const responseBody = await response.json().catch(() => null);
                throw new Error(responseBody?.error || "Failed to update entry");
              }
              return response.json().catch(() => null);
            });
          })
        );
        setShowEditModal(false);
        if (onSuccess) {
          await onSuccess();
        }
      } catch (err) {
        console.error("[useTransBudgetEdit] Failed to update entries:", err);
        setEditError(err?.message ?? "Failed to update selected entries");
      } finally {
        setIsEditing(false);
      }
    },
    [selectedRows, buildEditPayload, onSuccess]
  );

  return {
    showEditModal,
    editFormValues,
    isEditing,
    editError,
    handleEditRequest,
    handleEditFieldChange,
    handleEditCancel,
    handleEditSubmit,
  };
}
