import { useCallback, useState } from "react";
import { useToast } from "../contexts/ToastContext.jsx";
import Rest from "../js/rest.js";
import BalanceReconciliation from "../components/BalanceReconciliation/BalanceReconciliation.jsx";
import "./PageLayout.css";
import "./BalanceCalibration.css";

const fmt = (v) =>
  v != null && Number.isFinite(v)
    ? v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : "-";

export default function BalanceCalibration() {
  const { addToast } = useToast();

  const [calStatus, setCalStatus] = useState([]);
  const [calLoading, setCalLoading] = useState(false);
  const [mapLoading, setMapLoading] = useState(false);
  const [calibrating, setCalibrating] = useState(null);

  const loadCalibrationStatus = useCallback(async () => {
    setCalLoading(true);
    try {
      const result = await Rest.fetchCalibrationStatus();
      setCalStatus(result?.data ?? []);
    } catch (err) {
      addToast("Failed to load calibration status", "error");
    } finally {
      setCalLoading(false);
    }
  }, [addToast]);

  const handleMapPsAccounts = useCallback(async () => {
    setMapLoading(true);
    try {
      const result = await Rest.mapPsAccounts();
      addToast(
        `Mapped ${result.matched} accounts (${result.unmatched} unmatched)`,
        result.unmatched > 0 ? "warning" : "success"
      );
      await loadCalibrationStatus();
    } catch (err) {
      addToast("Failed to map PocketSmith accounts", "error");
    } finally {
      setMapLoading(false);
    }
  }, [addToast, loadCalibrationStatus]);

  const handleCalibrate = useCallback(async (accountId) => {
    setCalibrating(accountId ?? "all");
    try {
      const result = await Rest.calibrateAccounts(accountId);
      addToast(`Calibrated ${result.calibrated} account(s)`, "success");
      await loadCalibrationStatus();
    } catch (err) {
      addToast("Calibration failed", "error");
    } finally {
      setCalibrating(null);
    }
  }, [addToast, loadCalibrationStatus]);

  return (
    <main className="page-main">
      <div className="balance-calibration-container">
        <header className="balance-calibration-header">
          <h1 className="balance-calibration-header__title">Balance Calibration</h1>
          <p className="balance-calibration-header__subtitle">
            Calibrate account opening balances to ensure Balance Sheet accuracy.
            Maps PocketSmith transaction accounts, then back-calculates opening balances
            from the most recent known closing balance.
          </p>
        </header>

        {/* CR023 bank reconciliation — the live cutover gate (PS calibration below
            is the legacy path, being phased out). */}
        <BalanceReconciliation />

        <h2 className="balance-calibration-header__title" style={{ fontSize: "1.15rem", marginTop: "1.75rem" }}>
          PocketSmith calibration <span style={{ fontWeight: 400, fontSize: "0.85rem", opacity: 0.7 }}>(legacy — phasing out)</span>
        </h2>

        <div className="calibration-actions">
          <button
            className="btn btn--primary"
            onClick={handleMapPsAccounts}
            disabled={mapLoading}
          >
            {mapLoading ? "Mapping..." : "Map PocketSmith Accounts"}
          </button>
          <button
            className="btn btn--primary"
            onClick={loadCalibrationStatus}
            disabled={calLoading}
          >
            {calLoading ? "Loading..." : "Load Status"}
          </button>
          <button
            className="btn btn--primary"
            onClick={() => handleCalibrate()}
            disabled={calibrating !== null}
          >
            {calibrating === "all" ? "Calibrating..." : "Calibrate All"}
          </button>
        </div>

        {calStatus.length > 0 && (
          <div className="calibration-table-wrap">
            <table className="calibration-table">
              <thead>
                <tr>
                  <th className="calibration-th">Account</th>
                  <th className="calibration-th">CCY</th>
                  <th className="calibration-th calibration-th--right">Calculated</th>
                  <th className="calibration-th calibration-th--right">PocketSmith</th>
                  <th className="calibration-th calibration-th--right">Difference</th>
                  <th className="calibration-th">Last Calibrated</th>
                  <th className="calibration-th">PS Mapped</th>
                  <th className="calibration-th"></th>
                </tr>
              </thead>
              <tbody>
                {calStatus.map((acct) => {
                  const hasDiff = acct.difference !== null && Math.abs(acct.difference) >= 0.01;
                  return (
                    <tr key={acct.id} className={hasDiff ? "calibration-row--diff" : ""}>
                      <td className="calibration-td">{acct.name}</td>
                      <td className="calibration-td">{acct.currency}</td>
                      <td className="calibration-td calibration-td--right">{fmt(acct.calculatedBalance)}</td>
                      <td className="calibration-td calibration-td--right">
                        {acct.psBalance !== null ? fmt(acct.psBalance) : "-"}
                      </td>
                      <td className={`calibration-td calibration-td--right ${hasDiff ? "calibration-td--negative" : ""}`}>
                        {acct.difference !== null ? fmt(acct.difference) : "-"}
                      </td>
                      <td className="calibration-td">
                        {acct.lastCalibratedAt
                          ? new Date(acct.lastCalibratedAt).toLocaleDateString()
                          : "Never"}
                      </td>
                      <td className="calibration-td">{acct.psMapped ? "Yes" : "No"}</td>
                      <td className="calibration-td">
                        {hasDiff && (
                          <button
                            className="calibration-btn"
                            onClick={() => handleCalibrate(acct.id)}
                            disabled={calibrating !== null}
                          >
                            {calibrating === acct.id ? "..." : "Recalibrate"}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </main>
  );
}
