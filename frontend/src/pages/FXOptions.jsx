import NavigationMenu from "../components/NavigationMenu.jsx";
import BudgetOptionExchangeRates from "../features/BudgetEntry/BudgetOptionExchangeRates.jsx";
import ForecastFXAssumptions from "../features/BudgetEntry/ForecastFXAssumptions.jsx";
import "./PageLayout.css";
import "./FXOptions.css";

export default function FXOptions() {
  return (
    <div className="page-shell">
      <NavigationMenu />
      <main className="page-main">
        <div className="fx-options-container">
          <header className="fx-options-header">
            <h1 className="fx-options-header__title">FX Options</h1>
            <p className="fx-options-header__subtitle">
              Manage exchange rates for budget planning and reporting
            </p>
          </header>

          <section className="fx-options-section">
            <h2 className="fx-options-section__title">Budget Exchange Rates</h2>
            <BudgetOptionExchangeRates />
          </section>

          <section className="fx-options-section">
            <h2 className="fx-options-section__title">Forecast FX Assumptions</h2>
            <p className="fx-options-section__description">
              Exchange rate assumptions used in forecast scenarios
            </p>
            <ForecastFXAssumptions />
          </section>
        </div>
      </main>
    </div>
  );
}
