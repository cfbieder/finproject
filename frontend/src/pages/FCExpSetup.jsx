import { useState } from "react";
import FCExpConfirmDeleteModal from "../features/Forecast/FCExpConfirmDeleteModal.jsx";
import FCExpModal from "../features/Forecast/FCExpModal.jsx";
import FCExpFilter from "../features/Forecast/FCExpFilter.jsx";
import FCAddFromLinesModal from "../features/Forecast/FCAddFromLinesModal.jsx";
import FCExpTable from "../features/Forecast/FCExpTable.jsx";
import FCExpTableDetails from "../features/Forecast/FCExpTableDetails.jsx";
import { useFCExpAssumptions } from "../features/Forecast/hooks/useFCExpAssumptions.js";
import { useFCExpAccountHierarchy } from "../features/Forecast/hooks/useFCExpAccountHierarchy.js";
import { useFCExpEntries } from "../features/Forecast/hooks/useFCExpEntries.js";
import { useFCExpCrud } from "../features/Forecast/hooks/useFCExpCrud.js";
import "../features/Forecast/FCModulesFilter.css";
import FCStepNav from "../features/Forecast/FCStepNav.jsx";
import "./PageLayout.css";
import "./FCExpSetup.css";

const formatDate = (value) => {
  if (!value) return "—";
  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) return String(parsed.getFullYear());
  if (typeof value === "number" && Number.isFinite(value))
    return String(Math.trunc(value));
  const match = String(value).match(/\d{4}/);
  return match ? match[0] : "—";
};

const formatNumber = (value) =>
  typeof value === "number"
    ? value.toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
    : "—";

const formatTableNumber = (value) => {
  const num = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(num)) return "—";
  const formatted = Math.abs(Math.trunc(num)).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
  if (num < 0) {
    return <span className="text--negative">{`(${formatted})`}</span>;
  }
  return formatted;
};

export default function FCExpSetup() {
  const {
    assumptions,
    selectedScenario,
    setSelectedScenario,
    error,
    isLoading,
    scenarioSelectRef,
    periodStart,
    periodEnd,
    periodYears,
    getScenarioStartYear,
  } = useFCExpAssumptions();

  const { accountOptions, accountNameOptions, leafAccountLookup } =
    useFCExpAccountHierarchy();

  const {
    setIncomeExpenseEntries,
    entriesLoading,
    entriesError,
    selectedEntryId,
    setSelectedEntryId,
    sortedEntries,
    selectedEntry,
    getEntryId,
    handleAddIncomeExpense,
  } = useFCExpEntries(selectedScenario, getScenarioStartYear);

  const {
    showDeleteModal,
    deleteSaving,
    deleteError,
    openDeleteModal,
    closeDeleteModal,
    handleDeleteEntry,
    showEditModal,
    editForm,
    editSaving,
    editError,
    openEditModal,
    closeEditModal,
    handleEditFieldChange,
    handleSaveEdit,
  } = useFCExpCrud(
    selectedScenario,
    selectedEntry,
    setIncomeExpenseEntries,
    getScenarioStartYear,
    accountNameOptions,
    leafAccountLookup
  );

  const [showAddFromLinesModal, setShowAddFromLinesModal] = useState(false);
  const [statusFilter, setStatusFilter] = useState("all");

  const filteredEntries = statusFilter === "all"
    ? sortedEntries
    : sortedEntries.filter((e) => (e.SetupStatus || "new") === statusFilter);

  const reloadEntries = () => {
    // Trigger re-fetch by toggling scenario
    const current = selectedScenario;
    setSelectedScenario("");
    setTimeout(() => setSelectedScenario(current), 50);
  };

  return (
    <>
      <main className="page-content">
        <FCStepNav />
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
          onAddFromLinesClick={() => setShowAddFromLinesModal(true)}
          addFromLinesDisabled={!selectedScenario}
          statusFilter={statusFilter}
          onStatusFilterChange={setStatusFilter}
        />
        <div className="exp-setup-sections">
          <FCExpTable
            entriesLoading={entriesLoading}
            entriesError={entriesError}
            selectedScenario={selectedScenario}
            sortedEntries={filteredEntries}
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
      <FCAddFromLinesModal
        isOpen={showAddFromLinesModal}
        onClose={() => setShowAddFromLinesModal(false)}
        scenario={selectedScenario}
        existingEntries={sortedEntries}
        onAdded={reloadEntries}
      />
    </>
  );
}
