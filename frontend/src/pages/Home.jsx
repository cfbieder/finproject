import { Link } from "react-router-dom";
import {
  Wallet,
  ArrowLeftRight,
  FileSpreadsheet,
  Layers,
  LineChart,
  Receipt,
  ArrowRight,
} from "lucide-react";
import { useOverview } from "../hooks/useOverview.js";
import { useNetWorthSeries } from "../hooks/useReports.js";
import NetWorthHero from "../components/NetWorthHero/NetWorthHero.jsx";
import { KpiCard } from "../components/KpiCards.jsx";
import AttentionStrip from "../components/AttentionStrip/AttentionStrip.jsx";
import "./PageLayout.css";

const quickActions = [
  { title: "Balance Summary", description: "View your current financial position", path: "/balances/summary", icon: Wallet },
  { title: "Cash Flow", description: "Track income and expenses", path: "/cash-flow", icon: ArrowLeftRight },
  { title: "Budget Worksheet", description: "Plan and manage budgets", path: "/budget-worksheet", icon: FileSpreadsheet },
  { title: "Forecast Scenarios", description: "Build and analyze forecast scenarios", path: "/forecast-scenarios", icon: Layers },
  { title: "Net Worth Chart", description: "Visualize wealth over time", path: "/balances/chart", icon: LineChart },
  { title: "Transaction History", description: "View and manage transactions", path: "/trans-actual", icon: Receipt },
];

export default function Home() {
  const { data: overview } = useOverview();
  const { data: series, isLoading: seriesLoading } = useNetWorthSeries(12);

  const lastPoint = series.length ? series[series.length - 1].netWorth : null;
  const current = overview?.netWorth ?? lastPoint;
  // Delta over the whole window when we have a series; else fall back to the
  // month-over-month delta from useOverview.
  const delta =
    series.length > 1
      ? series[series.length - 1].netWorth - series[0].netWorth
      : overview?.delta ?? null;

  return (
    <div className="home-container">
      <header className="home-header">
        <h1 className="home-header__title">Financial Workspace</h1>
        <p className="home-header__subtitle">
          Manage your finances with clarity and precision
        </p>
      </header>

      {/* Net-worth hero (CR042 U3) */}
      <NetWorthHero
        series={series}
        current={current}
        delta={delta}
        isLoading={seriesLoading}
      />

      {/* This-month flow metrics */}
      <section className="home-section" aria-label="This month">
        <div className="home-kpi-row">
          <KpiCard
            title="Net Cash Flow"
            value={overview?.net}
            subtitle="This month"
            positiveIsGood
          />
          <KpiCard
            title="Income"
            value={overview?.income}
            subtitle="This month"
            positiveIsGood
          />
          <KpiCard
            title="Expenses"
            value={overview?.expense}
            subtitle="This month"
            positiveIsGood={false}
          />
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
              <Link key={action.path} to={action.path} className="quick-action-card">
                <div className="quick-action-card__icon">
                  <Icon size={24} strokeWidth={1.75} />
                </div>
                <div className="quick-action-card__content">
                  <h3 className="quick-action-card__title">{action.title}</h3>
                  <p className="quick-action-card__description">{action.description}</p>
                </div>
                <span className="quick-action-card__arrow">
                  <ArrowRight size={16} strokeWidth={2} />
                </span>
              </Link>
            );
          })}
        </div>
      </section>
    </div>
  );
}
