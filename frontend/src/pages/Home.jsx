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
      title: "Net Worth Chart",
      description: "Visualize wealth over time",
      path: "/balance-chart",
      icon: "📈",
      color: "primary",
    },
  ];

  const features = [
    {
      category: "Reports",
      items: [
        { label: "Balance Summary", path: "/balance" },
        { label: "Cash Flow Summary", path: "/cash-flow" },
        { label: "Cash Flow Monthly", path: "/cash-flow-monthly" },
      ],
    },
    {
      category: "Budgeting",
      items: [
        { label: "Budget Worksheet", path: "/budget-worksheet" },
        { label: "Budget Realization", path: "/budget-realization" },
      ],
    },
    {
      category: "Transactions",
      items: [
        { label: "Transaction History", path: "/trans-actual" },
        { label: "Budget Transactions", path: "/trans-budget" },
      ],
    },
    {
      category: "Data Management",
      items: [
        { label: "Upload PS Data", path: "/upload-ps" },
        { label: "Refresh PS Data", path: "/refresh-ps" },
        { label: "FX Options", path: "/fx-options" },
      ],
    },
    {
      category: "Analytics",
      items: [
        { label: "Net Worth Chart", path: "/balance-chart" },
        { label: "Option Analysis", path: "/option-analysis" },
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
                <h3 className="feature-category__title">{feature.category}</h3>
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
