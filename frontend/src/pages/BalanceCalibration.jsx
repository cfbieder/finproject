import BalanceReconciliation from "../components/BalanceReconciliation/BalanceReconciliation.jsx";
import "./PageLayout.css";
import "./BalanceCalibration.css";

/**
 * Balance Calibration page — hosts the CR023 bank reconciliation table (the live
 * PS→feeds cutover gate). The legacy PocketSmith API calibration (Map PS Accounts
 * / Load Status / Calibrate All) was removed in CR030 when automated PocketSmith
 * was retired; reconciliation is now feed-driven via "Reconcile to feed".
 */
export default function BalanceCalibration() {
  return (
    <main className="page-main">
      <div className="balance-calibration-container">
        <header className="balance-calibration-header">
          <h1 className="balance-calibration-header__title">Balance Calibration</h1>
          <p className="balance-calibration-header__subtitle">
            Per fed account: fin&apos;s computed balance vs the bank&apos;s reported
            balance, with a sign-aware reconcile-to-feed action.
          </p>
        </header>

        <BalanceReconciliation />
      </div>
    </main>
  );
}
