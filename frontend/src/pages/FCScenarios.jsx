/**
 * Forecast Scenarios Management Page
 *
 * This component provides a comprehensive interface for managing forecast scenarios,
 * including inflation rates and foreign exchange (FX) assumptions. Users can create
 * multiple scenarios with different assumptions to model various financial futures.
 *
 * Features:
 * - Create, edit, delete, and copy forecast scenarios
 * - Manage inflation rate assumptions by year
 * - Manage FX rate assumptions (USD/PLN, USD/EUR) by year
 * - Manage tax rate assumptions by scenario
 * - Set scenario time periods (start/end years)
 * - Copy scenarios with all associated data (modules, income/expense entries)
 * - Set default scenario for forecast pages
 * - Commit changes to persist data to the server
 * - Reload default assumptions from the server
 *
 * Data Structure:
 * - Scenarios: { Name, PeriodStart, PeriodEnd }
 * - Inflation: { Scenario, Year, Rate }
 * - FX: { Scenario, Year, Rates: { USDPLN, USDEUR } }
 * - Tax Rate: { Scenario, Rate }
 */

import { useEffect, useState } from "react";
import FCScenariosSelect from "../features/Forecast/FCScenariosSelect.jsx";
import FCScenariosTable from "../features/Forecast/FCScenariosTable.jsx";
import FCScenariosModal from "../features/Forecast/FCScenariosModal.jsx";
import FCExpConfirmDeleteModal from "../features/Forecast/FCExpConfirmDeleteModal.jsx";
import { useToast } from "../contexts";
import Rest from "../js/rest.js";
import "./PageLayout.css";

