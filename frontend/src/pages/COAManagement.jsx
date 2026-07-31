import { useCallback, useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import COAManagementToolbar from "../features/COAManagement/COAManagementToolbar.jsx";
import COAEditModal from "../features/COAManagement/COAEditModal.jsx";
import COAMoveModal from "../features/COAManagement/COAMoveModal.jsx";
import COATreeTable from "../features/COAManagement/COATreeTable.jsx";
import { reorderPlan } from "../features/COAManagement/coaReorder.js";
import FCExpConfirmDeleteModal from "../features/Forecast/FCExpConfirmDeleteModal.jsx";
import { useToast } from "../contexts";
import Rest from "../js/rest.js";
import "../features/BudgetEntry/BudgetOptionExchangeRates.css";
import "./PageLayout.css";
import "./COAManagement.css";

/**
 * Flatten the COA tree into rows.
 * coaData is: [{ "Balance Sheet Accounts": [{name, children}, ...] }, ...]
 * Nodes with non-empty children are categories; leaf nodes are accounts.
 */
const collectCoaRows = (coaData, path = [], rows = []) => {
  if (Array.isArray(coaData)) {
    coaData.forEach((item) => collectCoaRows(item, path, rows));
    return rows;
  }

  if (coaData && typeof coaData === "object") {
    // {name, children} node from PostgreSQL tree
    if ("name" in coaData && "children" in coaData) {
      const hasChildren =
        Array.isArray(coaData.children) && coaData.children.length > 0;
      // CR063: `accountId` is the real accounts.id (the tree now carries it), used
      // for reordering. It is deliberately NOT the row key — that stays the
      // synthetic path|name id, which selection and the modals already depend on.
      rows.push({
        accountId: coaData.id ?? null,
        name: coaData.name,
        path,
        isCategory: hasChildren,
      });
      if (hasChildren) {
        const childPath = [...path, coaData.name];
        coaData.children.forEach((child) =>
          collectCoaRows(child, childPath, rows)
        );
      }
      return rows;
    }

    // {children: [...]} node missing its name — skip the key, recurse children
    if (!("name" in coaData) && "children" in coaData) {
      if (Array.isArray(coaData.children)) {
        coaData.children.forEach((child) => collectCoaRows(child, path, rows));
      }
      return rows;
    }

    // Top-level section wrapper: { "Balance Sheet Accounts": [...] }
    Object.entries(coaData).forEach(([key, value]) => {
      // Synthesized client-side by fetchCoaSections — the API strips the section
      // root — so it has no id. Reorder therefore addresses this parent by NAME.
      rows.push({ accountId: null, name: key, path, isCategory: true });
      collectCoaRows(value, [...path, key], rows);
    });
    return rows;
  }

  if (typeof coaData === "string") {
    rows.push({ accountId: null, name: coaData, path, isCategory: false });
  }

  return rows;
};

const buildCoaRows = (coaData = [], traitsMap = {}, fedNames = null) => {
  const rows = collectCoaRows(coaData);
  const seenIds = new Map();
  return rows.map(({ accountId, name, path, isCategory }) => {
    const traits = isCategory ? {} : traitsMap?.[name] || {};
    const type = isCategory ? "Category" : traits.Type || "Unspecified";
    const currency = isCategory ? "\u2014" : traits.Currency || "Unspecified";
    // The tree shows a container's Type as "Category" and Currency as "\u2014", but the
    // real account_type/currency (which the backend inherits verbatim when adding a
    // child \u2014 see server util/coa.js) live in the traits map for every account,
    // containers included. Keep them so the Add-child modal can lock Type to the
    // parent and default the child's currency.
    const parentTraits = traitsMap?.[name] || {};
    const accountType = parentTraits.Type || null;
    const accountCurrency =
      parentTraits.Currency && parentTraits.Currency !== "N/A"
        ? parentTraits.Currency
        : null;
    const baseId = `${path.join("|")}-${name}`;
    const count = seenIds.get(baseId) || 0;
    seenIds.set(baseId, count + 1);
    const id = count > 0 ? `${baseId}#${count}` : baseId;
    return {
      id,
      accountId,
      name,
      path,
      depth: path.length,
      pathLabel: path.length ? path.join(" \u203A ") : "Root",
      type,
      currency,
      accountType,
      accountCurrency,
      accountNumber: traits.AccountNumber || "",
      isCategory,
      fed: !isCategory && fedNames instanceof Set && fedNames.has(name),
    };
  });
};

export default function COAManagement() {
  const { showSuccess, showError: showErrorToast } = useToast();
  const queryClient = useQueryClient();
  const [typeFilter, setTypeFilter] = useState("all");
  const [currencyFilter, setCurrencyFilter] = useState("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [coaRows, setCoaRows] = useState(() => buildCoaRows());
  const [coaSections, setCoaSections] = useState([]);
  const [editModal, setEditModal] = useState({
    open: false,
    row: null,
    mode: "edit",
  });
  const [customTypeEnabled, setCustomTypeEnabled] = useState(false);
  const [customTypeValue, setCustomTypeValue] = useState("");
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState("");
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [deleteSaving, setDeleteSaving] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [coaLoadError, setCoaLoadError] = useState("");
  const [isLoadingCoa, setIsLoadingCoa] = useState(true);
  const [currencyChoices, setCurrencyChoices] = useState([]);
  const [selectedRowKeys, setSelectedRowKeys] = useState([]);
  const [collapsedPaths, setCollapsedPaths] = useState(new Set());
  const [moveModal, setMoveModal] = useState({ open: false, row: null });
  const [moveSaving, setMoveSaving] = useState(false);
  const [moveError, setMoveError] = useState("");

  const loadCoaData = useCallback(async (withLoading = true) => {
    if (withLoading) {
      setIsLoadingCoa(true);
    }
    setCoaLoadError("");
    try {
      const [coaSections, traits, currencyPayload, fedPayload] = await Promise.all([
        Rest.fetchCoaSections(),
        Rest.fetchCoaTraits().catch(() => ({})),
        Rest.fetchCurrencyOptionsV2().catch(() => null),
        Rest.fetchJson("/api/v2/bank-feed/fed-accounts").catch(() => ({ data: [] })),
      ]);
      setCoaSections(coaSections);
      const fedNames = new Set((fedPayload?.data || []).map((a) => a.name));
      setCoaRows(buildCoaRows(coaSections, traits || {}, fedNames));
      const currencies = currencyPayload?.currencies;
      if (Array.isArray(currencies)) {
        setCurrencyChoices(currencies);
      } else {
        setCurrencyChoices([]);
      }
    } catch (error) {
      setCoaLoadError(error?.message || "Failed to load COA data.");
      setCoaRows([]);
    } finally {
      if (withLoading) {
        setIsLoadingCoa(false);
      }
    }
  }, []);

  useEffect(() => {
    loadCoaData(true);
  }, [loadCoaData]);

  // This page holds its own COA copy, but the rest of the app reads the shared
  // useCoa() query (forecast module Account list, category selectors, …). Without
  // this, a newly added/renamed/moved account stays invisible there until that
  // cache goes stale on its own.
  const reloadCoaAfterMutation = useCallback(() => {
    loadCoaData(false).catch(() => {});
    queryClient.invalidateQueries({ queryKey: ["coa"] });
  }, [loadCoaData, queryClient]);

  const typeOptions = useMemo(() => {
    // Real account types only (asset/liability/income/expense) — a container's true
    // type is on accountType, not the tree's "Category" pseudo-type. Powers both the
    // filter dropdown and the edit modal's Type select, so neither offers "Category".
    const set = new Set();
    coaRows.forEach((row) => {
      if (row.accountType) set.add(row.accountType);
    });
    return ["all", ...Array.from(set).sort()];
  }, [coaRows]);

  const currencyOptions = useMemo(() => {
    const set = new Set();
    coaRows.forEach((row) => set.add(row.currency));
    return ["all", ...Array.from(set).sort()];
  }, [coaRows]);

  const currencySelectOptions = useMemo(() => {
    const set = new Set();
    (currencyChoices || []).forEach((currency) => {
      if (typeof currency === "string" && currency.trim()) {
        set.add(currency.trim());
      }
    });
    coaRows.forEach((row) => {
      const currency = row.currency;
      if (
        typeof currency === "string" &&
        currency.trim() &&
        currency !== "\u2014" &&
        currency !== "Unspecified"
      ) {
        set.add(currency.trim());
      }
    });
    return Array.from(set).sort();
  }, [currencyChoices, coaRows]);

  const filteredRows = useMemo(() => {
    const search = searchTerm.trim().toLowerCase();
    return coaRows.filter((row) => {
      // Match on the real account_type so a type filter also surfaces the category
      // containers of that type (they display "Category" in the tree but carry the
      // parent type on accountType), giving back the hierarchy instead of orphaned
      // leaves. Synthetic section wrappers (no accountType) drop out under a filter.
      if (typeFilter !== "all" && row.accountType !== typeFilter) return false;
      if (currencyFilter !== "all" && row.currency !== currencyFilter)
        return false;
      if (!search) return true;
      return (
        row.name.toLowerCase().includes(search) ||
        row.pathLabel.toLowerCase().includes(search)
      );
    });
  }, [coaRows, typeFilter, currencyFilter, searchTerm]);

  // Apply collapse state to filtered rows (skip collapse when searching)
  const visibleRows = useMemo(() => {
    const isSearching = searchTerm.trim().length > 0;
    if (isSearching || collapsedPaths.size === 0) return filteredRows;
    return filteredRows.filter((row) => {
      // Check if any ancestor is collapsed
      for (let i = 1; i <= row.path.length; i++) {
        const ancestorKey = row.path.slice(0, i).join("|");
        if (collapsedPaths.has(ancestorKey)) return false;
      }
      return true;
    });
  }, [filteredRows, collapsedPaths, searchTerm]);

  const getRowKey = useCallback((row) => {
    return row?.id || `${row?.pathLabel || ""}-${row?.name || ""}`;
  }, []);

  // ---------------------------------------------------------------------------
  // CR063 — reorder a row among its siblings.
  //
  // Reordering is suppressed whenever a search or filter is active: in a filtered
  // view the row rendered above is not the sibling the row would swap with, so an
  // arrow would move the account somewhere other than where it appears to go.
  // ---------------------------------------------------------------------------
  const isFiltered =
    searchTerm.trim().length > 0 || typeFilter !== "all" || currencyFilter !== "all";

  // Same function decides whether the arrow is enabled and what it does, so the
  // button cannot offer a move the handler would then decline.
  const canReorder = useCallback(
    (row, delta) => !isFiltered && reorderPlan(coaRows, row, delta) !== null,
    [coaRows, isFiltered]
  );

  const handleReorder = useCallback(
    async (row, delta) => {
      const plan = reorderPlan(coaRows, row, delta);
      if (!plan || isFiltered) return;
      try {
        await Rest.reorderCoaChildren(plan.parent, plan.orderedIds);
        reloadCoaAfterMutation();
      } catch (error) {
        showErrorToast(error?.message || "Failed to reorder accounts");
      }
    },
    [coaRows, isFiltered, reloadCoaAfterMutation, showErrorToast]
  );

  const selectedRows = useMemo(() => {
    const keySet = new Set(selectedRowKeys);
    return coaRows.filter((row) => keySet.has(getRowKey(row)));
  }, [coaRows, getRowKey, selectedRowKeys]);

  const deletableRows = useMemo(() => {
    return selectedRows.filter(
      (row) => row && !row.isCategory && row.type !== "Category"
    );
  }, [selectedRows]);

  const canDeleteSelected =
    selectedRows.length > 0 && deletableRows.length === selectedRows.length;

  const toggleCollapse = useCallback((row) => {
    const pathKey = [...row.path, row.name].join("|");
    setCollapsedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(pathKey)) next.delete(pathKey);
      else next.add(pathKey);
      return next;
    });
  }, []);

  // ---------------------------------------------------------------------------
  // Expand / collapse controls — same four-button pattern as the reports
  // (BudgetBalancePanel, CashFlow): all / one-layer, in both directions. The
  // state here is the INVERSE of the reports' (`collapsedPaths`, not
  // `expandedPaths`), so "expand all" is the empty set and "collapse all" has to
  // enumerate every category path.
  // ---------------------------------------------------------------------------
  const collapsiblePaths = useMemo(() => {
    const keys = new Set();
    for (const row of filteredRows) {
      if (row.isCategory) keys.add([...row.path, row.name].join("|"));
    }
    return keys;
  }, [filteredRows]);

  const depthOf = (pathKey) => pathKey.split("|").length - 1;

  const isFullyExpanded =
    collapsiblePaths.size > 0 && collapsedPaths.size === 0;
  const isFullyCollapsed =
    collapsiblePaths.size > 0 && collapsedPaths.size === collapsiblePaths.size;

  const handleExpandAll = useCallback(() => setCollapsedPaths(new Set()), []);

  const handleCollapseAll = useCallback(
    () => setCollapsedPaths(new Set(collapsiblePaths)),
    [collapsiblePaths]
  );

  const handleExpandOneLayer = useCallback(() => {
    setCollapsedPaths((prev) => {
      if (prev.size === 0) return prev;
      let minDepth = Infinity;
      for (const pathKey of prev) {
        minDepth = Math.min(minDepth, depthOf(pathKey));
      }
      const next = new Set(prev);
      for (const pathKey of prev) {
        if (depthOf(pathKey) === minDepth) next.delete(pathKey);
      }
      return next;
    });
  }, []);

  const handleCollapseOneLayer = useCallback(() => {
    setCollapsedPaths((prev) => {
      const open = [...collapsiblePaths].filter((pathKey) => !prev.has(pathKey));
      if (open.length === 0) return prev;
      let maxDepth = -1;
      for (const pathKey of open) {
        maxDepth = Math.max(maxDepth, depthOf(pathKey));
      }
      const next = new Set(prev);
      for (const pathKey of open) {
        if (depthOf(pathKey) === maxDepth) next.add(pathKey);
      }
      return next;
    });
  }, [collapsiblePaths]);

  const toggleRowSelection = (row, options = {}) => {
    const key = getRowKey(row);
    if (!options.multi) {
      setSelectedRowKeys([key]);
      return;
    }
    setSelectedRowKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return Array.from(next);
    });
  };

  const openEditModal = async (row, options = {}) => {
    const selection =
      Array.isArray(options.selection) && options.selection.length
        ? options.selection
        : [row];
    const isMulti = selection.length > 1;
    const sharedValue = (field) => {
      const values = Array.from(
        new Set(selection.map((item) => String(item?.[field] ?? "").trim()))
      );
      return values.length === 1 ? values[0] : "";
    };
    const mixedFields = {
      type: isMulti && sharedValue("type") === "",
      currency: isMulti && sharedValue("currency") === "",
      accountNumber: isMulti && sharedValue("accountNumber") === "",
    };
    const editRow = isMulti
      ? {
          ...selection[0],
          name: "Multiple accounts selected",
          type: sharedValue("type"),
          currency: sharedValue("currency"),
          accountNumber: sharedValue("accountNumber"),
          originalName: selection[0]?.name,
        }
      : {
          ...row,
          originalName: row.name,
        };

    // For single edit, try to fetch source mappings.
    // Try category first (for P&L leaves like "FX"), then account (for BS items like "Bank of America").
    if (!isMulti) {
      let mappings = null;
      try {
        const catData = await Rest.fetchCategoryByName(row.name);
        if (catData) {
          editRow.categoryId = catData.id;
          mappings = catData.mappings || [];
        }
      } catch {
        // 404 — try account next
      }
      if (!mappings) {
        try {
          const acctData = await Rest.fetchAccountByName(row.name);
          if (acctData) {
            editRow.accountId = acctData.id;
            mappings = acctData.mappings || [];
          }
        } catch {
          // Non-critical — modal still opens without mappings
        }
      }
      if (mappings) {
        const psMapping = mappings.find((m) => m.source === "pocketsmith");
        const qkMapping = mappings.find((m) => m.source === "quicken");
        editRow.pocketsmithName = psMapping?.external_name ?? "";
        editRow.quickenName = qkMapping?.external_name ?? "";
      }
    }

    setEditModal({
      open: true,
      row: editRow,
      isMulti,
      selectedRows: selection,
      mixedFields,
      changedFields: {},
      mode: "edit",
    });
    setCustomTypeEnabled(false);
    setCustomTypeValue("");
    setEditError("");
  };

  const openAddModal = (parentRow) => {
    const parentPath = parentRow
      ? [...(parentRow.path || []), parentRow.name].filter(Boolean)
      : [];
    // A child always inherits its parent's account_type on add (the backend ignores
    // any type we send), so seed and lock it; default the currency to the parent's.
    // When there's no parent yet (toolbar "Add New" → category picker), these fill in
    // once a parent is chosen (handleQuickAddParentChange).
    const inheritedType = parentRow?.accountType || "";
    const inheritedCurrency = parentRow?.accountCurrency || "";
    setEditModal({
      open: true,
      row: {
        name: "",
        type: inheritedType,
        currency: inheritedCurrency,
        accountNumber: "",
        isCategory: false,
        path: parentPath,
      },
      mode: "add",
      parentPath,
    });
    setCustomTypeEnabled(false);
    setCustomTypeValue("");
    setEditError("");
  };

  // Used by the toolbar "Add" path, where no parent is chosen up front and the
  // modal shows the category picker instead.
  const handleQuickAddParentChange = (newPath) => {
    setEditModal((prev) => {
      if (!prev.open) return prev;
      // Match the chosen parent by its full path (names alone aren't unique) so we
      // inherit its real account_type/currency, same as the "+" add-child path.
      const parent = coaRows.find(
        (r) =>
          r.isCategory &&
          [...(r.path || []), r.name].length === newPath.length &&
          [...(r.path || []), r.name].every((seg, i) => seg === newPath[i])
      );
      return {
        ...prev,
        parentPath: newPath,
        row: {
          ...prev.row,
          path: newPath,
          type: parent?.accountType ?? prev.row.type,
          currency: parent?.accountCurrency ?? prev.row.currency,
        },
      };
    });
  };

  const closeEditModal = () =>
    setEditModal({ open: false, row: null, mode: "edit" });

  const openDeleteModal = () => {
    setDeleteError("");
    setDeleteModalOpen(true);
  };

  // Inline delete: select the row first so deletableRows picks it up
  const handleInlineDelete = (row) => {
    const key = getRowKey(row);
    setSelectedRowKeys([key]);
    setDeleteError("");
    setDeleteModalOpen(true);
  };

  const closeDeleteModal = () => {
    setDeleteModalOpen(false);
    setDeleteError("");
  };

  const openMoveModal = (row) => {
    setMoveError("");
    setMoveModal({ open: true, row });
  };

  const closeMoveModal = () => {
    setMoveModal({ open: false, row: null });
    setMoveError("");
  };

  const handleConfirmMove = async (row, targetPath) => {
    if (!row || !targetPath?.length) {
      setMoveError("Select a destination category.");
      return;
    }
    // Check if destination is the same as current parent
    const currentParentPath = row.path || [];
    if (
      targetPath.length === currentParentPath.length &&
      targetPath.every((seg, i) => seg === currentParentPath[i])
    ) {
      setMoveError("This account is already under that parent. Select a different destination.");
      return;
    }
    setMoveSaving(true);
    setMoveError("");
    try {
      // The coa/add endpoint re-parents an existing account when it finds
      // the same name under a different parent
      await Rest.fetchJson("/api/v2/util/coa/add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path: targetPath,
          name: row.name,
          type: row.type === "Category" ? "" : row.type,
          currency: row.currency === "\u2014" ? "" : row.currency,
          accountNumber: row.accountNumber,
          isCategory: row.isCategory,
        }),
      });
      closeMoveModal();
      reloadCoaAfterMutation();
      setSelectedRowKeys([]);
      showSuccess(`"${row.name}" moved successfully`);
    } catch (error) {
      setMoveError(error?.message || "Failed to move account.");
      showErrorToast(error?.message || "Failed to move account");
    } finally {
      setMoveSaving(false);
    }
  };

  const handleEditFieldChange = (field, value) => {
    setEditModal((prev) => {
      if (!prev.open) return prev;
      // Allow isCategory toggle in add mode
      if (field === "isCategory") {
        return { ...prev, row: { ...prev.row, isCategory: value } };
      }
      // Block non-name changes for categories in edit mode
      if (prev.row?.isCategory && field !== "name" && prev.mode === "edit") {
        return prev;
      }
      return {
        ...prev,
        row: { ...prev.row, [field]: value },
        changedFields: { ...(prev.changedFields || {}), [field]: true },
      };
    });
  };

  const handleSaveEdit = async () => {
    if (!editModal.open || !editModal.row) return;
    if (editModal.mode === "add") {
      const trimmedName = String(editModal.row.name || "").trim();
      const isCategoryAdd = editModal.row.isCategory;
      if (!trimmedName) {
        setEditError(isCategoryAdd ? "Category name is required." : "Account name is required.");
        return;
      }
      if (!editModal.parentPath || editModal.parentPath.length === 0) {
        setEditError(isCategoryAdd ? "Select a parent category." : "Select a category to add this account.");
        return;
      }
      setEditSaving(true);
      setEditError("");
      try {
        await Rest.fetchJson("/api/v2/util/coa/add", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            path: editModal.parentPath,
            name: trimmedName,
            type: editModal.row.type,
            currency: editModal.row.currency,
            accountNumber: editModal.row.accountNumber,
            isCategory: isCategoryAdd,
          }),
        });
        reloadCoaAfterMutation();
        closeEditModal();
        showSuccess(isCategoryAdd ? "Category added successfully" : "Account added successfully");
      } catch (error) {
        setEditError(error?.message || "Failed to add account.");
        showErrorToast(error?.message || "Failed to add account");
      } finally {
        setEditSaving(false);
      }
      return;
    }
    const targets = editModal.isMulti
      ? editModal.selectedRows || []
      : [editModal.row];
    if (!targets.length) return;
    setEditSaving(true);
    setEditError("");
    try {
      const resolveField = (field, row) => {
        const mixed = editModal.mixedFields?.[field];
        const changed = editModal.changedFields?.[field];
        const value = editModal.row?.[field];
        if (editModal.isMulti && mixed && !changed) {
          return row[field];
        }
        return value ?? row[field];
      };

      const updates = [];

      for (const target of targets) {
        const nextName = editModal.isMulti ? target.name : editModal.row.name;
        const isCategoryTarget =
          target.isCategory || target.type === "Category";
        const nextType = isCategoryTarget
          ? target.type
          : resolveField("type", target);
        const nextCurrency = isCategoryTarget
          ? target.currency
          : resolveField("currency", target);
        const nextAccountNumber = isCategoryTarget
          ? target.accountNumber
          : resolveField("accountNumber", target);

        const pathForApi = [
          ...target.path,
          target.isCategory
            ? target.originalName || target.name
            : target.originalName || target.name,
        ];

        await Rest.fetchJson("/api/v2/util/coa/update", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            path: pathForApi,
            oldName: target.originalName || target.name,
            name: nextName,
            type: nextType,
            currency: nextCurrency,
            accountNumber: nextAccountNumber,
          }),
        });

        // Save source mappings for categories
        if (editModal.row.categoryId) {
          const catId = editModal.row.categoryId;
          if (editModal.changedFields?.pocketsmithName && editModal.row.pocketsmithName) {
            await Rest.saveCategoryMapping(catId, "pocketsmith", editModal.row.pocketsmithName);
          }
          if (editModal.changedFields?.quickenName && editModal.row.quickenName) {
            await Rest.saveCategoryMapping(catId, "quicken", editModal.row.quickenName);
          }
        } else if (editModal.row.accountId) {
          const acctId = editModal.row.accountId;
          if (editModal.changedFields?.pocketsmithName && editModal.row.pocketsmithName) {
            await Rest.saveAccountMapping(acctId, "pocketsmith", editModal.row.pocketsmithName);
          }
          if (editModal.changedFields?.quickenName && editModal.row.quickenName) {
            await Rest.saveAccountMapping(acctId, "quicken", editModal.row.quickenName);
          }
        }

        updates.push({
          targetId: target.id,
          updatedRow: {
            ...target,
            name: nextName,
            type: nextType,
            currency: nextCurrency,
            accountNumber: nextAccountNumber,
            id: `${target.path.join("|")}-${nextName}`,
            originalName: undefined,
          },
        });
      }

      setCoaRows((prev) =>
        prev.map((row) => {
          const found = updates.find((entry) => entry.targetId === row.id);
          return found ? found.updatedRow : row;
        })
      );
      setSelectedRowKeys((prev) => {
        const map = new Map(
          updates.map((entry) => [entry.targetId, entry.updatedRow.id])
        );
        return Array.from(new Set(prev.map((key) => map.get(key) || key)));
      });
      reloadCoaAfterMutation();
      closeEditModal();
      setSelectedRowKeys([]);
      showSuccess("Account updated successfully");
    } catch (error) {
      setEditError(error?.message || "Failed to save changes.");
      showErrorToast(error?.message || "Failed to save changes");
    } finally {
      setEditSaving(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deletableRows.length) {
      setDeleteError("No deleteable accounts selected.");
      return;
    }
    setDeleteSaving(true);
    setDeleteError("");
    try {
      await Promise.all(
        deletableRows.map((row) =>
          Rest.fetchJson("/api/v2/util/coa/delete", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              path: [...row.path, row.name],
              name: row.name,
            }),
          })
        )
      );
      setDeleteModalOpen(false);
      reloadCoaAfterMutation();
      setSelectedRowKeys([]);
      showSuccess("Accounts deleted successfully");
    } catch (error) {
      setDeleteError(error?.message || "Failed to delete selected accounts.");
      showErrorToast(error?.message || "Failed to delete selected accounts");
    } finally {
      setDeleteSaving(false);
    }
  };

  return (
    <>
      <main className="page-main">
        <div className="coa-management-container">
          <header className="coa-management-header">
            <h1 className="coa-management-header__title">
              Chart of Accounts
            </h1>
            <p className="coa-management-header__subtitle">
              Manage your chart of accounts hierarchy
            </p>
          </header>
          <COAManagementToolbar
            searchTerm={searchTerm}
            onSearchChange={setSearchTerm}
            typeFilter={typeFilter}
            onTypeChange={setTypeFilter}
            typeOptions={typeOptions}
            currencyFilter={currencyFilter}
            onCurrencyChange={setCurrencyFilter}
            currencyOptions={currencyOptions}
            onAddNew={() => openAddModal(null)}
            onExpandAll={handleExpandAll}
            onCollapseAll={handleCollapseAll}
            onExpandOneLayer={handleExpandOneLayer}
            onCollapseOneLayer={handleCollapseOneLayer}
            hasCollapsiblePaths={collapsiblePaths.size > 0}
            isFullyExpanded={isFullyExpanded}
            isFullyCollapsed={isFullyCollapsed}
            selectedCount={selectedRows.length}
            onEditSelected={() =>
              selectedRows.length
                ? openEditModal(selectedRows[0], {
                    selection: selectedRows,
                  })
                : null
            }
            onDeleteSelected={() =>
              canDeleteSelected ? openDeleteModal() : null
            }
            onClearSelected={() => setSelectedRowKeys([])}
            editDisabled={selectedRows.length === 0}
            deleteDisabled={!canDeleteSelected}
          />
          <COATreeTable
            visibleRows={visibleRows}
            totalRowCount={coaRows.length}
            isLoadingCoa={isLoadingCoa}
            coaLoadError={coaLoadError}
            selectedRowKeys={selectedRowKeys}
            collapsedPaths={collapsedPaths}
            onToggleCollapse={toggleCollapse}
            onToggleRowSelection={toggleRowSelection}
            getRowKey={getRowKey}
            onAddChild={(row) => openAddModal(row)}
            onEditRow={(row) => openEditModal(row)}
            onDeleteRow={handleInlineDelete}
            onMoveRow={openMoveModal}
            onReorderRow={handleReorder}
            canReorder={canReorder}
          />
        </div>
      </main>
      <COAEditModal
        open={editModal.open}
        row={editModal.row}
        onClose={closeEditModal}
        onFieldChange={handleEditFieldChange}
        onSave={handleSaveEdit}
        typeOptions={typeOptions}
        currencyOptions={currencySelectOptions}
        editError={editError}
        editSaving={editSaving}
        customTypeEnabled={customTypeEnabled}
        setCustomTypeEnabled={setCustomTypeEnabled}
        customTypeValue={customTypeValue}
        setCustomTypeValue={setCustomTypeValue}
        mode={editModal.mode}
        isMultiEdit={Boolean(editModal.isMulti)}
        selectedCount={editModal.selectedRows?.length || 0}
        mixedFields={editModal.mixedFields || {}}
        coaSections={coaSections}
        parentPath={editModal.parentPath || []}
        onParentPathChange={handleQuickAddParentChange}
      />
      <FCExpConfirmDeleteModal
        isOpen={deleteModalOpen}
        selectedEntry={deletableRows[0] || null}
        error={deleteError}
        isSaving={deleteSaving}
        onClose={closeDeleteModal}
        onConfirm={handleConfirmDelete}
        title="Delete Accounts"
        itemLabel={
          deletableRows.length > 1
            ? `${deletableRows.length} accounts`
            : deletableRows[0]?.name
        }
        description={
          deletableRows.length > 1
            ? `Are you sure you want to delete ${deletableRows.length} accounts?`
            : undefined
        }
        confirmLabel="Delete"
      />
      <COAMoveModal
        open={moveModal.open}
        row={moveModal.row}
        coaSections={coaSections}
        onClose={closeMoveModal}
        onConfirm={handleConfirmMove}
        isSaving={moveSaving}
        error={moveError}
      />
    </>
  );
}
