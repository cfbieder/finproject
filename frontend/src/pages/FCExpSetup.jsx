import { useEffect, useMemo, useRef, useState } from "react";
import NavigationMenu from "../components/NavigationMenu.jsx";
import FCExpConfirmDeleteModal from "../features/Forecast/FCExpConfirmDeleteModal.jsx";
import FCExpModal from "../features/Forecast/FCExpModal.jsx";
import FCExpFilter from "../features/Forecast/FCExpFilter.jsx";
import FCExpTable from "../features/Forecast/FCExpTable.jsx";
import FCExpTableDetails from "../features/Forecast/FCExpTableDetails.jsx";
import Rest from "../js/rest.js";
import "../features/Forecast/FCModulesFilter.css";
import "./PageLayout.css";
import "./FCExpSetup.css";

/**
 * FCExpSetup - Forecast Income/Expense Setup Page
 *
 * This component provides a comprehensive interface for managing forecast income and expense entries.
 * It allows users to view, create, edit, and delete forecast entries within different scenarios.
 *
 * Key Features:
 * - Scenario-based filtering and management
 * - Dynamic account hierarchy loading from Chart of Accounts
 * - Automatic base value calculation from historical cash flow data
 * - Growth rate configuration with periodic changes
 * - Matched vs unmatched entry distinction
 * - Real-time entry selection and detail viewing
 *
 * @component
 * @returns {JSX.Element} The forecast expense setup page
 */
