import * as XLSX from "xlsx";

/**
 * Flatten a hierarchical tree into rows with indentation depth.
 * @param {Array} nodes - Tree nodes with { name, children[], ... }
 * @param {Function} getValues - (node, pathKey) => array of numeric values for columns
 * @param {string[]} path - Current path (for recursion)
 * @param {number} depth - Current depth (for recursion)
 * @returns {Array<{name: string, depth: number, values: number[]}>}
 */
const flattenTree = (nodes, getValues, path = [], depth = 0) => {
  if (!Array.isArray(nodes)) return [];
  return nodes.flatMap((node) => {
    if (!node || !node.name) return [];
    const pathKey = [...path, node.name].join(">");
    const values = getValues(node, pathKey);
    const hasChildren = Array.isArray(node.children) && node.children.length > 0;
    const children = hasChildren
      ? flattenTree(node.children, getValues, [...path, node.name], depth + 1)
      : [];
    return [{ name: node.name, depth, values }, ...children];
  });
};

/**
 * Creates a worksheet from flattened rows with headers.
 * Bold for depth-0 rows, indentation via leading spaces.
 */
const buildSheet = (headers, rows) => {
  const data = [headers];
  for (const row of rows) {
    const indent = "  ".repeat(row.depth);
    data.push([`${indent}${row.name}`, ...row.values]);
  }
  const ws = XLSX.utils.aoa_to_sheet(data);

  // Set column widths
  const colWidths = headers.map((h, i) =>
    i === 0 ? { wch: 40 } : { wch: 16 }
  );
  ws["!cols"] = colWidths;

  return ws;
};

/**
 * Triggers download of a workbook as .xlsx
 */
const downloadWorkbook = (wb, filename) => {
  const buffer = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
};

const formatNum = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
};

// ============================================================================
// BALANCE SHEET EXPORT
// ============================================================================

/**
 * Export balance sheet report(s) to Excel.
 * @param {Array[]} balanceReports - Array of report arrays (one per period)
 * @param {string[]} periodDates - Period date labels
 */
export const exportBalanceSheet = (balanceReports, periodDates) => {
  if (!Array.isArray(balanceReports) || balanceReports.length === 0) return;

  const activeReports = balanceReports;
  const valueMaps = activeReports.map((report) => buildValueMap(report, "totalUSD"));
  const baseReport = activeReports[0];

  const headers = ["Account", ...periodDates.slice(0, activeReports.length)];
  const rows = flattenTree(baseReport, (_node, pathKey) =>
    valueMaps.map((map) => formatNum(map.get(pathKey) ?? 0))
  );

  // Add Net Worth row
  const netWorths = activeReports.map((report) => {
    if (!Array.isArray(report)) return 0;
    return report.reduce((sum, acct) => {
      const name = (acct.name ?? "").toLowerCase();
      if (name === "assets" || name === "liabilities") {
        return sum + (acct.totalUSD ?? 0);
      }
      return sum;
    }, 0);
  });
  rows.push({ name: "Net Worth", depth: 0, values: netWorths.map(formatNum) });

  const wb = XLSX.utils.book_new();
  const ws = buildSheet(headers, rows);
  XLSX.utils.book_append_sheet(wb, ws, "Balance Sheet");
  downloadWorkbook(wb, `balance-sheet-${Date.now()}.xlsx`);
};

// ============================================================================
// CASH FLOW EXPORT
// ============================================================================

/**
 * Export cash flow report(s) to Excel.
 * @param {Array[]} reports - Array of report arrays (one per period)
 * @param {string[]} periodLabels - Period labels
 */
export const exportCashFlow = (reports, periodLabels) => {
  if (!Array.isArray(reports) || reports.length === 0) return;

  const valueMaps = reports.map((report) => buildValueMap(report, "total"));
  const baseReport = reports[0];

  const headers = ["Category", ...periodLabels.slice(0, reports.length)];
  const rows = flattenTree(baseReport, (_node, pathKey) =>
    valueMaps.map((map) => formatNum(map.get(pathKey) ?? 0))
  );

  const wb = XLSX.utils.book_new();
  const ws = buildSheet(headers, rows);
  XLSX.utils.book_append_sheet(wb, ws, "Cash Flow");
  downloadWorkbook(wb, `cash-flow-${Date.now()}.xlsx`);
};

// ============================================================================
// BUDGET REALIZATION EXPORT
// ============================================================================

