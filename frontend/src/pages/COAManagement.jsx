import NavigationMenu from "../components/NavigationMenu.jsx";
import "./PageLayout.css";

export default function COAManagement() {
  return (
    <div className="page-shell">
      <NavigationMenu />
      <main className="page-main">
        <div className="budget-options-layout">
          <section className="budget-options-region">
            <h1 className="budget-options-region__title">Chart of Account Management</h1>
            <p className="budget-options-region__note">
              Configure and manage your chart of accounts.
            </p>
          </section>
        </div>
      </main>
    </div>
  );
}
