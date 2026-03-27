import { useState, useEffect } from "react";
import Rest from "../../js/rest.js";

/**
 * FCSeedFromBudgetModal — Review and apply budget values to forecast income/expense items.
 *
 * Shows a table with current vs proposed values for each item. Proposed values
 * come from the current-year budget, with prior-year actuals as fallback.
 */
export default function FCSeedFromBudgetModal({
  isOpen,
  onClose,
  scenario,
  onApplied,
}) {
  const [budgetYear, setBudgetYear] = useState(new Date().getFullYear());
  const [proposals, setProposals] = useState([]);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState(new Set());

  useEffect(() => {
    if (isOpen && scenario) {
      loadProposals();
    }
  }, [isOpen, scenario, budgetYear]);

  const loadProposals = async () => {
    setLoading(true);
    setError("");
    try {
      const data = await Rest.post(
        `/forecast/incomeexpense/seed-from-budget?scenario=${encodeURIComponent(scenario)}&budgetYear=${budgetYear}`
      );
      const items = data.data || [];
      setProposals(items);
      const matchedIds = new Set(
        items.filter((p) => p.matched).map((p) => p.incexp_id)
      );
      setSelected(matchedIds);
    } catch (err) {
      setError(err.message || "Failed to load proposals");
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
    const matchedIds = proposals
      .filter((p) => p.matched)
      .map((p) => p.incexp_id);
    if (selected.size === matchedIds.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(matchedIds));
    }
  };

  const handleApply = async () => {
    const updates = proposals
      .filter((p) => selected.has(p.incexp_id))
      .map((p) => ({
        id: p.incexp_id,
        base_value: p.proposed_base_value,
        base_value_usd: p.proposed_base_value,
      }));

    if (updates.length === 0) return;

    setApplying(true);
    setError("");
    try {
      await Rest.patch("/forecast/incomeexpense/bulk-update", { updates });
      onApplied?.();
      onClose();
    } catch (err) {
      setError(err.message || "Failed to apply updates");
    } finally {
      setApplying(false);
    }
  };

  if (!isOpen) return null;

  const fmt = (v) =>
    v != null
      ? Number(v).toLocaleString("en-US", { maximumFractionDigits: 0 })
      : "—";

  const matchedCount = proposals.filter((p) => p.matched).length;

  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.6)", backdropFilter: "blur(6px)", display: "flex", alignItems: "center", justifyContent: "center", padding: "2rem", zIndex: 1000 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: "min(950px, 96vw)", maxHeight: "90vh", background: "white", borderRadius: "1.25rem", boxShadow: "0 20px 60px -12px rgba(37,99,235,0.25)", display: "flex", flexDirection: "column", overflow: "hidden" }}
      >
        <div style={{ padding: "1.5rem 2rem", borderBottom: "1px solid #e2e8f0", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2 style={{ margin: 0, fontSize: "1.25rem", fontWeight: 700 }}>Seed from Budget</h2>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: "1.5rem", cursor: "pointer", color: "#64748b" }}>
            &times;
          </button>
        </div>

        <div className="modal-body" style={{ padding: "1rem" }}>
          <div
            style={{
              display: "flex",
              gap: "1rem",
              alignItems: "center",
              marginBottom: "1rem",
            }}
          >
            <label>
              Budget Year:
              <input
                type="number"
                value={budgetYear}
                onChange={(e) => setBudgetYear(Number(e.target.value))}
                style={{ marginLeft: "0.5rem", width: "5rem" }}
                className="form-input"
              />
            </label>
            <span
              style={{ color: "var(--text-secondary)", fontSize: "0.85rem" }}
            >
              Budget totals for {budgetYear}, fallback to {budgetYear - 1}{" "}
              actuals
            </span>
            <span style={{ marginLeft: "auto", fontSize: "0.85rem" }}>
              {matchedCount}/{proposals.length} matched
            </span>
          </div>

          {error && (
            <div style={{ color: "var(--danger)", marginBottom: "0.5rem" }}>
              {error}
            </div>
          )}

          {loading ? (
            <p>Loading proposals...</p>
          ) : (
            <div style={{ maxHeight: "50vh", overflow: "auto" }}>
              <table
                className="data-table"
                style={{ width: "100%", fontSize: "0.85rem" }}
              >
                <thead>
                  <tr>
                    <th style={{ width: "2rem" }}>
                      <input
                        type="checkbox"
                        checked={
                          selected.size === matchedCount && matchedCount > 0
                        }
                        onChange={toggleAll}
                      />
                    </th>
                    <th>Item</th>
                    <th>Account</th>
                    <th style={{ textAlign: "right" }}>Current</th>
                    <th style={{ textAlign: "right" }}>Budget</th>
                    <th style={{ textAlign: "right" }}>
                      Actual ({budgetYear - 1})
                    </th>
                    <th style={{ textAlign: "right" }}>Proposed</th>
                    <th>Source</th>
                  </tr>
                </thead>
                <tbody>
                  {proposals.map((p) => (
                    <tr
                      key={p.incexp_id}
                      style={{
                        opacity: p.matched ? 1 : 0.5,
                        background: selected.has(p.incexp_id)
                          ? "var(--bg-highlight, #f0f4ff)"
                          : undefined,
                      }}
                    >
                      <td>
                        <input
                          type="checkbox"
                          checked={selected.has(p.incexp_id)}
                          disabled={!p.matched}
                          onChange={() => toggleSelect(p.incexp_id)}
                        />
                      </td>
                      <td>{p.item_name}</td>
                      <td>{p.account_name}</td>
                      <td
                        style={{
                          textAlign: "right",
                          fontFamily: "var(--font-mono)",
                        }}
                      >
                        {fmt(p.current_base_value)}
                      </td>
                      <td
                        style={{
                          textAlign: "right",
                          fontFamily: "var(--font-mono)",
                        }}
                      >
                        {fmt(p.budget_amount)}
                      </td>
                      <td
                        style={{
                          textAlign: "right",
                          fontFamily: "var(--font-mono)",
                        }}
                      >
                        {fmt(p.actual_amount)}
                      </td>
                      <td
                        style={{
                          textAlign: "right",
                          fontFamily: "var(--font-mono)",
                          fontWeight: "600",
                        }}
                      >
                        {fmt(p.proposed_base_value)}
                      </td>
                      <td>
                        {p.source === "Budget" ? (
                          <span style={{ color: "var(--primary)" }}>
                            Budget
                          </span>
                        ) : p.source === "Actual" ? (
                          <span style={{ color: "var(--accent)" }}>
                            Actual
                          </span>
                        ) : (
                          <span style={{ color: "var(--text-secondary)" }}>
                            None
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div style={{ padding: "1rem 2rem", borderTop: "1px solid #e2e8f0", display: "flex", justifyContent: "flex-end", gap: "0.75rem" }}>
          <button
            onClick={onClose}
            style={{ padding: "0.5rem 1.25rem", borderRadius: "0.5rem", border: "1px solid #cbd5e1", background: "white", cursor: "pointer" }}
          >
            Cancel
          </button>
          <button
            onClick={handleApply}
            disabled={selected.size === 0 || applying}
            style={{ padding: "0.5rem 1.25rem", borderRadius: "0.5rem", border: "none", background: selected.size > 0 ? "var(--primary, #1e40af)" : "#94a3b8", color: "white", cursor: selected.size > 0 ? "pointer" : "not-allowed", fontWeight: 600 }}
          >
            {applying ? "Applying..." : `Apply (${selected.size})`}
          </button>
        </div>
      </div>
    </div>
  );
}
