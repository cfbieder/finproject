import { useEffect, useState } from "react";
import ForecastFXAssumptions from "../features/BudgetEntry/ForecastFXAssumptions.jsx";
import Rest from "../js/rest.js";
import "./PageLayout.css";
import "./FXOptions.css";

const DEFAULT_MODULE_TYPES = ["Asset", "Liability", "Deposit", "Fixed Income", "Bond", "Real Estate", "Private Equity", "Business"];

const DEFAULT_AI_PROMPT = `You are an experienced financial advisor reviewing a long-term retirement financial plan. The user's goal is to have sufficient funds so that they and their spouse can maintain a similar standard of living until they pass away, with minimal savings remaining at end of life.

Review the plan and provide structured feedback with sections: Strong Points, Concerns, Recommendations, Key Risks, and Questions.

When you recommend specific numeric changes, include machine-readable action blocks using triple backtick blocks with the language tag "action" containing JSON with type, module_id/incexp_id/scenario_id, field, current_value, proposed_value, and reason.`;

export default function FCSettings() {
  const [birthYear, setBirthYear] = useState("");
  const [moduleTypes, setModuleTypes] = useState(DEFAULT_MODULE_TYPES);
  const [newType, setNewType] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [aiPrompt, setAiPrompt] = useState(DEFAULT_AI_PROMPT);

  useEffect(() => {
    Rest.fetchAppDataV2().then((data) => {
      const doc = Array.isArray(data) && data.length > 0 ? data[0] : data;
      if (doc?.birthYear) setBirthYear(String(doc.birthYear));
      if (Array.isArray(doc?.moduleTypes) && doc.moduleTypes.length > 0) setModuleTypes(doc.moduleTypes);
      if (doc?.anthropic_api_key) setApiKey(String(doc.anthropic_api_key));
      if (doc?.ai_review_prompt) setAiPrompt(String(doc.ai_review_prompt));
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
                      background: "#f1f5f9", fontSize: "0.8rem", border: "1px solid #E8E6DF",
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
                    background: newType.trim() ? "var(--primary, #567856)" : "#E8E6DF",
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

        {/* AI Review Settings */}
        <section className="fx-options-section">
          <h2 style={{ fontSize: "1.1rem", fontWeight: 700, marginBottom: "1rem" }}>AI Review</h2>
          <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            <div>
              <label style={{ fontSize: "0.85rem", fontWeight: 600, display: "block", marginBottom: "0.25rem" }}>
                Anthropic API Key
              </label>
              <span style={{ fontSize: "0.8rem", color: "var(--text-secondary)", display: "block", marginBottom: "0.5rem" }}>
                Required for AI-powered plan reviews. Get yours at console.anthropic.com
              </span>
              <input
                type="password"
                className="form-input"
                value={apiKey}
                onChange={(e) => {
                  setApiKey(e.target.value);
                  save("anthropic_api_key", e.target.value || null);
                }}
                placeholder="sk-ant-..."
                style={{ width: "min(100%, 28rem)", fontFamily: "monospace" }}
              />
            </div>
            <div>
              <label style={{ fontSize: "0.85rem", fontWeight: 600, display: "block", marginBottom: "0.25rem" }}>
                AI System Prompt
              </label>
              <span style={{ fontSize: "0.8rem", color: "var(--text-secondary)", display: "block", marginBottom: "0.5rem" }}>
                Instructions and goals sent to the AI. Customize to reflect your personal circumstances.
              </span>
              <textarea
                className="form-input"
                value={aiPrompt}
                onChange={(e) => {
                  setAiPrompt(e.target.value);
                  save("ai_review_prompt", e.target.value || null);
                }}
                rows={8}
                style={{ width: "100%", fontFamily: "inherit", fontSize: "0.85rem", lineHeight: 1.5, resize: "vertical" }}
              />
              <button
                type="button"
                onClick={() => { setAiPrompt(DEFAULT_AI_PROMPT); save("ai_review_prompt", DEFAULT_AI_PROMPT); }}
                style={{ marginTop: "0.35rem", fontSize: "0.8rem", padding: "0.25rem 0.75rem", borderRadius: "0.375rem", border: "1px solid #cbd5e1", background: "white", cursor: "pointer", color: "#64748b" }}
              >
                Reset to Default
              </button>
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
