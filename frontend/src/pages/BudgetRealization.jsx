import { useMemo, useState, useEffect } from "react";
import NavigationMenu from "../components/NavigationMenu.jsx";
import BudgetBalancePanel, {
  MONTH_OPTIONS,
  YEAR_OPTIONS,
} from "../features/Budgets/BudgetBalancePanel.jsx";
import Rest from "../js/rest.js";
import "../features/CashFlow/CashFlowReport.css";
import coaData from "../../../components/data/coa.json";
import "./PageLayout.css";

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const formatCurrencyValue = (value) => {
  const amount = Number.isFinite(Number(value)) ? Number(value) : 0;
  const formatted = currencyFormatter.format(Math.abs(amount));
  return amount < 0 ? `(${formatted})` : formatted;
};

const buildLeafActualTotalsMap = (nodes, map = new Map()) => {
  if (!Array.isArray(nodes)) {
    return map;
  }

  for (const node of nodes) {
    if (!node || typeof node !== "object" || !node.name) {
      continue;
    }
    const hasChildren =
      Array.isArray(node.children) && node.children.length > 0;
    if (!hasChildren) {
      const numericValue = Number.isFinite(Number(node.total))
        ? Number(node.total)
        : 0;
      map.set(node.name, numericValue);
      continue;
    }
    buildLeafActualTotalsMap(node.children, map);
  }

  return map;
};

const computePeriodRange = (reportType, selectedMonth, selectedYear) => {
  const yearNumber = Number.parseInt(selectedYear, 10);
  if (!Number.isFinite(yearNumber)) {
    return null;
  }

  const normalizedReportType =
    typeof reportType === "string" ? reportType : "month";
  let startMonth = 1;
  let endMonth = 12;

  if (normalizedReportType === "month") {
    const monthNumber = Number.parseInt(selectedMonth, 10);
    if (!Number.isFinite(monthNumber)) {
      return null;
    }
    startMonth = monthNumber;
    endMonth = monthNumber;
  } else if (normalizedReportType === "ytd") {
    const monthNumber = Number.parseInt(selectedMonth, 10);
    if (!Number.isFinite(monthNumber)) {
      return null;
    }
    startMonth = 1;
    endMonth = Math.min(Math.max(monthNumber, 1), 12);
  } else if (normalizedReportType === "full-year") {
    startMonth = 1;
    endMonth = 12;
  } else {
    const monthNumber = Number.parseInt(selectedMonth, 10);
    if (!Number.isFinite(monthNumber)) {
      return null;
    }
    startMonth = monthNumber;
    endMonth = monthNumber;
  }

  const start = new Date(yearNumber, startMonth - 1, 1);
  const end = new Date(yearNumber, endMonth, 0);
  return { start, end };
};

const formatDateParam = (value) => {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    return null;
  }
  return value.toISOString().split("T")[0];
};

const createActualValueResolver = (leafTotals) => {
  if (!leafTotals || typeof leafTotals.get !== "function") {
    return () => 0;
  }
  const cache = new Map();
  const resolve = (node, pathKey) => {
    if (!node || !pathKey) {
      return 0;
    }
    if (cache.has(pathKey)) {
      return cache.get(pathKey);
    }
    const hasChildren =
      Array.isArray(node.children) && node.children.length > 0;
    const total = hasChildren
      ? node.children.reduce(
          (sum, child) => sum + resolve(child, `${pathKey}>${child.name}`),
          0
        )
      : leafTotals.get(node.name) ?? 0;
    cache.set(pathKey, total);
    return total;
  };
  return resolve;
};

const buildCategoryTree = (items) => {
  if (!Array.isArray(items)) {
    return [];
  }

  return items.flatMap((item) => {
    if (typeof item === "string") {
      const name = item.trim();
      return name ? [{ name }] : [];
    }

    if (item && typeof item === "object") {
      return Object.entries(item)
        .map(([key, value]) => {
          const name = key?.trim();
          if (!name) {
            return null;
          }
          const node = { name };
          if (typeof value === "string") {
            const childName = value?.trim();
            if (childName) {
              node.children = [{ name: childName }];
            }
          } else if (Array.isArray(value)) {
            node.children = buildCategoryTree(value);
          } else if (value && typeof value === "object") {
            node.children = buildCategoryTree([value]);
          }
          return node;
        })
        .filter(Boolean);
    }

    return [];
  });
};

