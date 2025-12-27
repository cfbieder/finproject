/**
 * BudgetExpenseSignModal Component
 *
 * Warning modal displayed when user enters a positive amount for an expense category.
 * Prompts user to either change the amount to negative or keep it positive.
 *
 * @param {Object} props
 * @param {boolean} props.isOpen - Whether the modal is visible
 * @param {boolean} props.isSubmitting - Whether submission is in progress
 * @param {Function} props.onClose - Callback when close button is clicked
 * @param {Function} props.onConfirmNegative - Callback when "Change to negative" is clicked
 * @param {Function} props.onKeepPositive - Callback when "Keep positive" is clicked
 */
export default function BudgetExpenseSignModal({
  isOpen,
  isSubmitting,
  onClose,
  onConfirmNegative,
  onKeepPositive,
}) {
  if (!isOpen) {
    return null;
  }

  return (
    <div
      className="budget-entries-modal-overlay"
      role="dialog"
      aria-modal="true"
    >
      <div className="budget-entries-modal" role="document">
        <div className="budget-entries-modal__header">
          <h1>Expense Amount Warning</h1>
          <button
            type="button"
            className="budget-entries-modal__close"
            aria-label="Close modal"
            onClick={onClose}
            disabled={isSubmitting}
          >
            Close
          </button>
        </div>
        <div className="budget-entries-modal__content">
          <p>
            Positive amounts for expense categories are usually negative.
            Change this amount to a negative value?
          </p>
          <div className="budget-entries-modal__actions">
            <button
              type="button"
              onClick={onConfirmNegative}
              disabled={isSubmitting}
            >
              Change to negative
            </button>
            <button
              type="button"
              onClick={onKeepPositive}
              disabled={isSubmitting}
            >
              Keep positive
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
