import { useEffect, useRef, useState } from "react";
import NavigationMenu from "../components/NavigationMenu.jsx";
import FCModulesFilter from "../features/Forecast/FCModulesFilter.jsx";
import FCModulesEditModal from "../features/Forecast/FCModulesEdit.jsx";
import FCModulesTable from "../features/Forecast/FCModulesTable.jsx";
import Rest from "../js/rest.js";
import "./PageLayout.css";
import "../features/Forecast/FCModules.css";

/**
 * Formats transfer entries for the edit form by ensuring consistent date formatting.
 * Extracts year from date and formats as YYYY-07-01 for fiscal year convention.
 *
 * @param {Array<Object>} transfers - Array of transfer objects with Date, Amount, and Flag properties
 * @returns {Array<Object>} Formatted transfer array with normalized dates
 */
const formatTransferForm = (transfers) => {
  if (!Array.isArray(transfers)) {
    return [];
  }
  return transfers.map((entry) => {
    const date = entry?.Date ? new Date(entry.Date) : null;
    const year =
      date && !Number.isNaN(date.getTime()) ? date.getFullYear() : null;
    return {
      Date: year ? `${year}-07-01` : "",
      Amount: entry?.Amount ?? "",
      Flag: entry?.Flag ?? "",
    };
  });
};

/**
 * Normalizes transfer data for API submission by validating dates and amounts.
 * Filters out invalid entries and ensures proper data types.
 *
 * @param {Array<Object>} transfers - Array of transfer objects to normalize
 * @returns {Array<Object>} Validated transfer array with ISO date strings and numeric amounts
 */
const normalizeTransfers = (transfers) => {
  if (!Array.isArray(transfers)) {
    return [];
  }
  return transfers
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return null;
      }
      const dateValue = entry.Date ? new Date(entry.Date) : null;
      const date =
        dateValue && !Number.isNaN(dateValue.getTime())
          ? dateValue.toISOString()
          : null;
      const rawAmount = entry.Amount;
      const parsedAmount =
        rawAmount === "" || rawAmount === null || rawAmount === undefined
          ? null
          : Number(rawAmount);
      const amount = Number.isNaN(parsedAmount) ? null : parsedAmount;
      const flag = entry.Flag ?? "";
      if (!date || (amount === null && !flag)) {
        return null;
      }
      return { Date: date, Amount: amount, Flag: flag };
    })
    .filter(Boolean);
};

/**
 * FCModuleManage component manages forecast modules for different scenarios.
 *
 * Features:
 * - Loads and displays forecast assumptions and scenarios
 * - Filters modules by selected scenario
 * - Dynamic scenario selector with auto-sizing based on content
 * - Module selection and detail viewing
 * - Edit modal for updating module properties (account, type, values, transfers)
 * - Real-time data synchronization with backend API
 *
 * State management:
 * - Assumptions: Forecast scenarios and configuration
 * - Modules: Filtered list of forecast modules for selected scenario
 * - Selection: Currently selected module and scenario
 * - Edit modal: Form state for editing module details
 *
 * @component
 * @returns {JSX.Element} The forecast module management page
 */
