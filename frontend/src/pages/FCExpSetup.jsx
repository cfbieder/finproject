import { useEffect, useMemo, useRef, useState } from "react";
import NavigationMenu from "../components/NavigationMenu.jsx";
import Rest from "../js/rest.js";
import "../features/Forecast/FCModulesFilter.css";
import "./PageLayout.css";

export default function FCExpSetup() {
  const [assumptions, setAssumptions] = useState(null);
  const [selectedScenario, setSelectedScenario] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [entriesLoading, setEntriesLoading] = useState(false);
  const [entriesError, setEntriesError] = useState("");
  const [incomeExpenseEntries, setIncomeExpenseEntries] = useState([]);
  const [selectedEntryId, setSelectedEntryId] = useState("");
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteSaving, setDeleteSaving] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [showEditModal, setShowEditModal] = useState(false);
  const [editForm, setEditForm] = useState(null);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState("");
  const scenarioSelectRef = useRef(null);

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

  const selectedScenarioDetails = (assumptions?.scenarios || []).find(
    (scenario) => scenario.Name === selectedScenario
  );

  const periodStart =
    selectedScenarioDetails?.PeriodStart ?? assumptions?.PeriodStart ?? null;
  const periodEnd =
    selectedScenarioDetails?.PeriodEnd ?? assumptions?.PeriodEnd ?? null;

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
        const payload = await Rest.fetchJson(
          `/api/forecast/incomeexpense?scenario=${encodeURIComponent(
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

  const formatNumber = (value) =>
    typeof value === "number"
      ? value.toLocaleString(undefined, {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })
      : "—";

  const sortedEntries = useMemo(() => {
    return [...incomeExpenseEntries].sort((a, b) => {
      const accountCompare = (a.Account || "").localeCompare(b.Account || "");
      if (accountCompare !== 0) {
        return accountCompare;
      }
      return (a.Name || "").localeCompare(b.Name || "");
    });
  }, [incomeExpenseEntries]);

  const getEntryId = (entry) =>
    entry?._id || `${entry?.Account || ""}-${entry?.Name || ""}`;

  useEffect(() => {
    setSelectedEntryId((prev) => {
      if (incomeExpenseEntries.some((entry) => getEntryId(entry) === prev)) {
        return prev;
      }
      const first = incomeExpenseEntries[0];
      return first ? getEntryId(first) : "";
    });
  }, [incomeExpenseEntries]);

  const selectedEntry =
    sortedEntries.find((entry) => getEntryId(entry) === selectedEntryId) ??
    null;

  const getScenarioStartYear = () => {
    const raw = selectedScenarioDetails?.PeriodStart ?? assumptions?.PeriodStart;
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

  const handleAddIncomeExpense = async () => {
    if (!selectedScenario) {
      return;
    }

    const startYear = getScenarioStartYear();
    const baseDate =
      Number.isFinite(startYear) && startYear
        ? new Date(`${startYear - 1}-12-31T00:00:00.000Z`).toISOString()
        : null;

    setEntriesError("");
    setEntriesLoading(true);
    try {
      await Rest.fetchJson("/api/forecast/incomeexpense", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          Scenario: selectedScenario,
          Matched: false,
          Account: "",
          Name: "",
          Type: "",
          Currency: "",
          BaseDate: baseDate,
          BaseValue: 0,
          BaseValueUSD: 0,
          Growth: 1,
          Changes: [],
        }),
      });

      const payload = await Rest.fetchJson(
        `/api/forecast/incomeexpense?scenario=${encodeURIComponent(
          selectedScenario
        )}`
      );
      setIncomeExpenseEntries(payload?.entries || []);
    } catch (err) {
      setEntriesError(err.message || "Failed to add income/expense entry");
    } finally {
      setEntriesLoading(false);
    }
  };

  const openDeleteModal = () => {
    if (!selectedEntry) return;
    setDeleteError("");
    setShowDeleteModal(true);
  };

  const closeDeleteModal = () => {
    if (deleteSaving) return;
    setShowDeleteModal(false);
    setDeleteError("");
  };

  const handleDeleteEntry = async () => {
    if (!selectedEntry?._id) {
      setDeleteError("Cannot delete entry without an identifier.");
      return;
    }

    setDeleteError("");
    setDeleteSaving(true);
    try {
      await Rest.fetchJson(
        `/api/forecast/incomeexpense/${encodeURIComponent(selectedEntry._id)}`,
        { method: "DELETE" }
      );
      const payload = await Rest.fetchJson(
        `/api/forecast/incomeexpense?scenario=${encodeURIComponent(
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

  const openEditModal = () => {
    if (!selectedEntry) return;
    setEditError("");
    setEditForm({
      ...selectedEntry,
      Scenario: selectedEntry.Scenario || selectedScenario || "",
      Account: selectedEntry.Account || "",
      Name: selectedEntry.Name || "",
      Type: selectedEntry.Type || "",
      Currency: selectedEntry.Currency || "",
      BaseDate: selectedEntry.BaseDate
        ? new Date(selectedEntry.BaseDate).toISOString().slice(0, 10)
        : "",
      BaseValue: selectedEntry.BaseValue ?? 0,
      BaseValueUSD: selectedEntry.BaseValueUSD ?? 0,
      Growth:
        selectedEntry.Growth === null || selectedEntry.Growth === undefined
          ? ""
          : selectedEntry.Growth,
      Matched: Boolean(selectedEntry.Matched),
    });
    setShowEditModal(true);
  };

  const closeEditModal = () => {
    if (editSaving) return;
    setShowEditModal(false);
    setEditForm(null);
    setEditError("");
  };

  const handleEditFieldChange = (field, value) => {
    setEditForm((prev) => ({ ...(prev || {}), [field]: value }));
  };

  const normalizeNumber = (value) => {
    if (value === "" || value === null || value === undefined) {
      return null;
    }
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
  };

  const handleSaveEdit = async () => {
    if (!selectedEntry?._id || !editForm) {
      return;
    }

    const payload = {
      Scenario: (editForm.Scenario || "").trim(),
      Account: (editForm.Account || "").trim(),
      Name: (editForm.Name || "").trim(),
      Type: (editForm.Type || "").trim(),
      Currency: (editForm.Currency || "").trim(),
      Matched: Boolean(editForm.Matched),
      BaseDate:
        editForm.BaseDate && !Number.isNaN(new Date(editForm.BaseDate).getTime())
          ? new Date(editForm.BaseDate).toISOString()
          : null,
      BaseValue: normalizeNumber(editForm.BaseValue),
      BaseValueUSD: normalizeNumber(editForm.BaseValueUSD),
      Growth: normalizeNumber(editForm.Growth),
    };

    setEditError("");
    setEditSaving(true);
    try {
      await Rest.fetchJson(
        `/api/forecast/incomeexpense/${encodeURIComponent(selectedEntry._id)}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );
      const refreshed = await Rest.fetchJson(
        `/api/forecast/incomeexpense?scenario=${encodeURIComponent(
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

  return (
    <div className="page-shell">
      <NavigationMenu />
      <main className="page-content">
        <section className="exp-setup-filter section-filters fc-modules-filter">
          <div className="section-table__content">
            {isLoading && (
              <div className="fc-modules-filter__loading">
                <div className="fc-modules-filter__spinner" />
                <p>Loading scenarios...</p>
              </div>
            )}
            {error && !isLoading && (
              <div className="fc-modules-filter__error">
                <span className="fc-modules-filter__error-icon">⚠</span>
                <p>{error}</p>
              </div>
            )}
            {!isLoading && !error && assumptions && (
              <div className="fc-modules-filter__content">
                <div className="fc-modules-filter__row">
                  <div className="fc-modules-filter__field">
                    <label
                      htmlFor="fc-exp-scenario-select"
                      className="fc-modules-filter__label"
                    >
                      Scenario
                    </label>
                    <select
                      id="fc-exp-scenario-select"
                      className="form-input fc-modules-filter__select"
                      ref={scenarioSelectRef}
                      value={selectedScenario}
                      onChange={(event) =>
                        setSelectedScenario(event.target.value)
                      }
                      disabled={!assumptions?.scenarios?.length}
                    >
                      <option value="" disabled>
                        Select scenario
                      </option>
                      {(assumptions?.scenarios || []).map((scenario) => (
                        <option key={scenario.Name} value={scenario.Name}>
                          {scenario.Name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="fc-modules-filter__actions">
                    <div className="fc-modules-filter__actions-grid">
                      {[
                        {
                          label: "Add",
                          icon: "+",
                          disabled: !selectedScenario || entriesLoading,
                          onClick: handleAddIncomeExpense,
                          success: true,
                        },
                        {
                          label: "Edit",
                          icon: "✎",
                          disabled: !selectedScenario || !sortedEntries.length,
                          onClick: openEditModal,
                          primary: !!selectedScenario && !!sortedEntries.length,
                        },
                        {
                          label: "Delete",
                          icon: "×",
                          disabled: !selectedScenario || !sortedEntries.length,
                          onClick: openDeleteModal,
                          danger: true,
                        },
                      ].map(
                        ({
                          label,
                          icon,
                          disabled,
                          onClick,
                          primary,
                          danger,
                          success,
                        }) => (
                          <button
                            key={label}
                            type="button"
                            className={`fc-modules-filter__action-btn ${
                              primary
                                ? "fc-modules-filter__action-btn--primary"
                                : ""
                            } ${
                              danger
                                ? "fc-modules-filter__action-btn--danger"
                                : ""
                            } ${
                              success
                                ? "fc-modules-filter__action-btn--success"
                                : ""
                            }`}
                            disabled={disabled}
                            onClick={onClick}
                          >
                            <span className="fc-modules-filter__action-icon">
                              {icon}
                            </span>
                            {label}
                          </button>
                        )
                      )}
                    </div>
                  </div>
                </div>

                {(periodStart || periodEnd) && (
                  <div className="fc-modules-filter__period">
                    <div className="fc-modules-filter__period-item">
                      <span className="fc-modules-filter__period-label">
                        Period Start
                      </span>
                      <span className="fc-modules-filter__period-value">
                        {periodStart ?? "—"}
                      </span>
                    </div>
                    <div className="fc-modules-filter__period-item">
                      <span className="fc-modules-filter__period-label">
                        Period End
                      </span>
                      <span className="fc-modules-filter__period-value">
                        {periodEnd ?? "—"}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </section>
        <div className="exp-setup-sections">
          <section
            className="exp-setup-table section-table"
            aria-label="Forecast income and expense"
          >
            <div className="section-table__content">
              <h3>Forecast Income/Expense</h3>
              <div className="trans-budget-table-wrapper">
                {entriesLoading ? (
                  <p className="trans-budget-table__message">
                    Loading forecast income/expense entries...
                  </p>
                ) : entriesError ? (
                  <p className="trans-budget-table__message trans-budget-table__message--error">
                    {entriesError}
                  </p>
                ) : !selectedScenario ? (
                  <p className="trans-budget-table__message">
                    Select a scenario to view forecast income/expense entries.
                  </p>
                ) : !sortedEntries.length ? (
                  <p className="trans-budget-table__message">
                    No forecast income/expense entries to display.
                  </p>
                ) : (
                  <table className="trans-budget-table">
                    <thead>
                      <tr>
                        <th>Account</th>
                        <th>Name</th>
                        <th>Type</th>
                        <th>Base Date</th>
                        <th className="trans-budget-table__value">
                          Base Value (USD)
                        </th>
                        <th className="trans-budget-table__value">Growth</th>
                        <th>Matched</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedEntries.map((entry) => (
                        <tr
                          key={getEntryId(entry)}
                          className={`trans-budget-table__row ${
                            getEntryId(entry) === selectedEntryId
                              ? "trans-budget-table__row--selected"
                              : ""
                          }`}
                          onClick={() => setSelectedEntryId(getEntryId(entry))}
                        >
                          <td className="trans-budget-table__value">
                            {entry.Account || "—"}
                          </td>
                          <td className="trans-budget-table__value">
                            {entry.Name || "—"}
                          </td>
                          <td className="trans-budget-table__value">
                            {entry.Type || "—"}
                          </td>
                          <td className="trans-budget-table__value">
                            {formatDate(entry.BaseDate)}
                          </td>
                          <td className="trans-budget-table__value trans-budget-table__value--numeric">
                            {formatNumber(entry.BaseValueUSD)}
                          </td>
                          <td className="trans-budget-table__value trans-budget-table__value--numeric">
                            {typeof entry.Growth === "number"
                              ? `${entry.Growth.toFixed(2)}%`
                              : "—"}
                          </td>
                          <td className="trans-budget-table__value">
                            {entry.Matched ? "Yes" : "No"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </section>
          <section
            className="exp-setup-table section-table"
            aria-label="Income and expense details"
          >
            <div className="section-table__content">
              <h3>Income/Expense Details</h3>
              <div className="trans-budget-table-wrapper">
                {!selectedScenario ? (
                  <p className="trans-budget-table__message">
                    Select a scenario to view income/expense details.
                  </p>
                ) : !selectedEntry ? (
                  <p className="trans-budget-table__message">
                    Choose an income/expense entry to see details.
                  </p>
                ) : (
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                      gap: "0.75rem 1rem",
                      padding: "0.25rem 0",
                    }}
                  >
                    <div>
                      <strong>Account:</strong> {selectedEntry.Account || "—"}
                    </div>
                    <div>
                      <strong>Name:</strong> {selectedEntry.Name || "—"}
                    </div>
                    <div>
                      <strong>Type:</strong> {selectedEntry.Type || "—"}
                    </div>
                    <div>
                      <strong>Currency:</strong> {selectedEntry.Currency || "—"}
                    </div>
                    <div>
                      <strong>Base Date:</strong>{" "}
                      {formatDate(selectedEntry.BaseDate)}
                    </div>
                    <div>
                      <strong>Base Value:</strong>{" "}
                      {formatNumber(selectedEntry.BaseValue)}
                    </div>
                    <div>
                      <strong>Base Value (USD):</strong>{" "}
                      {formatNumber(selectedEntry.BaseValueUSD)}
                    </div>
                    <div>
                      <strong>Growth:</strong>{" "}
                      {typeof selectedEntry.Growth === "number"
                        ? `${selectedEntry.Growth.toFixed(2)}%`
                        : "—"}
                    </div>
                    <div>
                      <strong>Changes:</strong>{" "}
                      {Array.isArray(selectedEntry.Changes)
                        ? selectedEntry.Changes.length
                        : 0}
                    </div>
                    <div>
                      <strong>Matched:</strong>{" "}
                      {selectedEntry.Matched ? "Yes" : "No"}
                    </div>
                    <div>
                      <strong>Scenario:</strong>{" "}
                      {selectedEntry.Scenario || selectedScenario || "—"}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </section>
        </div>
      </main>
      {showDeleteModal && (
        <div
          className="fc-scenarios-modal-overlay"
          onClick={closeDeleteModal}
        >
          <div
            className="fc-scenarios-modal"
            onClick={(event) => event.stopPropagation()}
          >
            <h3 className="fc-scenarios-modal__title">Delete Entry</h3>
            <p className="fc-scenarios-modal__description">
              {`Delete ${
                selectedEntry?.Name || selectedEntry?.Account || "this entry"
              }? This action cannot be undone.`}
            </p>
            {deleteError && (
              <div className="trans-budget-edit-modal__error">{deleteError}</div>
            )}
            <div className="fc-scenarios-modal__actions">
              <button
                type="button"
                className="fc-scenarios-action-button"
                onClick={closeDeleteModal}
                disabled={deleteSaving}
              >
                Cancel
              </button>
              <button
                type="button"
                className="fc-scenarios-action-button fc-scenarios-action-button--danger"
                onClick={handleDeleteEntry}
                disabled={deleteSaving}
              >
                {deleteSaving ? "Deleting..." : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
      {showEditModal && (
        <div className="fc-scenarios-modal-overlay" onClick={closeEditModal}>
          <div
            className="fc-scenarios-modal"
            onClick={(event) => event.stopPropagation()}
          >
            <h3 className="fc-scenarios-modal__title">Edit Entry</h3>
            <div className="fc-scenarios-modal__field">
              <span>Scenario</span>
              <input
                className="form-input"
                type="text"
                value={editForm?.Scenario || ""}
                onChange={(e) =>
                  handleEditFieldChange("Scenario", e.target.value)
                }
              />
            </div>
            <div className="fc-scenarios-modal__field">
              <span>Account</span>
              <input
                className="form-input"
                type="text"
                value={editForm?.Account || ""}
                onChange={(e) =>
                  handleEditFieldChange("Account", e.target.value)
                }
              />
            </div>
            <div className="fc-scenarios-modal__field">
              <span>Name</span>
              <input
                className="form-input"
                type="text"
                value={editForm?.Name || ""}
                onChange={(e) => handleEditFieldChange("Name", e.target.value)}
              />
            </div>
            <div className="fc-scenarios-modal__field">
              <span>Type</span>
              <input
                className="form-input"
                type="text"
                value={editForm?.Type || ""}
                onChange={(e) => handleEditFieldChange("Type", e.target.value)}
              />
            </div>
            <div className="fc-scenarios-modal__field">
              <span>Currency</span>
              <input
                className="form-input"
                type="text"
                value={editForm?.Currency || ""}
                onChange={(e) =>
                  handleEditFieldChange("Currency", e.target.value)
                }
              />
            </div>
            <div className="fc-scenarios-modal__field">
              <span>Base Date</span>
              <input
                className="form-input"
                type="date"
                value={editForm?.BaseDate || ""}
                onChange={(e) =>
                  handleEditFieldChange("BaseDate", e.target.value)
                }
              />
            </div>
            <div className="fc-scenarios-modal__field">
              <span>Base Value</span>
              <input
                className="form-input"
                type="number"
                step="0.01"
                value={
                  editForm?.BaseValue === null || editForm?.BaseValue === undefined
                    ? ""
                    : editForm.BaseValue
                }
                onChange={(e) =>
                  handleEditFieldChange("BaseValue", e.target.value)
                }
              />
            </div>
            <div className="fc-scenarios-modal__field">
              <span>Base Value (USD)</span>
              <input
                className="form-input"
                type="number"
                step="0.01"
                value={
                  editForm?.BaseValueUSD === null ||
                  editForm?.BaseValueUSD === undefined
                    ? ""
                    : editForm.BaseValueUSD
                }
                onChange={(e) =>
                  handleEditFieldChange("BaseValueUSD", e.target.value)
                }
              />
            </div>
            <div className="fc-scenarios-modal__field">
              <span>Growth (%)</span>
              <input
                className="form-input"
                type="number"
                step="0.01"
                value={
                  editForm?.Growth === null || editForm?.Growth === undefined
                    ? ""
                    : editForm.Growth
                }
                onChange={(e) =>
                  handleEditFieldChange("Growth", e.target.value)
                }
              />
            </div>
            <label
              className="fc-scenarios-modal__field"
              style={{ flexDirection: "row", alignItems: "center", gap: "0.6rem" }}
            >
              <input
                type="checkbox"
                checked={Boolean(editForm?.Matched)}
                onChange={(e) =>
                  handleEditFieldChange("Matched", e.target.checked)
                }
              />
              <span>Matched</span>
            </label>
            {editError && (
              <div className="trans-budget-edit-modal__error">{editError}</div>
            )}
            <div className="fc-scenarios-modal__actions">
              <button
                type="button"
                className="fc-scenarios-action-button"
                onClick={closeEditModal}
                disabled={editSaving}
              >
                Cancel
              </button>
              <button
                type="button"
                className="fc-scenarios-action-button fc-scenarios-action-button--primary"
                onClick={handleSaveEdit}
                disabled={editSaving}
              >
                {editSaving ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