const collectCollapsiblePaths = (nodes, path = [], accumulator = new Set()) => {
  if (!Array.isArray(nodes)) {
    return accumulator;
  }

  for (const node of nodes) {
    if (!node || typeof node !== "object" || !node.name) {
      continue;
    }
    const currentPath = [...path, node.name];
    const pathKey = currentPath.join(">");
    if (Array.isArray(node.children) && node.children.length > 0) {
      accumulator.add(pathKey);
      collectCollapsiblePaths(node.children, currentPath, accumulator);
    }
  }

  return accumulator;
};

const safeNumber = (value) =>
  Number.isFinite(Number(value)) ? Number(value) : 0;

const resolveTopLevelNodeValue = (nodes, name, resolver) => {
  if (!Array.isArray(nodes) || !name || typeof resolver !== "function") {
    return null;
  }
  const node = nodes.find((entry) => entry && entry.name === name);
  if (!node) {
    return null;
  }
  return resolver(node, name);
};

const computeIncomeExpenseTotal = (nodes, resolver) => {
  if (typeof resolver !== "function") {
    return 0;
  }
  const incomeValue = resolveTopLevelNodeValue(nodes, "Income", resolver);
  const expenseValue = resolveTopLevelNodeValue(nodes, "Expense", resolver);
  return safeNumber(incomeValue) + safeNumber(expenseValue);
};

const isExpensePath = (path) => {
  if (!Array.isArray(path) || path.length === 0) {
    return false;
  }
  const topLevel = path[0];
  return (
    typeof topLevel === "string" &&
    topLevel.toLowerCase().includes("expense")
  );
};

const isIncomePath = (path) => {
  if (!Array.isArray(path) || path.length === 0) {
    return false;
  }
  const topLevel = path[0];
  return (
    typeof topLevel === "string" &&
    topLevel.toLowerCase().includes("income")
  );
};

const renderCategoryRows = (
  nodes,
  collapsedPaths,
  handleToggle,
  leafActualTotals,
  getActualValue,
  leafBudgetTotals,
  getBudgetValue,
  level = 0,
  path = []
) => {
  if (!Array.isArray(nodes) || nodes.length === 0) {
    return [];
  }

  return nodes.flatMap((node) => {
    if (!node || typeof node !== "object" || !node.name) {
      return [];
    }
    const currentPath = [...path, node.name];
    const pathKey = currentPath.join(">");
    const hasChildren =
      Array.isArray(node.children) && node.children.length > 0;
    const isCollapsed = collapsedPaths.has(pathKey);

    const hasActualData = leafActualTotals !== null;
    const hasBudgetData = leafBudgetTotals !== null;
    const resolvedActualValue =
      hasActualData && typeof getActualValue === "function"
        ? getActualValue(node, pathKey)
        : 0;
    const resolvedBudgetValue =
      hasBudgetData && typeof getBudgetValue === "function"
        ? getBudgetValue(node, pathKey)
        : 0;
    const actualDisplay = hasActualData
      ? formatCurrencyValue(resolvedActualValue)
      : "—";
    const budgetDisplay = hasBudgetData
      ? formatCurrencyValue(resolvedBudgetValue)
      : "—";
    const hasVarianceData = hasBudgetData || hasActualData;
    const budgetForVariance = hasBudgetData ? resolvedBudgetValue : 0;
    const actualForVariance = hasActualData ? resolvedActualValue : 0;
    const varianceValue =
      isExpensePath(currentPath) || isIncomePath(currentPath)
        ? actualForVariance - budgetForVariance
        : budgetForVariance - actualForVariance;
    const varianceDisplay = hasVarianceData
      ? formatCurrencyValue(varianceValue)
      : "—";

    const row = (
      <tr key={pathKey}>
        <td
          className="balance-report-table__name"
          style={{ "--cashflow-indent-level": level }}
        >
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              handleToggle(pathKey);
            }}
            disabled={!hasChildren}
            className="cash-flow-report__toggle-button"
            aria-label={
              hasChildren
                ? `${isCollapsed ? "Expand" : "Collapse"} ${node.name}`
                : undefined
            }
          >
            {hasChildren ? (isCollapsed ? "+" : "−") : "\u00a0"}
          </button>
          <span className="balance-report-table__name-text">{node.name}</span>
        </td>
        <td className="balance-report-table__value">{budgetDisplay}</td>
        <td className="balance-report-table__value">{actualDisplay}</td>
        <td className="balance-report-table__value">{varianceDisplay}</td>
      </tr>
    );

    const childrenRows =
      hasChildren && !isCollapsed
        ? renderCategoryRows(
            node.children,
            collapsedPaths,
            handleToggle,
            leafActualTotals,
            getActualValue,
            leafBudgetTotals,
            getBudgetValue,
            level + 1,
            currentPath
          )
        : [];

    return hasChildren ? [row, ...childrenRows] : [row];
  });
};

