import { useState, useEffect } from "react";
import Rest from "../../js/rest.js";

const fmt = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n) || n === 0) return "—";
  return n < 0
    ? `(${Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: 0 })})`
    : n.toLocaleString("en-US", { maximumFractionDigits: 0 });
};

const fmtPct = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n) || n === 0) return "—";
  return n.toFixed(2) + "%";
};

const pctColumns = new Set(["GrowthPct", "IncomePct", "ExpensePct"]);

function AuditTable({ title, data }) {
  if (!data) return null;
  const { headers, rows } = data;
  if (!headers || headers.length === 0) return null;

  return (
    <div style={{ marginBottom: "1.5rem" }}>
      <h4 style={{ margin: "0 0 0.5rem", fontSize: "0.9rem", fontWeight: 700 }}>{title}</h4>
      <div style={{ overflow: "auto", maxHeight: "40vh", border: "1px solid #e2e8f0", borderRadius: "0.5rem" }}>
        <table className="data-table" style={{ width: "100%", fontSize: "0.78rem", whiteSpace: "nowrap" }}>
          <thead>
            <tr>
              {headers.map((h) => (
                <th
                  key={h}
                  style={{
                    position: "sticky", top: 0, background: "#f8fafc", zIndex: 1,
                    textAlign: h === "index" || h === "Year" || h === "Action" ? "left" : "right",
                    padding: "0.4rem 0.6rem", fontWeight: 600, fontSize: "0.72rem",
                    borderBottom: "2px solid #e2e8f0",
                  }}
                >
                  {h === "index" ? "Year" : h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, ri) => (
              <tr key={ri} style={{ background: ri % 2 === 0 ? "white" : "#fafbfc" }}>
                {row.map((cell, ci) => {
                  const colName = headers[ci];
                  const isIndex = ci === 0;
                  const isAction = colName === "Action";
                  const isPct = pctColumns.has(colName);
                  const isFx = colName === "FX";
                  const n = Number(cell);
                  const display = isIndex ? cell
                    : isAction ? cell
                    : isPct ? fmtPct(cell)
                    : isFx && Number.isFinite(n) ? n.toFixed(4)
                    : fmt(cell);

                  // Color-code sweep actions
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
                        textAlign: isIndex || isAction ? "left" : "right",
                        padding: "0.3rem 0.6rem",
                        fontFamily: isIndex || isAction ? "inherit" : "var(--font-mono)",
                        fontWeight: isIndex || isAction ? 600 : 400,
                        color: actionColor || (!isIndex && !isAction && Number.isFinite(n) && n < 0 ? "var(--danger, #ef4444)" : undefined),
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
    </div>
  );
}

export default function FCModuleAuditModal({ isOpen, onClose, scenario, moduleName }) {
  const [data, setData] = useState(null);
  const [sweepData, setSweepData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [view, setView] = useState("lc"); // "lc", "usd", or "sweep"

  useEffect(() => {
    if (!isOpen || !scenario || !moduleName) {
      setData(null);
      setSweepData(null);
      return;
    }
    setLoading(true);
    setError("");

    // Fetch module audit trail and cash sweep audit trail in parallel
    Promise.all([
      Rest.get(`/forecast/audittrail/${encodeURIComponent(scenario)}/${encodeURIComponent(moduleName)}/detail`)
        .catch(() => null),
      Rest.get(`/forecast/audittrail/${encodeURIComponent(scenario)}/cash-sweep`)
        .catch(() => null),
    ])
      .then(([moduleData, sweep]) => {
        setData(moduleData);
        setSweepData(sweep);
        if (!moduleData && !sweep) setError("No audit trail found. Generate the forecast first.");
      })
      .catch((err) => setError(err.message || "Failed to load audit trail"))
      .finally(() => setLoading(false));
  }, [isOpen, scenario, moduleName]);

  if (!isOpen) return null;

  const lastMod = data?.lc?.lastModified || data?.usd?.lastModified;
  const lastModStr = lastMod ? new Date(lastMod).toLocaleString() : null;
  const hasSweep = sweepData && sweepData.headers && sweepData.rows?.length > 0;

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
          width: "min(95vw, 1400px)", maxHeight: "90vh", background: "white",
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
              Module Output — {moduleName}
            </h3>
            <span style={{ fontSize: "0.8rem", color: "var(--text-secondary)" }}>
              Scenario: {scenario}
              {lastModStr && <> · Generated: {lastModStr}</>}
            </span>
          </div>
          <button
            onClick={onClose}
            style={{ background: "none", border: "none", fontSize: "1.5rem", cursor: "pointer", color: "#64748b" }}
          >
            &times;
          </button>
        </div>

        {/* Toggle */}
        {(data || hasSweep) && !loading && (
          <div style={{ padding: "0.75rem 1.5rem 0", display: "flex", gap: "0.25rem" }}>
            {[
              { key: "lc", label: "Local Currency" },
              { key: "usd", label: "USD" },
              ...(hasSweep ? [{ key: "sweep", label: "Cash Sweep" }] : []),
            ].map((tab) => (
              <button
                key={tab.key}
                onClick={() => setView(tab.key)}
                style={{
                  padding: "0.35rem 1rem", fontSize: "0.8rem", fontWeight: view === tab.key ? 600 : 400,
                  border: "1px solid", borderRadius: "999px",
                  borderColor: view === tab.key ? (tab.key === "sweep" ? "#059669" : "var(--primary, #1e40af)") : "#d1d5db",
                  background: view === tab.key ? (tab.key === "sweep" ? "#059669" : "var(--primary, #1e40af)") : "white",
                  color: view === tab.key ? "white" : "#4b5563",
                  cursor: "pointer", transition: "all 0.15s",
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>
        )}

        {/* Body */}
        <div style={{ padding: "1rem 1.5rem", overflow: "auto", flex: 1 }}>
          {loading && <p style={{ color: "var(--text-secondary)" }}>Loading audit trail...</p>}
          {error && <p style={{ color: "var(--danger, #ef4444)" }}>{error}</p>}
          {data && !loading && view === "lc" && (
            <AuditTable title="Local Currency Values" data={data.lc} />
          )}
          {data && !loading && view === "usd" && (
            <AuditTable title="USD Values" data={data.usd} />
          )}
          {hasSweep && !loading && view === "sweep" && (
            <AuditTable title="Cash Sweep Summary" data={sweepData} />
          )}
        </div>
      </div>
    </div>
  );
}
