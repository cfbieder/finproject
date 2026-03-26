import { useCallback, useEffect, useMemo, useState } from "react";
import COAManagementToolbar from "../features/COAManagement/COAManagementToolbar.jsx";
import COAEditModal from "../features/COAManagement/COAEditModal.jsx";
import COAMoveModal from "../features/COAManagement/COAMoveModal.jsx";
import COATreeTable from "../features/COAManagement/COATreeTable.jsx";
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
      rows.push({ name: coaData.name, path, isCategory: hasChildren });
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
      rows.push({ name: key, path, isCategory: true });
      collectCoaRows(value, [...path, key], rows);
    });
    return rows;
  }

  if (typeof coaData === "string") {
    rows.push({ name: coaData, path, isCategory: false });
  }

  return rows;
};

const buildCoaRows = (coaData = [], traitsMap = {}) => {
  const rows = collectCoaRows(coaData);
  const seenIds = new Map();
  return rows.map(({ name, path, isCategory }) => {
    const traits = isCategory ? {} : traitsMap?.[name] || {};
    const type = isCategory ? "Category" : traits.Type || "Unspecified";
    const currency = isCategory ? "\u2014" : traits.Currency || "Unspecified";
    const baseId = `${path.join("|")}-${name}`;
    const count = seenIds.get(baseId) || 0;
    seenIds.set(baseId, count + 1);
    const id = count > 0 ? `${baseId}#${count}` : baseId;
    return {
      id,
      name,
      path,
      depth: path.length,
      pathLabel: path.length ? path.join(" \u203A ") : "Root",
      type,
      currency,
      accountNumber: traits.AccountNumber || "",
      isCategory,
    };
  });
};

