import { useCallback, useEffect, useState } from "react";
import { useToast } from "../contexts/ToastContext.jsx";
import Rest from "../js/rest.js";
import "./PageLayout.css";
import "./ProgramSettings.css";

const CURRENT_YEAR = new Date().getFullYear();
const BUDGET_YEAR_CHOICES = Array.from({ length: 6 }, (_, i) => CURRENT_YEAR - 1 + i);

export default function ProgramSettings() {
  const { addToast } = useToast();
  const [defaultBudgetYear, setDefaultBudgetYear] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await Rest.fetchAppDataV2();
        const doc = Array.isArray(data) && data.length > 0 ? data[0] : data;
        if (!cancelled && doc?.defaultBudgetYear != null) {
          setDefaultBudgetYear(String(doc.defaultBudgetYear));
        }
      } catch (err) {
        console.warn("Failed to load program settings:", err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const handleBudgetYearChange = useCallback(async (e) => {
    const year = e.target.value;
    setDefaultBudgetYear(year);
    try {
      const response = await fetch(Rest.buildUrl("/api/v2/util/appdata"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          updates: [{ key: "defaultBudgetYear", value: year ? Number(year) : null }],
        }),
      });
      await Rest.handleResponse(response);
      addToast(`Default budget year set to ${year}`, "success");
    } catch {
      addToast("Failed to save default budget year", "error");
    }
  }, [addToast]);


  return (
    <main className="page-main">
      <div className="program-settings-container">
        <header className="program-settings-header">
          <h1 className="program-settings-header__title">Program Settings</h1>
          <p className="program-settings-header__subtitle">
            Configure application preferences and defaults
          </p>
        </header>

        <section className="program-settings-section">
          <h2 className="program-settings-section__title">Budget Defaults</h2>
          <div className="program-settings-field">
            <label className="program-settings-field__label" htmlFor="defaultBudgetYear">
              Default Budget Year
            </label>
            <p className="program-settings-field__description">
              The budget year pre-selected when opening the Budget Worksheet
            </p>
            <select
              id="defaultBudgetYear"
              className="program-settings-field__select"
              value={defaultBudgetYear}
              onChange={handleBudgetYearChange}
              disabled={loading}
            >
              <option value="">Current year + 1 (default)</option>
              {BUDGET_YEAR_CHOICES.map((yr) => (
                <option key={yr} value={String(yr)}>{yr}</option>
              ))}
            </select>
          </div>
        </section>

      </div>
    </main>
  );
}
