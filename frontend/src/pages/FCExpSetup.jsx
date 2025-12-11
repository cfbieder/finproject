import NavigationMenu from "../components/NavigationMenu.jsx";
import "./PageLayout.css";

export default function FCExpSetup() {
  return (
    <div className="page-shell">
      <NavigationMenu />
      <main className="page-content"></main>
    </div>
  );
}