export default function FCScenarios() {
  const { showSuccess, showError: showErrorToast } = useToast();
  // ============================================================================
  // STATE MANAGEMENT
  // ============================================================================

  /** Full assumptions data loaded from the server */
  const [assumptions, setAssumptions] = useState(null);

  /** Error message to display to the user */
  const [loadError, setLoadError] = useState("");

  /** Loading state for async operations */
  const [isLoading, setIsLoading] = useState(false);

  /** Currently selected scenario name (or "__new_scenario__" for new) */
  const [selectedScenario, setSelectedScenario] = useState("");

  /** Start year for the selected scenario's period */
  const [periodStart, setPeriodStart] = useState("");

  /** End year for the selected scenario's period */
  const [periodEnd, setPeriodEnd] = useState("");

  /** List of all scenario configurations */
  const [scenarios, setScenarios] = useState([]);

  /** Local working copy of inflation assumptions (not yet committed) */
  const [localInflation, setLocalInflation] = useState([]);

  /** Local working copy of FX rate assumptions (not yet committed) */
  const [localFX, setLocalFX] = useState([]);

  /** Local working copy of tax rates by scenario */
  const [localTaxRates, setLocalTaxRates] = useState([]);

  /** Tracks whether there are local changes that need to be committed */
  const [hasPendingChanges, setHasPendingChanges] = useState(false);

  /** Modal state for various dialogs (edit, delete, commit) */
  const [modalState, setModalState] = useState({ type: null, payload: null });

  /** Current calendar year for date calculations */
  const currentYear = new Date().getFullYear();

  // ============================================================================
  // DATA LOADING & PERSISTENCE
  // ============================================================================

  /**
   * Reloads default assumptions from the server
   * Discards any local uncommitted changes and resets to server state
   * If the currently selected scenario no longer exists, selects the first available scenario
   */
  const reloadDefaults = async () => {
    setIsLoading(true);
    try {
      // Using v2 API (PostgreSQL)
        const data = await Rest.fetchJson("/api/v2/forecast/assumptions");
      setAssumptions(data);
      setScenarios(data?.scenarios || []);
      setLocalInflation(data?.inflation || []);
      setLocalFX(data?.FX || []);
      setLocalTaxRates(data?.["Tax Rate"] || []);
      setHasPendingChanges(false);

      // Verify selected scenario still exists after reload
      const scenarioNames = (data?.scenarios || []).map((item) => item.Name);
      if (!scenarioNames.includes(selectedScenario)) {
        setSelectedScenario(scenarioNames[0] || "");
      }

      setLoadError("");
      showSuccess("Defaults reloaded");
    } catch (error) {
      setLoadError(error.message || "Failed to reload defaults");
      showErrorToast(error.message || "Failed to reload defaults");
    } finally {
      setIsLoading(false);
    }
  };

  // ============================================================================
  // EFFECTS
  // ============================================================================

  /**
   * Initial data fetch on component mount
   * Uses isMounted flag to prevent state updates after unmount
   */
  useEffect(() => {
    let isMounted = true;

    const fetchAssumptions = async () => {
      setIsLoading(true);
      try {
        // Using v2 API (PostgreSQL)
        const data = await Rest.fetchJson("/api/v2/forecast/assumptions");
        if (isMounted) {
          setAssumptions(data);
          setScenarios(data?.scenarios || []);
          setLocalInflation(data?.inflation || []);
          setLocalFX(data?.FX || []);
          setLocalTaxRates(data?.["Tax Rate"] || []);
          setHasPendingChanges(false);
          setLoadError("");
        }
      } catch (error) {
        if (isMounted) {
          setAssumptions(null);
          setLoadError(error.message || "Failed to load assumptions");
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };

    fetchAssumptions();

    return () => {
      isMounted = false;
    };
  }, []);

  /**
   * Auto-select the first scenario when scenarios are loaded
   * Only runs if no scenario is currently selected
   */
  useEffect(() => {
    if (!selectedScenario && scenarios.length) {
      setSelectedScenario(scenarios[0].Name ?? "");
    }
  }, [scenarios, selectedScenario]);

  /**
   * Update period start/end when scenario selection changes
   *
   * For new scenarios: Sets a 10-year forward period (currentYear+1 to currentYear+11)
   * For existing scenarios: Uses the scenario's configured period or defaults
   */
  useEffect(() => {
    if (!assumptions) {
      return;
    }

    // Default period ranges
    const newScenarioRange = { start: currentYear + 1, end: currentYear + 11 };
    const defaultRange = { start: currentYear - 3, end: currentYear + 50 };

    // Handle new scenario creation
    if (selectedScenario === "__new_scenario__") {
      setPeriodStart(String(newScenarioRange.start));
      setPeriodEnd(String(newScenarioRange.end));
      return;
    }

    // Load existing scenario's period or use defaults
    const scenario = scenarios.find((item) => item.Name === selectedScenario);
    const startValue =
      scenario?.PeriodStart ?? assumptions.PeriodStart ?? defaultRange.start;
    const endValue =
      scenario?.PeriodEnd ?? assumptions.PeriodEnd ?? defaultRange.end;

    setPeriodStart(String(startValue));
    setPeriodEnd(String(endValue));
  }, [assumptions, selectedScenario, currentYear, scenarios]);

  // ============================================================================
  // COMPUTED VALUES & HELPERS
  // ============================================================================

  /**
   * Generates an array of consecutive years between start and end (inclusive)
   */
  const yearOptions = (start, end) =>
    Array.from({ length: end - start + 1 }, (_, index) => start + index);

  /** Whether the user is creating a new scenario */
  const isNewScenario = selectedScenario === "__new_scenario__";

  /** Available year options for period selection dropdowns */
  const periodYears = yearOptions(
    isNewScenario ? currentYear - 3 : currentYear - 3,
    isNewScenario ? currentYear + 50 : currentYear + 50
  );

  /** Marks the current state as having uncommitted changes */
  const markPendingChanges = () => setHasPendingChanges(true);

  const handlePeriodStartChange = (value) => {
    setPeriodStart(value);
    markPendingChanges();
  };

  const handlePeriodEndChange = (value) => {
    setPeriodEnd(value);
    markPendingChanges();
  };

  /**
   * Sorts array of items by Year property in ascending order
   */
  const sortByYear = (items) =>
    [...items].sort((a, b) => Number(a.Year) - Number(b.Year));

  /** Inflation data for the currently selected scenario, sorted by year */
  const inflationRows = sortByYear(
    (localInflation || []).filter((item) => item.Scenario === selectedScenario)
  );

  /** FX rate data for the currently selected scenario, sorted by year */
  const fxRows = sortByYear(
    (localFX || []).filter((item) => item.Scenario === selectedScenario)
  );

  /** Tax rate for the selected scenario */
  const selectedTaxRate =
    (localTaxRates || []).find((item) => item.Scenario === selectedScenario)
      ?.Rate ?? "";

  /** All unique FX rate keys (e.g., "USDPLN", "USDEUR") across all scenarios */
  const fxKeys = Array.from(
    new Set((localFX || []).flatMap((row) => Object.keys(row.Rates || {})))
  );

  // ============================================================================
  // MODAL MANAGEMENT
  // ============================================================================

  /** Closes any open modal */
  const closeModal = () => setModalState({ type: null, payload: null });

  /**
   * Opens the inflation edit/add modal
   * @param {Object} row - Existing inflation data (null for new entry)
   * @param {boolean} isNew - Whether this is a new entry or editing existing
   */
  const openInflationModal = (row, isNew = false) => {
    setModalState({
      type: "editInflation",
      payload: {
        Year: String(row?.Year ?? currentYear),
        Rate: String(row?.Rate ?? ""),
        isNew,
      },
    });
  };

  /**
   * Opens the FX rate edit/add modal
   * @param {Object} row - Existing FX data (null for new entry)
   * @param {boolean} isNew - Whether this is a new entry or editing existing
   */
  const openFxModal = (row, isNew = false) => {
    setModalState({
      type: "editFX",
      payload: {
        Year: String(row?.Year ?? currentYear),
        Rates: { ...(row?.Rates || {}) },
        isNew,
      },
    });
  };

  /**
   * Opens a deletion confirmation modal
   * @param {string} type - Modal type (deleteInflation, deleteFX, deleteScenario)
   * @param {Object} row - Data to delete
   */
  const openDeleteModal = (type, row) => {
    setModalState({
      type,
      payload: row,
    });
  };

  // ============================================================================
  // INFLATION RATE OPERATIONS
  // ============================================================================

  /**
   * Saves inflation rate (add new or update existing)
   * Updates local state only - changes must be committed to persist
   */
  const saveInflation = () => {
    const payload = modalState.payload;
    const next = [...localInflation];

    // Check if entry already exists for this scenario and year
    const index = next.findIndex(
      (item) =>
        item.Scenario === selectedScenario &&
        Number(item.Year) === Number(payload.Year)
    );

    const entry = {
      Scenario: selectedScenario,
      Year: Number(payload.Year),
      Rate: Number(payload.Rate),
    };

    // Update existing or add new
    if (index >= 0) {
      next[index] = entry;
    } else {
      next.push(entry);
    }

    setLocalInflation(next);
    markPendingChanges();
    closeModal();
  };

  /**
   * Deletes an inflation rate entry
   * Updates local state only - changes must be committed to persist
   */
  const deleteInflation = () => {
    const payload = modalState.payload;
    setLocalInflation((prev) =>
      prev.filter(
        (item) =>
          !(
            item.Scenario === selectedScenario &&
            Number(item.Year) === Number(payload.Year)
          )
      )
    );
    markPendingChanges();
    closeModal();
  };

  // ============================================================================
  // FX RATE OPERATIONS
  // ============================================================================

  /**
   * Saves FX rates (add new or update existing)
   * Converts all rate values to numbers before saving
   * Updates local state only - changes must be committed to persist
   */
  const saveFx = () => {
    const payload = modalState.payload;
    const next = [...localFX];

    // Check if entry already exists for this scenario and year
    const index = next.findIndex(
      (item) =>
        item.Scenario === selectedScenario &&
        Number(item.Year) === Number(payload.Year)
    );

    const entry = {
      Scenario: selectedScenario,
      Year: Number(payload.Year),
      Rates: Object.fromEntries(
        Object.entries(payload.Rates || {}).map(([k, v]) => [k, Number(v)])
      ),
    };

    // Update existing or add new
    if (index >= 0) {
      next[index] = entry;
    } else {
      next.push(entry);
    }

    setLocalFX(next);
    markPendingChanges();
    closeModal();
  };

  /**
   * Deletes an FX rate entry
   * Updates local state only - changes must be committed to persist
   */
  const deleteFx = () => {
    const payload = modalState.payload;
    setLocalFX((prev) =>
      prev.filter(
        (item) =>
          !(
            item.Scenario === selectedScenario &&
            Number(item.Year) === Number(payload.Year)
          )
      )
    );
    markPendingChanges();
    closeModal();
  };

  // ============================================================================
  // TAX RATE OPERATIONS
  // ============================================================================

  /** Ensures a default tax rate exists for new scenarios */
  useEffect(() => {
    if (selectedScenario !== "__new_scenario__") {
      return;
    }
    setLocalTaxRates((prev) => {
      if (prev.some((item) => item.Scenario === "__new_scenario__")) {
        return prev;
      }
      return [...prev, { Scenario: "__new_scenario__", Rate: 25 }];
    });
  }, [selectedScenario]);

  /**
   * Updates tax rate for the selected scenario
   * Adds a new entry if one does not exist
   */
  const updateTaxRate = (value) => {
    if (!selectedScenario) {
      return;
    }
    setLocalTaxRates((prev) => {
      const next = [...prev];
      const index = next.findIndex(
        (item) => item.Scenario === selectedScenario
      );
      const entry = { Scenario: selectedScenario, Rate: value };
      if (index >= 0) {
        next[index] = { ...next[index], ...entry };
      } else {
        next.push(entry);
      }
      return next;
    });
    markPendingChanges();
  };

  // ============================================================================
  // SCENARIO OPERATIONS
  // ============================================================================

  /**
   * Sets the currently selected scenario as the default for other forecast pages.
   * Stores the scenario name in localStorage to persist across sessions.
   */
  const makeDefaultScenario = () => {
    if (selectedScenario && selectedScenario !== "__new_scenario__") {
      localStorage.setItem("forecast_default_scenario", selectedScenario);
    }
  };

  /**
   * Deletes a scenario and all its associated data
   * Removes the scenario from scenarios list and removes all inflation/FX data
   * If deleting the currently selected scenario, switches to the first available scenario
   * Updates local state only - changes must be committed to persist
   */
  const deleteScenario = async () => {
    const name = modalState.payload?.Name;
   if (!name) {
      closeModal();
      return;
    }

    const encodedName = encodeURIComponent(name);

    // Attempt to delete scenario-linked modules/inc-exp on the server
    // Using v2 API (PostgreSQL) with scenario name
    try {
      await Rest.fetchJson(`/api/v2/forecast/scenarios/byname/${encodedName}`, {
        method: "DELETE",
      });
    } catch (error) {
      console.error(
        "Failed to delete scenario-related modules/inc-exp:",
        error
      );
    }

    // Delete audit trail files for this scenario
    // Using v2 API
    try {
      await Rest.fetchJson(`/api/v2/forecast/audittrail/${encodedName}`, {
        method: "DELETE",
      });
    } catch (error) {
      console.error(
        `Failed to delete audit trail files for scenario "${name}":`,
        error
      );
    }

    // Remove scenario from list
    setScenarios((prev) => {
      const filtered = prev.filter((s) => s.Name !== name);

      // If we deleted the selected scenario, select another one
      if (selectedScenario === name) {
        setSelectedScenario(filtered[0]?.Name || "__new_scenario__");
      }

      return filtered;
    });

    // Update assumptions object
    setAssumptions((prev) =>
      prev
        ? {
            ...prev,
            scenarios: prev.scenarios?.filter((s) => s.Name !== name),
            "Tax Rate": (prev["Tax Rate"] || []).filter(
              (item) => item.Scenario !== name
            ),
          }
        : prev
    );

    // Remove all inflation and FX data for this scenario
    setLocalInflation((prev) => prev.filter((item) => item.Scenario !== name));
    setLocalFX((prev) => prev.filter((item) => item.Scenario !== name));
    setLocalTaxRates((prev) => prev.filter((item) => item.Scenario !== name));

    showSuccess(`Scenario "${name}" deleted`);
    closeModal();
  };

  // ============================================================================
  // COMMIT OPERATIONS
  // ============================================================================

  /**
   * Initiates the commit process
   * For new scenarios: Opens modal to name the scenario
   * For existing scenarios: Opens confirmation modal
   */
  const confirmCommit = () => {
    if (selectedScenario === "__new_scenario__") {
      setModalState({ type: "nameScenario", payload: { Name: "" } });
      return;
    }
    setModalState({ type: "commit", payload: { hasPendingChanges } });
  };

  /**
   * Commits all local changes to the server
   * Persists scenario configurations, inflation rates, and FX rates
   *
   * @param {string} newScenarioName - Name for new scenario (only used when creating)
   *
   * For new scenarios:
   * - Creates new scenario with the provided name
   * - Renames all "__new_scenario__" entries to the actual scenario name
   *
   * For existing scenarios:
   * - Updates period start/end values
   * - Saves all inflation and FX changes
   */
  const commitChanges = async (newScenarioName) => {
    if (!assumptions) {
      closeModal();
      return;
    }

    const isCreatingNew = selectedScenario === "__new_scenario__";
    const scenarioName = isCreatingNew ? newScenarioName : selectedScenario;

    if (isCreatingNew && !scenarioName) {
      return;
    }

    // Prepare period values
    const periodValues = {
      PeriodStart: Number(periodStart),
      PeriodEnd: Number(periodEnd),
    };

    // Update scenarios list (add new or update existing)
    const updatedScenarios = isCreatingNew
      ? [...scenarios, { Name: scenarioName, ...periodValues }]
      : scenarios.map((scenario) =>
          scenario.Name === selectedScenario
            ? { ...scenario, ...periodValues }
            : scenario
        );

    // For new scenarios, rename all "__new_scenario__" entries to actual name
    const updatedInflation = isCreatingNew
      ? localInflation.map((item) =>
          item.Scenario === "__new_scenario__"
            ? { ...item, Scenario: scenarioName }
            : item
        )
      : localInflation;

    const updatedFx = isCreatingNew
      ? localFX.map((item) =>
          item.Scenario === "__new_scenario__"
            ? { ...item, Scenario: scenarioName }
            : item
        )
      : localFX;

    const updatedTaxRates = isCreatingNew
      ? localTaxRates.map((item) =>
          item.Scenario === "__new_scenario__"
            ? { ...item, Scenario: scenarioName }
            : item
        )
      : localTaxRates;

    const normalizedTaxRates = updatedTaxRates.map((item) => {
      const numericRate = Number(item.Rate);
      return {
        Scenario: item.Scenario,
        Rate: Number.isFinite(numericRate) ? numericRate : 0,
      };
    });

    try {
      // Persist to server using v2 API (PostgreSQL)
      await Rest.fetchJson("/api/v2/forecast/assumptions", {
        method: "PUT",
        body: JSON.stringify({
          ...assumptions,
          scenarios: updatedScenarios,
          inflation: updatedInflation,
          FX: updatedFx,
          "Tax Rate": normalizedTaxRates,
        }),
        headers: { "Content-Type": "application/json" },
      });

      // Update local state to match server
      setScenarios(updatedScenarios);
      setLocalInflation(updatedInflation);
      setLocalFX(updatedFx);
      setLocalTaxRates(normalizedTaxRates);

      if (isCreatingNew) {
        setSelectedScenario(scenarioName);
      }

      setAssumptions((prev) =>
        prev
          ? {
              ...prev,
              scenarios: updatedScenarios,
              inflation: updatedInflation,
              FX: updatedFx,
              "Tax Rate": normalizedTaxRates,
            }
          : prev
      );
      setHasPendingChanges(false);
      showSuccess("Changes committed successfully");

      closeModal();
    } catch (error) {
      setLoadError(error.message || "Failed to commit changes");
      showErrorToast(error.message || "Failed to commit changes");
      closeModal();
    }
  };

  /**
   * Commits a new scenario after the user provides a name
   * Validates the name is not empty before committing
   */
  const commitNewScenario = () => {
    const name = (modalState.payload?.Name || "").trim();
    if (!name) {
      return;
    }
    commitChanges(name);
  };

  /**
   * Clears audit trail files for the selected scenario
   * Deletes any audit trail CSV whose filename starts with the scenario name
   */
  const clearAuditTrail = async () => {
    if (!selectedScenario || selectedScenario === "__new_scenario__") {
      return;
    }

    setIsLoading(true);
    try {
      // Using v2 API (PostgreSQL)
      const encoded = encodeURIComponent(selectedScenario);
      await Rest.fetchJson(`/api/v2/forecast/audittrail/${encoded}`, {
        method: "DELETE",
      });
      setLoadError("");
      showSuccess("Audit trail cleared");
    } catch (error) {
      setLoadError(error.message || "Failed to clear audit trail");
      showErrorToast(error.message || "Failed to clear audit trail");
    } finally {
      setIsLoading(false);
    }
  };

  // ============================================================================
  // SCENARIO COPY OPERATIONS
  // ============================================================================

  /**
   * Opens the copy scenario modal
   * Prompts the user for a new scenario name
   */
  const openCopyScenarioModal = () => {
    if (selectedScenario && selectedScenario !== "__new_scenario__") {
      setModalState({
        type: "copyScenario",
        payload: {
          sourceScenario: selectedScenario,
          newScenarioName: "",
        },
      });
    }
  };

  /**
   * Copies the current scenario with all its data
   * Creates a new scenario with copied assumptions, modules, and inc/exp entries
   */
  const copyScenario = async () => {
    const sourceScenario = modalState.payload?.sourceScenario;
    const newScenarioName = (modalState.payload?.newScenarioName || "").trim();

    if (!sourceScenario || !newScenarioName) {
      return;
    }

    setIsLoading(true);

    try {
      // Find the source scenario configuration
      const sourceScenarioConfig = scenarios.find(
        (s) => s.Name === sourceScenario
      );

      if (!sourceScenarioConfig) {
        setLoadError("Source scenario not found");
        closeModal();
        setIsLoading(false);
        return;
      }

      // Copy scenario configuration
      const newScenarioConfig = {
        Name: newScenarioName,
        PeriodStart: sourceScenarioConfig.PeriodStart,
        PeriodEnd: sourceScenarioConfig.PeriodEnd,
      };

      // Copy inflation data
      const copiedInflation = localInflation
        .filter((item) => item.Scenario === sourceScenario)
        .map((item) => ({ ...item, Scenario: newScenarioName }));

      // Copy FX data
      const copiedFX = localFX
        .filter((item) => item.Scenario === sourceScenario)
        .map((item) => ({ ...item, Scenario: newScenarioName }));

      // Copy tax rate
      const sourceTaxRate = localTaxRates.find(
        (item) => item.Scenario === sourceScenario
      );
      const copiedTaxRate = sourceTaxRate
        ? { ...sourceTaxRate, Scenario: newScenarioName }
        : { Scenario: newScenarioName, Rate: 25 };

      // Update scenarios list
      const updatedScenarios = [...scenarios, newScenarioConfig];
      const updatedInflation = [...localInflation, ...copiedInflation];
      const updatedFX = [...localFX, ...copiedFX];
      const updatedTaxRates = [...localTaxRates, copiedTaxRate];

      // Save to server using v2 API (PostgreSQL)
      await Rest.fetchJson("/api/v2/forecast/assumptions", {
        method: "PUT",
        body: JSON.stringify({
          ...assumptions,
          scenarios: updatedScenarios,
          inflation: updatedInflation,
          FX: updatedFX,
          "Tax Rate": updatedTaxRates,
        }),
        headers: { "Content-Type": "application/json" },
      });

      // Copy modules and inc/exp entries via the v2 backend API
      const encoded = encodeURIComponent(sourceScenario);
      await Rest.fetchJson(`/api/v2/forecast/scenarios/byname/${encoded}/copy`, {
        method: "POST",
        body: JSON.stringify({ newScenarioName }),
        headers: { "Content-Type": "application/json" },
      });

      // Update local state
      setScenarios(updatedScenarios);
      setLocalInflation(updatedInflation);
      setLocalFX(updatedFX);
      setLocalTaxRates(updatedTaxRates);
      setAssumptions((prev) =>
        prev
          ? {
              ...prev,
              scenarios: updatedScenarios,
              inflation: updatedInflation,
              FX: updatedFX,
              "Tax Rate": updatedTaxRates,
            }
          : prev
      );
      setHasPendingChanges(false);

      // Select the newly created scenario
      setSelectedScenario(newScenarioName);
      showSuccess(`Scenario copied as "${newScenarioName}"`);

      closeModal();
    } catch (error) {
      setLoadError(error.message || "Failed to copy scenario");
      showErrorToast(error.message || "Failed to copy scenario");
    } finally {
      setIsLoading(false);
    }
  };

  // ============================================================================
  // RENDER
  // ============================================================================

  const scenarioDeleteOpen = modalState.type === "deleteScenario";
  const scenarioDeleteName = modalState.payload?.Name || selectedScenario;
  const commitOpen = modalState.type === "commit";
  const commitScenarioName = selectedScenario;
  const commitWarning = hasPendingChanges
    ? "Uncommitted changes detected. Committing will overwrite server assumptions for this scenario."
    : "This will overwrite server assumptions for this scenario.";

  return (
    <>
      <main className="page-main trans-budget-main">
        {/* Header section with scenario selection and actions */}
        <FCScenariosSelect
          assumptions={assumptions}
          loadError={loadError}
          scenarios={scenarios}
          selectedScenario={selectedScenario}
          setSelectedScenario={setSelectedScenario}
          periodStart={periodStart}
          setPeriodStart={handlePeriodStartChange}
          periodEnd={periodEnd}
          setPeriodEnd={handlePeriodEndChange}
          periodYears={periodYears}
          confirmCommit={confirmCommit}
          reloadDefaults={reloadDefaults}
          clearAuditTrail={clearAuditTrail}
          openDeleteModal={openDeleteModal}
          isLoading={isLoading}
          taxRate={String(selectedTaxRate ?? "")}
          setTaxRate={updateTaxRate}
          makeDefaultScenario={makeDefaultScenario}
          onCopyScenario={openCopyScenarioModal}
          hasPendingChanges={hasPendingChanges}
        />

        {/* Data tables for inflation and FX assumptions */}
        <FCScenariosTable
          inflationRows={inflationRows}
          fxRows={fxRows}
          fxKeys={fxKeys}
          openInflationModal={openInflationModal}
          openDeleteModal={openDeleteModal}
          openFxModal={openFxModal}
          isLoading={isLoading}
          selectedScenario={selectedScenario}
        />

        {/* Modal dialogs for editing, deleting, and committing */}
        {!scenarioDeleteOpen && !commitOpen && (
          <FCScenariosModal
            modalState={modalState}
            closeModal={closeModal}
            saveInflation={saveInflation}
            deleteInflation={deleteInflation}
            saveFx={saveFx}
            deleteFx={deleteFx}
            deleteScenario={deleteScenario}
            commitNewScenario={commitNewScenario}
            commitChanges={commitChanges}
            setModalState={setModalState}
            fxKeys={fxKeys}
            copyScenario={copyScenario}
          />
        )}
        <FCExpConfirmDeleteModal
          isOpen={commitOpen}
          selectedEntry={{ Name: commitScenarioName }}
          error=""
          isSaving={false}
          onClose={closeModal}
          onConfirm={() => commitChanges()}
          title="Commit Changes"
          itemLabel={commitScenarioName || "this scenario"}
          description="Save all changes to scenarios, inflation, and FX data?"
          warning={commitWarning}
          confirmLabel="Commit"
          confirmBusyLabel="Committing..."
          context={
            commitScenarioName ? `Scenario: ${commitScenarioName}` : undefined
          }
        />
        <FCExpConfirmDeleteModal
          isOpen={scenarioDeleteOpen}
          selectedEntry={{ Name: scenarioDeleteName }}
          error=""
          isSaving={false}
          onClose={closeModal}
          onConfirm={deleteScenario}
          title="Delete Scenario"
          itemLabel={scenarioDeleteName || "this scenario"}
          context="This removes the scenario, its inflation/FX assumptions, and deletes related modules and income/expense entries."
        />
      </main>
    </>
  );
}
