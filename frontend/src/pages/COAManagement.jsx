import { useCallback, useEffect, useMemo, useState } from "react";
import COAManagementFilters from "../features/COAManagement/COAManagementFilters.jsx";
import COAEditModal from "../features/COAManagement/COAEditModal.jsx";
import COAManagementTableSection from "../features/COAManagement/COAManagementTableSection.jsx";
import FCExpConfirmDeleteModal from "../features/Forecast/FCExpConfirmDeleteModal.jsx";
import { useToast } from "../contexts";
import Rest from "../js/rest.js";
import "../features/BudgetEntry/BudgetOptionExchangeRates.css";
import "./PageLayout.css";
import "./COAManagement.css";

const collectCoaRows = (node, path = [], rows = []) => {
  if (Array.isArray(node)) {
    node.forEach((child) => collectCoaRows(child, path, rows));
    return rows;
  }

  if (node && typeof node === "object") {
    Object.entries(node).forEach(([key, value]) => {
      rows.push({ name: key, path, isCategory: true });
      collectCoaRows(value, [...path, key], rows);
    });
    return rows;
  }

  if (typeof node === "string") {
    rows.push({ name: node, path, isCategory: false });
  }

  return rows;
};

const buildCoaRows = (coaData = [], traitsMap = {}) => {
  const rows = collectCoaRows(coaData);
  return rows.map(({ name, path, isCategory }) => {
    const traits = isCategory ? {} : traitsMap?.[name] || {};
    const type = isCategory ? "Category" : traits.Type || "Unspecified";
    const currency = isCategory ? "—" : traits.Currency || "Unspecified";
    return {
      id: `${path.join("|")}-${name}`,
      name,
      path,
      depth: path.length,
      pathLabel: path.length ? path.join(" › ") : "Root",
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
        currency !== "—" &&
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

  const getRowKey = useCallback((row) => {
    return row?.id || `${row?.pathLabel || ""}-${row?.name || ""}`;
  }, []);

  const selectedRows = useMemo(() => {
    const keySet = new Set(selectedRowKeys);
    return coaRows.filter((row) => keySet.has(getRowKey(row)));
  }, [coaRows, getRowKey, selectedRowKeys]);

  const selectedCategoryRow =
    selectedRows.length === 1 &&
    (selectedRows[0].isCategory || selectedRows[0].type === "Category")
      ? selectedRows[0]
      : null;
  const canAddSelected = Boolean(selectedCategoryRow);

  const deletableRows = useMemo(() => {
    return selectedRows.filter(
      (row) => row && !row.isCategory && row.type !== "Category"
    );
  }, [selectedRows]);

  const canDeleteSelected =
    selectedRows.length > 0 && deletableRows.length === selectedRows.length;

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
    const parentPath = [...(parentRow?.path || []), parentRow?.name].filter(
      Boolean
    );
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

  const closeEditModal = () =>
    setEditModal({ open: false, row: null, mode: "edit" });

  const openDeleteModal = () => {
    setDeleteError("");
    setDeleteModalOpen(true);
  };

  const closeDeleteModal = () => {
    setDeleteModalOpen(false);
    setDeleteError("");
  };

  const handleEditFieldChange = (field, value) => {
    setEditModal((prev) =>
      prev.open
        ? prev.row?.isCategory && field !== "name"
          ? prev
          : {
              ...prev,
              row: { ...prev.row, [field]: value },
              changedFields: { ...(prev.changedFields || {}), [field]: true },
            }
        : prev
    );
  };

  const handleSaveEdit = async () => {
    if (!editModal.open || !editModal.row) return;
    if (editModal.mode === "add") {
      const trimmedName = String(editModal.row.name || "").trim();
      if (!trimmedName) {
        setEditError("Account name is required.");
        return;
      }
      if (!editModal.parentPath || editModal.parentPath.length === 0) {
        setEditError("Select a category to add this account.");
        return;
      }
      setEditSaving(true);
      setEditError("");
      try {
        // Using v2 API
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
            isCategory: false,
          }),
        });
        loadCoaData(false).catch(() => {});
        closeEditModal();
        showSuccess("Account added successfully");
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

        // Using v2 API
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
      // Using v2 API
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
      // Using v2 API (wraps v1)
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
              Chart of Account Management
            </h1>
            <p className="coa-management-header__subtitle">
              View and filter your chart of accounts by type, currency, or
              search term
            </p>
          </header>
          <div className="coa-management-layout">
            <div className="coa-management-sidebar">
              <COAManagementFilters
                typeOptions={typeOptions}
                currencyOptions={currencyOptions}
                typeFilter={typeFilter}
                currencyFilter={currencyFilter}
                searchTerm={searchTerm}
                onTypeChange={setTypeFilter}
                onCurrencyChange={setCurrencyFilter}
                onSearchChange={setSearchTerm}
                onEditSelected={() =>
                  selectedRows.length
                    ? openEditModal(selectedRows[0], {
                        selection: selectedRows,
                      })
                    : null
                }
                onAddSelected={() =>
                  canAddSelected ? openAddModal(selectedCategoryRow) : null
                }
                onDeleteSelected={() =>
                  canDeleteSelected ? openDeleteModal() : null
                }
                selectedCount={selectedRows.length}
                onClearSelected={() => setSelectedRowKeys([])}
                addDisabled={!canAddSelected}
                deleteDisabled={!canDeleteSelected}
              />
            </div>
            <COAManagementTableSection
              filteredRows={filteredRows}
              totalRowCount={coaRows.length}
              isAnalyzing={isAnalyzing}
              onAnalyzeClick={handleAnalyzeClick}
              analyzeStatus={analyzeStatus}
              isLoadingCoa={isLoadingCoa}
              coaLoadError={coaLoadError}
              selectedRowKeys={selectedRowKeys}
              onToggleRowSelection={toggleRowSelection}
              getRowKey={getRowKey}
            />
          </div>
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
    </>
  );
}
