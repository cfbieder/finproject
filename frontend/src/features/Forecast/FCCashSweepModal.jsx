import { useState, useEffect } from "react";
import Rest from "../../js/rest.js";

const fmt = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n) || n === 0) return "\u2014";
  return n < 0
    ? `(${Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: 0 })})`
    : n.toLocaleString("en-US", { maximumFractionDigits: 0 });
};

export default function FCCashSweepModal({ isOpen, onClose, scenario }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!isOpen || !scenario) {
      setData(null);
      return;
    }
    setLoading(true);
    setError("");
    Rest.get(`/forecast/audittrail/${encodeURIComponent(scenario)}/cash-sweep`)
      .then((result) => setData(result))
      .catch((err) => setError(err.message || "Failed to load cash sweep data"))
      .finally(() => setLoading(false));
  }, [isOpen, scenario]);

  if (!isOpen) return null;

  const headers = data?.headers || [];
  const rows = data?.rows || [];
  const lastMod = data?.lastModified ? new Date(data.lastModified).toLocaleString() : null;

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, background: "rgba(15,23,42,0.6)",
        backdropFilter: "blur(6px)", display: "flex", alignItems: "center",
        justifyContent: "center", padding: "1rem", zIndex: 1100,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(95vw, 1100px)", maxHeight: "90vh", background: "white",
          borderRadius: "1rem", boxShadow: "0 20px 60px -12px rgba(37,99,235,0.25)",
          display: "flex", flexDirection: "column", overflow: "hidden",
        }}
      >
        {/* Header */}
        <div style={{
          padding: "1rem 1.5rem", borderBottom: "1px solid #e2e8f0",
          display: "flex", justifyContent: "space-between", alignItems: "center",
        }}>
          <div>
            <h3 style={{ margin: 0, fontSize: "1.1rem", fontWeight: 700 }}>
              Cash Sweep Summary
            </h3>
            <span style={{ fontSize: "0.8rem", color: "var(--text-secondary)" }}>
              Scenario: {scenario}
              {lastMod && <> &middot; Generated: {lastMod}</>}
            </span>
          </div>
          <button
            onClick={onClose}
            style={{ background: "none", border: "none", fontSize: "1.5rem", cursor: "pointer", color: "#64748b" }}
          >
            &times;
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: "1rem 1.5rem", overflow: "auto", flex: 1 }}>
          {loading && <p style={{ color: "var(--text-secondary)" }}>Loading...</p>}
          {error && <p style={{ color: "var(--danger, #ef4444)" }}>{error}</p>}
          {!loading && !error && rows.length === 0 && (
            <p style={{ color: "var(--text-secondary)" }}>No cash sweep data. Generate the forecast with a cash sweep target first.</p>
          )}
          {!loading && rows.length > 0 && (
            <div style={{ overflow: "auto", maxHeight: "70vh", border: "1px solid #e2e8f0", borderRadius: "0.5rem" }}>
              <table className="data-table" style={{ width: "100%", fontSize: "0.78rem", whiteSpace: "nowrap" }}>
                <thead>
                  <tr>
                    {headers.map((h) => (
                      <th
                        key={h}
                        style={{
                          position: "sticky", top: 0, background: "#f8fafc", zIndex: 1,
                          textAlign: h === "Year" || h === "Action" ? "left" : "right",
                          padding: "0.4rem 0.6rem", fontWeight: 600, fontSize: "0.72rem",
                          borderBottom: "2px solid #e2e8f0",
                        }}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, ri) => (
                    <tr key={ri} style={{ background: ri % 2 === 0 ? "white" : "#fafbfc" }}>
                      {row.map((cell, ci) => {
                        const colName = headers[ci];
                        const isYear = colName === "Year";
                        const isAction = colName === "Action";

                        const n = Number(cell);
                        const display = isYear || isAction ? cell : fmt(cell);

                        let actionColor;
                        if (isAction) {
                          if (cell === "sweep_in") actionColor = "#16a34a";
                          else if (cell === "sweep_out") actionColor = "#d97706";
                          else if (cell === "shortfall") actionColor = "#dc2626";
                          else if (cell === "deposit") actionColor = "#2563eb";
                        }

                        return (
                          <td
                            key={ci}
                            style={{
                              textAlign: isYear || isAction ? "left" : "right",
                              padding: "0.3rem 0.6rem",
                              fontFamily: isYear || isAction ? "inherit" : "var(--font-mono)",
                              fontWeight: isYear || isAction ? 600 : 400,
                              color: actionColor || (!isYear && !isAction && Number.isFinite(n) && n < 0 ? "var(--danger, #ef4444)" : undefined),
                            }}
                          >
                            {display}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
