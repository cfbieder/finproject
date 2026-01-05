import { useMemo, useState } from "react";
import NavigationMenu from "../components/NavigationMenu.jsx";
import UploadFeedback from "../features/Database/UploadFeedback.jsx";
import coaData from "../../../components/data/coa.json";
import coaTraits from "../../../components/data/coa_traits.json";
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

export default function COAManagement() {
  const [typeFilter, setTypeFilter] = useState("all");
  const [currencyFilter, setCurrencyFilter] = useState("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [analyzeStatus, setAnalyzeStatus] = useState(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  const coaRows = useMemo(() => {
    const rows = collectCoaRows(coaData);
    return rows.map(({ name, path, isCategory }) => {
      const traits = isCategory ? {} : coaTraits?.[name] || {};
      const type = isCategory ? "Category" : traits.Type || "Unspecified";
      const currency = isCategory ? "—" : traits.Currency || "Unspecified";
      return {
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
  }, []);

  const getRowShade = (depth) => {
    const lightness = Math.max(98 - depth * 6, 70);
    return `hsl(215, 45%, ${lightness}%)`;
  };

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
              View and filter your chart of accounts by type, currency, or search term
            </p>
          </header>

          <section className="coa-management-filters">
            <h2 className="coa-management-filters__title">Filters</h2>
            <div className="coa-management-filters__grid">
              <label className="filter-field">
                <span className="filter-field__label">Type</span>
                <select
                  className="form-input"
                  value={typeFilter}
                  onChange={(event) => setTypeFilter(event.target.value)}
                >
                  {typeOptions.map((option) => (
                    <option key={option} value={option}>
                      {option === "all" ? "All types" : option}
                    </option>
                  ))}
                </select>
              </label>
              <label className="filter-field">
                <span className="filter-field__label">Currency</span>
                <select
                  className="form-input"
                  value={currencyFilter}
                  onChange={(event) => setCurrencyFilter(event.target.value)}
                >
                  {currencyOptions.map((option) => (
                    <option key={option} value={option}>
                      {option === "all" ? "All currencies" : option}
                    </option>
                  ))}
                </select>
              </label>
              <label className="filter-field">
                <span className="filter-field__label">Search</span>
                <input
                  className="form-input"
                  type="search"
                  placeholder="Search account or path"
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                />
              </label>
            </div>
          </section>

          <section className="coa-management-table-section">
            <div className="coa-management-table-header">
              <div>
                <h2 className="coa-management-table-header__title">Accounts</h2>
                <p className="coa-management-table-header__count">
                  Showing {filteredRows.length} of {coaRows.length} accounts
                </p>
              </div>
              <div className="coa-management-actions">
                <button
                  className="coa-action-button coa-action-button--analyze"
                  type="button"
                  onClick={handleAnalyzeClick}
                  disabled={isAnalyzing}
                >
                  <span className="coa-action-button__icon" aria-hidden="true">
                    🔍
                  </span>
                  <span>{isAnalyzing ? "Analyzing..." : "Analyze PS Data"}</span>
                </button>
              </div>
            </div>
            <div className="coa-management-status">
              <UploadFeedback
                lastIngestStatus={null}
                lastRefreshStatus={null}
                psDataCountStatus={null}
                uploadStatus={null}
                clearStatus={null}
                ingestStatus={null}
                analyzeStatus={analyzeStatus}
              />
            </div>
            <div className="budget-options-table-wrapper">
              <table className="budget-options-table">
                <thead>
                  <tr>
                    <th style={{ width: "40%" }}>Account</th>
                    <th>Type</th>
                    <th>Currency</th>
                    <th style={{ width: "18%" }}>Account #</th>
                    <th>Add</th>
                    <th>Delete</th>
                    <th>Edit</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.length === 0 ? (
                    <tr>
                      <td colSpan="7" style={{ textAlign: "center" }}>
                        No accounts match the selected filters.
                      </td>
                    </tr>
                  ) : (
                    filteredRows.map((row) => (
                      <tr
                        key={`${row.pathLabel}-${row.name}`}
                        className={
                          row.isCategory ? "coa-table-row--category" : ""
                        }
                        style={{ backgroundColor: getRowShade(row.depth) }}
                      >
                        <td style={{ paddingLeft: `${row.depth * 16}px` }}>
                          {row.name}
                        </td>
                        <td>{row.type}</td>
                        <td>{row.currency}</td>
                        <td>{row.accountNumber || "—"}</td>
                        <td style={{ textAlign: "center" }}>
                          <button className="coa-action-button coa-action-button--add" type="button">
                            <span className="coa-action-button__icon" aria-hidden="true">
                              +
                            </span>
                            <span className="coa-action-button__label sr-only">Add (placeholder)</span>
                          </button>
                        </td>
                        <td style={{ textAlign: "center" }}>
                          <button className="coa-action-button coa-action-button--delete" type="button">
                            <span className="coa-action-button__icon" aria-hidden="true">
                              -
                            </span>
                            <span className="coa-action-button__label sr-only">Delete (placeholder)</span>
                          </button>
                        </td>
                        <td style={{ textAlign: "center" }}>
                          <button className="coa-action-button coa-action-button--edit" type="button">
                            <span className="coa-action-button__icon" aria-hidden="true">
                              ✎
                            </span>
                            <span className="coa-action-button__label sr-only">Edit (placeholder)</span>
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
