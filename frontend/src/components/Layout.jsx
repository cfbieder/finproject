import { useLocation } from "react-router-dom";
import NavigationMenu from "./NavigationMenu";
import Breadcrumbs from "./Breadcrumbs";
import Footer from "./Footer";
import "./Layout.css";
import "./DataTable.css";
import "./buttons.css";

export default function Layout({ children }) {
  const { pathname } = useLocation();

  return (
    <div className="app-layout">
      <NavigationMenu />
      <Breadcrumbs />
      <div className="page-content-area" key={pathname}>
        <div className="page-shell">{children}</div>
      </div>
      <Footer />
    </div>
  );
}
