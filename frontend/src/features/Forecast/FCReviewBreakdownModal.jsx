import { useCallback, useEffect, useMemo, useState } from "react";
import { formatAmount } from "./utils/fcReviewUtils.js";
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

/**
 * A forecast cell's entries, as a compact list in the Workbench side inspector
 * (CR105 S4; the overlay version went with the classic layout in S6c). Its module
 * links and the Modify Transfer editor still open as dialogs on top.
 */
export default function FCReviewBreakdownModal({
  breakdownModal,
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

  const childModals = (
    <>
      <FCReviewAuditTrailModal auditModal={auditTrailModal} onClose={handleCloseAuditModal} />
      <FCReviewAdjustTransferModal
        isOpen={adjustTransferModal.isOpen}
        onClose={handleCloseAdjustTransferModal}
        entry={adjustTransferModal.entry}
        scenarioName={scenarioName}
        onTransferComplete={onTransferComplete}
      />
    </>
  );

  const neg = (v) => (Number(v) < 0 ? " insp-amt--neg" : "");
  return (
    <div className="insp-drill">
      <dl className="insp-facts">
        <dt>Amount</dt>
        <dd className={`insp-amt${neg(amount)}`}>{formatAmount(amount)}</dd>
        {hasEntries && (
          <>
            <dt>Entries total</dt>
            <dd className={`insp-amt${neg(entryTotal)}`}>{formatAmount(entryTotal)}</dd>
          </>
        )}
      </dl>
      {hasEntries ? (
        <ul className="insp-list">
          {entries.map((entry, index) => {
            const editable = isAmountEditable(entry);
            return (
              <li key={`${entry?.Account}-${entry?.Year}-${index}`} className="insp-item">
                <div className="insp-item__top">
                  <span className="insp-item__desc">
                    {entry?.Module ? (
                      <button
                        type="button"
                        className="insp-link"
                        onClick={() => handleModuleClick(entry.Module)}
                        disabled={!moduleClickEnabled}
                        title="Open this module's audit trail"
                      >
                        {entry.Module}
                      </button>
                    ) : (
                      entry?.Account || "—"
                    )}
                  </span>
                  {editable ? (
                    <button
                      type="button"
                      className={`insp-link insp-amt${neg(entry?.Amount)}`}
                      onClick={() => handleAmountClick(entry)}
                      title="Modify this transfer"
                    >
                      {formatAmount(entry?.Amount)}
                    </button>
                  ) : (
                    <span className={`insp-amt${neg(entry?.Amount)}`}>{formatAmount(entry?.Amount)}</span>
                  )}
                </div>
                <div className="insp-item__meta">
                  {entry?.Account || "—"} · {entry?.Year ?? "—"}
                  {entry?.Comment ? ` · ${entry.Comment}` : ""}
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="insp-muted">No forecast entries found for this cell.</p>
      )}
      {childModals}
    </div>
  );

}
