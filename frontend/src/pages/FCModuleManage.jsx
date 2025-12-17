import { useEffect, useRef, useState } from "react";
import NavigationMenu from "../components/NavigationMenu.jsx";
import FCModulesFilter from "../features/Forecast/FCModulesFilter.jsx";
import FCModulesEditModal from "../features/Forecast/FCModulesEdit.jsx";
import FCModulesTable from "../features/Forecast/FCModulesTable.jsx";
import Rest from "../js/rest.js";
import "./PageLayout.css";

export default function FCModuleManage() {
  const [assumptions, setAssumptions] = useState(null);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [selectedScenario, setSelectedScenario] = useState("");
  const [modules, setModules] = useState([]);
  const [modulesError, setModulesError] = useState("");
  const [modulesLoading, setModulesLoading] = useState(false);
  const [selectedModuleId, setSelectedModuleId] = useState("");
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
    const arrowSpace = 24; // space for the dropdown arrow

    selectEl.style.width = `${widest + padding + borders + arrowSpace}px`;
  }, [assumptions]);

  const selectedScenarioDetails = (assumptions?.scenarios || []).find(
    (scenario) => scenario.Name === selectedScenario
  );

  const getModuleId = (module) =>
    module?._id ??
    module?.id ??
    module?.Id ??
    `${module?.Scenario ?? "module"}-${module?.Account ?? module?.Name ?? ""}`;

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

  const selectedModule =
    modules.find((module) => getModuleId(module) === selectedModuleId) ?? null;

  const openEditModal = () => {
    if (!selectedModule) return;
    setEditError("");
    setEditForm({
      ...selectedModule,
      BaseDate: selectedModule.BaseDate
        ? new Date(selectedModule.BaseDate).toISOString().slice(0, 10)
        : "",
      Matched: Boolean(selectedModule.Matched),
    });
    setShowEditModal(true);
  };

  const closeEditModal = () => {
    setShowEditModal(false);
    setEditForm(null);
    setEditError("");
  };

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

  const handleSaveEdit = async (event) => {
    event.preventDefault();
    if (!selectedModule || !editForm) return;

    const moduleId = selectedModule._id || selectedModule.id || selectedModule.Id;
    if (!moduleId) {
      setEditError("Cannot edit this module because it has no id.");
      return;
    }

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

    for (const field of numericFields) {
      const raw = editForm[field];
      const parsed = raw === "" || raw === null || raw === undefined
        ? null
        : Number(raw);
      payload[field] = Number.isNaN(parsed) ? null : parsed;
    }

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
