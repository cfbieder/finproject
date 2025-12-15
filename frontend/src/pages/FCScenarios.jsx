/**
 * Forecast Scenarios Management Page
 *
 * This component provides a comprehensive interface for managing forecast scenarios,
 * including inflation rates and foreign exchange (FX) assumptions. Users can create
 * multiple scenarios with different assumptions to model various financial futures.
 *
 * Features:
 * - Create, edit, and delete forecast scenarios
 * - Manage inflation rate assumptions by year
 * - Manage FX rate assumptions (USD/PLN, USD/EUR) by year
 * - Set scenario time periods (start/end years)
 * - Commit changes to persist data to the server
 * - Reload default assumptions from the server
 *
 * Data Structure:
 * - Scenarios: { Name, PeriodStart, PeriodEnd }
 * - Inflation: { Scenario, Year, Rate }
 * - FX: { Scenario, Year, Rates: { USDPLN, USDEUR } }
 */

import { useEffect, useState } from "react";
import NavigationMenu from "../components/NavigationMenu.jsx";
import FCScenariosSelect from "../features/Forecast/FCScenariosSelect.jsx";
import FCScenariosTable from "../features/Forecast/FCScenariosTable.jsx";
import FCScenariosModal from "../features/Forecast/FCScenariosModal.jsx";
import Rest from "../js/rest.js";
import "./PageLayout.css";

export default function FCScenarios() {
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
      const data = await Rest.fetchJson("/api/forecast/assumptions");
      setAssumptions(data);
      setScenarios(data?.scenarios || []);
      setLocalInflation(data?.inflation || []);
      setLocalFX(data?.FX || []);

      // Verify selected scenario still exists after reload
      const scenarioNames = (data?.scenarios || []).map((item) => item.Name);
      if (!scenarioNames.includes(selectedScenario)) {
        setSelectedScenario(scenarioNames[0] || "");
      }

      setLoadError("");
    } catch (error) {
      setLoadError(error.message || "Failed to reload defaults");
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
        const data = await Rest.fetchJson("/api/forecast/assumptions");
        if (isMounted) {
          setAssumptions(data);
          setScenarios(data?.scenarios || []);
          setLocalInflation(data?.inflation || []);
          setLocalFX(data?.FX || []);
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
    isNewScenario ? currentYear + 1 : currentYear - 3,
    isNewScenario ? currentYear + 11 : currentYear + 50
  );

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
    closeModal();
  };

  // ============================================================================
  // SCENARIO OPERATIONS
  // ============================================================================

  /**
   * Deletes a scenario and all its associated data
   * Removes the scenario from scenarios list and removes all inflation/FX data
   * If deleting the currently selected scenario, switches to the first available scenario
   * Updates local state only - changes must be committed to persist
   */
  const deleteScenario = () => {
    const name = modalState.payload?.Name;
    if (!name) {
      closeModal();
      return;
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
        ? { ...prev, scenarios: prev.scenarios?.filter((s) => s.Name !== name) }
        : prev
    );

    // Remove all inflation and FX data for this scenario
    setLocalInflation((prev) => prev.filter((item) => item.Scenario !== name));
    setLocalFX((prev) => prev.filter((item) => item.Scenario !== name));

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
    setModalState({ type: "commit" });
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

    try {
      // Persist to server
      await Rest.fetchJson("/api/forecast/assumptions", {
        method: "PUT",
        body: JSON.stringify({
          ...assumptions,
          scenarios: updatedScenarios,
          inflation: updatedInflation,
          FX: updatedFx,
        }),
        headers: { "Content-Type": "application/json" },
      });

      // Update local state to match server
      setScenarios(updatedScenarios);
      setLocalInflation(updatedInflation);
      setLocalFX(updatedFx);

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
            }
          : prev
      );

      closeModal();
    } catch (error) {
      setLoadError(error.message || "Failed to commit changes");
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

  // ============================================================================
  // RENDER
  // ============================================================================

  return (
    <div className="page-shell">
      <NavigationMenu />
      <main className="page-main trans-budget-main">
        {/* Header section with scenario selection and actions */}
        <FCScenariosSelect
          assumptions={assumptions}
          loadError={loadError}
          scenarios={scenarios}
          selectedScenario={selectedScenario}
          setSelectedScenario={setSelectedScenario}
          periodStart={periodStart}
          setPeriodStart={setPeriodStart}
          periodEnd={periodEnd}
          setPeriodEnd={setPeriodEnd}
          periodYears={periodYears}
          confirmCommit={confirmCommit}
          reloadDefaults={reloadDefaults}
          openDeleteModal={openDeleteModal}
          isLoading={isLoading}
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
        />
      </main>
    </div>
  );
}