const filterCategoryTree = (nodes, { includeUnrealized, includeTransfers }) => {
  if (!Array.isArray(nodes) || nodes.length === 0) {
    return [];
  }

  return nodes
    .map((node) => {
      if (!node || typeof node !== "object" || !node.name) {
        return null;
      }
      if (!includeUnrealized && node.name === "Unrealized G/L") {
        return null;
      }
      if (!includeTransfers && node.name === "Transfers") {
        return null;
      }
      const filteredChildren = filterCategoryTree(node.children, {
        includeUnrealized,
        includeTransfers,
      });
      const nextNode = { ...node };
      if (filteredChildren.length > 0) {
        nextNode.children = filteredChildren;
      } else {
        delete nextNode.children;
      }
      return nextNode;
    })
    .filter(Boolean);
};

export default function BudgetRealization() {
  const [reportType, setReportType] = useState("month");
  const [selectedMonth, setSelectedMonth] = useState(
    MONTH_OPTIONS[new Date().getMonth()].value
  );
  const [selectedYear, setSelectedYear] = useState(YEAR_OPTIONS[3]);
  const [leafActualTotals, setLeafActualTotals] = useState(null);
  const [leafBudgetTotals, setLeafBudgetTotals] = useState(null);
  const [includeUnrealized, setIncludeUnrealized] = useState(false);
  const [includeTransfers, setIncludeTransfers] = useState(false);
  const periodRange = useMemo(
    () => computePeriodRange(reportType, selectedMonth, selectedYear),
    [reportType, selectedMonth, selectedYear]
  );
  const actualValueResolver = useMemo(
    () =>
      leafActualTotals ? createActualValueResolver(leafActualTotals) : null,
    [leafActualTotals]
  );
  const budgetValueResolver = useMemo(
    () =>
      leafBudgetTotals ? createActualValueResolver(leafBudgetTotals) : null,
    [leafBudgetTotals]
  );

  const categoryTree = useMemo(() => {
    const profitLossSection = coaData.find(
      (entry) =>
        entry &&
        typeof entry === "object" &&
        Object.prototype.hasOwnProperty.call(entry, "Profit & Loss Accounts")
    );
    const profitLossNodes = profitLossSection
      ? profitLossSection["Profit & Loss Accounts"]
      : [];
    return buildCategoryTree(profitLossNodes);
  }, []);
  const filteredCategoryTree = useMemo(
    () =>
      filterCategoryTree(categoryTree, {
        includeUnrealized,
        includeTransfers,
      }),
    [categoryTree, includeUnrealized, includeTransfers]
  );
  const hasActualData = leafActualTotals !== null;
  const hasBudgetData = leafBudgetTotals !== null;
  const netActualValue =
    hasActualData && actualValueResolver
      ? computeIncomeExpenseTotal(filteredCategoryTree, actualValueResolver)
      : null;
  const netBudgetValue =
    hasBudgetData && budgetValueResolver
      ? computeIncomeExpenseTotal(filteredCategoryTree, budgetValueResolver)
      : null;
  const showNetRow = hasActualData || hasBudgetData;
  const netBudgetDisplay = hasBudgetData
    ? formatCurrencyValue(netBudgetValue)
    : "—";
  const netActualDisplay = hasActualData
    ? formatCurrencyValue(netActualValue)
    : "—";
  const showNetVariance = hasBudgetData || hasActualData;
  const netVarianceValue =
    (hasActualData ? netActualValue : 0) - (hasBudgetData ? netBudgetValue : 0);
  const netVarianceDisplay = showNetVariance
    ? formatCurrencyValue(netVarianceValue)
    : "—";
  const collapsiblePaths = useMemo(
    () => collectCollapsiblePaths(filteredCategoryTree),
    [filteredCategoryTree]
  );
  const [collapsedPaths, setCollapsedPaths] = useState(
    () => new Set(collapsiblePaths)
  );

  useEffect(() => {
    setCollapsedPaths(new Set(collapsiblePaths));
  }, [collapsiblePaths]);

  useEffect(() => {
    if (!periodRange) {
      setLeafActualTotals(null);
      setLeafBudgetTotals(null);
      return;
    }

    const fromDateParam = formatDateParam(periodRange.start);
    const toDateParam = formatDateParam(periodRange.end);
    if (!fromDateParam || !toDateParam) {
      setLeafActualTotals(null);
      setLeafBudgetTotals(null);
      return;
    }

    let isActive = true;
    setLeafActualTotals(null);
    setLeafBudgetTotals(null);
    const transfersMode = includeTransfers ? "include" : "exclude";

    const fetchActuals = async () => {
      try {
        const report = await Rest.fetchCashFlowReport({
          fromDate: fromDateParam,
          toDate: toDateParam,
          transfers: transfersMode,
          includeUnrealizedGL: includeUnrealized,
        });
        const nodes = Array.isArray(report) ? report : [];
        const totalsMap = buildLeafActualTotalsMap(nodes);
        if (!isActive) {
          return;
        }
        setLeafActualTotals(totalsMap);
      } catch (error) {
        if (!isActive) {
          return;
        }
        console.error("[BudgetRealization] Failed to load actuals:", error);
        setLeafActualTotals(null);
      }
    };

    const fetchBudgets = async () => {
      try {
        const report = await Rest.fetchBudgetCashFlowReport({
          fromDate: fromDateParam,
          toDate: toDateParam,
          transfers: transfersMode,
          includeUnrealizedGL: includeUnrealized,
        });
        const nodes = Array.isArray(report) ? report : [];
        const totalsMap = buildLeafActualTotalsMap(nodes);
        if (!isActive) {
          return;
        }
        setLeafBudgetTotals(totalsMap);
      } catch (error) {
        if (!isActive) {
          return;
        }
        console.error(
          "[BudgetRealization] Failed to load budget totals:",
          error
        );
        setLeafBudgetTotals(null);
      }
    };

    fetchActuals();
    fetchBudgets();

    return () => {
      isActive = false;
    };
  }, [periodRange, includeTransfers, includeUnrealized]);

  const handleTogglePath = (pathKey) => {
    setCollapsedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(pathKey)) {
        next.delete(pathKey);
      } else {
        next.add(pathKey);
      }
      return next;
    });
  };
  const handleCollapseAll = () => {
    setCollapsedPaths(new Set(collapsiblePaths));
  };
  const handleExpandAll = () => {
    setCollapsedPaths(new Set());
  };
  const isFullyCollapsed =
    collapsiblePaths.size > 0 && collapsedPaths.size === collapsiblePaths.size;
  const handleToggleCollapseAll = () => {
    if (isFullyCollapsed) {
      handleExpandAll();
    } else {
      handleCollapseAll();
    }
  };

  return (
    <div className="budget-realization-shell">
      <NavigationMenu />
      <main className="budget-realization-main">
        <div className="budget-realization-content">
          <div className="budget-realization-scroll">
            <section className="budget-realization-placeholder">
              <h1 className="page__title">Budget realization</h1>
            </section>
            <section className="budget-realization-table">
              <div className="budget-realization-table__header"></div>
              <div className="budget-realization-table__wrapper">
                <div className="cash-flow-report">
                  <table className="balance-report-table">
                    <thead className="balance-report-table__head">
                      <tr>
                        <th
                          className="balance-report-table__category"
                          scope="col"
                        >
                          Category
                        </th>
                        <th scope="col">Budgeted</th>
                        <th scope="col">Actuals</th>
                        <th scope="col">Variance</th>
                      </tr>
                    </thead>
                      <tbody>
                        {renderCategoryRows(
                          filteredCategoryTree,
                          collapsedPaths,
                          handleTogglePath,
                          leafActualTotals,
                          actualValueResolver,
                          leafBudgetTotals,
                          budgetValueResolver
                        )}
                        {showNetRow && (
                          <tr>
                            <td className="balance-report-table__name">
                              <span className="balance-report-table__name-text">
                                Net cash flow
                              </span>
                            </td>
                            <td className="balance-report-table__value">
                              {netBudgetDisplay}
                            </td>
                            <td className="balance-report-table__value">
                              {netActualDisplay}
                            </td>
                            <td className="balance-report-table__value">
                              {netVarianceDisplay}
                            </td>
                          </tr>
                        )}
                      </tbody>
                  </table>
                </div>
              </div>
              <p className="budget-realization-table__note">
                Budget and Variance are placeholders; Actuals now respect the
                selected period and filters.
              </p>
            </section>
          </div>
        </div>
        <div className="budget-realization-sidebar">
          <BudgetBalancePanel
            includeUnrealized={includeUnrealized}
            onIncludeUnrealizedChange={setIncludeUnrealized}
            includeTransfers={includeTransfers}
            onIncludeTransfersChange={setIncludeTransfers}
            reportType={reportType}
            onReportTypeChange={setReportType}
            year={selectedYear}
            onYearChange={setSelectedYear}
            month={selectedMonth}
            onMonthChange={setSelectedMonth}
            isFullyCollapsed={isFullyCollapsed}
            onToggleCollapseAll={handleToggleCollapseAll}
            hasCollapsiblePaths={collapsiblePaths.size > 0}
          />
        </div>
      </main>
    </div>
  );
}
