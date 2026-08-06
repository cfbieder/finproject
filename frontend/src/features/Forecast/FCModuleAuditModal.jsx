import { useState, useEffect } from "react";
import Rest from "../../js/rest.js";
import Modal from "../../components/Modal/Modal.jsx";

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

function AuditTable({ title, data, preHorizon = {}, periodStart = null, isLocal = false }) {
  if (!data) return null;
  const { headers, rows } = data;
  if (!headers || headers.length === 0) return null;

  return (
    <div style={{ marginBottom: "1.5rem" }}>
      <h4 style={{ margin: "0 0 0.5rem", fontSize: "0.9rem", fontWeight: 700 }}>{title}</h4>
      <div style={{ overflow: "auto", maxHeight: "40vh", border: "1px solid var(--border)", borderRadius: "0.5rem" }}>
        <table className="data-table" style={{ width: "100%", fontSize: "0.78rem", whiteSpace: "nowrap" }}>
          <thead>
            <tr>
              {headers.map((h) => (
                <th
                  key={h}
                  style={{
                    position: "sticky", top: 0, background: "var(--surface-muted)", zIndex: 1,
                    textAlign: h === "index" || h === "Year" || h === "Action" ? "left" : "right",
                    padding: "0.4rem 0.6rem", fontWeight: 600, fontSize: "0.72rem",
                    borderBottom: "2px solid var(--border)",
                  }}
                >
                  {h === "index" ? "Year" : h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, ri) => (
              <tr key={ri} style={{ background: ri % 2 === 0 ? "white" : "var(--surface-muted)" }}>
                {row.map((cell, ci) => {
                  const colName = headers[ci];
                  const isIndex = ci === 0;
                  // CR072 §8 P6 — a P&L column in a pre-horizon year is history or plan, not a
                  // dash. `actual_total`/`budget_total` are USD (both queries sum `base_amount`),
                  // so the LOCAL table converts with that row's own FX — the very rate the engine
                  // used for the year — rather than printing a USD figure under a PLN heading.
                  const rowYear = Number(row[0]);
                  const preKey = `${rowYear}|${String(colName).trim().toLowerCase()}`;
                  let preValue = preHorizon[preKey];
                  if (preValue != null && isLocal) {
                    const fxIdx = headers.indexOf("FX");
                    const fx = fxIdx >= 0 ? Number(row[fxIdx]) : NaN;
                    preValue = Number.isFinite(fx) && fx > 0 ? preValue * fx : null;
                  }
                  const isPre = preValue != null;
                  const isAction = colName === "Action";
                  const isPct = pctColumns.has(colName);
                  const isFx = colName === "FX";
                  const n = Number(cell);
                  const display = isIndex ? cell
                    : isAction ? cell
                    : isPre ? fmt(preValue)
                    : isPct ? fmtPct(cell)
                    : isFx && Number.isFinite(n) ? n.toFixed(4)
                    : fmt(cell);

                  // Color-code sweep actions
                  let actionColor;
                  if (isAction) {
                    if (cell === "sweep_in") actionColor = "#5B9E9E";
                    else if (cell === "sweep_out") actionColor = "#d97706";
                    else if (cell === "shortfall") actionColor = "#C0504D";
                    else if (cell === "deposit") actionColor = "#6B8E6B";
                  }

                  return (
                    <td
                      key={ci}
                      style={{
                        textAlign: isIndex || isAction ? "left" : "right",
                        padding: "0.3rem 0.6rem",
                        fontFamily: isIndex || isAction ? "inherit" : "var(--font-mono)",
                        fontWeight: isIndex || isAction ? 600 : 400,
                        color: actionColor || (!isIndex && !isAction && Number.isFinite(n) && n < 0 ? "var(--danger, #C0504D)" : undefined),
                        // A pre-horizon figure is NOT a forecast, and must not read as one.
                        ...(isPre ? { fontStyle: "italic", opacity: 0.75 } : null),
                      }}
                      title={isPre
                        ? (rowYear === periodStart - 1 ? "Budget — not forecast" : "Actual — not forecast")
                        : undefined}
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
      {periodStart && Object.keys(preHorizon).length > 0 && (
        <p style={{ margin: "0.4rem 0 0", fontSize: "0.7rem", color: "var(--muted)" }}>
          <em>Italic</em> = not forecast. {periodStart - 2} is actual, {periodStart - 1} is budget;
          the forecast begins in {periodStart}.
          {isLocal ? " Converted from base currency at that year's FX." : ""}
        </p>
      )}
    </div>
  );
}

export default function FCModuleAuditModal({
  isOpen, onClose, scenario, moduleName,
  // CR072 §8 P6 — the module's P&L lines and the forecast's start, so the two pre-horizon
  // years can show HISTORY instead of a dash. Both optional: without them the table renders
  // exactly as before rather than guessing which column is a line or which year is which.
  lineNames = [], periodStart = null,
}) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [view, setView] = useState("lc"); // "lc" or "usd"

  useEffect(() => {
    if (!isOpen || !scenario || !moduleName) {
      setData(null);
      return;
    }
    setLoading(true);
    setError("");

    Rest.get(`/forecast/audittrail/${encodeURIComponent(scenario)}/${encodeURIComponent(moduleName)}/detail`)
      .then((moduleData) => {
        setData(moduleData);
        if (!moduleData) setError("No audit trail found. Generate the forecast first.");
      })
      .catch((err) => setError(err.message || "Failed to load audit trail"))
      .finally(() => setLoading(false));
  }, [isOpen, scenario, moduleName]);

  // CR072 §8 P6 — the audit trail runs from the module's base_date, so on a valuation module its
  // first two rows are BEFORE the forecast starts and every P&L column in them reads "—". Those
  // years are not unknown, they are history and plan: PeriodStart−2 has actuals, PeriodStart−1 has
  // a budget. Filling them is what lets the owner sanity-check the first forecast amount against
  // what the line has actually been doing.
  //
  // Fetched, never derived from the forecast: these must remain visibly NOT-forecast, which is why
  // they are rendered in a distinct style and called out in a legend under the table.
  const [preHorizon, setPreHorizon] = useState({});
  // Extracted so the dep is statically checkable, and so a new array identity from the parent
  // does not refire the fetch on every render.
  const lineKey = lineNames.join("|");
  useEffect(() => {
    let isActive = true;
    if (!isOpen || !periodStart || !lineKey) return undefined;
    (async () => {
      const [actual, budget] = await Promise.all([
        Rest.fetchFcLineActualTotals(periodStart - 2).catch(() => []),
        Rest.fetchFcLineBudgetTotals(periodStart - 1).catch(() => []),
      ]);
      if (!isActive) return;
      const wanted = new Set(lineKey.split("|").map((n) => n.trim().toLowerCase()));
      const out = {};
      const put = (rows, year, field) => {
        for (const r of rows || []) {
          const name = String(r.fc_line_name || "").trim().toLowerCase();
          if (!wanted.has(name)) continue;
          const v = Number(r[field]);
          if (!Number.isFinite(v) || v === 0) continue;   // 0 budget = none kept, not a plan of zero
          out[`${year}|${name}`] = v;
        }
      };
      put(actual, periodStart - 2, "actual_total");
      put(budget, periodStart - 1, "budget_total");
      setPreHorizon(out);
    })();
    return () => { isActive = false; };
  }, [isOpen, periodStart, lineKey]);

  const lastMod = data?.lc?.lastModified || data?.usd?.lastModified;
  const lastModStr = lastMod ? new Date(lastMod).toLocaleString() : null;

  // This modal is opened from INSIDE the module editor, which is a Radix dialog and stays
  // open behind it. A modal Radix layer sets `pointer-events: none` on <body> and re-enables
  // it only on the topmost layer it owns — so the hand-rolled overlay this used to be
  // rendered on top, looked fine, and swallowed every click including its own ✕. Going
  // through the shared primitive makes it a real (nested) layer, which is what unfreezes it.
  return (
    <Modal
      open={isOpen}
      onClose={onClose}
      bare
      ariaLabel="Module output details"
    >
      <div
        style={{
          width: "min(95vw, 1400px)", maxHeight: "90vh", background: "white",
          borderRadius: "1rem", boxShadow: "0 20px 60px -12px rgba(37,99,235,0.25)",
          display: "flex", flexDirection: "column", overflow: "hidden",
        }}
      >
        {/* Header */}
        <div style={{
          padding: "1rem 1.5rem", borderBottom: "1px solid var(--border)",
          display: "flex", justifyContent: "space-between", alignItems: "center",
        }}>
          <div>
            <h3 style={{ margin: 0, fontSize: "1.1rem", fontWeight: 700 }}>
              Module Output — {moduleName}
            </h3>
            <span style={{ fontSize: "0.8rem", color: "var(--ink-secondary)" }}>
              Scenario: {scenario}
              {lastModStr && <> · Generated: {lastModStr}</>}
            </span>
          </div>
          <button
            onClick={onClose}
            aria-label="Close module output"
            style={{ background: "none", border: "none", fontSize: "1.5rem", cursor: "pointer", color: "var(--muted)" }}
          >
            &times;
          </button>
        </div>

        {/* Toggle */}
        {data && !loading && (
          <div style={{ padding: "0.75rem 1.5rem 0", display: "flex", gap: "0.25rem" }}>
            {[
              { key: "lc", label: "Local Currency" },
              { key: "usd", label: "USD" },
            ].map((tab) => (
              <button
                key={tab.key}
                onClick={() => setView(tab.key)}
                style={{
                  padding: "0.35rem 1rem", fontSize: "0.8rem", fontWeight: view === tab.key ? 600 : 400,
                  border: "1px solid", borderRadius: "999px",
                  borderColor: view === tab.key ? "var(--primary, #567856)" : "var(--border)",
                  background: view === tab.key ? "var(--primary, #567856)" : "white",
                  color: view === tab.key ? "white" : "var(--ink-secondary)",
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
          {loading && <p style={{ color: "var(--ink-secondary)" }}>Loading audit trail...</p>}
          {error && <p style={{ color: "var(--danger, #C0504D)" }}>{error}</p>}
          {data && !loading && view === "lc" && (
            <AuditTable title="Local Currency Values" data={data.lc} preHorizon={preHorizon} periodStart={periodStart} isLocal />
          )}
          {data && !loading && view === "usd" && (
            <AuditTable title="USD Values" data={data.usd} preHorizon={preHorizon} periodStart={periodStart} />
          )}
        </div>
      </div>
    </Modal>
  );
}
