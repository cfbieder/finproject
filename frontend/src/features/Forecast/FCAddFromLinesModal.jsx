import { useState, useEffect } from "react";
import Rest from "../../js/rest.js";

const fmt = (v) =>
  v != null
    ? Math.abs(Number(v)).toLocaleString("en-US", { maximumFractionDigits: 0 })
    : "0";

/**
 * FCAddFromLinesModal — Select FC Lines (Forecast Expense/Income type) to add
 * as forecast income/expense items in the current scenario.
 * Budget total pre-fills base_value.
 */
export default function FCAddFromLinesModal({
  isOpen,
  onClose,
  scenario,
  existingEntries = [],
  onAdded,
}) {
  const [lines, setLines] = useState([]);
  const [budgetTotals, setBudgetTotals] = useState({});
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState(new Set());
  const [budgetYear, setBudgetYear] = useState(new Date().getFullYear());

  useEffect(() => {
    if (!isOpen) return;
    setSelected(new Set());
    setError("");
    loadData();
  }, [isOpen, budgetYear]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [linesRes, budgetRes] = await Promise.all([
        Rest.get(`/fc-lines?budgetYear=${budgetYear}`),
        Rest.get(`/fc-lines/budget-totals?budgetYear=${budgetYear}`),
      ]);

      const allLines = linesRes.data || [];
      // Only show forecast_expense and forecast_income lines
      const fcLines = allLines.filter(
        (l) => l.line_type === "forecast_expense" || l.line_type === "forecast_income"
      );

      // Exclude lines already added to this scenario (by fc_line_id)
      const existingLineIds = new Set(
        existingEntries.map((e) => e.fc_line_id).filter(Boolean)
      );
      const available = fcLines.filter((l) => !existingLineIds.has(l.id));

      setLines(available);

      const totMap = {};
      for (const t of budgetRes.data || []) {
        totMap[t.fc_line_id] = parseFloat(t.budget_total) || 0;
      }
      setBudgetTotals(totMap);
    } catch (err) {
      setError(err.message || "Failed to load FC Lines");
    } finally {
      setLoading(false);
    }
  };

  const toggleSelect = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selected.size === lines.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(lines.map((l) => l.id)));
    }
  };

  const handleApply = async () => {
    if (selected.size === 0 || !scenario) return;
    setApplying(true);
    setError("");

    try {
      for (const lineId of selected) {
        const line = lines.find((l) => l.id === lineId);
        if (!line) continue;

        const budgetTotal = budgetTotals[lineId] || 0;
        const isIncome = line.line_type === "forecast_income";

        await Rest.post("/forecast/incomeexpense", {
          Scenario: scenario,
          Name: line.name,
          Type: isIncome ? "income" : "expense",
          Currency: "USD",
          BaseDate: `${budgetYear}-01-01`,
          BaseValue: budgetTotal,
          BaseValueUSD: budgetTotal,
          Growth: 1,
          Matched: true,
          FcLineId: lineId,
          BudgetSourceYear: budgetYear,
          Comment: `From FC Line: ${line.name} (${budgetYear} budget)`,
        });
      }

      onAdded?.();
      onClose();
    } catch (err) {
      setError(err.message || "Failed to add items");
    } finally {
      setApplying(false);
    }
  };

  if (!isOpen) return null;

  const selectedTotal = Array.from(selected).reduce(
    (sum, id) => sum + (budgetTotals[id] || 0),
    0
  );

  return (
    <div
      style={{
        position: "fixed", inset: 0, background: "rgba(15,23,42,0.6)",
        backdropFilter: "blur(6px)", display: "flex", alignItems: "center",
        justifyContent: "center", padding: "2rem", zIndex: 1000,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(700px, 96vw)", maxHeight: "90vh", background: "white",
          borderRadius: "1.25rem", boxShadow: "0 20px 60px -12px rgba(37,99,235,0.25)",
          display: "flex", flexDirection: "column", overflow: "hidden",
        }}
      >
        {/* Header */}
        <div style={{ padding: "1.5rem 2rem", borderBottom: "1px solid #E8E6DF", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2 style={{ margin: 0, fontSize: "1.25rem", fontWeight: 700 }}>Add from FC Lines</h2>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: "1.5rem", cursor: "pointer", color: "var(--muted)" }}>
            &times;
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: "1rem 2rem", flex: 1, overflow: "auto" }}>
          <div style={{ display: "flex", gap: "1rem", alignItems: "center", marginBottom: "1rem" }}>
            <label style={{ fontSize: "0.85rem" }}>
              Budget Year:
              <input
                type="number"
                value={budgetYear}
                onChange={(e) => setBudgetYear(Number(e.target.value))}
                style={{ marginLeft: "0.5rem", width: "5rem" }}
                className="form-input"
              />
            </label>
            <span style={{ marginLeft: "auto", fontSize: "0.85rem", color: "var(--text-secondary)" }}>
              {lines.length} available lines
            </span>
          </div>

          {error && (
            <div style={{ color: "var(--danger)", marginBottom: "0.5rem", fontSize: "0.85rem" }}>{error}</div>
          )}

          {loading ? (
            <p>Loading...</p>
          ) : lines.length === 0 ? (
            <p style={{ color: "var(--text-secondary)" }}>
              No Forecast Expense/Income lines available. Either all lines are already added to this scenario,
              or no FC Lines are typed as "Forecast Expense" or "Forecast Income" on the mapping page.
            </p>
          ) : (
            <table className="data-table" style={{ width: "100%", fontSize: "0.85rem" }}>
              <thead>
                <tr>
                  <th style={{ width: "2rem" }}>
                    <input
                      type="checkbox"
                      checked={selected.size === lines.length && lines.length > 0}
                      onChange={toggleAll}
                    />
                  </th>
                  <th>Line Name</th>
                  <th>Type</th>
                  <th style={{ textAlign: "right" }}>Budget ({budgetYear})</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((line) => {
                  const bt = budgetTotals[line.id] || 0;
                  return (
                    <tr
                      key={line.id}
                      style={{
                        background: selected.has(line.id) ? "var(--bg-highlight, #f0f4ff)" : undefined,
                        cursor: "pointer",
                      }}
                      onClick={() => toggleSelect(line.id)}
                    >
                      <td onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={selected.has(line.id)}
                          onChange={() => toggleSelect(line.id)}
                        />
                      </td>
                      <td>{line.name}</td>
                      <td style={{ color: "var(--text-secondary)", fontSize: "0.8rem" }}>
                        {line.line_type === "forecast_income" ? "Income" : "Expense"}
                      </td>
                      <td style={{
                        textAlign: "right", fontFamily: "var(--font-mono)",
                        color: bt < 0 ? "var(--danger)" : bt > 0 ? "var(--success)" : undefined,
                      }}>
                        {bt !== 0 ? (bt < 0 ? "-" : "") + fmt(bt) : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: "1rem 2rem", borderTop: "1px solid #E8E6DF", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: "0.85rem", color: "var(--text-secondary)" }}>
            {selected.size} selected
            {selectedTotal !== 0 && ` — Total: ${selectedTotal < 0 ? "-" : ""}${fmt(selectedTotal)}`}
          </span>
          <div style={{ display: "flex", gap: "0.75rem" }}>
            <button
              onClick={onClose}
              style={{ padding: "0.5rem 1.25rem", borderRadius: "0.5rem", border: "1px solid #D5D2C9", background: "white", cursor: "pointer" }}
            >
              Cancel
            </button>
            <button
              onClick={handleApply}
              disabled={selected.size === 0 || applying}
              style={{
                padding: "0.5rem 1.25rem", borderRadius: "0.5rem", border: "none",
                background: selected.size > 0 ? "var(--primary, #567856)" : "var(--muted-light)",
                color: "white", cursor: selected.size > 0 ? "pointer" : "not-allowed", fontWeight: 600,
              }}
            >
              {applying ? "Adding..." : `Add ${selected.size} Item${selected.size !== 1 ? "s" : ""}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