/**
 * Export budget vs actual report to Excel.
 * @param {Array} categoryTree - Filtered category tree
 * @param {Function} getActualValue - Resolver for actual values
 * @param {Function} getBudgetValue - Resolver for budget values
 * @param {boolean} hasActualData
 * @param {boolean} hasBudgetData
 */
export const exportBudgetRealization = (
  categoryTree,
  getActualValue,
  getBudgetValue,
  hasActualData,
  hasBudgetData
) => {
  if (!Array.isArray(categoryTree) || categoryTree.length === 0) return;

  const headers = ["Category", "Budget", "Actual", "Variance"];

  const isExpensePath = (path) => {
    const top = path[0]?.toLowerCase?.() ?? "";
    return top.includes("expense");
  };
  const isIncomePath = (path) => {
    const top = path[0]?.toLowerCase?.() ?? "";
    return top.includes("income");
  };

  const flattenBudgetTree = (nodes, path = [], depth = 0) => {
    if (!Array.isArray(nodes)) return [];
    return nodes.flatMap((node) => {
      if (!node || !node.name) return [];
      const currentPath = [...path, node.name];
      const pathKey = currentPath.join(">");
      const budget = hasBudgetData && getBudgetValue ? getBudgetValue(node, pathKey) : 0;
      const actual = hasActualData && getActualValue ? getActualValue(node, pathKey) : 0;
      if (hasActualData && hasBudgetData && actual === 0 && budget === 0) return [];
      const variance =
        isExpensePath(currentPath) || isIncomePath(currentPath)
          ? actual - budget
          : budget - actual;
      const hasChildren = Array.isArray(node.children) && node.children.length > 0;
      const children = hasChildren
        ? flattenBudgetTree(node.children, currentPath, depth + 1)
        : [];
      return [
        { name: node.name, depth, values: [formatNum(budget), formatNum(actual), formatNum(variance)] },
        ...children,
      ];
    });
  };

  const rows = flattenBudgetTree(categoryTree);
  const wb = XLSX.utils.book_new();
  const ws = buildSheet(headers, rows);
  XLSX.utils.book_append_sheet(wb, ws, "Budget vs Actual");
  downloadWorkbook(wb, `budget-realization-${Date.now()}.xlsx`);
};

// ============================================================================
// TRANSACTIONS EXPORT
// ============================================================================

/**
 * Export transaction list to Excel.
 * @param {Array} transactions - Array of transaction objects
 * @param {string} sheetName - Sheet name
 * @param {string} filePrefix - File name prefix
 */
export const exportTransactions = (
  transactions,
  sheetName = "Transactions",
  filePrefix = "transactions"
) => {
  if (!Array.isArray(transactions) || transactions.length === 0) return;

  const headers = [
    "Date",
    "Description",
    "Amount",
    "Currency",
    "Base Amount (USD)",
    "Account",
    "Category",
  ];

  const data = [headers];
  for (const tx of transactions) {
    data.push([
      tx.Date ?? tx.transaction_date ?? "",
      tx.Description1 ?? tx.description1 ?? "",
      formatNum(tx.Amount ?? tx.amount),
      tx.Currency ?? tx.currency ?? "",
      formatNum(tx.BaseAmount ?? tx.base_amount ?? tx.Amount ?? tx.amount),
      tx.Account ?? tx.account_name ?? "",
      tx.Category ?? tx.category_name ?? "",
    ]);
  }

  const ws = XLSX.utils.aoa_to_sheet(data);
  ws["!cols"] = [
    { wch: 12 },
    { wch: 30 },
    { wch: 14 },
    { wch: 8 },
    { wch: 14 },
    { wch: 20 },
    { wch: 20 },
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  downloadWorkbook(wb, `${filePrefix}-${Date.now()}.xlsx`);
};

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Builds a map of node paths to their values (recursive).
 * @param {Array} nodes - Tree nodes
 * @param {string} valueKey - Key for the value field (e.g., "totalUSD" or "total")
 * @param {string[]} path - Current path
 * @param {Map} map - Accumulator
 * @returns {Map}
 */
const buildValueMap = (nodes, valueKey, path = [], map = new Map()) => {
  if (!Array.isArray(nodes)) return map;
  for (const node of nodes) {
    if (!node || typeof node !== "object") continue;
    const key = [...path, node.name].join(">");
    map.set(key, node[valueKey] ?? 0);
    if (Array.isArray(node.children) && node.children.length > 0) {
      buildValueMap(node.children, valueKey, [...path, node.name], map);
    }
  }
  return map;
};
