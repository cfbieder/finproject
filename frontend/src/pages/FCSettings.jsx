import { useEffect, useState } from "react";
import ForecastFXAssumptions from "../features/BudgetEntry/ForecastFXAssumptions.jsx";
import Rest from "../js/rest.js";
import "./PageLayout.css";
import "./FXOptions.css";

const DEFAULT_MODULE_TYPES = ["Asset", "Liability", "Deposit", "Fixed Income", "Bond", "Real Estate", "Private Equity", "Business"];

export default function FCSettings() {
  const [birthYear, setBirthYear] = useState("");
  const [moduleTypes, setModuleTypes] = useState(DEFAULT_MODULE_TYPES);
  const [newType, setNewType] = useState("");

  useEffect(() => {
    Rest.fetchAppDataV2().then((data) => {
      const doc = Array.isArray(data) && data.length > 0 ? data[0] : data;
      if (doc?.birthYear) setBirthYear(String(doc.birthYear));
      if (Array.isArray(doc?.moduleTypes) && doc.moduleTypes.length > 0) setModuleTypes(doc.moduleTypes);
    }).catch(() => {});
  }, []);

  const save = (key, value) => {
    fetch(Rest.buildUrl("/api/v2/util/appdata"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ updates: [{ key, value }] }),
    }).catch(() => {});
  };

  return (
    <main className="page-main">
      <div className="fx-options-container">
        <header className="fx-options-header">
          <h1 className="fx-options-header__title">FC Settings</h1>
          <p className="fx-options-header__subtitle">
            Forecast configuration, module types, and exchange rate assumptions
          </p>
        </header>

        {/* General Settings */}
        <section className="fx-options-section">
          <div style={{ display: "flex", gap: "2.5rem", flexWrap: "wrap", padding: "0.5rem 0" }}>
            {/* Birth Year */}
            <div>
              <label style={{ fontSize: "0.85rem", fontWeight: 600, display: "block", marginBottom: "0.25rem" }}>
                Birth Year
              </label>
              <span style={{ fontSize: "0.8rem", color: "var(--text-secondary)", display: "block", marginBottom: "0.5rem" }}>
                Displays age alongside forecast years in the Review page
              </span>
              <input
                type="number"
                className="form-input"
                value={birthYear}
                onChange={(e) => {
                  setBirthYear(e.target.value);
                  save("birthYear", e.target.value ? Number(e.target.value) : null);
                }}
                placeholder="e.g. 1968"
                style={{ width: "7rem" }}
                min="1920"
                max="2010"
              />
            </div>

            {/* Module Types */}
            <div style={{ flex: 1, minWidth: "250px" }}>
              <label style={{ fontSize: "0.85rem", fontWeight: 600, display: "block", marginBottom: "0.25rem" }}>
                Module Types
              </label>
              <span style={{ fontSize: "0.8rem", color: "var(--text-secondary)", display: "block", marginBottom: "0.5rem" }}>
                Available types in the module edit dropdown
              </span>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem", marginBottom: "0.5rem" }}>
                {moduleTypes.map((type) => (
                  <span
                    key={type}
                    style={{
                      display: "inline-flex", alignItems: "center", gap: "0.3rem",
                      padding: "0.25rem 0.6rem", borderRadius: "1rem",
                      background: "#f1f5f9", fontSize: "0.8rem", border: "1px solid #e2e8f0",
                    }}
                  >
                    {type}
                    <button
                      onClick={() => {
                        const u = moduleTypes.filter((t) => t !== type);
                        setModuleTypes(u);
                        save("moduleTypes", u);
                      }}
                      style={{
                        background: "none", border: "none", cursor: "pointer",
                        color: "#94a3b8", fontSize: "1rem", padding: 0, lineHeight: 1,
                      }}
                    >
                      &times;
                    </button>
                  </span>
                ))}
              </div>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const t = newType.trim();
                  if (!t || moduleTypes.includes(t)) return;
                  const u = [...moduleTypes, t];
                  setModuleTypes(u);
                  setNewType("");
                  save("moduleTypes", u);
                }}
                style={{ display: "flex", gap: "0.35rem" }}
              >
                <input
                  className="form-input"
                  type="text"
                  value={newType}
                  onChange={(e) => setNewType(e.target.value)}
                  placeholder="Add type..."
                  style={{ width: "12rem", fontSize: "0.85rem" }}
                />
                <button
                  type="submit"
                  disabled={!newType.trim()}
                  style={{
                    fontSize: "0.85rem", padding: "0.3rem 0.75rem", borderRadius: "0.5rem",
                    border: "1px solid #cbd5e1",
                    background: newType.trim() ? "var(--primary, #1e40af)" : "#e2e8f0",
                    color: newType.trim() ? "white" : "#94a3b8",
                    cursor: newType.trim() ? "pointer" : "not-allowed",
                  }}
                >
                  + Add
                </button>
              </form>
            </div>
          </div>
        </section>

        {/* FX Assumptions */}
        <section className="fx-options-section">
          <ForecastFXAssumptions />
        </section>
      </div>
    </main>
  );
}
