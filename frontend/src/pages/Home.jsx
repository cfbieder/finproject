import { Link } from "react-router-dom";
import NavigationMenu from "../components/NavigationMenu.jsx";
import "./PageLayout.css";

export default function Home() {
  const quickActions = [
    {
      title: "Balance Summary",
      description: "View your current financial position",
      path: "/balance",
      icon: "📊",
      color: "primary",
    },
    {
      title: "Cash Flow",
      description: "Track income and expenses",
      path: "/cash-flow",
      icon: "💰",
      color: "accent",
    },
    {
      title: "Budget Worksheet",
      description: "Plan and manage budgets",
      path: "/budget-worksheet",
      icon: "📝",
      color: "success",
    },
    {
      title: "Forecast Scenarios",
      description: "Build and analyze forecast scenarios",
      path: "/forecast-scenarios",
      icon: "🔮",
      color: "primary",
    },
    {
      title: "Net Worth Chart",
      description: "Visualize wealth over time",
      path: "/balance-chart",
      icon: "📈",
      color: "accent",
    },
    {
      title: "Transaction History",
      description: "View and manage transactions",
      path: "/trans-actual",
      icon: "🧾",
      color: "success",
    },
  ];

  const features = [
    {
      category: "Forecasting",
      description: "Build and analyze financial forecasts",
      icon: "🔮",
      items: [
        { label: "Forecast Scenarios", path: "/forecast-scenarios" },
        { label: "Forecast Modules", path: "/forecast-modules" },
        { label: "Forecast Expenditures Setup", path: "/forecast-setup-exp" },
        { label: "Forecast Review", path: "/forecast-review" },
      ],
    },
    {
      category: "Reports & Graphs",
      description: "Analyze your financial data",
      icon: "📊",
      items: [
        { label: "Balance Summary", path: "/balance" },
        { label: "Cash Flow Summary", path: "/cash-flow" },
        { label: "Cash Flow Monthly", path: "/cash-flow-monthly" },
        { label: "Net Worth Chart", path: "/balance-chart" },
      ],
    },
    {
      category: "Budgeting",
      description: "Plan and track your budget",
      icon: "📝",
      items: [
        { label: "Budget Worksheet", path: "/budget-worksheet" },
        { label: "Budget Realization", path: "/budget-realization" },
      ],
    },
    {
      category: "Transactions",
      description: "Manage transaction records",
      icon: "🧾",
      items: [
        { label: "History", path: "/trans-actual" },
        { label: "Budget", path: "/trans-budget" },
      ],
    },
    {
      category: "Database",
      description: "Import and refresh data",
      icon: "💾",
      items: [
        { label: "Upload PS", path: "/upload-ps" },
        { label: "Refresh PS", path: "/refresh-ps" },
      ],
    },
    {
      category: "Settings",
      description: "Configure your workspace",
      icon: "⚙️",
      items: [
        { label: "FX Options", path: "/fx-options" },
      ],
    },
  ];

  return (
    <div className="page-shell">
      <NavigationMenu />
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
            {quickActions.map((action) => (
              <Link
                key={action.path}
                to={action.path}
                className="quick-action-card"
              >
                <div className="quick-action-card__icon">{action.icon}</div>
                <div className="quick-action-card__content">
                  <h3 className="quick-action-card__title">{action.title}</h3>
                  <p className="quick-action-card__description">
                    {action.description}
                  </p>
                </div>
                <span className="quick-action-card__arrow">→</span>
              </Link>
            ))}
          </div>
        </section>

        <section className="home-section">
          <h2 className="home-section__title">All Features</h2>
          <div className="home-features-grid">
            {features.map((feature) => (
              <div key={feature.category} className="feature-category">
                <div className="feature-category__header">
                  <span className="feature-category__icon">{feature.icon}</span>
                  <div>
                    <h3 className="feature-category__title">{feature.category}</h3>
                    <p className="feature-category__description">{feature.description}</p>
                  </div>
                </div>
                <ul className="feature-category__list">
                  {feature.items.map((item) => (
                    <li key={item.path}>
                      <Link to={item.path} className="feature-link">
                        <span className="feature-link__bullet">•</span>
                        {item.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
