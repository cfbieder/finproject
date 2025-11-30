import NavigationMenu from "../components/NavigationMenu.jsx";
import BudgetOptionExchangeRates from "../features/BudgetOptionExchangeRates.jsx";
import "./BudgetOptions.css";

export default function BudgetOptions() {
  return (
    <div className="page-shell">
      <NavigationMenu />
      <main className="page-main">
        <div className="budget-options-layout">
          <BudgetOptionExchangeRates />
          <section className="budget-options-region">
            <p className="budget-options-region__title">budget_options2</p>
            <p className="budget-options-region__note">
              Placeholder for analysis panels, charts, or comparative views.
            </p>
          </section>
          <section className="budget-options-region budget-options-region--footer">
            <p className="budget-options-region__title">budget_options3</p>
            <p className="budget-options-region__note">
              Placeholder for actionable summaries, results, or next steps.
            </p>
          </section>
        </div>
      </main>
    </div>
  );
}
