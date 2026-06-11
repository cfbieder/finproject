import ManualReconciliation from "../components/ManualReconciliation/ManualReconciliation.jsx";
import "./PageLayout.css";
import "./BalanceCalibration.css";

/**
 * Manual Calibration page (CR033) — the non-fed twin of Balance Calibration.
 * For balance-sheet accounts with NO bank feed: compare fin's computed balance
 * against a current balance the user types in, with the same sign-aware
 * calibrate / MTM reconcile action.
 */
export default function ManualCalibration() {
  return (
    <main className="page-main">
      <div className="balance-calibration-container">
        <header className="balance-calibration-header">
          <h1 className="balance-calibration-header__title">Manual Calibration</h1>
          <p className="balance-calibration-header__subtitle">
            Per non-fed account: fin&apos;s computed balance vs a current balance you
            enter by hand, with a sign-aware reconcile action.
          </p>
        </header>

        <ManualReconciliation />
      </div>
    </main>
  );
}
