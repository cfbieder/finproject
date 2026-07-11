import { useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import Rest from "../js/rest.js";

// Stable empty references so derived useMemos don't churn while data is loading.
const EMPTY_OBJ = {};
const EMPTY_ARR = [];

/**
 * Fetch + normalize the chart of accounts (traits + P&L/BS trees) in one shot.
 * Shared as a single TanStack Query so every useCoa consumer reuses one fetch.
 */
async function fetchCoa() {
  const [traitsData, plData, bsData] = await Promise.all([
    Rest.fetchAccountTraitsV2(),
    Rest.fetchAccountTreeV2({ section: "profit_loss" }),
    Rest.fetchAccountTreeV2({ section: "balance_sheet" }),
  ]);

  // Extract children of the section root so the tree starts at Income/Expense
  // (P&L) or Assets/Liabilities (BS).
  const plRoot = plData.find((n) => n.name === "Profit & Loss Accounts");
  const bsRoot = bsData.find((n) => n.name === "Balance Sheet Accounts");

  return {
    traits: traitsData || {},
    plTree: plRoot?.children ?? plData,
    bsTree: bsRoot?.children ?? bsData,
  };
}

/**
 * Recursive helper: find a node by name in a { name, children } tree.
 */
const findNode = (nodes, targetName) => {
  for (const node of nodes) {
    if (node.name === targetName) return node;
    if (node.children?.length) {
      const found = findNode(node.children, targetName);
      if (found) return found;
    }
  }
  return null;
};

/**
 * Recursive helper: collect all leaf node names (nodes with no children).
 */
const collectLeafNames = (nodes, results = []) => {
  for (const node of nodes) {
    if (node.children?.length) {
      collectLeafNames(node.children, results);
    } else if (node.name?.trim()) {
      results.push(node.name.trim());
    }
  }
  return results;
};

/**
 * Central hook for Chart of Accounts data from PostgreSQL.
 *
 * Replaces direct JSON imports of coa.json and coa_traits.json with
 * async API calls to the v2 accounts endpoints.
 */
export function useCoa() {
  const { data, isPending, error: queryError } = useQuery({
    queryKey: ["coa"],
    queryFn: fetchCoa,
  });

  const traits = data?.traits ?? EMPTY_OBJ;
  const plTree = data?.plTree ?? EMPTY_ARR;
  const bsTree = data?.bsTree ?? EMPTY_ARR;
  const loading = isPending;
  const error = queryError ? queryError.message || "Failed to load COA data" : "";

  // ---------------------------------------------------------------------------
  // Derived: Set of expense account names (for sign normalization)
  // ---------------------------------------------------------------------------
  const expenseAccountNames = useMemo(() => {
    const expenseNode = findNode(plTree, "Expense");
    if (!expenseNode?.children?.length) return new Set();
    return new Set(collectLeafNames(expenseNode.children));
  }, [plTree]);

  // ---------------------------------------------------------------------------
  // Derived: account name → currency map
  // ---------------------------------------------------------------------------
  const accountCurrencyMap = useMemo(() => {
    const map = new Map();
    for (const [name, t] of Object.entries(traits)) {
      const c = t?.Currency?.trim();
      if (name && c && c !== "N/A" && c !== "\u2014" && c !== "--") {
        map.set(name.trim(), c);
      }
    }
    return map;
  }, [traits]);

  // ---------------------------------------------------------------------------
  // Derived: BS level-2 account names (children of Assets/Liabilities),
  //          excluding "Bank Accounts"
  // ---------------------------------------------------------------------------
  const bsLevel2Options = useMemo(() => {
    const results = [];
    for (const topGroup of bsTree) {
      if (topGroup.children) {
        for (const child of topGroup.children) {
          if (child.name && child.name !== "Bank Accounts") {
            results.push(child.name);
          }
        }
      }
    }
    return results;
  }, [bsTree]);

  // ---------------------------------------------------------------------------
  // Derived: get children of a named BS level-2 account
  // ---------------------------------------------------------------------------
  const getChildCategoriesForAccount = useCallback(
    (accountName) => {
      if (!accountName) return [];
      for (const topGroup of bsTree) {
        if (!topGroup.children) continue;
        for (const child of topGroup.children) {
          if (child.name === accountName && child.children) {
            return child.children.map((c) => c.name).filter(Boolean);
          }
        }
      }
      return [];
    },
    [bsTree]
  );

  // ---------------------------------------------------------------------------
  // Derived: expense category options
  // (leaf names from Financial Expenses + Property-Other + Tax Reserve)
  // ---------------------------------------------------------------------------
  const expenseCategoryOptions = useMemo(() => {
    const expenseNode = findNode(plTree, "Expense");
    if (!expenseNode?.children) return [];

    const results = [];

    const finExp = findNode(expenseNode.children, "Financial Expenses");
    if (finExp?.children) collectLeafNames(finExp.children, results);

    const propOther = findNode(expenseNode.children, "Property - Other");
    if (propOther?.children) {
      collectLeafNames(propOther.children, results);
    } else if (propOther) {
      results.push(propOther.name);
    }

    if (!results.includes("Tax Reserve")) {
      results.push("Tax Reserve");
    }

    return [...new Set(results)].sort();
  }, [plTree]);

  // ---------------------------------------------------------------------------
  // Derived: income category options (leaf names from Financial Income)
  // ---------------------------------------------------------------------------
  const incomeCategoryOptions = useMemo(() => {
    const incomeNode = findNode(plTree, "Income");
    if (!incomeNode?.children) return [];

    const finInc = findNode(incomeNode.children, "Financial Income");
    if (!finInc?.children) return [];

    return [...new Set(collectLeafNames(finInc.children))].sort();
  }, [plTree]);

  // ---------------------------------------------------------------------------
  // Derived: currency options
  // ---------------------------------------------------------------------------
  const currencyOptions = useMemo(() => {
    const values = new Set();
    for (const t of Object.values(traits)) {
      if (t?.Currency) values.add(t.Currency);
    }
    if (!values.has("USD")) values.add("USD");
    return Array.from(values).sort();
  }, [traits]);

  // ---------------------------------------------------------------------------
  // Derived: default trait values (first sorted Type/Currency)
  // ---------------------------------------------------------------------------
  const traitDefaults = useMemo(() => {
    const types = new Set();
    const currencies = new Set();
    for (const t of Object.values(traits)) {
      if (!t || typeof t !== "object") continue;
      if (t.Type) types.add(t.Type);
      if (t.Currency) currencies.add(t.Currency);
    }
    const sortedTypes = Array.from(types).sort();
    const sortedCurrencies = Array.from(currencies).sort();
    return {
      Type: sortedTypes[0] || "",
      Currency: sortedCurrencies[0] || "",
    };
  }, [traits]);

  return {
    // Raw data
    traits,
    plTree,
    bsTree,
    // Derived
    expenseAccountNames,
    accountCurrencyMap,
    bsLevel2Options,
    getChildCategoriesForAccount,
    expenseCategoryOptions,
    incomeCategoryOptions,
    currencyOptions,
    traitDefaults,
    // State
    loading,
    error,
  };
}
