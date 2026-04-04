import { useCallback, useEffect, useState } from "react";
import { useToast } from "../contexts/ToastContext.jsx";
import Rest from "../js/rest.js";
import "./PageLayout.css";
import "./ProgramSettings.css";

const CURRENT_YEAR = new Date().getFullYear();
const BUDGET_YEAR_CHOICES = Array.from({ length: 6 }, (_, i) => CURRENT_YEAR - 1 + i);

const fmt = (v) =>
  v != null && Number.isFinite(v)
    ? v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : "-";

export default function ProgramSettings() {
  const { addToast } = useToast();
  const [defaultBudgetYear, setDefaultBudgetYear] = useState("");
  const [loading, setLoading] = useState(true);

  // Calibration state
  const [calStatus, setCalStatus] = useState([]);
  const [calLoading, setCalLoading] = useState(false);
  const [mapLoading, setMapLoading] = useState(false);
  const [calibrating, setCalibrating] = useState(null); // null | 'all' | accountId

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await Rest.fetchAppDataV2();
        const doc = Array.isArray(data) && data.length > 0 ? data[0] : data;
        if (!cancelled && doc?.defaultBudgetYear != null) {
          setDefaultBudgetYear(String(doc.defaultBudgetYear));
        }
      } catch (err) {
        console.warn("Failed to load program settings:", err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const handleBudgetYearChange = useCallback(async (e) => {
    const year = e.target.value;
    setDefaultBudgetYear(year);
    try {
      const response = await fetch(Rest.buildUrl("/api/v2/util/appdata"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          updates: [{ key: "defaultBudgetYear", value: year ? Number(year) : null }],
        }),
      });
      await Rest.handleResponse(response);
      addToast(`Default budget year set to ${year}`, "success");
    } catch (err) {
      addToast("Failed to save default budget year", "error");
    }
  }, [addToast]);

  // ── Calibration handlers ──────────────────────────────────────────

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
      <div className="program-settings-container">
        <header className="program-settings-header">
          <h1 className="program-settings-header__title">Program Settings</h1>
          <p className="program-settings-header__subtitle">
            Configure application preferences and defaults
          </p>
        </header>

        <section className="program-settings-section">
          <h2 className="program-settings-section__title">Budget Defaults</h2>
          <div className="program-settings-field">
            <label className="program-settings-field__label" htmlFor="defaultBudgetYear">
              Default Budget Year
            </label>
            <p className="program-settings-field__description">
              The budget year pre-selected when opening the Budget Worksheet
            </p>
            <select
              id="defaultBudgetYear"
              className="program-settings-field__select"
              value={defaultBudgetYear}
              onChange={handleBudgetYearChange}
              disabled={loading}
            >
              <option value="">Current year + 1 (default)</option>
              {BUDGET_YEAR_CHOICES.map((yr) => (
                <option key={yr} value={String(yr)}>{yr}</option>
              ))}
            </select>
          </div>
        </section>

        <section className="program-settings-section">
          <h2 className="program-settings-section__title">Balance Calibration</h2>
          <p className="program-settings-field__description">
            Calibrate account opening balances to ensure Balance Sheet accuracy.
            Maps PocketSmith transaction accounts, then back-calculates opening balances
            from the most recent known closing balance.
          </p>

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
        </section>

      </div>
    </main>
  );
}
