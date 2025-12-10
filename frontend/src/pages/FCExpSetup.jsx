import { useMemo, useState } from "react";
import NavigationMenu from "../components/NavigationMenu.jsx";
import ForecastSection from "../features/Forecast/ForecastSection.jsx";
import "./PageLayout.css";
import fcSetupData from "../../../components/data/fc_setup.json";

export default function FCExpSetup() {
  const buildPeriods = () =>
    Array.isArray(fcSetupData?.periods_used)
      ? fcSetupData.periods_used
          .map((period) => {
            if (!period || typeof period !== "object") {
              return null;
            }
            const [year, type] = Object.entries(period)[0] ?? [];
            if (!year) {
              return null;
            }
            return { key: year, type: typeof type === "string" ? type : "" };
          })
          .filter(Boolean)
      : [];

  const [periods, setPeriods] = useState(buildPeriods);
  const [baselinePeriods, setBaselinePeriods] = useState(() =>
    buildPeriods().map((period) => ({ ...period }))
  );
  const [activePeriodIndex, setActivePeriodIndex] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [saveSuccess, setSaveSuccess] = useState("");
  const [includeUnrealizedGL, setIncludeUnrealizedGL] = useState(false);

  const periodLabels = periods.map((period) =>
    period.type ? `${period.key} (${period.type})` : period.key
  );
  const periodKeys = periods.map((period) => period.key);
  const periodIndexMap = new Map(periodKeys.map((key, index) => [key, index]));
  const hasChanges = useMemo(() => {
    if (periods.length !== baselinePeriods.length) {
      return true;
    }
    for (let i = 0; i < periods.length; i += 1) {
      const current = periods[i];
      const base = baselinePeriods[i];
      if (!base || current.key !== base.key || current.type !== base.type) {
        return true;
      }
    }
    return false;
  }, [baselinePeriods, periods]);

  const profitLossRows = [];
  const traverseProfitLoss = (node, depth = 0) => {
    if (Array.isArray(node)) {
      node.forEach((child) => traverseProfitLoss(child, depth));
      return;
    }

    if (node && typeof node === "object") {
      for (const [label, children] of Object.entries(node)) {
        profitLossRows.push({ label, depth, isGroup: true });
        traverseProfitLoss(children, depth + 1);
      }
      return;
    }

    if (typeof node === "string" && node.trim()) {
      profitLossRows.push({ label: node.trim(), depth, isGroup: false });
    }
  };

  traverseProfitLoss(fcSetupData?.["Profit & Loss Accounts"] ?? [], 0);

  const sumValuesForPeriods = (node, totals) => {
    let hasValue = false;

    const visit = (current) => {
      if (Array.isArray(current)) {
        current.forEach(visit);
        return;
      }

      if (current && typeof current === "object") {
        for (const [key, value] of Object.entries(current)) {
          if (periodIndexMap.has(key) && Number.isFinite(value)) {
            const periodIndex = periodIndexMap.get(key);
            totals[periodIndex] += value;
            hasValue = true;
          } else {
            visit(value);
          }
        }
      }
    };

    visit(node);
    return hasValue;
  };

  const incomeTotals = periodKeys.map(() => 0);
  const expenseTotals = periodKeys.map(() => 0);
  (fcSetupData?.["Profit & Loss Accounts"] ?? []).forEach((entry) => {
    if (!entry || typeof entry !== "object") {
      return;
    }
    for (const [category, value] of Object.entries(entry)) {
      const normalizedCategory =
        typeof category === "string" ? category.toLowerCase() : "";
      if (normalizedCategory === "income") {
        sumValuesForPeriods(value, incomeTotals);
      } else if (
        normalizedCategory === "expense" ||
        normalizedCategory === "expenses"
      ) {
        sumValuesForPeriods(value, expenseTotals);
      }
    }
  });

  const netCashFlowValues = incomeTotals.map(
    (income, index) => income + expenseTotals[index]
  );

  const handleSavePeriods = async () => {
    setSaveError("");
    setSaveSuccess("");
    setIsSaving(true);
    try {
      const response = await fetch("/api/util/fc-setup/periods", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          periods: periods.map((period) => ({
            key: period.key,
            type: period.type,
          })),
        }),
      });

      if (!response.ok) {
        throw new Error(`Save failed with status ${response.status}`);
      }

      setBaselinePeriods(periods.map((period) => ({ ...period })));
      setSaveSuccess("Periods saved");
    } catch (error) {
      setSaveError(error?.message || "Unable to save period changes");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="page-shell">
      <NavigationMenu />
      <main className="page-content">
        <ForecastSection
          hasChanges={hasChanges}
          isSaving={isSaving}
          saveError={saveError}
          saveSuccess={saveSuccess}
          onSave={handleSavePeriods}
          periodLabels={periodLabels}
          profitLossRows={profitLossRows}
          netCashFlowValues={netCashFlowValues}
          onPeriodDoubleClick={setActivePeriodIndex}
          includeUnrealizedGL={includeUnrealizedGL}
          onIncludeUnrealizedGLChange={setIncludeUnrealizedGL}
        />
      </main>
      {activePeriodIndex !== null && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            backgroundColor: "rgba(0, 0, 0, 0.35)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
          onClick={() => setActivePeriodIndex(null)}
        >
          <div
            style={{
              background: "#fff",
              padding: "20px",
              borderRadius: "8px",
              minWidth: "260px",
              boxShadow: "0 10px 30px rgba(0,0,0,0.2)",
            }}
            onClick={(event) => event.stopPropagation()}
          >
            <h3 style={{ marginTop: 0, marginBottom: "12px" }}>
              Select period type
            </h3>
            <div
              style={{
                display: "flex",
                gap: "10px",
                justifyContent: "space-between",
                marginBottom: "12px",
              }}
            >
              {["B", "F", "A"].map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => {
                    setPeriods((prev) =>
                      prev.map((period, index) =>
                        index === activePeriodIndex
                          ? { ...period, type }
                          : period
                      )
                    );
                    setActivePeriodIndex(null);
                  }}
                  style={{
                    flex: 1,
                    padding: "10px",
                    fontWeight: 700,
                    cursor: "pointer",
                    border: "1px solid #1f2937",
                    borderRadius: "6px",
                    background: "#f9fafb",
                  }}
                >
                  {type}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setActivePeriodIndex(null)}
              style={{
                width: "100%",
                padding: "8px",
                background: "#1f2937",
                color: "#fff",
                border: "none",
                borderRadius: "6px",
                cursor: "pointer",
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
