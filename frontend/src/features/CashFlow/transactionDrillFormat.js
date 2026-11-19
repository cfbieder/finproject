/** Row formatting for the cash-flow drill-down in the Workbench inspector (CR105 S4). */

// Per-currency formatter cache — the drill-down can mix currencies in original
// mode, so each row formats in its own currency (a null code ⇒ plain decimal).
const rowFormatterCache = new Map();
export const formatRowAmount = (currencyCode, value) => {
  const key = currencyCode || "__plain__";
  let nf = rowFormatterCache.get(key);
  if (!nf) {
    nf = currencyCode
      ? new Intl.NumberFormat("en-US", {
          style: "currency",
          currency: currencyCode,
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })
      : new Intl.NumberFormat("en-US", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        });
    rowFormatterCache.set(key, nf);
  }
  const amount = value ?? 0;
  return amount < 0 ? `(${nf.format(Math.abs(amount))})` : nf.format(amount);
};

// In original-currency mode the report sums native amounts, so the drill-down
// shows the native Amount; otherwise the USD BaseAmount.
export const rowAmount = (txn, preferNative) => {
  if (preferNative) {
    return typeof txn?.Amount === "number" ? txn.Amount : 0;
  }
  if (typeof txn?.BaseAmount === "number") return txn.BaseAmount;
  if (typeof txn?.Amount === "number") return txn.Amount;
  return 0;
};

export const getTransactionSortValue = (txn, column, preferNative) => {
  if (!txn) {
    return "";
  }
  switch (column) {
    case "date": {
      const value = txn?.Date ? new Date(txn.Date) : null;
      return value && !Number.isNaN(value.getTime()) ? value.getTime() : 0;
    }
    case "amount":
      return rowAmount(txn, preferNative);
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


/** The text a row is known by. */
export const rowDescription = (txn) =>
  txn?.Description1 || txn?.Description2 || txn?.Memo || txn?.Note || "";
