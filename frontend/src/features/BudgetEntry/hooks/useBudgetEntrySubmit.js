import { useState } from "react";
import Rest from "../../../js/rest.js";
import {
  BASE_CURRENCY,
  buildMonthSequence,
  normalizeCurrencyCode,
  normalizeTextInput,
  parseNumericInput,
} from "../utils/budgetInputUtils.js";

/**
 * Hook for managing budget entry submission, including expense sign modal.
 *
 * @param {Object} params
 * @param {Object} params.entryForm - Current entry form values
 * @param {Function} params.setEntryForm - Setter for entry form
 * @param {Array} params.monthSelectOptions - Available month options
 * @param {number|undefined} params.computedBaseAmount - Base amount in USD
 * @param {Object} params.categoryGroups - Category groups from filter options
 * @param {string} params.budgetYear - Selected budget year
 * @param {Object} params.activeMonthRange - { start, end } month range
 * @param {Function} params.refreshBalances - Refresh balance data
 * @param {Function} params.setBudgetEntriesPopupRequest - Close budget popup
 */
export function useBudgetEntrySubmit({
  entryForm,
  setEntryForm,
  monthSelectOptions,
  computedBaseAmount,
  categoryGroups,
  budgetYear,
  activeMonthRange,
  refreshBalances,
  setBudgetEntriesPopupRequest,
}) {
  const [entryStatus, setEntryStatus] = useState({
    loading: false,
    error: "",
    message: "",
  });
  const [expenseSignModal, setExpenseSignModal] = useState(null);

  const resolveBudgetEntryDateSelection = () => {
    if (!Array.isArray(monthSelectOptions) || !monthSelectOptions.length) {
      return "";
    }
    const validValues = new Set(
      monthSelectOptions
        .map((option) => option?.value)
        .filter((value) => value !== undefined && value !== null)
    );
    if (validValues.has(entryForm.date)) {
      return entryForm.date;
    }
    if (validValues.has("All")) {
      return "All";
    }
    const firstOption = monthSelectOptions.find(
      (option) => option && option.value
    );
    return firstOption ? firstOption.value : "";
  };

  const performBudgetEntrySubmit = async (
    amountOverride,
    baseAmountOverride,
    selectedDateValue
  ) => {
    setEntryStatus({ loading: true, error: "", message: "" });

    const resolvedDateSelection =
      selectedDateValue ?? resolveBudgetEntryDateSelection();
    if (!resolvedDateSelection) {
      setEntryStatus({
        loading: false,
        error: "Please select a valid period for the budget entry.",
        message: "",
      });
      return;
    }

    const normalizedCurrency = normalizeCurrencyCode(entryForm.currency);
    const isAllMonthsSelected = resolvedDateSelection === "All";
    const amountToUse = amountOverride ?? parseNumericInput(entryForm.amount);
    const baseAmountToUse = Number.isFinite(baseAmountOverride)
      ? baseAmountOverride
      : Number.isFinite(computedBaseAmount)
      ? computedBaseAmount
      : undefined;
    const payload = {
      Date:
        resolvedDateSelection && resolvedDateSelection !== "All"
          ? `${resolvedDateSelection}-01`
          : undefined,
      Description1: normalizeTextInput(entryForm.description),
      Account: (() => {
        const normalized = normalizeTextInput(entryForm.account);
        return normalized && normalized.toLowerCase() === "none"
          ? undefined
          : normalized;
      })(),
      Category: normalizeTextInput(entryForm.category),
      Amount: amountToUse,
      BaseAmount: Number.isFinite(baseAmountToUse)
        ? baseAmountToUse
        : undefined,
      Currency: normalizedCurrency || undefined,
      BaseCurrency: BASE_CURRENCY,
      Note: normalizeTextInput(entryForm.note),
    };

    const sanitizedPayload = Object.fromEntries(
      Object.entries(payload).filter(([, value]) => value !== undefined)
    );

    if (!Object.keys(sanitizedPayload).length) {
      setEntryStatus({
        loading: false,
        error: "Please provide at least one valid value to submit.",
        message: "",
      });
      return;
    }

    let entriesToPersist = [];
    if (isAllMonthsSelected) {
      const budgetYearNumber = Number(budgetYear);
      if (!Number.isFinite(budgetYearNumber)) {
        setEntryStatus({
          loading: false,
          error: "Unable to resolve the budget year for the selected months.",
          message: "",
        });
        return;
      }

      const monthSequence = buildMonthSequence(
        activeMonthRange.start,
        activeMonthRange.end
      );
      if (!monthSequence.length) {
        setEntryStatus({
          loading: false,
          error: "No months are available for the current budget period.",
          message: "",
        });
        return;
      }

      const paddedYear = String(Math.floor(budgetYearNumber)).padStart(4, "0");
      const basePayload = { ...sanitizedPayload };
      delete basePayload.Date;

      entriesToPersist = monthSequence.map((monthNumber) => {
        const paddedMonth = String(monthNumber).padStart(2, "0");
        return {
          ...basePayload,
          Date: `${paddedYear}-${paddedMonth}-01`,
        };
      });
    } else {
      entriesToPersist = [sanitizedPayload];
    }

    const submissionBody = isAllMonthsSelected
      ? entriesToPersist
      : entriesToPersist[0];

    try {
      await Rest.fetchJson("/api/v2/budget/entries", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(submissionBody),
      });

      setEntryStatus({
        loading: false,
        error: "",
        message:
          entriesToPersist.length > 1
            ? "Budget entries saved successfully."
            : "Budget entry saved successfully.",
      });
      setEntryForm((previous) => ({
        ...previous,
        date: "",
        description: "",
        amount: "",
        note: "",
      }));
      setBudgetEntriesPopupRequest(null);
      refreshBalances();
    } catch (error) {
      console.error("[BudgetInput] Failed to submit budget entry:", error);
      setEntryStatus({
        loading: false,
        error: error?.message || "Unable to submit budget entry.",
        message: "",
      });
    }
  };

  const handleBudgetEntrySubmit = async (event) => {
    event.preventDefault();
    const resolvedDateSelection = resolveBudgetEntryDateSelection();
    if (!resolvedDateSelection) {
      setEntryStatus({
        loading: false,
        error: "Please select a valid period for the budget entry.",
        message: "",
      });
      return;
    }
    if (resolvedDateSelection !== entryForm.date) {
      setEntryForm((previous) => ({
        ...previous,
        date: resolvedDateSelection,
      }));
    }
    const parsedAmount = parseNumericInput(entryForm.amount);
    const normalizedCategory = normalizeTextInput(entryForm.category);
    const isExpenseCategory =
      normalizedCategory &&
      Array.isArray(categoryGroups?.Expense) &&
      categoryGroups.Expense.some(
        (category) =>
          typeof category === "string" &&
          category.trim().toLowerCase() === normalizedCategory.toLowerCase()
      );

    if (isExpenseCategory && Number.isFinite(parsedAmount) && parsedAmount > 0) {
      setExpenseSignModal({
        amount: parsedAmount,
        baseAmount: computedBaseAmount,
      });
      return;
    }

    await performBudgetEntrySubmit(
      parsedAmount,
      computedBaseAmount,
      resolvedDateSelection
    );
  };

  const handleExpenseSignModalClose = () => {
    if (entryStatus.loading) return;
    setExpenseSignModal(null);
  };

  const handleExpenseSignModalConfirmNegative = async () => {
    if (!expenseSignModal) return;
    const negativeAmount = -Math.abs(expenseSignModal.amount);
    const negativeBaseAmount = Number.isFinite(expenseSignModal.baseAmount)
      ? -Math.abs(expenseSignModal.baseAmount)
      : undefined;
    setExpenseSignModal(null);
    setEntryForm((previous) => ({
      ...previous,
      amount: String(negativeAmount),
    }));
    await performBudgetEntrySubmit(negativeAmount, negativeBaseAmount);
  };

  const handleExpenseSignModalKeepPositive = async () => {
    if (!expenseSignModal) return;
    const positiveAmount = expenseSignModal.amount;
    const baseAmountToUse = Number.isFinite(expenseSignModal.baseAmount)
      ? expenseSignModal.baseAmount
      : undefined;
    setExpenseSignModal(null);
    await performBudgetEntrySubmit(positiveAmount, baseAmountToUse);
  };

  return {
    entryStatus,
    expenseSignModal,
    handleBudgetEntrySubmit,
    handleExpenseSignModalClose,
    handleExpenseSignModalConfirmNegative,
    handleExpenseSignModalKeepPositive,
  };
}
