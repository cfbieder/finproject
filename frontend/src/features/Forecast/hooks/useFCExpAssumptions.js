import { useEffect, useMemo, useRef, useState } from "react";
import Rest from "../../../js/rest.js";

/**
 * Hook for managing forecast assumptions, scenario selection, and period calculation.
 */
export function useFCExpAssumptions() {
  const [assumptions, setAssumptions] = useState(null);
  const [selectedScenario, setSelectedScenario] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const scenarioSelectRef = useRef(null);

  // Load assumptions on mount
  useEffect(() => {
    let isMounted = true;
    const loadAssumptions = async () => {
      setIsLoading(true);
      try {
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
        if (isMounted) setIsLoading(false);
      }
    };
    loadAssumptions();
    return () => { isMounted = false; };
  }, []);

  // Auto-select scenario
  useEffect(() => {
    const availableScenarios = assumptions?.scenarios || [];
    if (!availableScenarios.length) {
      setSelectedScenario("");
      return;
    }
    setSelectedScenario((prev) => {
      if (prev && availableScenarios.some((s) => s.Name === prev)) return prev;
      const defaultScenario = localStorage.getItem("forecast_default_scenario");
      if (defaultScenario && availableScenarios.some((s) => s.Name === defaultScenario)) return defaultScenario;
      return availableScenarios[0].Name || "";
    });
  }, [assumptions]);

  // Dynamic scenario select width
  useEffect(() => {
    const selectEl = scenarioSelectRef.current;
    if (!selectEl) return;
    const selectStyles = window.getComputedStyle(selectEl);
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) return;
    context.font = `${selectStyles.fontWeight} ${selectStyles.fontSize} ${selectStyles.fontFamily}`;
    const scenarioNames = (assumptions?.scenarios || []).map((s) => s.Name);
    scenarioNames.push("Select scenario");
    const widest = scenarioNames.reduce(
      (max, name) => Math.max(max, context.measureText(name).width), 0
    );
    const padding = parseFloat(selectStyles.paddingLeft || "0") + parseFloat(selectStyles.paddingRight || "0");
    const borders = parseFloat(selectStyles.borderLeftWidth || "0") + parseFloat(selectStyles.borderRightWidth || "0");
    selectEl.style.width = `${widest + padding + borders + 24}px`;
  }, [assumptions]);

  const selectedScenarioDetails = (assumptions?.scenarios || []).find(
    (s) => s.Name === selectedScenario
  );

  const periodStart = selectedScenarioDetails?.PeriodStart ?? assumptions?.PeriodStart ?? null;
  const periodEnd = selectedScenarioDetails?.PeriodEnd ?? assumptions?.PeriodEnd ?? null;

  const getScenarioYear = (value) => {
    if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
    const asString = String(value || "").trim();
    if (!asString) return null;
    const dateValue = new Date(asString);
    if (!Number.isNaN(dateValue.getTime())) return dateValue.getFullYear();
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
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return [];
    const years = [];
    for (let year = start; year <= end; year += 1) years.push(year);
    return years;
  }, [assumptions, selectedScenarioDetails]);

  return {
    assumptions,
    selectedScenario,
    setSelectedScenario,
    error,
    isLoading,
    scenarioSelectRef,
    selectedScenarioDetails,
    periodStart,
    periodEnd,
    periodYears,
    getScenarioStartYear,
  };
}
