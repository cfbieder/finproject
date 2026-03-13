// Budget FX rates have moved to /budget-fx page under Budgeting
// TODO: Consider moving Forecast FX to Forecasting category (see PROJECT_ROADMAP.md)
import ForecastFXAssumptions from "../features/BudgetEntry/ForecastFXAssumptions.jsx";
import "./PageLayout.css";
import "./FXOptions.css";

export default function FXOptions() {
  return (
    <>
      <main className="page-main">
        <div className="fx-options-container">
          <header className="fx-options-header">
            <h1 className="fx-options-header__title">FX Options</h1>
            <p className="fx-options-header__subtitle">
              Manage exchange rates for forecasting
            </p>
          </header>

          <section className="fx-options-section">
            <h2 className="fx-options-section__title">Forecast FX Assumptions</h2>
            <p className="fx-options-section__description">
              Exchange rate assumptions used in forecast scenarios
            </p>
            <ForecastFXAssumptions />
          </section>
        </div>
      </main>
    </>
  );
}