export default function FCModuleManage() {
  // Assumptions state
  const [assumptions, setAssumptions] = useState(null);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  // Scenario selection
  const [selectedScenario, setSelectedScenario] = useState("");
  const scenarioSelectRef = useRef(null);

  // Modules state
  const [modules, setModules] = useState([]);
  const [modulesError, setModulesError] = useState("");
  const [modulesLoading, setModulesLoading] = useState(false);
  const [selectedModuleId, setSelectedModuleId] = useState("");

  // Edit modal state
  const [showEditModal, setShowEditModal] = useState(false);
  const [editForm, setEditForm] = useState(null);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState("");

  /**
   * Loads forecast assumptions from the API on component mount.
   * Handles cleanup to prevent state updates on unmounted component.
   */
  useEffect(() => {
    let isMounted = true;
    const loadAssumptions = async () => {
      setIsLoading(true);
      try {
        const data = await Rest.fetchJson("/api/forecast/assumptions");
        if (isMounted) {
          setAssumptions(data);
          setError("");
        }
      } catch (err) {
        if (isMounted) {
          setError(err.message || "Failed to load assumptions");
          setAssumptions(null);
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
   * Updates selected scenario when assumptions load or change.
   * Preserves previous selection if still valid, otherwise defaults to first scenario.
   */
  useEffect(() => {
    const availableScenarios = assumptions?.scenarios || [];
    if (!availableScenarios.length) {
      setSelectedScenario("");
      return;
    }

    setSelectedScenario((prev) => {
      if (
        prev &&
        availableScenarios.some((scenario) => scenario.Name === prev)
      ) {
        return prev;
      }
      return availableScenarios[0].Name || "";
    });
  }, [assumptions]);

  /**
   * Dynamically adjusts scenario select width to fit content.
   * Measures text width using canvas and sets element width accordingly.
   * Ensures dropdown arrow has sufficient space.
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

  /**
   * Retrieves currently selected scenario details from assumptions.
   */
  const selectedScenarioDetails = (assumptions?.scenarios || []).find(
    (scenario) => scenario.Name === selectedScenario
  );

  /**
   * Generates a unique identifier for a module.
   * Attempts multiple ID fields before falling back to composite key.
   *
   * @param {Object} module - The module object
   * @returns {string} Unique module identifier
   */
  const getModuleId = (module) =>
    module?._id ??
    module?.id ??
    module?.Id ??
    `${module?.Scenario ?? "module"}-${module?.Account ?? module?.Name ?? ""}`;

  /**
   * Loads modules for the selected scenario from the API.
   * Filters results by scenario and updates selected module if needed.
   */
  useEffect(() => {
    if (!selectedScenario) {
      setModules([]);
      setSelectedModuleId("");
      setModulesError("");
      setModulesLoading(false);
      return;
    }

    let isMounted = true;
    const loadModules = async () => {
      setModulesLoading(true);
      try {
        const data = await Rest.fetchJson("/api/forecast/modules");
        if (!isMounted) return;
        const filtered = (data || []).filter(
          (entry) => entry?.Scenario === selectedScenario
        );
        setModules(filtered);
        setModulesError("");
        setSelectedModuleId((prev) => {
          if (filtered.some((entry) => getModuleId(entry) === prev)) {
            return prev;
          }
          const firstId = filtered[0] ? getModuleId(filtered[0]) : "";
          return firstId || "";
        });
      } catch (err) {
        if (!isMounted) return;
        setModules([]);
        setModulesError(err.message || "Failed to load modules");
        setSelectedModuleId("");
      } finally {
        if (isMounted) {
          setModulesLoading(false);
        }
      }
    };

    loadModules();
    return () => {
      isMounted = false;
    };
  }, [selectedScenario]);

  /**
   * Retrieves the currently selected module object.
   */
  const selectedModule =
    modules.find((module) => getModuleId(module) === selectedModuleId) ?? null;

  /**
   * Opens the edit modal with the selected module's data.
   * Formats dates and transfer arrays for form display.
   */
  const openEditModal = () => {
    if (!selectedModule) return;
    setEditError("");
    setEditForm({
      ...selectedModule,
      BaseDate: selectedModule.BaseDate
        ? new Date(selectedModule.BaseDate).toISOString().slice(0, 10)
        : "",
      Matched: Boolean(selectedModule.Matched),
      Invest: formatTransferForm(selectedModule.Invest),
      Dispose: formatTransferForm(selectedModule.Dispose),
    });
    setShowEditModal(true);
  };

  /**
   * Closes the edit modal and clears form state.
   */
  const closeEditModal = () => {
    setShowEditModal(false);
    setEditForm(null);
    setEditError("");
  };

  /**
   * Updates a single field in the edit form.
   * Clears Name field when Account changes to maintain consistency.
   *
   * @param {string} field - The field name to update
   * @param {*} value - The new field value
   */
  const handleEditFieldChange = (field, value) => {
    setEditForm((prev) => {
      if (field === "Account") {
        return { ...prev, Account: value, Name: "" };
      }
      return {
        ...prev,
        [field]: value,
      };
    });
  };

  /**
   * Submits the edit form to update the selected module via API.
   * Validates module ID, formats numeric fields, normalizes transfers, and updates local state on success.
   *
   * @param {Event} event - Form submit event
   */
  const handleSaveEdit = async (event) => {
    event.preventDefault();
    if (!selectedModule || !editForm) return;

    const moduleId = selectedModule._id || selectedModule.id || selectedModule.Id;
    if (!moduleId) {
      setEditError("Cannot edit this module because it has no id.");
      return;
    }

    // Define numeric fields that need special handling
    const numericFields = [
      "Expense",
      "ExpensePct",
      "Income",
      "IncomePct",
      "BaseValue",
      "MarketValue",
      "BaseValueUSD",
      "MarketValueUSD",
      "Growth",
    ];

    // Build base payload with string and boolean fields
    const payload = {
      Account: editForm.Account ?? "",
      Name: editForm.Name ?? "",
      Type: editForm.Type ?? "",
      Currency: editForm.Currency ?? "",
      ExpCategory: editForm.ExpCategory ?? "",
      IncomeCategory: editForm.IncomeCategory ?? "",
      Matched: Boolean(editForm.Matched),
      BaseDate: editForm.BaseDate
        ? new Date(editForm.BaseDate).toISOString()
        : null,
      AccountNumber: editForm.AccountNumber ?? "",
    };

    // Process numeric fields with validation
    for (const field of numericFields) {
      const raw = editForm[field];
      const parsed = raw === "" || raw === null || raw === undefined
        ? null
        : Number(raw);
      payload[field] = Number.isNaN(parsed) ? null : parsed;
    }

    // Normalize and add transfer arrays
    payload.Invest = normalizeTransfers(editForm.Invest);
    payload.Dispose = normalizeTransfers(editForm.Dispose);

    setEditSaving(true);
    try {
      const response = await Rest.fetchJson(`/api/forecast/modules/${moduleId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const updatedModule = response?.module ?? { ...selectedModule, ...payload };
      setModules((prev) =>
        prev.map((module) =>
          getModuleId(module) === moduleId ? { ...module, ...updatedModule } : module
        )
      );
      setSelectedModuleId(moduleId);
      closeEditModal();
    } catch (err) {
      setEditError(err.message || "Failed to update module");
    } finally {
      setEditSaving(false);
    }
  };

  return (
    <div className="page-shell">
      <NavigationMenu />
      <main className="page-main trans-budget-main">
        <FCModulesFilter
          assumptions={assumptions}
          error={error}
          isLoading={isLoading}
          onScenarioChange={setSelectedScenario}
          onEditClick={openEditModal}
          scenarioSelectRef={scenarioSelectRef}
          selectedScenario={selectedScenario}
          selectedScenarioDetails={selectedScenarioDetails}
          hasSelectedModule={Boolean(selectedModule)}
        />
        <FCModulesTable
          getModuleId={getModuleId}
          modules={modules}
          modulesError={modulesError}
          modulesLoading={modulesLoading}
          onSelectModule={setSelectedModuleId}
          selectedModule={selectedModule}
          selectedModuleId={selectedModuleId}
        />
        <FCModulesEditModal
          isOpen={showEditModal}
          editForm={editForm}
          editError={editError}
          editSaving={editSaving}
          onClose={closeEditModal}
          onFieldChange={handleEditFieldChange}
          onSubmit={handleSaveEdit}
        />
      </main>
    </div>
  );
}
