import { useEffect, useMemo, useRef, useState } from "react";
import "./TransactionModal.css";

const TRANSACTION_COLUMNS = [
  { key: "date", label: "Date" },
  { key: "description", label: "Description" },
  { key: "category", label: "Category" },
  { key: "account", label: "Account" },
  { key: "amount", label: "Amount" },
];

const getTransactionSortValue = (txn, column) => {
  if (!txn) {
    return "";
  }
  switch (column) {
    case "date": {
      const value = txn?.Date ? new Date(txn.Date) : null;
      return value && !Number.isNaN(value.getTime()) ? value.getTime() : 0;
    }
    case "amount": {
      if (typeof txn?.BaseAmount === "number") {
        return txn.BaseAmount;
      }
      if (typeof txn?.Amount === "number") {
        return txn.Amount;
      }
      return 0;
    }
    case "description":
      return (
        txn?.Description1 || txn?.Description2 || txn?.Memo || txn?.Note || ""
      );
    case "category":
      return txn?.Category || "";
    case "account":
      return txn?.Account || "";
    default:
      return "";
  }
};

const formatDate = (value) => {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().split("T")[0];
};

export default function TransactionModal({
  onClose,
  transactionModal,
  formatCurrency,
}) {
  const [modalOffset, setModalOffset] = useState({ x: 0, y: 0 });
  const modalDragCleanup = useRef(() => {});

  useEffect(() => {
    return () => {
      modalDragCleanup.current();
    };
  }, []);

  const [modalSort, setModalSort] = useState({
    column: "date",
    direction: "desc",
  });

  const startDragging = (event) => {
    if (event.button && event.button !== 0) {
      return;
    }
    if (event.target instanceof HTMLElement) {
      const buttonAncestor = event.target.closest("button");
      if (buttonAncestor) {
        return;
      }
    }
    event.preventDefault();
    modalDragCleanup.current();

    const dragState = {
      startX: event.clientX,
      startY: event.clientY,
      initialX: modalOffset.x,
      initialY: modalOffset.y,
    };

    const handleMove = (moveEvent) => {
      const deltaX = moveEvent.clientX - dragState.startX;
      const deltaY = moveEvent.clientY - dragState.startY;
      setModalOffset({
        x: dragState.initialX + deltaX,
        y: dragState.initialY + deltaY,
      });
    };

    let cleanup = () => {};
    const handleUp = () => {
      cleanup();
    };

    cleanup = () => {
      document.body.style.cursor = "";
      document.removeEventListener("pointermove", handleMove);
      document.removeEventListener("pointerup", handleUp);
      modalDragCleanup.current = () => {};
    };

    modalDragCleanup.current = cleanup;

    document.body.style.cursor = "grabbing";
    document.addEventListener("pointermove", handleMove);
    document.addEventListener("pointerup", handleUp);
  };

  const transactions = Array.isArray(transactionModal?.transactions)
    ? transactionModal.transactions
    : [];

  const sortedTransactions = useMemo(() => {
    const items = [...transactions];
    if (!modalSort.column) {
      return items;
    }
    const direction = modalSort.direction === "asc" ? 1 : -1;
    items.sort((a, b) => {
      const valueA = getTransactionSortValue(a, modalSort.column);
      const valueB = getTransactionSortValue(b, modalSort.column);
      if (valueA === valueB) {
        return 0;
      }
      if (typeof valueA === "number" && typeof valueB === "number") {
        return (valueA - valueB) * direction;
      }
      const strA =
        valueA !== null && valueA !== undefined ? String(valueA) : "";
      const strB =
        valueB !== null && valueB !== undefined ? String(valueB) : "";
      return (
        strA.localeCompare(strB, undefined, { sensitivity: "base" }) * direction
      );
    });
    return items;
  }, [modalSort.column, modalSort.direction, transactions]);

  const handleModalSortChange = (column) => {
    setModalSort((prev) => {
      if (prev.column === column) {
        return {
          column,
          direction: prev.direction === "asc" ? "desc" : "asc",
        };
      }
      return {
        column,
        direction: "desc",
      };
    });
  };

  const getSortIndicator = (column) => {
    if (modalSort.column !== column) {
      return "";
    }
    return modalSort.direction === "asc" ? "↑" : "↓";
  };

  return (
    <div className="transaction-modal__overlay">
      <div
        className="transaction-modal"
        style={{
          transform: `translate(${modalOffset.x}px, ${modalOffset.y}px)`,
        }}
        onClick={(event) => {
          event.stopPropagation();
        }}
      >
        <div
          className="transaction-modal__header"
          onPointerDown={startDragging}
        >
          <h3 className="transaction-modal__title">
            {transactionModal?.title || "Transactions"}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="transaction-modal__close-button"
          >
            Close
          </button>
        </div>
        <div className="transaction-modal__table-wrapper">
          {transactionModal?.isLoading ? (
            <p>Loading transactions...</p>
          ) : transactionModal?.error ? (
            <p className="transaction-modal__error-message">
              {transactionModal.error}
            </p>
          ) : transactions.length === 0 ? (
            <p>No transactions found for this period.</p>
          ) : (
            <table className="balance-report-table transaction-modal__table">
              <thead>
                <tr>
                  {TRANSACTION_COLUMNS.map((column) => (
                    <th
                      key={`modal-col-${column.key}`}
                      className="transaction-modal__header-cell"
                    >
                      <button
                        type="button"
                        onClick={() => handleModalSortChange(column.key)}
                        className="transaction-modal__header-button"
                      >
                        <span>{column.label}</span>
                        <span aria-hidden="true">
                          {getSortIndicator(column.key)}
                        </span>
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedTransactions.map((txn, index) => {
                  const description =
                    txn?.Description1 ||
                    txn?.Description2 ||
                    txn?.Memo ||
                    txn?.Note ||
                    "";
                  const amount =
                    typeof txn?.BaseAmount === "number"
                      ? txn.BaseAmount
                      : typeof txn?.Amount === "number"
                      ? txn.Amount
                      : 0;
                  const rowKey = txn?._id || txn?.ID || index;
                  return (
                    <tr key={rowKey}>
                      <td>{formatDate(txn?.Date)}</td>
                      <td className="transaction-modal__description-cell">
                        {description || "(No description)"}
                      </td>
                      <td>{txn?.Category || "-"}</td>
                      <td>{txn?.Account || "-"}</td>
                      <td
                        className={`balance-report-table__value ${
                          amount < 0
                            ? "balance-report-table__value--negative"
                            : ""
                        }`}
                      >
                        {formatCurrency(amount)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