export default function FCExpSetup() {
  // ========== Core Data State ==========
  /** @type {[Object|null, Function]} Forecast assumptions including scenarios and period ranges */
  const [assumptions, setAssumptions] = useState(null);

  /** @type {[string, Function]} Currently selected scenario name */
  const [selectedScenario, setSelectedScenario] = useState("");

  /** @type {[string, Function]} Error message for assumptions loading */
  const [error, setError] = useState("");

  /** @type {[boolean, Function]} Loading state for assumptions */
  const [isLoading, setIsLoading] = useState(false);

  // ========== Income/Expense Entries State ==========
  /** @type {[boolean, Function]} Loading state for income/expense entries */
  const [entriesLoading, setEntriesLoading] = useState(false);

  /** @type {[string, Function]} Error message for entries loading */
  const [entriesError, setEntriesError] = useState("");

  /** @type {[Array, Function]} List of income/expense forecast entries */
  const [incomeExpenseEntries, setIncomeExpenseEntries] = useState([]);

  /** @type {[string, Function]} ID of currently selected entry */
  const [selectedEntryId, setSelectedEntryId] = useState("");

  // ========== Delete Modal State ==========
  /** @type {[boolean, Function]} Whether delete confirmation modal is visible */
  const [showDeleteModal, setShowDeleteModal] = useState(false);

  /** @type {[boolean, Function]} Whether delete operation is in progress */
  const [deleteSaving, setDeleteSaving] = useState(false);

  /** @type {[string, Function]} Error message from delete operation */
  const [deleteError, setDeleteError] = useState("");

  // ========== Edit Modal State ==========
  /** @type {[boolean, Function]} Whether edit modal is visible */
  const [showEditModal, setShowEditModal] = useState(false);

  /** @type {[Object|null, Function]} Form data for entry being edited */
  const [editForm, setEditForm] = useState(null);

  /** @type {[boolean, Function]} Whether save operation is in progress */
  const [editSaving, setEditSaving] = useState(false);

  /** @type {[string, Function]} Error message from save operation */
  const [editError, setEditError] = useState("");

  // ========== Account Hierarchy State ==========
  /** @type {[Array, Function]} List of level-2 account names from COA */
  const [accountOptions, setAccountOptions] = useState([]);

  /** @type {[Object, Function]} Map of account names to their leaf account names */
  const [accountNameOptions, setAccountNameOptions] = useState({});

  /** @type {[Object, Function]} Map of leaf account names to their parent account */
  const [leafAccountLookup, setLeafAccountLookup] = useState({});

  // ========== Refs ==========
  /** Reference to scenario select element for dynamic width calculation */
  const scenarioSelectRef = useRef(null);

  // ========== Effects ==========
  /**
   * Effect: Load forecast assumptions on component mount
   * Fetches scenarios, period ranges, and other forecast configuration
   */
  useEffect(() => {
    let isMounted = true;
    const loadAssumptions = async () => {
      setIsLoading(true);
      try {
        // Using v2 API (PostgreSQL)
        const data = await Rest.fetchJson("/api/v2/forecast/assumptions");
        if (isMounted) {
          setAssumptions(data);
          setError("");
        }
      } catch (err) {
        if (isMounted) {
          setAssumptions(null);
          setError(err.message || "Failed to load assumptions");
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };

    loadAssumptions();
    return () => {
      isMounted = false;
    };
  }, []);

  /**
   * Effect: Auto-select scenario when assumptions load
   * Maintains current selection if still valid, otherwise checks localStorage for default,
   * otherwise defaults to first scenario
   */
  useEffect(() => {
    const availableScenarios = assumptions?.scenarios || [];
    if (!availableScenarios.length) {
      setSelectedScenario("");
      return;
    }

    setSelectedScenario((prev) => {
      // Keep current selection if valid
      if (
        prev &&
        availableScenarios.some((scenario) => scenario.Name === prev)
      ) {
        return prev;
      }

      // Check localStorage for default scenario
      const defaultScenario = localStorage.getItem("forecast_default_scenario");
      if (
        defaultScenario &&
        availableScenarios.some((scenario) => scenario.Name === defaultScenario)
      ) {
        return defaultScenario;
      }

      // Fall back to first scenario
      return availableScenarios[0].Name || "";
    });
  }, [assumptions]);

  /**
   * Effect: Load Chart of Accounts hierarchy on component mount
   * Builds account options and lookup tables for matched entries
   */
  useEffect(() => {
    let isMounted = true;

    const loadAccounts = async () => {
      try {
        // Using v2 API
        const data = await Rest.fetchJson("/api/v2/util/coa/CashFlow");
        if (!isMounted) return;

        const options = [];
        const seen = new Set();
        const namesByAccount = {};
        const leafToAccount = {};
        const addLevel2 = (section) => {
          if (!Array.isArray(section)) return;
          section.forEach((entry) => {
            if (!entry || typeof entry !== "object") return;
            const [key] = Object.keys(entry);
            if (key) {
              if (!seen.has(key)) {
                seen.add(key);
                options.push(key);
              }

              const names = [];
              const addLeaves = (node) => {
                if (typeof node === "string") {
                  names.push(node);
                  if (!leafToAccount[node]) {
                    leafToAccount[node] = key;
                  }
                  return;
                }
                if (Array.isArray(node)) {
                  node.forEach((item) => addLeaves(item));
                  return;
                }
                if (node && typeof node === "object") {
                  Object.entries(node).forEach(([k, v]) => {
                    addLeaves(k);
                    addLeaves(v);
                  });
                }
              };

              addLeaves(entry[key]);
              namesByAccount[key] = names;
            }
          });
        };

        (Array.isArray(data) ? data : []).forEach((group) => {
          if (!group || typeof group !== "object") return;
          Object.values(group).forEach(addLevel2);
        });

        setAccountOptions(options);
        setAccountNameOptions(namesByAccount);
        setLeafAccountLookup(leafToAccount);
      } catch {
        if (isMounted) {
          setAccountOptions([]);
          setAccountNameOptions({});
          setLeafAccountLookup({});
        }
      }
    };

    loadAccounts();
    return () => {
      isMounted = false;
    };
  }, []);

  /**
   * Effect: Dynamically adjust scenario select width to fit content
   * Uses canvas text measurement to calculate optimal width for longest scenario name
   */
  useEffect(() => {
    const selectEl = scenarioSelectRef.current;
    if (!selectEl) {
      return;
    }

    const selectStyles = window.getComputedStyle(selectEl);
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) {
      return;
    }

    const font = `${selectStyles.fontWeight} ${selectStyles.fontSize} ${selectStyles.fontFamily}`;
    context.font = font;

    const scenarioNames = (assumptions?.scenarios || []).map(
      (scenario) => scenario.Name
    );
    scenarioNames.push("Select scenario");

    const widest = scenarioNames.reduce(
      (max, name) => Math.max(max, context.measureText(name).width),
      0
    );

    const padding =
      parseFloat(selectStyles.paddingLeft || "0") +
      parseFloat(selectStyles.paddingRight || "0");
    const borders =
      parseFloat(selectStyles.borderLeftWidth || "0") +
      parseFloat(selectStyles.borderRightWidth || "0");
    const arrowSpace = 24;

    selectEl.style.width = `${widest + padding + borders + arrowSpace}px`;
  }, [assumptions]);

  // ========== Computed Values ==========
  /** Details of the currently selected scenario */
  const selectedScenarioDetails = (assumptions?.scenarios || []).find(
    (scenario) => scenario.Name === selectedScenario
  );

  /** Period start date (scenario-specific or global default) */
  const periodStart =
    selectedScenarioDetails?.PeriodStart ?? assumptions?.PeriodStart ?? null;

  /** Period end date (scenario-specific or global default) */
  const periodEnd =
    selectedScenarioDetails?.PeriodEnd ?? assumptions?.PeriodEnd ?? null;

  /**
   * Effect: Load income/expense entries when scenario changes
   * Fetches all forecast entries for the selected scenario
   */
  useEffect(() => {
    if (!selectedScenario) {
      setIncomeExpenseEntries([]);
      setEntriesError("");
      setSelectedEntryId("");
      return;
    }

    let isMounted = true;
    const loadEntries = async () => {
      setEntriesLoading(true);
      try {
        // Using v2 API (PostgreSQL)
        const payload = await Rest.fetchJson(
          `/api/v2/forecast/incomeexpense?scenario=${encodeURIComponent(
            selectedScenario
          )}`
        );
        if (isMounted) {
          setIncomeExpenseEntries(payload?.entries || []);
          setEntriesError("");
          setSelectedEntryId("");
        }
      } catch (err) {
        if (isMounted) {
          setIncomeExpenseEntries([]);
          setEntriesError(
            err.message || "Failed to load forecast income/expense entries"
          );
        }
      } finally {
        if (isMounted) {
          setEntriesLoading(false);
        }
      }
    };

    loadEntries();
    return () => {
      isMounted = false;
    };
  }, [selectedScenario]);

  // ========== Utility Functions ==========
  /**
   * Format date value to display year only
   * Handles dates, numbers, and string formats
   * @param {Date|number|string} value - Date value to format
   * @returns {string} Four-digit year or "—" if invalid
   */
  const formatDate = (value) => {
    if (!value) return "—";
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return String(parsed.getFullYear());
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return String(Math.trunc(value));
    }
    const match = String(value).match(/\d{4}/);
    return match ? match[0] : "—";
  };

  /**
   * Format number with locale-specific formatting
   * @param {number} value - Number to format
   * @returns {string} Formatted number with 2 decimal places or "—" if invalid
   */
  const formatNumber = (value) =>
    typeof value === "number"
      ? value.toLocaleString(undefined, {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })
      : "—";

  /**
   * Format number for table display: no decimals, comma separators, negatives in red brackets
   * @param {number} value - Number to format
   * @returns {string|JSX.Element} Formatted number or placeholder
   */
  const formatTableNumber = (value) => {
    if (typeof value !== "number" || Number.isNaN(value)) {
      return "—";
    }
    const formatted = Math.abs(Math.trunc(value)).toLocaleString(undefined, {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    });
    if (value < 0) {
      return <span style={{ color: "red" }}>{`(${formatted})`}</span>;
    }
    return formatted;
  };

  /**
   * Sorted list of income/expense entries
   * Sorts by Account name, then by Name
   */
  const sortedEntries = useMemo(() => {
    return [...incomeExpenseEntries].sort((a, b) => {
      const accountCompare = (a.Account || "").localeCompare(b.Account || "");
      if (accountCompare !== 0) {
        return accountCompare;
      }
      return (a.Name || "").localeCompare(b.Name || "");
    });
  }, [incomeExpenseEntries]);

  /**
   * Generate unique ID for an entry
   * Uses id if available, otherwise creates composite key
   * @param {Object} entry - Income/expense entry
   * @returns {string} Unique identifier for the entry
   */
  const getEntryId = (entry) =>
    entry?._id || `${entry?.Account || ""}-${entry?.Name || ""}`;

  /**
   * Effect: Auto-select first entry when entries list changes
   * Maintains current selection if still valid
   */
  useEffect(() => {
    setSelectedEntryId((prev) => {
      if (incomeExpenseEntries.some((entry) => getEntryId(entry) === prev)) {
        return prev;
      }
      const first = incomeExpenseEntries[0];
      return first ? getEntryId(first) : "";
    });
  }, [incomeExpenseEntries]);

  /** Currently selected entry object */
  const selectedEntry =
    sortedEntries.find((entry) => getEntryId(entry) === selectedEntryId) ??
    null;

  /**
   * Extract year from various date formats
   * @param {Date|number|string} value - Date value
   * @returns {number|null} Four-digit year or null if invalid
   */
  const getScenarioYear = (value) => {
    const raw = value;
    if (typeof raw === "number" && Number.isFinite(raw)) {
      return Math.trunc(raw);
    }
    const asString = String(raw || "").trim();
    if (!asString) {
      return null;
    }
    const dateValue = new Date(asString);
    if (!Number.isNaN(dateValue.getTime())) {
      return dateValue.getFullYear();
    }
    const match = asString.match(/\d{4}/);
    return match ? Number(match[0]) : null;
  };

  /** @returns {number|null} Start year of current scenario */
  const getScenarioStartYear = () =>
    getScenarioYear(
      selectedScenarioDetails?.PeriodStart ?? assumptions?.PeriodStart
    );

  /** @returns {number|null} End year of current scenario */
  const getScenarioEndYear = () =>
    getScenarioYear(
      selectedScenarioDetails?.PeriodEnd ?? assumptions?.PeriodEnd
    );

  /**
   * Array of years in the scenario period range
   * Used for year selection in changes/adjustments
   */
  const periodYears = useMemo(() => {
    const start = getScenarioStartYear();
    const end = getScenarioEndYear();
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
      return [];
    }
    const years = [];
    for (let year = start; year <= end; year += 1) {
      years.push(year);
    }
    return years;
  }, [assumptions, selectedScenarioDetails]);

  // ========== Event Handlers ==========
  /**
   * Create a new income/expense entry for the current scenario
   * Initializes with default values and refreshes the entries list
   */
  const handleAddIncomeExpense = async () => {
    if (!selectedScenario) {
      return;
    }

    const existingIds = new Set(
      incomeExpenseEntries.map((entry) => getEntryId(entry))
    );
    const prevSelectedId = selectedEntryId;

    const startYear = getScenarioStartYear();
    const baseDate =
      Number.isFinite(startYear) && startYear
        ? new Date(`${startYear - 1}-12-31T00:00:00.000Z`).toISOString()
        : null;

    setEntriesError("");
    setEntriesLoading(true);
    try {
      // Using v2 API (PostgreSQL)
      await Rest.fetchJson("/api/v2/forecast/incomeexpense", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          Scenario: selectedScenario,
          Matched: true,
          Account: "",
          Name: "All",
          Type: "",
          Currency: "USD",
          BaseDate: baseDate,
          BaseValue: 0,
          BaseValueUSD: 0,
          Growth: 1,
          Changes: [],
        }),
      });

      const payload = await Rest.fetchJson(
        `/api/v2/forecast/incomeexpense?scenario=${encodeURIComponent(
          selectedScenario
        )}`
      );
      const nextEntries = payload?.entries || [];
      setIncomeExpenseEntries(nextEntries);

      const newlyCreated =
        nextEntries.find((entry) => !existingIds.has(getEntryId(entry))) ||
        null;
      const nextSelectedId =
        (newlyCreated && getEntryId(newlyCreated)) ||
        (existingIds.has(prevSelectedId) ? prevSelectedId : "") ||
        (nextEntries[0] ? getEntryId(nextEntries[0]) : "");
      setSelectedEntryId(nextSelectedId);
    } catch (err) {
      setEntriesError(err.message || "Failed to add income/expense entry");
    } finally {
      setEntriesLoading(false);
    }
  };

  /**
   * Open delete confirmation modal for selected entry
   */
  const openDeleteModal = () => {
    if (!selectedEntry) return;
    setDeleteError("");
    setShowDeleteModal(true);
  };

  /**
   * Close delete confirmation modal
   * Prevents closing while delete operation is in progress
   */
  const closeDeleteModal = () => {
    if (deleteSaving) return;
    setShowDeleteModal(false);
    setDeleteError("");
  };

  /**
   * Delete the currently selected entry
   * Refreshes the entries list on success
   */
  const handleDeleteEntry = async () => {
    if (!selectedEntry?._id) {
      setDeleteError("Cannot delete entry without an identifier.");
      return;
    }

    setDeleteError("");
    setDeleteSaving(true);
    try {
      // Using v2 API (PostgreSQL)
      await Rest.fetchJson(
        `/api/v2/forecast/incomeexpense/${encodeURIComponent(selectedEntry._id)}`,
        { method: "DELETE" }
      );
      const payload = await Rest.fetchJson(
        `/api/v2/forecast/incomeexpense?scenario=${encodeURIComponent(
          selectedScenario
        )}`
      );
      setIncomeExpenseEntries(payload?.entries || []);
      setShowDeleteModal(false);
    } catch (err) {
      setDeleteError(err.message || "Failed to delete entry");
    } finally {
      setDeleteSaving(false);
    }
  };

  /**
   * Open edit modal for the selected entry
   * Initializes form with current entry values
   */
  const openEditModal = () => {
    if (!selectedEntry) return;
    setEditError("");
    const startYear = getScenarioStartYear();
    const baseDate =
      Number.isFinite(startYear) && startYear
        ? new Date(`${startYear - 1}-12-31T00:00:00.000Z`).toISOString()
        : selectedEntry.BaseDate || "";
    setEditForm({
      ...selectedEntry,
      Scenario: selectedEntry.Scenario || selectedScenario || "",
      Account: selectedEntry.Account || "",
      Name: selectedEntry.Name || "",
      Type: selectedEntry.Type || "",
      Currency: "USD",
      BaseDate: baseDate,
      BaseValue: selectedEntry.BaseValue ?? 0,
      BaseValueUSD: selectedEntry.BaseValueUSD ?? 0,
      Growth:
        selectedEntry.Growth === null || selectedEntry.Growth === undefined
          ? ""
          : selectedEntry.Growth,
      Matched: Boolean(selectedEntry.Matched),
      Comment: selectedEntry.Comment || "",
      Changes: Array.isArray(selectedEntry.Changes)
        ? selectedEntry.Changes.map((change) => ({
            ...change,
            Date: change?.Date
              ? new Date(change.Date).toISOString().slice(0, 10)
              : "",
            Amount:
              change?.Amount === null || change?.Amount === undefined
                ? ""
                : change.Amount,
            Flag: change?.Flag || "",
          }))
        : [],
    });
    setShowEditModal(true);
  };

  /**
   * Close edit modal
   * Prevents closing while save operation is in progress
   */
  const closeEditModal = () => {
    if (editSaving) return;
    setShowEditModal(false);
    setEditForm(null);
    setEditError("");
  };

  /**
   * Update a field in the edit form
   * @param {string} field - Field name to update
   * @param {any} value - New value for the field
   */
  const handleEditFieldChange = (field, value) => {
    setEditForm((prev) => ({ ...(prev || {}), [field]: value }));
  };

  /**
   * Normalize input value to a number or null
   * @param {any} value - Input value
   * @returns {number|null} Numeric value or null
   */
  const normalizeNumber = (value) => {
    if (value === "" || value === null || value === undefined) {
      return null;
    }
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
  };

  /**
   * Normalize changes array, filtering out empty entries
   * @param {Array} changes - Array of change objects
   * @returns {Array} Normalized and filtered changes
   */
  const normalizeChanges = (changes) => {
    if (!Array.isArray(changes)) return [];
    return changes
      .map((change) => {
        const dateValue =
          change?.Date && !Number.isNaN(new Date(change.Date).getTime())
            ? new Date(change.Date).toISOString()
            : null;
        const amountValue = normalizeNumber(change?.Amount);
        const flagValue = (change?.Flag || "").trim();
        if (!dateValue && amountValue === null && !flagValue) {
          return null;
        }
        return {
          Date: dateValue,
          Amount: amountValue,
          Flag: flagValue,
        };
      })
      .filter(Boolean);
  };

  /**
   * Save changes to the edited entry
   * Validates and normalizes data before sending to API
   */
  const handleSaveEdit = async () => {
    if (!selectedEntry?._id || !editForm) {
      return;
    }

    const payload = {
      Scenario: (editForm.Scenario || "").trim(),
      Account: (editForm.Account || "").trim(),
      Name: (editForm.Name || "").trim(),
      Type: (editForm.Type || "").trim(),
      Currency: "USD",
      Matched: Boolean(editForm.Matched),
      BaseDate:
        editForm.BaseDate &&
        !Number.isNaN(new Date(editForm.BaseDate).getTime())
          ? new Date(editForm.BaseDate).toISOString()
          : null,
      BaseValue: normalizeNumber(editForm.BaseValue),
      BaseValueUSD: normalizeNumber(editForm.BaseValueUSD),
      Growth: normalizeNumber(editForm.Growth),
      Comment: (editForm.Comment || "").trim(),
      Changes: normalizeChanges(editForm.Changes),
    };

    setEditError("");
    setEditSaving(true);
    try {
      // Using v2 API (PostgreSQL)
      await Rest.fetchJson(
        `/api/v2/forecast/incomeexpense/${encodeURIComponent(selectedEntry._id)}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );
      const refreshed = await Rest.fetchJson(
        `/api/v2/forecast/incomeexpense?scenario=${encodeURIComponent(
          selectedScenario
        )}`
      );
      setIncomeExpenseEntries(refreshed?.entries || []);
      setShowEditModal(false);
    } catch (err) {
      setEditError(err.message || "Failed to update entry");
    } finally {
      setEditSaving(false);
    }
  };

  /**
   * Effect: Auto-correct Account/Name when Matched mode is enabled
   * Ensures Account and Name values are valid based on COA structure
   */
  useEffect(() => {
    if (!editForm?.Matched) return;
    const account = editForm.Account;
    const name = editForm.Name;

    const ensureAccount =
      accountNameOptions[account] ||
      leafAccountLookup[name] ||
      leafAccountLookup[account] ||
      null;

    const targetAccount =
      typeof ensureAccount === "string"
        ? ensureAccount
        : Array.isArray(ensureAccount)
        ? account
        : account;

    if (targetAccount && targetAccount !== account) {
      setEditForm((prev) =>
        prev ? { ...prev, Account: targetAccount } : prev
      );
      return;
    }

    const names = accountNameOptions[targetAccount] || [];
    const allowAll = name === "All";
    if (names.length && !names.includes(name) && !allowAll) {
      setEditForm((prev) => (prev ? { ...prev, Name: names[0] || "" } : prev));
    }
  }, [
    accountNameOptions,
    editForm?.Account,
    editForm?.Matched,
    editForm?.Name,
    leafAccountLookup,
  ]);

  return (
    <div className="page-shell">
      <NavigationMenu />
      <main className="page-content">
        <FCExpFilter
          assumptions={assumptions}
          error={error}
          isLoading={isLoading}
          onScenarioChange={setSelectedScenario}
          scenarioSelectRef={scenarioSelectRef}
          selectedScenario={selectedScenario}
          periodStart={periodStart}
          periodEnd={periodEnd}
          onAddClick={handleAddIncomeExpense}
          onEditClick={openEditModal}
          onDeleteClick={openDeleteModal}
          addDisabled={!selectedScenario || entriesLoading}
          editDisabled={!selectedScenario || !sortedEntries.length}
          deleteDisabled={!selectedScenario || !sortedEntries.length}
        />
        <div className="exp-setup-sections">
          <FCExpTable
            entriesLoading={entriesLoading}
            entriesError={entriesError}
            selectedScenario={selectedScenario}
            sortedEntries={sortedEntries}
            selectedEntryId={selectedEntryId}
            onSelectEntry={setSelectedEntryId}
            getEntryId={getEntryId}
            formatDate={formatDate}
            formatNumber={formatTableNumber}
            onRowDoubleClick={openEditModal}
          />
          <FCExpTableDetails
            selectedScenario={selectedScenario}
            selectedEntry={selectedEntry}
            formatDate={formatDate}
            formatNumber={formatNumber}
          />
        </div>
      </main>
      <FCExpConfirmDeleteModal
        isOpen={showDeleteModal}
        selectedEntry={selectedEntry}
        error={deleteError}
        isSaving={deleteSaving}
        onClose={closeDeleteModal}
        onConfirm={handleDeleteEntry}
      />
      <FCExpModal
        isOpen={showEditModal}
        editForm={editForm}
        editError={editError}
        editSaving={editSaving}
        onClose={closeEditModal}
        onFieldChange={handleEditFieldChange}
        onSubmit={handleSaveEdit}
        accountOptions={accountOptions}
        accountNameOptions={accountNameOptions}
        periodYears={periodYears}
      />
    </div>
  );
}
