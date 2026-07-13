import { useCallback, useEffect, useMemo, useState } from "react";
import { formatAmount } from "./utils/fcReviewUtils.js";
import Modal from "../../components/Modal/Modal.jsx";
import FCReviewAuditTrailModal from "./FCReviewAuditTrailModal.jsx";
import FCReviewAdjustTransferModal from "./FCReviewAdjustTransferModal.jsx";

const initialAuditState = {
  isOpen: false,
  title: "",
  headers: [],
  rows: [],
  loading: false,
  error: null,
};

const initialAdjustTransferState = {
  isOpen: false,
  entry: null,
};

/**
 * `_cash_sweep` (and any future `_`-prefixed name) is a SYNTHETIC module: the engine
 * attributes swept cash to it, so it appears in the breakdown, but it has no row in
 * forecast_modules and no Invest/Dispose to edit.
 *
 * Double-clicking its amount opened Modify Transfer, which looked it up by name, found
 * nothing, and said "Module not found" — an editor offered on something uneditable. Its
 * module-name link already opens the sweep's audit trail, which is the useful thing.
 */
const isSyntheticModule = (name) =>
  typeof name === "string" && name.startsWith("_");

export default function FCReviewBreakdownModal({
  breakdownModal,
  onClose,
  scenarioName,
  onTransferComplete,
}) {
  const { title, amount, entryTotal, entries = [] } = breakdownModal || {};
  const hasEntries = entries.length > 0;
  const [auditTrailModal, setAuditTrailModal] = useState(initialAuditState);
  const [adjustTransferModal, setAdjustTransferModal] = useState(
    initialAdjustTransferState
  );

  // Check if this breakdown modal was opened from the Transfers row
  const isTransfersRow = useMemo(() => {
    return title?.startsWith("Transfers");
  }, [title]);

  useEffect(() => {
    if (!breakdownModal?.isOpen) {
      setAuditTrailModal(initialAuditState);
      setAdjustTransferModal(initialAdjustTransferState);
    }
  }, [breakdownModal?.isOpen]);

  const moduleClickEnabled = useMemo(
    () => Boolean(scenarioName && hasEntries),
    [hasEntries, scenarioName]
  );

  const handleModuleClick = useCallback(
    async (moduleName) => {
      if (!moduleClickEnabled || !moduleName || !scenarioName) {
        return;
      }

      const modalTitle = `${moduleName} • ${scenarioName}`;

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
        // Call the v2 API endpoint to retrieve the audit trail data
        const response = await fetch(
          `/api/v2/forecast/audittrail/${encodeURIComponent(
            scenarioName
          )}/${encodeURIComponent(moduleName)}`
        );

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          setAuditTrailModal({
            ...initialAuditState,
            isOpen: true,
            title: modalTitle,
            error:
              errorData.error || "No audit trail file found for this module.",
          });
          return;
        }

        const { headers = [], rows = [] } = await response.json();

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

  // Only a real module's transfer amount can be modified.
  const isAmountEditable = useCallback(
    (entry) => isTransfersRow && !isSyntheticModule(entry?.Module),
    [isTransfersRow]
  );

  const handleAmountClick = useCallback((entry) => {
    if (isSyntheticModule(entry?.Module)) return;
    setAdjustTransferModal({
      isOpen: true,
      entry,
    });
  }, []);

  const handleCloseAdjustTransferModal = useCallback(() => {
    setAdjustTransferModal(initialAdjustTransferState);
  }, []);

  return (
    <>
      <Modal
        open={Boolean(breakdownModal?.isOpen)}
        onClose={onClose}
        bare
        closeOnOutside={false}
        ariaLabel="Forecast entry breakdown"
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
                    <th style={{ textAlign: "left", minWidth: "160px" }}>
                      Comment
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
                      <td style={{ whiteSpace: "pre-wrap" }}>
                        {entry?.Comment || "-"}
                      </td>
                      <td
                        className="trans-budget-table__value--numeric"
                        style={{
                          color:
                            Number(entry?.Amount) < 0
                              ? "var(--danger)"
                              : undefined,
                          ...(isAmountEditable(entry) && {
                            cursor: "pointer",
                            textDecoration: "underline dotted",
                            textDecorationColor: "var(--primary)",
                            textUnderlineOffset: "3px",
                          }),
                        }}
                        onDoubleClick={
                          isAmountEditable(entry)
                            ? () => handleAmountClick(entry)
                            : undefined
                        }
                        onMouseEnter={
                          isAmountEditable(entry)
                            ? (e) => {
                                e.currentTarget.style.backgroundColor =
                                  "var(--surface-muted)";
                              }
                            : undefined
                        }
                        onMouseLeave={
                          isAmountEditable(entry)
                            ? (e) => {
                                e.currentTarget.style.backgroundColor = "";
                              }
                            : undefined
                        }
                        title={
                          isAmountEditable(entry)
                            ? "Double-click to modify"
                            : isSyntheticModule(entry?.Module)
                              ? "Generated by the engine — click the module name for its audit trail"
                              : undefined
                        }
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
      </Modal>
      <FCReviewAuditTrailModal
        auditModal={auditTrailModal}
        onClose={handleCloseAuditModal}
      />
      <FCReviewAdjustTransferModal
        isOpen={adjustTransferModal.isOpen}
        onClose={handleCloseAdjustTransferModal}
        entry={adjustTransferModal.entry}
        scenarioName={scenarioName}
        onTransferComplete={onTransferComplete}
      />
    </>
  );
}
