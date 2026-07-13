import LoadingSpinner from "../components/LoadingSpinner.jsx";
import { useState, useEffect, useCallback } from "react";
import Rest from "../js/rest.js";
import FCStepNav from "../features/Forecast/FCStepNav.jsx";
import "./PageLayout.css";
import "../features/Forecast/FCModulesFilter.css";

const LINE_TYPES = [
  { value: "unassigned", label: "Unassigned", color: "#A0AEB9" },
  { value: "bs_module_expense", label: "BS Module - Expense", color: "#C0504D" },
  { value: "bs_module_income", label: "BS Module - Income", color: "#5B8C5B" },
  { value: "forecast_expense", label: "Forecast Expense", color: "#f97316" },
  { value: "forecast_income", label: "Forecast Income", color: "#7FA37F" },
];

const typeLabel = (t) => LINE_TYPES.find((lt) => lt.value === t)?.label || t;
const typeColor = (t) => LINE_TYPES.find((lt) => lt.value === t)?.color || "#A0AEB9";

const fmt = (v) =>
  v != null
    ? Math.abs(Number(v)).toLocaleString("en-US", { maximumFractionDigits: 0 })
    : "0";

export default function FCLineMapping() {
  const [lines, setLines] = useState([]);
  const [unassigned, setUnassigned] = useState([]);
  const [budgetTotals, setBudgetTotals] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedLineId, setSelectedLineId] = useState(null);
  const [budgetYear, setBudgetYear] = useState(new Date().getFullYear());
  const [newLineName, setNewLineName] = useState("");
  const [editingLineId, setEditingLineId] = useState(null);
  const [editingName, setEditingName] = useState("");
  const [draggedCatId, setDraggedCatId] = useState(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedCatIds, setSelectedCatIds] = useState(new Set());
  const [detailLine, setDetailLine] = useState(null);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [suggestions, setSuggestions] = useState([]);
  const [sugSelected, setSugSelected] = useState(new Set());
  const [sugLoading, setSugLoading] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [linesRes, unassignedRes, budgetRes] = await Promise.all([
        Rest.get(`/fc-lines?budgetYear=${budgetYear}`),
        Rest.get(`/fc-lines/unassigned-categories?budgetYear=${budgetYear}`),
        Rest.get(`/fc-lines/budget-totals?budgetYear=${budgetYear}`),
      ]);
      setLines(linesRes.data || []);
      setUnassigned(unassignedRes.data || []);
      const totMap = {};
      for (const t of budgetRes.data || []) {
        totMap[t.fc_line_id] = parseFloat(t.budget_total) || 0;
      }
      setBudgetTotals(totMap);
    } catch (err) {
      setError(err.message || "Failed to load data");
    } finally {
      setLoading(false);
    }
  }, [budgetYear]);

  useEffect(() => { loadData(); }, [loadData]);

  const openSuggestionsModal = async () => {
    setSugLoading(true);
    setShowSuggestions(true);
    try {
      const res = await Rest.get("/fc-lines/suggestions");
      const items = res.data || [];
      setSuggestions(items);
      setSugSelected(new Set(items.map((s) => s.name)));
    } catch (err) {
      setError(err.message);
      setShowSuggestions(false);
    } finally {
      setSugLoading(false);
    }
  };

  const handleCreateSuggestions = async () => {
    if (sugSelected.size === 0) return;
    setSugLoading(true);
    try {
      await Rest.post("/fc-lines/create-from-suggestions", {
        names: Array.from(sugSelected),
      });
      setShowSuggestions(false);
      await loadData();
    } catch (err) {
      setError(err.message);
    } finally {
      setSugLoading(false);
    }
  };

  const handleCreateLine = async () => {
    if (!newLineName.trim()) return;
    try {
      await Rest.post("/fc-lines", { name: newLineName.trim() });
      setNewLineName("");
      await loadData();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleDeleteLine = async (id) => {
    try {
      await Rest.del(`/fc-lines/${id}`);
      if (selectedLineId === id) setSelectedLineId(null);
      await loadData();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleUpdateType = async (id, line_type) => {
    try {
      await Rest.put(`/fc-lines/${id}`, { line_type });
      await loadData();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleStartRename = (line) => {
    setEditingLineId(line.id);
    setEditingName(line.name);
  };

  const handleFinishRename = async () => {
    if (!editingName.trim() || !editingLineId) return;
    try {
      await Rest.put(`/fc-lines/${editingLineId}`, { name: editingName.trim() });
      setEditingLineId(null);
      setEditingName("");
      await loadData();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleAssignCategory = async (lineId, categoryId) => {
    try {
      await Rest.post(`/fc-lines/${lineId}/categories`, { category_ids: [categoryId] });
      setSelectedCatIds(new Set());
      await loadData();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleAssignSelected = async (lineId) => {
    if (selectedCatIds.size === 0) return;
    try {
      await Rest.post(`/fc-lines/${lineId}/categories`, { category_ids: Array.from(selectedCatIds) });
      setSelectedCatIds(new Set());
      await loadData();
    } catch (err) {
      setError(err.message);
    }
  };

  const toggleCatSelection = (catId, ctrlKey) => {
    setSelectedCatIds((prev) => {
      const next = new Set(ctrlKey ? prev : []);
      if (next.has(catId)) next.delete(catId);
      else next.add(catId);
      return next;
    });
  };

  const handleUnassignCategory = async (lineId, categoryId) => {
    try {
      await Rest.del(`/fc-lines/${lineId}/categories/${categoryId}`);
      await loadData();
    } catch (err) {
      setError(err.message);
    }
  };

  // Drag handlers
  const onDragStart = (e, catId) => {
    setDraggedCatId(catId);
    e.dataTransfer.effectAllowed = "move";
  };

  const onDragOver = (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  };

  const onDropOnLine = (e, lineId) => {
    e.preventDefault();
    if (selectedCatIds.size > 0) {
      // Drop selected categories
      handleAssignSelected(lineId);
    } else if (draggedCatId) {
      handleAssignCategory(lineId, draggedCatId);
    }
    setDraggedCatId(null);
  };

  const onDropOnUnassigned = (e) => {
    e.preventDefault();
    if (draggedCatId) {
      // Find which line owns this category and unassign
      for (const line of lines) {
        const cat = line.categories?.find((c) => c.category_id === draggedCatId);
        if (cat) {
          handleUnassignCategory(line.id, draggedCatId);
          break;
        }
      }
      setDraggedCatId(null);
    }
  };

  const selectedLine = lines.find((l) => l.id === selectedLineId);
  // Budget-value-based coverage: sum of absolute budget amounts assigned vs total
  const assignedBudget = Object.values(budgetTotals).reduce((s, v) => s + Math.abs(v || 0), 0);
  const unassignedBudget = unassigned.reduce((s, c) => s + Math.abs(parseFloat(c.budget_total) || 0), 0);
  const totalBudget = assignedBudget + unassignedBudget;
  const assignedPct = totalBudget > 0 ? Math.round((assignedBudget / totalBudget) * 100) : 0;

  const filteredUnassigned = searchTerm
    ? unassigned.filter((c) =>
        c.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (c.parent_name || "").toLowerCase().includes(searchTerm.toLowerCase())
      )
    : unassigned;

  if (loading && lines.length === 0) {
    return (
      <main className="page-main trans-budget-main">
        <section className="section-filters">
          <div className="section-table__content" style={{ padding: "2rem" }}>
            <LoadingSpinner size="sm" />
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="page-main trans-budget-main">
      <FCStepNav />
      {/* Filter / toolbar card */}
      <section className="section-filters" style={{ height: "auto" }}>
        <div className="section-table__content">
          <div className="fc-modules-filter__content">
            <h2 style={{ margin: "0 0 0.25rem", fontSize: "1.15rem", fontWeight: 700 }}>FC Inc/Exp Mapping</h2>
            <p style={{ margin: "0 0 0.75rem", fontSize: "0.85rem", color: "var(--ink-secondary)" }}>
              Map budget categories to forecast lines. Each category is assigned to exactly one line.
            </p>

            {error && (
              <div style={{ color: "var(--danger)", marginBottom: "0.5rem", fontSize: "0.85rem" }}>
                {error}
                <button onClick={() => setError("")} style={{ marginLeft: "0.5rem", background: "none", border: "none", cursor: "pointer", textDecoration: "underline", color: "var(--danger)" }}>
                  dismiss
                </button>
              </div>
            )}

            {/* Coverage bar */}
            <div style={{ display: "flex", alignItems: "center", gap: "1rem", marginBottom: "0.75rem" }}>
              <span style={{ fontSize: "0.85rem", color: "var(--ink-secondary)" }}>
                Coverage: {fmt(assignedBudget)}/{fmt(totalBudget)} budget mapped ({assignedPct}%)
              </span>
              <div style={{ flex: 1, height: "6px", background: "var(--border)", borderRadius: "3px", overflow: "hidden" }}>
                <div style={{ width: `${assignedPct}%`, height: "100%", background: assignedPct === 100 ? "var(--success)" : "var(--primary-light)", transition: "width 0.3s" }} />
              </div>
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
            </div>

            {/* Toolbar */}
            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
              <button className="btn btn--primary" onClick={openSuggestionsModal} disabled={loading}>
                Generate Suggestions
              </button>
        <form
          onSubmit={(e) => { e.preventDefault(); handleCreateLine(); }}
          style={{ display: "flex", gap: "0.25rem", alignItems: "center" }}
        >
          <input
            className="form-input"
            type="text"
            placeholder="Type line name, press Enter or click Add"
            value={newLineName}
            onChange={(e) => setNewLineName(e.target.value)}
            style={{ width: "16rem" }}
          />
          <button
            type="submit"
            className="btn btn--success"
            disabled={!newLineName.trim()}
            style={{ opacity: newLineName.trim() ? 1 : 0.5 }}
          >
            + Add Line
          </button>
        </form>
            </div>
          </div>
        </div>
      </section>

      {/* Main two-panel layout */}
      <div style={{ display: "flex", gap: "1rem", padding: "0 1rem" }}>
        {/* Left panel: FC Lines */}
        <div style={{ flex: "1 1 55%", display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0, overflow: "hidden" }}>
          <h3 style={{ margin: "0 0 0.5rem", fontSize: "0.95rem", fontWeight: 600 }}>
            FC Lines ({lines.length})
          </h3>
          <div style={{ flex: 1, overflow: "auto", border: "1px solid var(--border)", borderRadius: "0.5rem", maxHeight: "calc(100vh - 320px)" }}>
            {lines.length === 0 ? (
              <div style={{ padding: "2rem", textAlign: "center", color: "var(--ink-secondary)" }}>
                No lines yet. Click "Generate Suggestions" or create one manually.
              </div>
            ) : (
              <table className="data-table" style={{ width: "100%", fontSize: "0.85rem" }}>
                <thead>
                  <tr>
                    <th>Line Name</th>
                    <th style={{ width: "11rem" }}>Type</th>
                    <th style={{ width: "3rem", textAlign: "right" }}>Cats</th>
                    <th style={{ width: "6rem", textAlign: "right" }}>Budget</th>
                    <th style={{ width: "5rem" }}>Actions</th>
                  </tr>
                </thead>
                {(() => {
                  const incomeLines = lines.filter((l) => l.line_type === "forecast_income" || l.line_type === "bs_module_income");
                  const expenseLines = lines.filter((l) => l.line_type === "forecast_expense" || l.line_type === "bs_module_expense");
                  const unassignedLines = lines.filter((l) => l.line_type === "unassigned");
                  const incomeSubtotal = incomeLines.reduce((s, l) => s + (budgetTotals[l.id] || 0), 0);
                  const expenseSubtotal = expenseLines.reduce((s, l) => s + (budgetTotals[l.id] || 0), 0);
                  const grandTotal = incomeSubtotal + expenseSubtotal;

                  const renderLineRow = (line) => (
                    <tr
                      key={line.id}
                      onClick={() => setSelectedLineId(line.id)}
                      onDragOver={onDragOver}
                      onDrop={(e) => onDropOnLine(e, line.id)}
                      style={{
                        cursor: "pointer",
                        background: selectedLineId === line.id ? "var(--surface-muted, var(--primary-subtle))" : undefined,
                        borderLeft: `3px solid ${typeColor(line.line_type)}`,
                      }}
                    >
                      <td>
                        {editingLineId === line.id ? (
                          <input
                            className="form-input"
                            value={editingName}
                            onChange={(e) => setEditingName(e.target.value)}
                            onBlur={handleFinishRename}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") handleFinishRename();
                              if (e.key === "Escape") setEditingLineId(null);
                            }}
                            autoFocus
                            style={{ width: "100%", fontSize: "0.85rem" }}
                            onClick={(e) => e.stopPropagation()}
                          />
                        ) : (
                          <span onDoubleClick={() => handleStartRename(line)}>{line.name}</span>
                        )}
                      </td>
                      <td>
                        <select
                          className="form-input"
                          value={line.line_type}
                          onChange={(e) => { e.stopPropagation(); handleUpdateType(line.id, e.target.value); }}
                          onClick={(e) => e.stopPropagation()}
                          style={{ fontSize: "0.8rem", padding: "0.15rem 0.3rem", width: "100%" }}
                        >
                          {LINE_TYPES.map((lt) => (
                            <option key={lt.value} value={lt.value}>{lt.label}</option>
                          ))}
                        </select>
                      </td>
                      <td style={{ textAlign: "right", fontFamily: "var(--font-mono)" }}>
                        {line.categories?.length || 0}
                      </td>
                      <td
                        style={{
                          textAlign: "right", fontFamily: "var(--font-mono)",
                          color: (budgetTotals[line.id] || 0) < 0 ? "var(--danger)" : undefined,
                          cursor: budgetTotals[line.id] ? "pointer" : undefined,
                          textDecoration: budgetTotals[line.id] ? "underline dotted" : undefined,
                        }}
                        onDoubleClick={(e) => {
                          e.stopPropagation();
                          if (line.categories?.length) setDetailLine(line);
                        }}
                        title={budgetTotals[line.id] ? "Double-click to see category breakdown" : ""}
                      >
                        {budgetTotals[line.id] ? fmt(budgetTotals[line.id]) : "—"}
                      </td>
                      <td>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleDeleteLine(line.id); }}
                          style={{ background: "none", border: "none", cursor: "pointer", color: "var(--danger)", fontSize: "1rem" }}
                          title="Delete line"
                        >
                          x
                        </button>
                      </td>
                    </tr>
                  );

                  const subtotalRow = (label, total, color) => (
                    <tr key={`subtotal-${label}`} style={{ fontWeight: 700, background: "var(--surface-muted)", borderTop: "1px solid var(--border)" }}>
                      <td colSpan={3}>{label}</td>
                      <td style={{ textAlign: "right", fontFamily: "var(--font-mono)", color }}>
                        {total !== 0 ? (total < 0 ? "-" : "") + fmt(total) : "—"}
                      </td>
                      <td />
                    </tr>
                  );

                  return (
                    <>
                      {incomeLines.length > 0 && (
                        <tbody>
                          <tr><td colSpan={5} style={{ fontWeight: 700, paddingTop: "0.5rem", fontSize: "0.8rem", color: "var(--success, #5B8C5B)", borderBottom: "1px solid var(--border)" }}>Income</td></tr>
                          {incomeLines.map(renderLineRow)}
                          {subtotalRow("Subtotal Income", incomeSubtotal, "var(--success, #5B8C5B)")}
                        </tbody>
                      )}
                      {expenseLines.length > 0 && (
                        <tbody>
                          <tr><td colSpan={5} style={{ fontWeight: 700, paddingTop: "0.75rem", fontSize: "0.8rem", color: "var(--danger, #C0504D)", borderBottom: "1px solid var(--border)" }}>Expense</td></tr>
                          {expenseLines.map(renderLineRow)}
                          {subtotalRow("Subtotal Expense", expenseSubtotal, "var(--danger, #C0504D)")}
                        </tbody>
                      )}
                      {unassignedLines.length > 0 && (
                        <tbody>
                          <tr><td colSpan={5} style={{ fontWeight: 700, paddingTop: "0.75rem", fontSize: "0.8rem", color: "var(--ink-secondary)", borderBottom: "1px solid var(--border)" }}>Unassigned</td></tr>
                          {unassignedLines.map(renderLineRow)}
                        </tbody>
                      )}
                      <tfoot>
                        <tr style={{ fontWeight: 700, borderTop: "2px solid var(--border-strong)" }}>
                          <td colSpan={3}>Total</td>
                          <td style={{
                            textAlign: "right", fontFamily: "var(--font-mono)",
                            color: grandTotal < 0 ? "var(--danger, #C0504D)" : grandTotal > 0 ? "var(--success, #5B8C5B)" : undefined,
                          }}>
                            {grandTotal !== 0 ? (grandTotal < 0 ? "-" : "") + fmt(grandTotal) : "—"}
                          </td>
                          <td />
                        </tr>
                      </tfoot>
                    </>
                  );
                })()}
              </table>
            )}
          </div>

          {/* Selected line detail: show assigned categories */}
          {selectedLine && (
            <div style={{ marginTop: "0.75rem" }}>
              <h4 style={{ margin: "0 0 0.25rem", fontSize: "0.9rem" }}>
                Categories in "{selectedLine.name}" ({selectedLine.categories?.length || 0})
              </h4>
              <div style={{ maxHeight: "20vh", overflow: "auto", border: "1px solid var(--border)", borderRadius: "0.5rem", padding: "0.5rem" }}>
                {(!selectedLine.categories || selectedLine.categories.length === 0) ? (
                  <div style={{ color: "var(--ink-secondary)", fontSize: "0.85rem" }}>
                    No categories assigned. Drag categories here from the unassigned pool.
                  </div>
                ) : (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "0.25rem" }}>
                    {selectedLine.categories.map((cat) => (
                      <span
                        key={cat.category_id}
                        draggable
                        onDragStart={(e) => onDragStart(e, cat.category_id)}
                        style={{
                          display: "inline-flex", alignItems: "center", gap: "0.35rem",
                          padding: "0.2rem 0.5rem", background: "#F2F1EC", borderRadius: "0.25rem",
                          fontSize: "0.8rem", cursor: "grab",
                        }}
                      >
                        {cat.category_name}
                        <button
                          onClick={() => handleUnassignCategory(selectedLine.id, cat.category_id)}
                          style={{ background: "none", border: "none", cursor: "pointer", color: "#A0AEB9", fontSize: "0.85rem", padding: 0, lineHeight: 1 }}
                        >
                          x
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Right panel: Unassigned categories */}
        <div
          style={{ flex: "1 1 35%", display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0, overflow: "hidden" }}
          onDragOver={onDragOver}
          onDrop={onDropOnUnassigned}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.5rem", flexWrap: "wrap" }}>
            <h3 style={{ margin: 0, fontSize: "0.95rem", fontWeight: 600 }}>
              Unassigned ({unassigned.length})
            </h3>
            <input
              className="form-input"
              type="text"
              placeholder="Search..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              style={{ flex: 1, fontSize: "0.8rem", minWidth: "6rem" }}
            />
            {selectedCatIds.size > 0 && (
              <div style={{ display: "flex", gap: "0.25rem", alignItems: "center" }}>
                <span style={{ fontSize: "0.8rem", color: "#7FA37F", fontWeight: 600 }}>
                  {selectedCatIds.size} selected
                </span>
                <button
                  className="btn btn--primary"
                  onClick={() => selectedLineId && handleAssignSelected(selectedLineId)}
                  disabled={!selectedLineId}
                  style={{ fontSize: "0.75rem", padding: "0.2rem 0.5rem", opacity: selectedLineId ? 1 : 0.5 }}
                >
                  Assign to {selectedLine?.name || "..."}
                </button>
                <button
                  onClick={() => setSelectedCatIds(new Set())}
                  style={{ background: "none", border: "none", cursor: "pointer", color: "#A0AEB9", fontSize: "0.8rem" }}
                >
                  Clear
                </button>
              </div>
            )}
          </div>
          <div style={{
            flex: 1, overflow: "auto", border: "1px solid var(--border)", borderRadius: "0.5rem",
            maxHeight: "calc(100vh - 320px)",
            background: draggedCatId ? "#fef3c7" : undefined, transition: "background 0.2s",
          }}>
            {filteredUnassigned.length === 0 ? (
              <div style={{ padding: "1rem", textAlign: "center", color: "var(--ink-secondary)", fontSize: "0.85rem" }}>
                {unassigned.length === 0 ? "All categories assigned!" : "No matches"}
              </div>
            ) : (
              <div style={{ padding: "0.5rem", display: "flex", flexDirection: "column", gap: "0.15rem" }}>
                {filteredUnassigned
                  .slice()
                  .sort((a, b) => Math.abs(parseFloat(b.budget_total) || 0) - Math.abs(parseFloat(a.budget_total) || 0))
                  .map((cat) => {
                  const bt = parseFloat(cat.budget_total) || 0;
                  return (
                  <div
                    key={cat.id}
                    draggable
                    onDragStart={(e) => onDragStart(e, cat.id)}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleCatSelection(cat.id, e.ctrlKey || e.metaKey);
                    }}
                    onDoubleClick={() => selectedLineId && handleAssignCategory(selectedLineId, cat.id)}
                    style={{
                      padding: "0.3rem 0.5rem",
                      background: selectedCatIds.has(cat.id) ? "var(--info-subtle)" : bt !== 0 ? "var(--warning-subtle)" : "var(--surface-elevated)",
                      borderRadius: "0.25rem",
                      fontSize: "0.8rem", cursor: "pointer",
                      border: selectedCatIds.has(cat.id) ? "1px solid var(--primary-light)" : "1px solid var(--border)",
                      display: "flex", alignItems: "center", gap: "0.5rem",
                    }}
                    title="Click to select, Ctrl+Click for multi-select, double-click to assign"
                  >
                    <span style={{ flex: 1 }}>{cat.name}</span>
                    <span style={{
                      fontFamily: "var(--font-mono)", fontSize: "0.75rem",
                      color: bt < 0 ? "var(--danger, #C0504D)" : bt > 0 ? "var(--success, #5B8C5B)" : "#A0AEB9",
                    }}>
                      {bt !== 0 ? (bt < 0 ? "-" : "") + fmt(bt) : "—"}
                    </span>
                    <span style={{ color: "#A0AEB9", fontSize: "0.75rem", whiteSpace: "nowrap" }}>{cat.parent_name || ""}</span>
                  </div>
                  );
                })}
                {(() => {
                  const unassignedTotal = filteredUnassigned.reduce((s, c) => s + (parseFloat(c.budget_total) || 0), 0);
                  const withBudget = filteredUnassigned.filter((c) => (parseFloat(c.budget_total) || 0) !== 0).length;
                  return unassignedTotal !== 0 ? (
                    <div style={{
                      padding: "0.4rem 0.5rem", marginTop: "0.25rem",
                      fontWeight: 700, fontSize: "0.8rem",
                      borderTop: "2px solid var(--border)",
                      display: "flex", justifyContent: "space-between",
                    }}>
                      <span>Unassigned Total ({withBudget} with budget)</span>
                      <span style={{
                        fontFamily: "var(--font-mono)",
                        color: unassignedTotal < 0 ? "var(--danger, #C0504D)" : "var(--success, #5B8C5B)",
                      }}>
                        {(unassignedTotal < 0 ? "-" : "") + fmt(unassignedTotal)}
                      </span>
                    </div>
                  ) : null;
                })()}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Budget detail modal */}
      {detailLine && (
        <div
          onClick={() => setDetailLine(null)}
          style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.6)", backdropFilter: "blur(6px)", display: "flex", alignItems: "center", justifyContent: "center", padding: "2rem", zIndex: 1000 }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ width: "min(600px, 96vw)", maxHeight: "80vh", background: "white", borderRadius: "1.25rem", boxShadow: "0 20px 60px -12px rgba(37,99,235,0.25)", display: "flex", flexDirection: "column", overflow: "hidden" }}
          >
            <div style={{ padding: "1.25rem 1.5rem", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <h2 style={{ margin: 0, fontSize: "1.15rem", fontWeight: 700 }}>{detailLine.name}</h2>
                <span style={{ fontSize: "0.8rem", color: "var(--ink-secondary)" }}>
                  {detailLine.categories?.length || 0} categories — Budget Year {budgetYear}
                </span>
              </div>
              <button onClick={() => setDetailLine(null)} style={{ background: "none", border: "none", fontSize: "1.5rem", cursor: "pointer", color: "#808E9B" }}>
                &times;
              </button>
            </div>
            <div style={{ padding: "1rem 1.5rem", overflow: "auto", flex: 1 }}>
              <table className="data-table" style={{ width: "100%", fontSize: "0.85rem" }}>
                <thead>
                  <tr>
                    <th>Category</th>
                    <th style={{ textAlign: "right" }}>Budget (USD)</th>
                    <th style={{ width: "2rem" }} />
                  </tr>
                </thead>
                {(() => {
                  const allCats = (detailLine.categories || []).slice();
                  // Group by parent name
                  const parentGroups = new Map();
                  for (const cat of allCats) {
                    const parent = cat.parent_name || "Other";
                    if (!parentGroups.has(parent)) parentGroups.set(parent, []);
                    parentGroups.get(parent).push(cat);
                  }
                  // Sort categories within each group by absolute budget
                  for (const cats of parentGroups.values()) {
                    cats.sort((a, b) => Math.abs(parseFloat(b.budget_total) || 0) - Math.abs(parseFloat(a.budget_total) || 0));
                  }
                  // Sort parent groups by absolute subtotal
                  const sortedParents = [...parentGroups.entries()]
                    .map(([parent, cats]) => ({
                      parent,
                      cats,
                      subtotal: cats.reduce((s, c) => s + (parseFloat(c.budget_total) || 0), 0),
                    }))
                    .sort((a, b) => Math.abs(b.subtotal) - Math.abs(a.subtotal));
                  const grandTotal = sortedParents.reduce((s, g) => s + g.subtotal, 0);

                  const renderRow = (cat) => {
                    const bt = parseFloat(cat.budget_total) || 0;
                    return (
                      <tr key={cat.category_id}>
                        <td style={{ paddingLeft: "1rem" }}>{cat.category_name}</td>
                        <td style={{
                          textAlign: "right", fontFamily: "var(--font-mono)",
                          color: bt < 0 ? "var(--danger, #C0504D)" : bt > 0 ? "var(--success, #5B8C5B)" : undefined,
                        }}>
                          {bt !== 0 ? (bt < 0 ? "-" : "") + fmt(bt) : "—"}
                        </td>
                        <td style={{ textAlign: "center" }}>
                          <button
                            onClick={async () => {
                              await handleUnassignCategory(detailLine.id, cat.category_id);
                              setDetailLine((prev) => prev ? {
                                ...prev,
                                categories: prev.categories.filter((c) => c.category_id !== cat.category_id),
                              } : null);
                            }}
                            title="Remove category"
                            style={{ background: "none", border: "none", cursor: "pointer", color: "#A0AEB9", fontSize: "1rem", padding: "0 0.25rem", lineHeight: 1 }}
                          >
                            &times;
                          </button>
                        </td>
                      </tr>
                    );
                  };

                  return (
                    <>
                      {sortedParents.map(({ parent, cats, subtotal }) => (
                        <tbody key={parent}>
                          <tr>
                            <td style={{ fontWeight: 700, paddingTop: "0.5rem", borderBottom: "1px solid var(--border)" }}>{parent}</td>
                            <td style={{
                              fontWeight: 700, textAlign: "right", fontFamily: "var(--font-mono)", paddingTop: "0.5rem", borderBottom: "1px solid var(--border)",
                              color: subtotal < 0 ? "var(--danger, #C0504D)" : subtotal > 0 ? "var(--success, #5B8C5B)" : undefined,
                            }}>
                              {subtotal !== 0 ? (subtotal < 0 ? "-" : "") + fmt(subtotal) : "—"}
                            </td>
                            <td style={{ borderBottom: "1px solid var(--border)" }} />
                          </tr>
                          {cats.map(renderRow)}
                        </tbody>
                      ))}
                      <tfoot>
                        <tr style={{ fontWeight: 700, borderTop: "2px solid var(--border)" }}>
                          <td>Total</td>
                          <td style={{
                            textAlign: "right", fontFamily: "var(--font-mono)",
                            color: grandTotal < 0 ? "var(--danger, #C0504D)" : grandTotal > 0 ? "var(--success, #5B8C5B)" : undefined,
                          }}>
                            {grandTotal !== 0 ? (grandTotal < 0 ? "-" : "") + fmt(grandTotal) : "—"}
                          </td>
                          <td />
                        </tr>
                      </tfoot>
                    </>
                  );
                })()}
              </table>
            </div>
          </div>
        </div>
      )}
      {/* Suggestions Modal */}
      {showSuggestions && (
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
              width: "min(500px, 96vw)", maxHeight: "80vh", background: "white",
              borderRadius: "1.25rem", boxShadow: "0 20px 60px -12px rgba(37,99,235,0.25)",
              display: "flex", flexDirection: "column", overflow: "hidden",
            }}
          >
            <div style={{ padding: "1.5rem 2rem", borderBottom: "1px solid var(--border)" }}>
              <h3 style={{ margin: 0, fontSize: "1.1rem", fontWeight: 700 }}>Generate Suggestions</h3>
              <span style={{ fontSize: "0.8rem", color: "var(--ink-secondary)" }}>
                Select P&L categories to create as FC Lines.
              </span>
            </div>
            <div style={{ flex: 1, overflow: "auto", padding: "0.75rem 2rem" }}>
              {sugLoading ? (
                <LoadingSpinner size="sm" />
              ) : suggestions.length === 0 ? (
                <p style={{ color: "var(--ink-secondary)", textAlign: "center", padding: "2rem 0" }}>
                  All suggestions already created.
                </p>
              ) : (
                <>
                  <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.75rem", fontSize: "0.8rem" }}>
                    <button
                      type="button"
                      style={{ background: "none", border: "none", color: "var(--primary)", cursor: "pointer", padding: 0, textDecoration: "underline" }}
                      onClick={() => setSugSelected(new Set(suggestions.map((s) => s.name)))}
                    >
                      Select All
                    </button>
                    <button
                      type="button"
                      style={{ background: "none", border: "none", color: "var(--primary)", cursor: "pointer", padding: 0, textDecoration: "underline" }}
                      onClick={() => setSugSelected(new Set())}
                    >
                      Clear
                    </button>
                  </div>
                  {suggestions.map((s) => (
                    <label
                      key={s.name}
                      style={{
                        display: "flex", alignItems: "center", gap: "0.5rem",
                        padding: "0.4rem 0", fontSize: "0.85rem", cursor: "pointer",
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={sugSelected.has(s.name)}
                        onChange={() => {
                          setSugSelected((prev) => {
                            const next = new Set(prev);
                            if (next.has(s.name)) next.delete(s.name);
                            else next.add(s.name);
                            return next;
                          });
                        }}
                      />
                      {s.name}
                    </label>
                  ))}
                </>
              )}
            </div>
            <div style={{ padding: "1rem 2rem", borderTop: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: "0.8rem", color: "var(--ink-secondary)" }}>
                {sugSelected.size} of {suggestions.length} selected
              </span>
              <div style={{ display: "flex", gap: "0.75rem" }}>
                <button
                  onClick={() => setShowSuggestions(false)}
                  style={{ padding: "0.5rem 1.25rem", borderRadius: "0.5rem", border: "1px solid #D5D2C9", background: "white", cursor: "pointer" }}
                >
                  Close
                </button>
                <button
                  onClick={handleCreateSuggestions}
                  disabled={sugSelected.size === 0 || sugLoading}
                  style={{
                    padding: "0.5rem 1.25rem", borderRadius: "0.5rem", border: "none",
                    background: sugSelected.size > 0 ? "var(--primary, #567856)" : "#A0AEB9",
                    color: "white", cursor: sugSelected.size > 0 ? "pointer" : "not-allowed", fontWeight: 600,
                  }}
                >
                  {sugLoading ? "Creating..." : `Add ${sugSelected.size} Line${sugSelected.size !== 1 ? "s" : ""}`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
