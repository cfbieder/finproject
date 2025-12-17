import { useEffect, useState } from "react";
import NavigationMenu from "../components/NavigationMenu.jsx";
import Rest from "../js/rest.js";
import "./PageLayout.css";

export default function FCAssumSetup() {
  return (
    <div className="page-shell">
      <NavigationMenu />
      <main className="page-main trans-budget-main">
        <section className="section-filters fc-setup-select"></section>
        <section className="section-table fc-setup-table">
          <div className="section-table__content"></div>
        </section>
      </main>
    </div>
  );
}
