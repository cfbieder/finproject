import ForecastFXAssumptions from "../features/BudgetEntry/ForecastFXAssumptions.jsx";
import "./PageLayout.css";
import "./FXOptions.css";

export default function FXOptions() {
  return (
    <>
      <main className="page-main">
        <div className="fx-options-container">
          <header className="fx-options-header">
            <h1 className="fx-options-header__title">Forecast FX Assumptions</h1>
            <p className="fx-options-header__subtitle">
              Exchange rate assumptions used in forecast scenarios
            </p>
          </header>

          <section className="fx-options-section">
            <ForecastFXAssumptions />
          </section>
        </div>
      </main>
    </>
  );
}
