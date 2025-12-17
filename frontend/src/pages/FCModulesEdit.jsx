import { useEffect, useRef, useState } from "react";
import NavigationMenu from "../components/NavigationMenu.jsx";
import FCModulesFilter from "../features/Forecast/FCModulesFilter.jsx";
import FCModulesTable from "../features/Forecast/FCModulesTable.jsx";
import Rest from "../js/rest.js";
import "./PageLayout.css";

export default function FCModulesEdit() {
  const [assumptions, setAssumptions] = useState(null);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [selectedScenario, setSelectedScenario] = useState("");
  const [modules, setModules] = useState([]);
  const [modulesError, setModulesError] = useState("");
  const [modulesLoading, setModulesLoading] = useState(false);
  const [selectedModuleId, setSelectedModuleId] = useState("");
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

  return (
    <div className="page-shell">
      <NavigationMenu />
      <main className="page-main trans-budget-main">
        <FCModulesFilter
          assumptions={assumptions}
          error={error}
          isLoading={isLoading}
          onScenarioChange={setSelectedScenario}
          scenarioSelectRef={scenarioSelectRef}
          selectedScenario={selectedScenario}
          selectedScenarioDetails={selectedScenarioDetails}
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
      </main>
    </div>
  );
}
