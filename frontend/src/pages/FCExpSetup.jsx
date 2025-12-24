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
  const [accountOptions, setAccountOptions] = useState([]);
  const [accountNameOptions, setAccountNameOptions] = useState({});
  const [leafAccountLookup, setLeafAccountLookup] = useState({});
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
    let isMounted = true;

    const loadAccounts = async () => {
      try {
        const data = await Rest.fetchJson("/api/coa/CashFlow");
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

  const getScenarioStartYear = () =>
    getScenarioYear(selectedScenarioDetails?.PeriodStart ?? assumptions?.PeriodStart);

  const getScenarioEndYear = () =>
    getScenarioYear(selectedScenarioDetails?.PeriodEnd ?? assumptions?.PeriodEnd);

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
      Changes: normalizeChanges(editForm.Changes),
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
      setEditForm((prev) =>
        prev ? { ...prev, Name: names[0] || "" } : prev
      );
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
            formatNumber={formatNumber}
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
