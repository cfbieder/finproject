import PropTypes from "prop-types";
import "./BalanceChartPanel.css";
const BalanceChartPanel = ({
  chartRangeSummary,
  hasChartData,
  chartLayout,
  chartPoints,
  tooltip,
  chartRef,
  onBarMouseMove,
  onBarMouseLeave,
  latestNet,
  formatCurrencyShort,
  formatAxisLabel,
}) => {
  const layout = chartLayout ?? {};

  return (
    <div className="balance-chart-panel">
      <div className="balance-chart-header">
        <div>
          <p className="balance-chart-title">Assets vs Liabilities</p>
          <p className="balance-chart-subtitle">{chartRangeSummary}</p>
        </div>
        {hasChartData && (
          <div className="balance-chart-values">
            <div className="balance-chart-values__metric">
              <span className="balance-chart-values__amount">
                {formatCurrencyShort(latestNet)}
              </span>
              <span className="balance-chart-values__label">
                Net Assets (latest)
              </span>
            </div>
          </div>
        )}
      </div>
      <div className="balance-chart-graph" ref={chartRef}>
        {hasChartData && chartLayout ? (
          <svg
            viewBox={`0 0 ${chartLayout.width} ${chartLayout.height}`}
            preserveAspectRatio="none"
            role="img"
            aria-label="Monthly net assets trend"
            className="balance-chart-graph__svg"
          >
            <g className="balance-chart-graph__grid">
              {chartLayout.ticks.map((tick, index) => (
                <g key={`grid-tick-${index}`}>
                  <line
                    className="balance-chart-graph__grid-line"
                    x1={chartLayout.gridLeft}
                    x2={chartLayout.width - chartLayout.gridRight}
                    y1={tick.y}
                    y2={tick.y}
                  />
                  <text
                    className="balance-chart-graph__grid-label"
                    x={chartLayout.gridLeft - 16}
                    y={tick.y + 6}
                    textAnchor="end"
                  >
                    {formatAxisLabel(tick.value)}
                  </text>
                </g>
              ))}
            </g>
            {chartLayout.showZeroLine && (
              <line
                className="balance-chart-graph__zero-line"
                x1={chartLayout.gridLeft}
                x2={chartLayout.width - chartLayout.gridRight}
                y1={chartLayout.zeroY}
                y2={chartLayout.zeroY}
              />
            )}
            {chartLayout.bars.map((bar, index) => (
              <rect
                key={`net-bar-${index}`}
                className={`balance-chart-graph__bar ${
                  bar.isPositive
                    ? "balance-chart-graph__bar--positive"
                    : "balance-chart-graph__bar--negative"
                }`}
                x={bar.x}
                y={bar.y}
                width={bar.width}
                height={bar.height}
                onMouseMove={(event) =>
                  onBarMouseMove(event, chartPoints[index], index)
                }
                onMouseLeave={onBarMouseLeave}
              />
            ))}
            {chartPoints.map((point, index) => {
              const bar = chartLayout.bars[index];
              const centerX = (bar?.x ?? 0) + (bar?.width ?? 0) / 2;
              const label = point.label || point.date || "";
              const pieces = label.split(" ");
              const monthLabel = pieces[0] ?? "";
              const yearLabel = pieces[1] ?? "";
              return (
                <text
                  key={`axis-label-${index}`}
                  className="balance-chart-graph__xlabel"
                  x={centerX}
                  y={chartLayout.height - chartLayout.verticalPadding / 2}
                  textAnchor="middle"
                >
                  <tspan x={centerX} dy="0">
                    {monthLabel}
                  </tspan>
                  <tspan x={centerX} dy="1.2em">
                    {yearLabel}
                  </tspan>
                </text>
              );
            })}
          </svg>
        ) : (
          <div className="balance-chart-empty">
            <p>Generating Report..............Please Wait</p>
          </div>
        )}
        {tooltip && (
          <div
            className="balance-chart-tooltip"
            style={{
              left: Math.min(
                Math.max(tooltip.x + 12, 8),
                (layout.width || 0) - 160
              ),
              top: Math.max(tooltip.y - 40, 8),
            }}
          >
            <div className="balance-chart-tooltip__label">{tooltip.label}</div>
            <div>
              <strong>Assets:</strong> {formatCurrencyShort(tooltip.assets)}
            </div>
            <div>
              <strong>Liabilities:</strong>{" "}
              {formatCurrencyShort(tooltip.liabilities)}
            </div>
          </div>
        )}
      </div>
      <div className="balance-chart-legend">
        <div className="balance-chart-legend__item">
          <span className="balance-chart-legend__swatch balance-chart-legend__swatch--positive" />
          Positive Net
        </div>
        <div className="balance-chart-legend__item">
          <span className="balance-chart-legend__swatch balance-chart-legend__swatch--negative" />
          Negative Net
        </div>
      </div>
    </div>
  );
};

BalanceChartPanel.propTypes = {
  chartRangeSummary: PropTypes.string.isRequired,
  hasChartData: PropTypes.bool.isRequired,
  chartLayout: PropTypes.shape({
    width: PropTypes.number,
    height: PropTypes.number,
    verticalPadding: PropTypes.number,
    ticks: PropTypes.arrayOf(
      PropTypes.shape({
        value: PropTypes.number,
        y: PropTypes.number,
      })
    ),
    bars: PropTypes.arrayOf(
      PropTypes.shape({
        x: PropTypes.number,
        y: PropTypes.number,
        width: PropTypes.number,
        height: PropTypes.number,
        value: PropTypes.number,
        isPositive: PropTypes.bool,
      })
    ),
    zeroY: PropTypes.number,
    gridLeft: PropTypes.number,
    gridRight: PropTypes.number,
    showZeroLine: PropTypes.bool,
  }),
  chartPoints: PropTypes.arrayOf(
    PropTypes.shape({
      label: PropTypes.string,
      date: PropTypes.string,
      net: PropTypes.number,
    })
  ).isRequired,
  tooltip: PropTypes.shape({
    x: PropTypes.number,
    y: PropTypes.number,
    label: PropTypes.string,
    assets: PropTypes.number,
    liabilities: PropTypes.number,
  }),
  chartRef: PropTypes.shape({ current: PropTypes.object }),
  onBarMouseMove: PropTypes.func.isRequired,
  onBarMouseLeave: PropTypes.func.isRequired,
  latestNet: PropTypes.number.isRequired,
  formatCurrencyShort: PropTypes.func.isRequired,
  formatAxisLabel: PropTypes.func.isRequired,
};

BalanceChartPanel.defaultProps = {
  chartLayout: null,
  tooltip: null,
  chartRef: null,
};

export default BalanceChartPanel;
