import { useEffect, useState } from "react";
import "./BudgetOptionExchangeRates.css";

export default function ForecastFXAssumptions() {
  const [assumptions, setAssumptions] = useState(null);
  const [status, setStatus] = useState({
    loading: true,
    error: "",
  });

  useEffect(() => {
    let isMounted = true;

    const fetchAssumptions = async () => {
      try {
        // Using v2 API (PostgreSQL)
        const response = await fetch("/api/v2/forecast/assumptions");

        if (!response.ok) {
          throw new Error("Failed to load forecast assumptions");
        }

        const data = await response.json();

        if (!isMounted) {
          return;
        }

        setAssumptions(data);
        setStatus({ loading: false, error: "" });
      } catch (error) {
        if (!isMounted) {
          return;
        }
        setStatus({
          loading: false,
          error: error?.message || "Failed to load FX assumptions",
        });
      }
    };

    fetchAssumptions();

    return () => {
      isMounted = false;
    };
  }, []);

  const renderBody = () => {
    if (status.loading) {
      return (
        <p className="budget-options-region__note">
          Loading forecast FX assumptions…
        </p>
      );
    }

    if (status.error) {
      return (
        <p className="budget-options-region__note budget-options-region__note--error">
          {status.error}
        </p>
      );
    }

    if (!assumptions) {
      return (
        <p className="budget-options-region__note">
          No forecast assumptions available
        </p>
      );
    }

    const scenarios = assumptions.scenarios || [];
    const fxData = assumptions.FX || [];

    if (scenarios.length === 0) {
      return (
        <p className="budget-options-region__note">
          No scenarios configured
        </p>
      );
    }

    // Get all unique currency pairs across all FX entries
    const currencyPairs = new Set();
    fxData.forEach((entry) => {
      if (entry.Rates && typeof entry.Rates === "object") {
        Object.keys(entry.Rates).forEach((pair) => currencyPairs.add(pair));
      }
    });

    const currencyPairsList = Array.from(currencyPairs).sort();

    // Group FX data by scenario
    const fxByScenario = {};
    fxData.forEach((entry) => {
      if (!fxByScenario[entry.Scenario]) {
        fxByScenario[entry.Scenario] = [];
      }
      fxByScenario[entry.Scenario].push(entry);
    });

    // Sort FX entries by year within each scenario
    Object.keys(fxByScenario).forEach((scenario) => {
      fxByScenario[scenario].sort((a, b) => a.Year - b.Year);
    });

    return (
      <div className="budget-options-table-wrapper">
        {scenarios.map((scenario) => {
          const scenarioFX = fxByScenario[scenario.Name] || [];

          return (
            <div key={scenario.Name} style={{ marginBottom: "2rem" }}>
              <h3
                style={{
                  margin: "0 0 0.75rem 0",
                  fontSize: "1.1rem",
                  fontWeight: 700,
                  color: "var(--primary)",
                }}
              >
                {scenario.Name}
                <span
                  style={{
                    marginLeft: "0.75rem",
                    fontSize: "0.85rem",
                    fontWeight: 600,
                    color: "var(--muted)",
                  }}
                >
                  ({scenario.PeriodStart} - {scenario.PeriodEnd})
                </span>
              </h3>

              {scenarioFX.length === 0 ? (
                <p
                  style={{
                    fontSize: "0.9rem",
                    color: "var(--muted)",
                    fontStyle: "italic",
                  }}
                >
                  No FX assumptions defined for this scenario
                </p>
              ) : (
                <table className="budget-options-table">
                  <thead>
                    <tr>
                      <th>Year</th>
                      {currencyPairsList.map((pair) => (
                        <th key={pair}>{pair}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {scenarioFX.map((entry, idx) => (
                      <tr key={`${scenario.Name}-${entry.Year}-${idx}`}>
                        <td>{entry.Year}</td>
                        {currencyPairsList.map((pair) => {
                          const rate = entry.Rates?.[pair];
                          return (
                            <td key={pair}>
                              {rate !== null &&
                              rate !== undefined &&
                              Number.isFinite(rate)
                                ? rate.toFixed(4)
                                : "—"}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          );
        })}
      </div>
    );
  };

  return <div>{renderBody()}</div>;
}
