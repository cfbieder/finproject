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
  TrendingUp,
  TrendingDown,
} from "lucide-react";
import { useOverview, formatOverviewKpi } from "../hooks/useOverview.js";
import AttentionStrip from "../components/AttentionStrip/AttentionStrip.jsx";
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
  const { data: overview, isLoading: overviewLoading } = useOverview();
  const deltaUp = (overview?.delta ?? 0) >= 0;

  return (
    <div className="home-container">
      <header className="home-header">
        <h1 className="home-header__title">Financial Workspace</h1>
        <p className="home-header__subtitle">
          Manage your finances with clarity and precision
        </p>
      </header>

      {/* Live overview (CR038 P1 — same numbers as the mobile home) */}
      <section className="home-section" aria-label="Overview">
        <div className="home-kpis">
          <div className="home-kpi home-kpi--hero">
            <span className="home-kpi__label">Net Worth</span>
            <span
              className={
                "home-kpi__value" +
                ((overview?.netWorth ?? 0) < 0 ? " home-kpi__value--negative" : "")
              }
            >
              {overviewLoading && !overview ? "…" : formatOverviewKpi(overview?.netWorth)}
            </span>
            {overview && (
              <span className={"home-kpi__sub home-kpi__sub--" + (deltaUp ? "up" : "down")}>
                {deltaUp ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
                {formatOverviewKpi(Math.abs(overview.delta))} vs last month
              </span>
            )}
          </div>
          <div className="home-kpi">
            <span className="home-kpi__label">Net Cash Flow (this month)</span>
            <span
              className={
                "home-kpi__value" +
                ((overview?.net ?? 0) < 0
                  ? " home-kpi__value--negative"
                  : " home-kpi__value--positive")
              }
            >
              {overviewLoading && !overview ? "…" : formatOverviewKpi(overview?.net)}
            </span>
          </div>
          <div className="home-kpi">
            <span className="home-kpi__label">Income (this month)</span>
            <span className="home-kpi__value home-kpi__value--positive">
              {overviewLoading && !overview ? "…" : formatOverviewKpi(overview?.income)}
            </span>
          </div>
          <div className="home-kpi">
            <span className="home-kpi__label">Expenses (this month)</span>
            <span
              className={
                "home-kpi__value" +
                ((overview?.expense ?? 0) < 0 ? " home-kpi__value--negative" : "")
              }
            >
              {overviewLoading && !overview ? "…" : formatOverviewKpi(overview?.expense)}
            </span>
          </div>
        </div>
      </section>

      {/* Needs attention (CR038 P2) */}
      <AttentionStrip />

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
