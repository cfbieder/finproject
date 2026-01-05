import NavigationMenu from "../components/NavigationMenu.jsx";
import BudgetOptionExchangeRates from "../features/BudgetEntry/BudgetOptionExchangeRates.jsx";
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
        </div>
      </main>
    </div>
  );
}
