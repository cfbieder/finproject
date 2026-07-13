import { useEffect, useRef, useState } from "react";
import FCModulesFilter from "../features/Forecast/FCModulesFilter.jsx";
import FCModulesEditModal from "../features/Forecast/FCModulesEdit.jsx";
import FCModulesTable from "../features/Forecast/FCModulesTable.jsx";
import FCExpConfirmDeleteModal from "../features/Forecast/FCExpConfirmDeleteModal.jsx";
import FCModulesUnmatchedModal from "../features/Forecast/FCModulesUnmatchedModal.jsx";
import FCAddFromActualsModal from "../features/Forecast/FCAddFromActualsModal.jsx";
import { useAssumptions } from "../features/Forecast/hooks/useAssumptions.js";
import { useModules } from "../features/Forecast/hooks/useModules.js";
import { useUnmatchedItems } from "../features/Forecast/hooks/useUnmatchedItems.js";
import {
  formatTransferForm,
  normalizeTransfers,
} from "../features/Forecast/utils/fcModuleManageUtils.js";
import Rest from "../js/rest.js";
import FCStepNav from "../features/Forecast/FCStepNav.jsx";
import { useCoa } from "../hooks/useCoa.js";
import "./PageLayout.css";
import "../features/Forecast/FCModulesEdit.css";
import "../features/Forecast/FCExpDeleteModal.css";
import { buildModulePayload } from "../features/Forecast/utils/fcModulePayload.js";

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
  // Load COA data from PostgreSQL
  const {
    traits,
    bsLevel2Options,
    getChildCategoriesForAccount,
    traitDefaults,
  } = useCoa();

  // Load module types from appdata
  const [moduleTypes, setModuleTypes] = useState(null);
  useEffect(() => {
    Rest.fetchAppDataV2().then((data) => {
      const doc = Array.isArray(data) && data.length > 0 ? data[0] : data;
      if (Array.isArray(doc?.moduleTypes) && doc.moduleTypes.length > 0) {
        setModuleTypes(doc.moduleTypes);
      }
    }).catch(() => {});
  }, []);

  const traitsWithModuleTypes = { ...traits, moduleTypes };

  // Custom hooks for data loading
  const {
    assumptions,
    selectedScenario,
    setSelectedScenario,
    isLoading,
    error,
  } = useAssumptions();

  const {
    modules,
    selectedModuleId,
    setSelectedModuleId,
    selectedModule,
    loading: modulesLoading,
    error: modulesError,
    reload: reloadModules,
    getModuleId,
  } = useModules(selectedScenario);

  const {
    unmatchedItems,
    loading: unmatchedLoading,
    error: unmatchedError,
    loadUnmatched,
    clear: clearUnmatched,
  } = useUnmatchedItems();

  // Scenario selection ref for auto-sizing
  const scenarioSelectRef = useRef(null);

  // Edit modal state
  const [showEditModal, setShowEditModal] = useState(false);
  const [editForm, setEditForm] = useState(null);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState("");
  const [editRefreshToken, setEditRefreshToken] = useState(0);

  // Delete modal state
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteSaving, setDeleteSaving] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  // Add from Actuals modal state
  const [showAddFromActualsModal, setShowAddFromActualsModal] = useState(false);

  // Unmatched modal state
  const [showUnmatchedModal, setShowUnmatchedModal] = useState(false);
  const [selectedUnmatchedItem, setSelectedUnmatchedItem] = useState(null);
  const [creatingFromUnmatched, setCreatingFromUnmatched] = useState(false);
  const [pendingSelectInfo, setPendingSelectInfo] = useState(null);

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

  const getScenarioStartYear = () => {
    const periodStartRaw =
      selectedScenarioDetails?.PeriodStart ?? assumptions?.PeriodStart ?? "";
    if (typeof periodStartRaw === "number") {
      return Number.isFinite(periodStartRaw)
        ? Math.trunc(periodStartRaw)
        : null;
    }
    const asString = String(periodStartRaw || "").trim();
    const dateFromString =
      asString && !Number.isNaN(new Date(asString).getTime())
        ? new Date(asString).getFullYear()
        : null;
    if (Number.isFinite(dateFromString) && dateFromString >= 1000) {
      return dateFromString;
    }
    const match = asString.match(/\d{4}/);
    return match ? Number(match[0]) : null;
  };

  /**
   * After a create call, watch for the next modules reload and auto-select the
   * first module that did not exist before the create.
   */
  useEffect(() => {
    if (!pendingSelectInfo) {
      return;
    }

    if (pendingSelectInfo.scenario !== selectedScenario) {
      setPendingSelectInfo(null);
      return;
    }

    const previousIds = new Set(pendingSelectInfo.prevIds || []);
    const currentIds = modules
      .map((module) => getModuleId(module))
      .filter(Boolean);
    const newIds = currentIds.filter((id) => !previousIds.has(id));

    if (newIds.length) {
      setSelectedModuleId(newIds[0]);
      setPendingSelectInfo(null);
    }
  }, [modules, selectedScenario, pendingSelectInfo, setSelectedModuleId]);

  const handleCreateNewModule = async () => {
    if (!selectedScenario) {
      return;
    }

    const existingIds = modules
      .map((module) => getModuleId(module))
      .filter(Boolean);
    const periodStartYear = getScenarioStartYear();
    const baseDate =
      Number.isFinite(periodStartYear) && periodStartYear
        ? new Date(`${periodStartYear - 1}-12-31T00:00:00.000Z`).toISOString()
        : null;
    try {
      await Rest.fetchJson("/api/v2/forecast/modules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          Scenario: selectedScenario,
          Matched: false,
          Account: "",
          Name: "",
          Type: traitDefaults.Type,
          Currency: traitDefaults.Currency,
          BaseDate: baseDate,
          // (BaseYear removed with CR043 N10: there is no such column and POST /modules
          //  never read it — it was a dead key, silently dropped on every create. The
          //  engine derives the base year from BaseDate.)
          BaseValue: 0,
          MarketValue: 0,
          BaseValueUSD: 0,
          MarketValueUSD: 0,
          Growth: null,
          Invest: [],
          Dispose: [],
          IncomePct: [],
        }),
      });

      setPendingSelectInfo({
        scenario: selectedScenario,
        prevIds: existingIds,
      });
      reloadModules();
    } catch (err) {
      console.error("Failed to create module:", err);
      setPendingSelectInfo(null);
    }
  };

  /**
   * Opens the edit modal with the selected module's data.
   * Formats dates and transfer arrays for form display.
   */
  const openEditModal = async (moduleToEdit) => {
    // If moduleToEdit is an event object or not provided, use selectedModule
    const isEvent =
      moduleToEdit &&
      typeof moduleToEdit === "object" &&
      "nativeEvent" in moduleToEdit;
    const moduleData = isEvent || !moduleToEdit ? selectedModule : moduleToEdit;
    if (!moduleData) return;

    setEditError("");

    // Fetch full module data with nested arrays (IncomePct, Invest, Dispose)
    let fullModule = moduleData;
    if (moduleData.id) {
      try {
        const res = await Rest.get(`/forecast/modules/${moduleData.id}`);
        if (res.data) fullModule = { ...moduleData, ...res.data };
      } catch (err) {
        // Fall back to list data if single-module fetch fails
        console.warn("Could not load full module data:", err.message);
      }
    }

    const normalizedModule = {
      ...fullModule,
      BaseValue: fullModule.BaseValue ?? 0,
      BaseValueUSD: fullModule.BaseValueUSD ?? 0,
      MarketValue: fullModule.MarketValue ?? 0,
      MarketValueUSD: fullModule.MarketValueUSD ?? 0,
    };

    setEditForm({
      ...normalizedModule,
      BaseDate: normalizedModule.BaseDate
        ? new Date(normalizedModule.BaseDate).toISOString().slice(0, 10)
        : "",
      Matched: Boolean(normalizedModule.Matched ?? normalizedModule.IsMatched ?? normalizedModule.is_matched),
      Comment: normalizedModule.Comment || "",
      Invest: formatTransferForm(normalizedModule.Invest),
      Dispose: formatTransferForm(normalizedModule.Dispose),
      IncomePct: formatTransferForm(normalizedModule.IncomePct),
    });
    setEditRefreshToken((prev) => prev + 1);
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
      if (field === "Matched") {
        return prev;
      }
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
  /**
   * Core save logic — builds payload and PUTs to API.
   * Returns true on success, false on failure.
   */
  const saveModule = async () => {
    if (!selectedModule || !editForm) return false;

    const moduleId = selectedModule.id;
    if (!moduleId) {
      setEditError("Cannot edit this module because it has no id.");
      return false;
    }

    const payload = buildModulePayload(editForm, { normalizeTransfers });

    setEditSaving(true);
    try {
      await Rest.fetchJson(`/api/v2/forecast/modules/${moduleId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      reloadModules();
      return true;
    } catch (err) {
      setEditError(err.message || "Failed to update module");
      return false;
    } finally {
      setEditSaving(false);
    }
  };

  const handleSaveEdit = async (event) => {
    event.preventDefault();
    const ok = await saveModule();
    if (ok) closeEditModal();
  };

  /**
   * Opens the delete confirmation modal for the selected module.
   */
  const openDeleteModal = () => {
    if (!selectedModule) return;
    setDeleteError("");
    setShowDeleteModal(true);
  };

  /**
   * Closes the delete confirmation modal.
   */
  const closeDeleteModal = () => {
    if (deleteSaving) return;
    setShowDeleteModal(false);
    setDeleteError("");
  };

  /**
   * Deletes the currently selected module after confirmation.
   * Removes the module from local state to keep the UI in sync.
   */
  const handleDeleteModule = async () => {
    if (!selectedModule) return;
    const moduleId = selectedModule.id;
    if (!moduleId) {
      setDeleteError("Cannot delete this module because it has no id.");
      return;
    }
    setDeleteSaving(true);
    try {
      await Rest.fetchJson(`/api/v2/forecast/modules/${moduleId}`, {
        method: "DELETE",
      });
      reloadModules();
      setShowDeleteModal(false);
    } catch (err) {
      setDeleteError(err.message || "Failed to delete module");
    } finally {
      setDeleteSaving(false);
    }
  };

  const openUnmatchedModal = async () => {
    if (!selectedScenario) {
      return;
    }
    setSelectedUnmatchedItem(null);
    setShowUnmatchedModal(true);
    await loadUnmatched(selectedScenario);
  };

  const closeUnmatchedModal = () => {
    setShowUnmatchedModal(false);
    setSelectedUnmatchedItem(null);
    clearUnmatched();
  };

  const handleCreateFromUnmatched = async () => {
    if (!selectedScenario || !selectedUnmatchedItem) {
      return;
    }
    const existingIds = modules
      .map((module) => getModuleId(module))
      .filter(Boolean);
    setCreatingFromUnmatched(true);
    try {
      const selectedItem =
        typeof selectedUnmatchedItem === "string"
          ? { name: selectedUnmatchedItem, category: "" }
          : selectedUnmatchedItem;
      const moduleName = selectedItem?.name;
      if (!moduleName) {
        throw new Error("No unmatched item selected");
      }
      const account = selectedItem?.category || moduleName;
      const periodStartYear = getScenarioStartYear();
      const baseDate =
        Number.isFinite(periodStartYear) && periodStartYear
          ? new Date(`${periodStartYear - 1}-12-31T00:00:00.000Z`).toISOString()
          : null;

      // Get Type and Currency from COA traits if available
      const moduleTraits = traits?.[moduleName] || {};
      const moduleType = moduleTraits.Type || "";
      const moduleCurrency = moduleTraits.Currency || "USD";

      await Rest.fetchJson("/api/v2/forecast/modules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          Scenario: selectedScenario,
          Account: account,
          Name: moduleName,
          Type: moduleType,
          Currency: moduleCurrency,
          BaseDate: baseDate,
          Matched: true,
          IncomePct: [],
          Invest: [],
          Dispose: [],
        }),
      });
      setPendingSelectInfo({
        scenario: selectedScenario,
        prevIds: existingIds,
      });
      reloadModules();
      closeUnmatchedModal();
    } catch (err) {
      console.error("Failed to create module from unmatched:", err);
      setPendingSelectInfo(null);
    } finally {
      setCreatingFromUnmatched(false);
    }
  };

  return (
    <>
      <main className="page-main trans-budget-main fc-modules-main">
        <FCStepNav />
        <FCModulesFilter
          assumptions={assumptions}
          error={error}
          isLoading={isLoading}
          onScenarioChange={setSelectedScenario}
          onNewClick={handleCreateNewModule}
          onEditClick={openEditModal}
          onDeleteClick={openDeleteModal}
          onUnmatchedClick={openUnmatchedModal}
          onSeedClick={() => setShowAddFromActualsModal(true)}
          scenarioSelectRef={scenarioSelectRef}
          selectedScenario={selectedScenario}
          selectedScenarioDetails={selectedScenarioDetails}
          unmatchedDisabled={!selectedScenario}
          seedDisabled={!selectedScenario}
          hasSelectedModule={Boolean(selectedModule)}
          newDisabled={!selectedScenario || modulesLoading || isLoading}
        />
        <FCModulesTable
          getModuleId={getModuleId}
          modules={modules}
          modulesError={modulesError}
          modulesLoading={modulesLoading}
          onSelectModule={setSelectedModuleId}
          onRowDoubleClick={openEditModal}
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
          refreshToken={editRefreshToken}
          traits={traitsWithModuleTypes}
          bsLevel2Options={bsLevel2Options}
          getChildCategoriesForAccount={getChildCategoriesForAccount}
          allModules={modules}
          scenarioName={selectedScenario}
          onSave={saveModule}
        />
        <FCExpConfirmDeleteModal
          isOpen={showDeleteModal}
          selectedEntry={selectedModule}
          error={deleteError}
          isSaving={deleteSaving}
          onClose={closeDeleteModal}
          onConfirm={handleDeleteModule}
          title="Delete Module"
          itemLabel={
            selectedModule?.Name || selectedModule?.Account || "this module"
          }
          context={selectedScenario ? `Scenario: ${selectedScenario}` : ""}
        />
        <FCModulesUnmatchedModal
          isOpen={showUnmatchedModal}
          unmatchedItems={unmatchedItems}
          selectedItem={selectedUnmatchedItem}
          loading={unmatchedLoading}
          creating={creatingFromUnmatched}
          error={unmatchedError}
          onClose={closeUnmatchedModal}
          onSelectItem={setSelectedUnmatchedItem}
          onCreate={handleCreateFromUnmatched}
        />
        <FCAddFromActualsModal
          isOpen={showAddFromActualsModal}
          onClose={() => setShowAddFromActualsModal(false)}
          scenario={selectedScenario}
          onAdded={reloadModules}
        />
      </main>
    </>
  );
}
