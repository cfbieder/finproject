import { useState, useEffect } from "react";
import Rest from "../../js/rest.js";

/**
 * FCCoverageCheckModal — Shows which budget categories are covered by
 * FC IncExp items, BS Module categories, or not covered at all.
 */
export default function FCCoverageCheckModal({ isOpen, onClose, scenario }) {
  const [budgetYear, setBudgetYear] = useState(new Date().getFullYear());
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [expandedSections, setExpandedSections] = useState({
    not_covered: true,
    covered_incexp: false,
    covered_module: false,
  });

  useEffect(() => {
    if (isOpen && scenario) loadCoverage();
  }, [isOpen, scenario, budgetYear]);

  const loadCoverage = async () => {
    setLoading(true);
    setError("");
    try {
      const result = await Rest.post(
        `/forecast/coverage-check?scenario=${encodeURIComponent(scenario)}&budgetYear=${budgetYear}`
      );
      setData(result);
    } catch (err) {
      setError(err.message || "Failed to load coverage");
    } finally {
      setLoading(false);
    }
  };

  const toggleSection = (key) =>
    setExpandedSections((prev) => ({ ...prev, [key]: !prev[key] }));

  if (!isOpen) return null;

  const fmt = (v) =>
    v != null
      ? Number(v).toLocaleString("en-US", { maximumFractionDigits: 0 })
      : "-";

  const summary = data?.summary;
  const items = data?.data;

  const sectionStyle = (color) => ({
    borderLeft: `4px solid ${color}`,
    marginBottom: "0.75rem",
    borderRadius: "0.5rem",
    overflow: "hidden",
    background: "white",
  });

  const headerStyle = (color) => ({
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "0.75rem 1rem",
    cursor: "pointer",
    background: `${color}08`,
    userSelect: "none",
  });

  const renderSection = (key, label, color, entries, coveredByLabel) => {
    const expanded = expandedSections[key];
    const total = entries?.reduce((s, e) => s + e.budget_total, 0) || 0;
    return (
      <div style={sectionStyle(color)} key={key}>
        <div style={headerStyle(color)} onClick={() => toggleSection(key)}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <span style={{ color, fontWeight: 700, fontSize: "1.1rem" }}>
              {expanded ? "v" : ">"}
            </span>
            <span style={{ fontWeight: 600, color: "var(--ink, #1e293b)" }}>
              {label}
            </span>
            <span
              style={{
                background: color,
                color: "white",
                borderRadius: "999px",
                padding: "0.15rem 0.6rem",
                fontSize: "0.75rem",
                fontWeight: 700,
              }}
            >
              {entries?.length || 0}
            </span>
          </div>
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontWeight: 600,
              color: total >= 0 ? "var(--success, #047857)" : "var(--danger, #dc2626)",
            }}
          >
            {fmt(total)}
          </span>
        </div>
        {expanded && entries && entries.length > 0 && (
          <table
            style={{
              width: "100%",
              fontSize: "0.8rem",
              borderCollapse: "collapse",
            }}
          >
            <thead>
              <tr style={{ background: "#f8fafc" }}>
                <th style={{ textAlign: "left", padding: "0.4rem 1rem" }}>
                  Category
                </th>
                <th style={{ textAlign: "left", padding: "0.4rem 0.5rem" }}>
                  Mapped Account
                </th>
                {coveredByLabel && (
                  <th style={{ textAlign: "left", padding: "0.4rem 0.5rem" }}>
                    {coveredByLabel}
                  </th>
                )}
                <th
                  style={{
                    textAlign: "right",
                    padding: "0.4rem 1rem",
                  }}
                >
                  Budget
                </th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e, i) => (
                <tr
                  key={i}
                  style={{
                    borderTop: "1px solid #f1f5f9",
                  }}
                >
                  <td style={{ padding: "0.35rem 1rem" }}>
                    {e.category_name}
                  </td>
                  <td
                    style={{
                      padding: "0.35rem 0.5rem",
                      color: e.mapped_account
                        ? "var(--ink)"
                        : "var(--danger, #dc2626)",
                      fontStyle: e.mapped_account ? "normal" : "italic",
                    }}
                  >
                    {e.mapped_account || "unmapped"}
                  </td>
                  {coveredByLabel && (
                    <td
                      style={{
                        padding: "0.35rem 0.5rem",
                        color: "var(--text-secondary)",
                      }}
                    >
                      {e.covered_by}
                    </td>
                  )}
                  <td
                    style={{
                      textAlign: "right",
                      padding: "0.35rem 1rem",
                      fontFamily: "var(--font-mono)",
                      color:
                        e.budget_total >= 0
                          ? "var(--success, #047857)"
                          : "var(--danger, #dc2626)",
                    }}
                  >
                    {fmt(e.budget_total)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    );
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15,23,42,0.6)",
        backdropFilter: "blur(6px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "2rem",
        zIndex: 1000,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(950px, 96vw)",
          maxHeight: "90vh",
          background: "#f8fafc",
          borderRadius: "1.25rem",
          boxShadow: "0 20px 60px -12px rgba(37,99,235,0.25)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            padding: "1.5rem 2rem",
            background: "white",
            borderBottom: "1px solid #e2e8f0",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <h2 style={{ margin: 0, fontSize: "1.25rem", fontWeight: 700 }}>
            Budget Coverage Check
          </h2>
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              fontSize: "1.5rem",
              cursor: "pointer",
              color: "#64748b",
            }}
          >
            &times;
          </button>
        </div>

        <div style={{ padding: "1rem 2rem", overflow: "auto", flex: 1 }}>
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
            {summary && (
              <span
                style={{
                  marginLeft: "auto",
                  fontSize: "0.85rem",
                  color: "var(--text-secondary)",
                }}
              >
                {summary.total_categories} categories analyzed
              </span>
            )}
          </div>

          {error && (
            <div style={{ color: "var(--danger)", marginBottom: "0.5rem" }}>
              {error}
            </div>
          )}

          {loading ? (
            <p>Analyzing coverage...</p>
          ) : items ? (
            <>
              {/* Summary cards */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(3, 1fr)",
                  gap: "0.75rem",
                  marginBottom: "1rem",
                }}
              >
                {[
                  {
                    label: "Not Covered",
                    count: summary.not_covered_count,
                    total: summary.not_covered_total,
                    color: "#dc2626",
                  },
                  {
                    label: "FC IncExp",
                    count: summary.covered_incexp_count,
                    total: summary.covered_incexp_total,
                    color: "#1e40af",
                  },
                  {
                    label: "BS Module",
                    count: summary.covered_module_count,
                    total: summary.covered_module_total,
                    color: "#047857",
                  },
                ].map(({ label, count, total, color }) => (
                  <div
                    key={label}
                    style={{
                      background: "white",
                      borderRadius: "0.75rem",
                      padding: "0.75rem 1rem",
                      borderLeft: `4px solid ${color}`,
                    }}
                  >
                    <div
                      style={{
                        fontSize: "0.75rem",
                        color: "var(--text-secondary)",
                        fontWeight: 600,
                        textTransform: "uppercase",
                        letterSpacing: "0.05em",
                      }}
                    >
                      {label}
                    </div>
                    <div
                      style={{
                        fontSize: "1.1rem",
                        fontWeight: 700,
                        color,
                      }}
                    >
                      {count} items
                    </div>
                    <div
                      style={{
                        fontSize: "0.85rem",
                        fontFamily: "var(--font-mono)",
                        color: "var(--text-secondary)",
                      }}
                    >
                      {fmt(total)}
                    </div>
                  </div>
                ))}
              </div>

              {/* Sections */}
              {renderSection(
                "not_covered",
                "Not Covered",
                "#dc2626",
                items.not_covered,
                null
              )}
              {renderSection(
                "covered_incexp",
                "Covered by FC Income/Expense",
                "#1e40af",
                items.covered_incexp,
                "FC Item"
              )}
              {renderSection(
                "covered_module",
                "Covered by BS Module",
                "#047857",
                items.covered_module,
                "Module"
              )}
            </>
          ) : null}
        </div>

        <div
          style={{
            padding: "1rem 2rem",
            borderTop: "1px solid #e2e8f0",
            background: "white",
            display: "flex",
            justifyContent: "flex-end",
          }}
        >
          <button
            onClick={onClose}
            style={{
              padding: "0.5rem 1.25rem",
              borderRadius: "0.5rem",
              border: "1px solid #cbd5e1",
              background: "white",
              cursor: "pointer",
            }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