export default function COAManagement() {
  const { showSuccess, showError: showErrorToast } = useToast();
  const [typeFilter, setTypeFilter] = useState("all");
  const [currencyFilter, setCurrencyFilter] = useState("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [analyzeStatus, setAnalyzeStatus] = useState(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
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
      const [coaSections, traits, currencyPayload] = await Promise.all([
        Rest.fetchCoaSections(),
        Rest.fetchCoaTraits().catch(() => ({})),
        Rest.fetchCurrencyOptions().catch(() => null),
      ]);
      setCoaSections(coaSections);
      setCoaRows(buildCoaRows(coaSections, traits || {}));
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

  const typeOptions = useMemo(() => {
    const set = new Set();
    coaRows.forEach((row) => set.add(row.type));
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
      if (typeFilter !== "all" && row.type !== typeFilter) return false;
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

  const openEditModal = (row, options = {}) => {
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
    const defaultType =
      typeOptions.find(
        (option) => option !== "all" && option !== "Category"
      ) || typeOptions.find((option) => option !== "all") || "";
    setEditModal({
      open: true,
      row: {
        name: "",
        type: defaultType,
        currency: "",
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

  const openQuickAddModal = (accountName) => {
    setEditModal({
      open: true,
      row: {
        name: accountName,
        type: "",
        currency: "",
        accountNumber: "",
        isCategory: false,
        path: [],
      },
      mode: "quickadd",
      parentPath: [],
    });
    setCustomTypeEnabled(false);
    setCustomTypeValue("");
    setEditError("");
  };

  const openQuickAddCategoryModal = (categoryName) => {
    setEditModal({
      open: true,
      row: {
        name: categoryName,
        type: "",
        currency: "",
        accountNumber: "",
        isCategory: true,
        path: [],
      },
      mode: "quickadd-category",
      parentPath: [],
    });
    setCustomTypeEnabled(false);
    setCustomTypeValue("");
    setEditError("");
  };

  const handleQuickAddParentChange = (newPath) => {
    setEditModal((prev) => {
      if (!prev.open) return prev;
      return {
        ...prev,
        parentPath: newPath,
        row: {
          ...prev.row,
          path: newPath,
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
      loadCoaData(false).catch(() => {});
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
    if (editModal.mode === "add" || editModal.mode === "quickadd" || editModal.mode === "quickadd-category") {
      const trimmedName = String(editModal.row.name || "").trim();
      const isQuickAddCategory = editModal.mode === "quickadd-category";
      const isCategoryAdd = isQuickAddCategory || editModal.row.isCategory;
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
        loadCoaData(false).catch(() => {});
        closeEditModal();
        if (editModal.mode === "quickadd" || isQuickAddCategory) {
          try {
            await Rest.fetchJson("/api/v2/ingest-ps/sync-to-transactions", {
              method: "POST",
            });
          } catch (syncError) {
            console.warn("Staging sync after quick-add failed:", syncError);
          }
          handleAnalyzeClick();
          showSuccess(isQuickAddCategory ? "Category added and transactions synced" : "Account added and transactions synced");
        } else {
          showSuccess(isCategoryAdd ? "Category added successfully" : "Account added successfully");
        }
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
      loadCoaData(false).catch(() => {});
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
      loadCoaData(false).catch(() => {});
      setSelectedRowKeys([]);
      showSuccess("Accounts deleted successfully");
    } catch (error) {
      setDeleteError(error?.message || "Failed to delete selected accounts.");
      showErrorToast(error?.message || "Failed to delete selected accounts");
    } finally {
      setDeleteSaving(false);
    }
  };

  const handleAnalyzeClick = async () => {
    if (isAnalyzing) {
      return;
    }

    setAnalyzeStatus({
      type: "info",
      message: "Running PS analysis...",
    });
    setIsAnalyzing(true);

    try {
      const result = await Rest.fetchJson("/api/v2/ingest-ps/analyze-ps");
      const {
        misAcct = {},
        missCOAact = {},
        misCat = {},
        missCOACat = {},
      } = result ?? {};

      const missingAccounts = Array.isArray(misAcct.missingAccounts)
        ? misAcct.missingAccounts.filter(
            (item) => typeof item === "string" && item
          )
        : [];
      const unknownAccounts = Array.isArray(missCOAact.unknownAccounts)
        ? missCOAact.unknownAccounts.filter(
            (item) => typeof item === "string" && item
          )
        : [];
      const missingCategories = Array.isArray(misCat.missingCategories)
        ? misCat.missingCategories.filter(
            (item) => typeof item === "string" && item
          )
        : [];
      const unknownCategories = Array.isArray(missCOACat.unknownCategories)
        ? missCOACat.unknownCategories.filter(
            (item) => typeof item === "string" && item
          )
        : [];

      const missingAccountCount =
        Number.isFinite(misAcct.missingCount) && misAcct.missingCount >= 0
          ? misAcct.missingCount
          : missingAccounts.length;
      const unknownAccountCount =
        Number.isFinite(missCOAact.unknownCount) && missCOAact.unknownCount >= 0
          ? missCOAact.unknownCount
          : unknownAccounts.length;
      const missingCategoryCount =
        Number.isFinite(misCat.missingCount) && misCat.missingCount >= 0
          ? misCat.missingCount
          : missingCategories.length;
      const unknownCategoryCount =
        Number.isFinite(missCOACat.unknownCount) && missCOACat.unknownCount >= 0
          ? missCOACat.unknownCount
          : unknownCategories.length;

      const details = [];
      if (missingAccounts.length) {
        details.push(
          `Missing from COA (accounts): ${missingAccounts.join(", ")}`
        );
      }
      if (unknownAccounts.length) {
        details.push(
          `Unrecognized COA accounts: ${unknownAccounts.join(", ")}`
        );
      }
      if (missingCategories.length) {
        details.push(
          `Missing from COA (categories): ${missingCategories.join(", ")}`
        );
      }
      if (unknownCategories.length) {
        details.push(
          `Unrecognized COA categories: ${unknownCategories.join(", ")}`
        );
      }
      if (
        unknownAccounts.length === 0 &&
        missCOAact.status &&
        missCOAact.status !== "ok"
      ) {
        details.push(`COA account status: ${missCOAact.status}`);
      }
      if (
        unknownCategories.length === 0 &&
        missCOACat.status &&
        missCOACat.status !== "ok"
      ) {
        details.push(`COA category status: ${missCOACat.status}`);
      }

      setAnalyzeStatus({
        type: "success",
        message: `Analysis complete: ${missingAccountCount} missing accounts, ${unknownAccountCount} unknown accounts; ${missingCategoryCount} missing categories, ${unknownCategoryCount} unknown categories.`,
        details,
        missingAccounts,
        missingCategories,
      });
    } catch (error) {
      setAnalyzeStatus({
        type: "error",
        message: error?.message ?? "Failed to analyze PS data.",
      });
    } finally {
      setIsAnalyzing(false);
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
            onAnalyzeClick={handleAnalyzeClick}
            isAnalyzing={isAnalyzing}
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
            analyzeStatus={analyzeStatus}
            onQuickAddAccount={openQuickAddModal}
            onQuickAddCategory={openQuickAddCategoryModal}
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
