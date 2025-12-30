import { useCallback, useEffect, useMemo, useState } from "react";
import { formatAmount } from "./utils/fcReviewUtils.js";
import FCReviewAuditTrailModal from "./FCReviewAuditTrailModal.jsx";

const normalizeKey = (value = "") =>
  value
    .toString()
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .replace(/_+/g, "_")
    .toLowerCase();

const auditTrailImports = import.meta.glob(
  "../../../../components/data/auditTrail/*_entries.csv?raw"
);

const auditTrailLoaderMap = new Map(
  Object.entries(auditTrailImports).map(([path, loader]) => {
    const fileName =
      path
        .split("/")
        .pop()
        ?.replace(/\?raw$/, "")
        ?.replace(/\.csv$/, "") || "";
    const normalized = normalizeKey(fileName);
    return [normalized, loader];
  })
);

const parseCsv = (text = "") => {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) {
    return { headers: [], rows: [] };
  }

  const headers = lines[0].split(",").map((header) => header.trim());
  const rows = lines.slice(1).map((line) => {
    const cells = line.split(",");
    return headers.reduce((row, header, index) => {
      row[header] = cells[index] ?? "";
      return row;
    }, {});
  });

  return { headers, rows };
};

const initialAuditState = {
  isOpen: false,
  title: "",
  headers: [],
  rows: [],
  loading: false,
  error: null,
};

export default function FCReviewBreakdownModal({
  breakdownModal,
  onClose,
  scenarioName,
}) {
  if (!breakdownModal?.isOpen) {
    return null;
  }

  const { title, amount, entryTotal, entries = [] } = breakdownModal || {};
  const hasEntries = entries.length > 0;
  const [auditTrailModal, setAuditTrailModal] = useState(initialAuditState);

  useEffect(() => {
    if (!breakdownModal?.isOpen) {
      setAuditTrailModal(initialAuditState);
    }
  }, [breakdownModal?.isOpen]);

  const moduleClickEnabled = useMemo(
    () => Boolean(scenarioName && hasEntries),
    [hasEntries, scenarioName]
  );

  const handleModuleClick = useCallback(
    async (moduleName) => {
      if (!moduleClickEnabled || !moduleName) {
        return;
      }

      const key = normalizeKey(`${scenarioName}_${moduleName}_entries`);
      const loader = auditTrailLoaderMap.get(key);
      console.log("Loading audit trail for key:", key, loader);
      const modalTitle = `${moduleName} • ${scenarioName}`;

      if (!loader) {
        setAuditTrailModal({
          ...initialAuditState,
          isOpen: true,
          title: modalTitle,
          error: "No audit trail file found for this module.",
        });
        return;
      }

      setAuditTrailModal((prev) => ({
        ...prev,
        isOpen: true,
        title: modalTitle,
        loading: true,
        error: null,
        headers: [],
        rows: [],
      }));

      try {
        const module = await loader();
        const csvText = module?.default ?? module ?? "";
        const { headers, rows } = parseCsv(csvText);
        if (!headers.length || !rows.length) {
          setAuditTrailModal({
            ...initialAuditState,
            isOpen: true,
            title: modalTitle,
            error: "No audit trail data found for this module.",
          });
          return;
        }

        setAuditTrailModal({
          isOpen: true,
          title: modalTitle,
          headers,
          rows,
          loading: false,
          error: null,
        });
      } catch (err) {
        console.error("Failed to load audit trail", err);
        setAuditTrailModal({
          ...initialAuditState,
          isOpen: true,
          title: modalTitle,
          error: "Unable to load audit trail data.",
        });
      }
    },
    [moduleClickEnabled, scenarioName]
  );

  const handleCloseAuditModal = useCallback(() => {
    setAuditTrailModal(initialAuditState);
  }, []);

  return (
    <>
      <div
        className="trans-budget-edit-modal-overlay"
        role="dialog"
        aria-modal="true"
        aria-label="Forecast entry breakdown"
      >
        <div
          className="trans-budget-edit-modal"
          style={{
            width: "min(760px, 95vw)",
            maxHeight: "75vh",
            overflowY: "auto",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "flex-start",
              gap: "1rem",
            }}
          >
            <div>
              <p
                style={{
                  margin: 0,
                  fontSize: "0.85rem",
                  color: "var(--muted)",
                  letterSpacing: "0.05em",
                  textTransform: "uppercase",
                  fontWeight: 700,
                }}
              >
                Entry Breakdown
              </p>
              <h3 style={{ margin: "0.25rem 0 0", color: "var(--ink)" }}>
                {title}
              </h3>
              <p
                style={{
                  margin: "0.35rem 0 0",
                  color: "var(--muted)",
                  fontWeight: 600,
                }}
              >
                Amount:{" "}
                <span
                  style={{
                    color: Number(amount) < 0 ? "var(--danger)" : "var(--ink)",
                  }}
                >
                  {formatAmount(amount)}
                </span>
                {hasEntries ? (
                  <>
                    {" "}
                    • Entries total:{" "}
                    <span
                      style={{
                        color:
                          Number(entryTotal) < 0
                            ? "var(--danger)"
                            : "var(--ink)",
                      }}
                    >
                      {formatAmount(entryTotal)}
                    </span>
                  </>
                ) : null}
              </p>
            </div>
            <button
              type="button"
              className="generate-report-button"
              onClick={onClose}
            >
              Close
            </button>
          </div>
          {hasEntries ? (
            <div style={{ overflowX: "auto" }}>
              <table className="trans-budget-table">
                <thead>
                  <tr>
                    <th style={{ textAlign: "left" }}>Account</th>
                    <th style={{ textAlign: "left", minWidth: "120px" }}>
                      Module
                    </th>
                    <th style={{ textAlign: "left", minWidth: "90px" }}>
                      Year
                    </th>
                    <th
                      className="trans-budget-table__value--numeric"
                      style={{ minWidth: "140px" }}
                    >
                      Amount
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((entry, index) => (
                    <tr key={`${entry?.Account}-${entry?.Year}-${index}`}>
                      <td>{entry?.Account || "-"}</td>
                      <td>
                        {entry?.Module ? (
                          <button
                            type="button"
                            onClick={() => handleModuleClick(entry?.Module)}
                            style={{
                              background: "none",
                              border: "none",
                              padding: 0,
                              color: moduleClickEnabled
                                ? "var(--primary)"
                                : "var(--ink)",
                              textDecoration: moduleClickEnabled
                                ? "underline"
                                : "none",
                              cursor: moduleClickEnabled
                                ? "pointer"
                                : "default",
                              fontWeight: 600,
                            }}
                          >
                            {entry.Module}
                          </button>
                        ) : (
                          "-"
                        )}
                      </td>
                      <td>{entry?.Year ?? "-"}</td>
                      <td
                        className="trans-budget-table__value--numeric"
                        style={{
                          color:
                            Number(entry?.Amount) < 0
                              ? "var(--danger)"
                              : undefined,
                        }}
                      >
                        {formatAmount(entry?.Amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p
              style={{
                margin: 0,
                color: "var(--muted)",
                fontWeight: 600,
              }}
            >
              No forecast entries found for this cell.
            </p>
          )}
        </div>
      </div>
      <FCReviewAuditTrailModal
        auditModal={auditTrailModal}
        onClose={handleCloseAuditModal}
      />
    </>
  );
}
