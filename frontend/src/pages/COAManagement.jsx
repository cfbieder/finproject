import { useCallback, useEffect, useMemo, useState } from "react";
import NavigationMenu from "../components/NavigationMenu.jsx";
import COAManagementFilters from "../features/COAManagement/COAManagementFilters.jsx";
import COAEditModal from "../features/COAManagement/COAEditModal.jsx";
import COAManagementTableSection from "../features/COAManagement/COAManagementTableSection.jsx";
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
  const [typeFilter, setTypeFilter] = useState("all");
  const [currencyFilter, setCurrencyFilter] = useState("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [analyzeStatus, setAnalyzeStatus] = useState(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [coaRows, setCoaRows] = useState(() => buildCoaRows());
  const [editModal, setEditModal] = useState({ open: false, row: null });
  const [customTypeEnabled, setCustomTypeEnabled] = useState(false);
  const [customTypeValue, setCustomTypeValue] = useState("");
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState("");
  const [coaLoadError, setCoaLoadError] = useState("");
  const [isLoadingCoa, setIsLoadingCoa] = useState(true);
  const [currencyChoices, setCurrencyChoices] = useState([]);

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

  const openEditModal = (row) => {
    setEditModal({
      open: true,
      row: {
        ...row,
        originalName: row.name,
      },
    });
    setCustomTypeEnabled(false);
    setCustomTypeValue("");
    setEditError("");
  };

  const closeEditModal = () => setEditModal({ open: false, row: null });

  const handleEditFieldChange = (field, value) => {
    setEditModal((prev) =>
      prev.open ? { ...prev, row: { ...prev.row, [field]: value } } : prev
    );
  };

  const handleSaveEdit = async () => {
    if (!editModal.open || !editModal.row) return;
    const updated = editModal.row;
    setEditSaving(true);
    setEditError("");
    try {
      const pathForApi = [
        ...updated.path,
        updated.isCategory
          ? updated.originalName || updated.name
          : updated.originalName || updated.name,
      ];
      await Rest.fetchJson("/api/coa/update", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          path: pathForApi,
          oldName: updated.originalName || updated.name,
          name: updated.name,
          type: updated.type,
          currency: updated.currency,
          accountNumber: updated.accountNumber,
        }),
      });
      setCoaRows((prev) =>
        prev.map((row) =>
          row.id === updated.id
            ? {
                ...row,
                ...updated,
                id: `${updated.path.join("|")}-${updated.name}`,
                originalName: undefined,
              }
            : row
        )
      );
      loadCoaData(false).catch(() => {});
      closeEditModal();
    } catch (error) {
      setEditError(error?.message || "Failed to save changes.");
    } finally {
      setEditSaving(false);
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
      const result = await Rest.fetchJson("/api/ingest-ps/analyze-ps");
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
    <div className="page-shell">
      <NavigationMenu />
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
          <COAManagementFilters
            typeOptions={typeOptions}
            currencyOptions={currencyOptions}
            typeFilter={typeFilter}
            currencyFilter={currencyFilter}
            searchTerm={searchTerm}
            onTypeChange={setTypeFilter}
            onCurrencyChange={setCurrencyFilter}
            onSearchChange={setSearchTerm}
          />
          <COAManagementTableSection
            filteredRows={filteredRows}
            totalRowCount={coaRows.length}
            isAnalyzing={isAnalyzing}
            onAnalyzeClick={handleAnalyzeClick}
            analyzeStatus={analyzeStatus}
            isLoadingCoa={isLoadingCoa}
            coaLoadError={coaLoadError}
            onEditRow={openEditModal}
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
      />
    </div>
  );
}
