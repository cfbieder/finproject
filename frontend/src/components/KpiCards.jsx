import { memo } from "react";
import {
  BarChart,
  Bar,
  AreaChart,
  Area,
  ResponsiveContainer,
} from "recharts";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import "./KpiCards.css";

/**
 * Formats a currency value in compact form for KPI display.
 * e.g. 1234567 -> "$1.2M", -45000 -> "($45.0K)"
 */
function formatKpiValue(value) {
  if (!Number.isFinite(value)) return "$0";
  const abs = Math.abs(value);
  let formatted;
  if (abs >= 1_000_000) {
    formatted = `$${(abs / 1_000_000).toFixed(1)}M`;
  } else if (abs >= 1_000) {
    formatted = `$${(abs / 1_000).toFixed(1)}K`;
  } else {
    formatted = `$${abs.toFixed(0)}`;
  }
  return value < 0 ? `(${formatted})` : formatted;
}

/**
 * Returns a trend icon based on value direction.
 */
function TrendIcon({ value, positiveIsGood = true }) {
  if (!Number.isFinite(value) || Math.abs(value) < 0.5) {
    return <Minus size={14} className="kpi-card__trend-icon kpi-card__trend-icon--neutral" />;
  }
  const isPositive = value > 0;
  const isGood = positiveIsGood ? isPositive : !isPositive;
  if (isPositive) {
    return (
      <TrendingUp
        size={14}
        className={`kpi-card__trend-icon ${isGood ? "kpi-card__trend-icon--positive" : "kpi-card__trend-icon--negative"}`}
      />
    );
  }
  return (
    <TrendingDown
      size={14}
      className={`kpi-card__trend-icon ${isGood ? "kpi-card__trend-icon--positive" : "kpi-card__trend-icon--negative"}`}
    />
  );
}

/**
 * A single KPI card with optional mini-chart.
 *
 * @param {Object} props
 * @param {string} props.title - Card title
 * @param {number} props.value - Primary display value
 * @param {string} [props.subtitle] - Optional subtitle text
 * @param {number} [props.changeValue] - Numeric change for trend indicator
 * @param {string} [props.changeLabel] - Label for the change (e.g. "vs budget")
 * @param {boolean} [props.positiveIsGood] - Whether positive change is favorable
 * @param {Array} [props.chartData] - Array of {value} objects for mini-chart
 * @param {string} [props.chartType] - "bar" or "area" (default: "area")
 * @param {string} [props.chartColor] - Chart fill color
 * @param {React.ReactNode} [props.icon] - Icon element
 */
function KpiCard({
  title,
  value,
  formattedValue,
  subtitle,
  changeValue,
  changeLabel,
  positiveIsGood = true,
  chartData,
  chartType = "area",
  chartColor = "var(--primary)",
  icon,
}) {
  const hasChart = Array.isArray(chartData) && chartData.length > 1;
  const hasChange = Number.isFinite(changeValue);

  return (
    <div className="kpi-card">
      <div className="kpi-card__content">
        <div className="kpi-card__header">
          {icon && <span className="kpi-card__icon">{icon}</span>}
          <span className="kpi-card__title">{title}</span>
        </div>
        <div className="kpi-card__value">{formattedValue ?? formatKpiValue(value)}</div>
        {(hasChange || subtitle) && (
          <div className="kpi-card__footer">
            {hasChange && (
              <span className="kpi-card__change">
                <TrendIcon value={changeValue} positiveIsGood={positiveIsGood} />
                <span
                  className={`kpi-card__change-value ${
                    changeValue > 0
                      ? positiveIsGood
                        ? "kpi-card__change-value--positive"
                        : "kpi-card__change-value--negative"
                      : changeValue < 0
                      ? positiveIsGood
                        ? "kpi-card__change-value--negative"
                        : "kpi-card__change-value--positive"
                      : ""
                  }`}
                >
                  {formatKpiValue(changeValue)}
                </span>
                {changeLabel && (
                  <span className="kpi-card__change-label">{changeLabel}</span>
                )}
              </span>
            )}
            {subtitle && !hasChange && (
              <span className="kpi-card__subtitle">{subtitle}</span>
            )}
          </div>
        )}
      </div>
      {hasChart && (
        <div className="kpi-card__chart">
          <ResponsiveContainer width="100%" height={48}>
            {chartType === "bar" ? (
              <BarChart data={chartData} margin={{ top: 2, right: 0, bottom: 2, left: 0 }}>
                <Bar dataKey="value" fill={chartColor} radius={[2, 2, 0, 0]} />
              </BarChart>
            ) : (
              <AreaChart data={chartData} margin={{ top: 2, right: 0, bottom: 2, left: 0 }}>
                <defs>
                  <linearGradient id={`kpi-gradient-${title}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={chartColor} stopOpacity={0.3} />
                    <stop offset="100%" stopColor={chartColor} stopOpacity={0.05} />
                  </linearGradient>
                </defs>
                <Area
                  type="monotone"
                  dataKey="value"
                  stroke={chartColor}
                  strokeWidth={1.5}
                  fill={`url(#kpi-gradient-${title})`}
                  dot={false}
                />
              </AreaChart>
            )}
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

/**
 * Container for a row of KPI cards.
 */
function KpiCardRow({ children }) {
  return <div className="kpi-card-row">{children}</div>;
}

const MemoKpiCard = memo(KpiCard);
const MemoKpiCardRow = memo(KpiCardRow);

export { MemoKpiCard as KpiCard, MemoKpiCardRow as KpiCardRow, formatKpiValue };
