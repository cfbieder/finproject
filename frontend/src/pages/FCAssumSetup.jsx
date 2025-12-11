import NavigationMenu from "../components/NavigationMenu.jsx";
import "./PageLayout.css";

export default function FCAssumSetup() {
  return (
    <div className="page-shell">
      <NavigationMenu />
      <main className="page-main trans-budget-main">
        <section className="section-filters fc-setup-select">
          <div className="section-table__content">
            <h2>fc-setup-select</h2>
          </div>
        </section>
        <section className="section-table fc-setup-table">
          <div className="section-table__content">
            <h2>fc-setup-table</h2>
          </div>
        </section>
      </main>
    </div>
  );
}
