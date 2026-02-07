import { Link } from "react-router-dom";
import { CATEGORY_META, getCategoryPath, getRoutesByCategory, getCategories } from "../config/routes";
import {
  Wallet,
  ArrowLeftRight,
  FileSpreadsheet,
  Layers,
  LineChart,
  Receipt,
  ArrowRight,
} from "lucide-react";
import "./PageLayout.css";

const quickActions = [
  {
    title: "Balance Summary",
    description: "View your current financial position",
    path: "/balance",
    icon: Wallet,
  },
  {
    title: "Cash Flow",
    description: "Track income and expenses",
    path: "/cash-flow",
    icon: ArrowLeftRight,
  },
  {
    title: "Budget Worksheet",
    description: "Plan and manage budgets",
    path: "/budget-worksheet",
    icon: FileSpreadsheet,
  },
  {
    title: "Forecast Scenarios",
    description: "Build and analyze forecast scenarios",
    path: "/forecast-scenarios",
    icon: Layers,
  },
  {
    title: "Net Worth Chart",
    description: "Visualize wealth over time",
    path: "/balance-chart",
    icon: LineChart,
  },
  {
    title: "Transaction History",
    description: "View and manage transactions",
    path: "/trans-actual",
    icon: Receipt,
  },
];

export default function Home() {
  const categories = getCategories();

  return (
    <div className="home-container">
      <header className="home-header">
        <h1 className="home-header__title">Financial Workspace</h1>
        <p className="home-header__subtitle">
          Manage your finances with clarity and precision
        </p>
      </header>

      <section className="home-section">
        <h2 className="home-section__title">Quick Actions</h2>
        <div className="home-quick-actions">
          {quickActions.map((action) => {
            const Icon = action.icon;
            return (
              <Link
                key={action.path}
                to={action.path}
                className="quick-action-card"
              >
                <div className="quick-action-card__icon">
                  <Icon size={24} strokeWidth={1.75} />
                </div>
                <div className="quick-action-card__content">
                  <h3 className="quick-action-card__title">{action.title}</h3>
                  <p className="quick-action-card__description">
                    {action.description}
                  </p>
                </div>
                <span className="quick-action-card__arrow">
                  <ArrowRight size={16} strokeWidth={2} />
                </span>
              </Link>
            );
          })}
        </div>
      </section>

      <section className="home-section">
        <h2 className="home-section__title">All Features</h2>
        <div className="home-features-grid">
          {categories.map((catName) => {
            const meta = CATEGORY_META[catName];
            const catPath = getCategoryPath(catName);
            const catRoutes = getRoutesByCategory(catName);
            const CategoryIcon = meta?.icon;

            return (
              <Link
                key={catName}
                to={catPath}
                className="feature-category feature-category--linked"
              >
                <div className="feature-category__header">
                  <span className="feature-category__icon">
                    {CategoryIcon && <CategoryIcon size={22} strokeWidth={1.75} />}
                  </span>
                  <div>
                    <h3 className="feature-category__title">{catName}</h3>
                    <p className="feature-category__description">
                      {meta?.description || ""}
                    </p>
                  </div>
                </div>
                <ul className="feature-category__list">
                  {catRoutes.slice(0, 3).map((route) => (
                    <li key={route.path}>
                      <span className="feature-link">
                        <span className="feature-link__bullet">&bull;</span>
                        {route.label}
                      </span>
                    </li>
                  ))}
                  {catRoutes.length > 3 && (
                    <li>
                      <span className="feature-link feature-link--more">
                        +{catRoutes.length - 3} more
                      </span>
                    </li>
                  )}
                </ul>
                <span className="feature-category__view-all">
                  View all <ArrowRight size={14} strokeWidth={2} />
                </span>
              </Link>
            );
          })}
        </div>
      </section>
    </div>
  );
}
