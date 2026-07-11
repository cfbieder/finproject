import { useState } from "react";
import PropTypes from "prop-types";
import { formatAmount } from "./utils/fcReviewUtils.js";
import "./FCReviewTableGraphModal.css";

export default function FCReviewTableGraphModal({
  isOpen,
  onClose,
  graphSeries,
  sortedYears,
  birthYear,
  chartMode = "line",
  onPointDoubleClick,
}) {
  const [mousePosition, setMousePosition] = useState(null);

  if (!isOpen) {
    return null;
  }

  const yearsList = sortedYears || [];
  const seriesList = graphSeries || [];
  const chartWidth = 1600;
  const chartHeight = 700;
  const paddingX = 100;
  const paddingTop = 50;
  const paddingBottom = 100;
  const usableWidth =
    chartWidth - paddingX * 2 > 0 ? chartWidth - paddingX * 2 : chartWidth;
  const usableHeight =
    chartHeight - paddingTop - paddingBottom > 0
      ? chartHeight - paddingTop - paddingBottom
      : chartHeight;
  const isBar = chartMode === "bar";
  const xStep = yearsList.length > 1
    ? usableWidth / (isBar ? yearsList.length : yearsList.length - 1)
    : 0;

  // For bar charts, compute stacked positive/negative totals per year
  let rawMin, rawMax;
  if (isBar) {
    let stackMax = 0;
    let stackMin = 0;
    for (let yi = 0; yi < yearsList.length; yi++) {
      let posSum = 0;
      let negSum = 0;
      for (const series of seriesList) {
        const v = Number(series.values?.[yi]) || 0;
        if (v >= 0) posSum += v;
        else negSum += v;
      }
      stackMax = Math.max(stackMax, posSum);
      stackMin = Math.min(stackMin, negSum);
    }
    rawMin = stackMin;
    rawMax = stackMax;
  } else {
    const allValues = seriesList.flatMap((series) =>
      (series.values || [])
        .map((val) => Number(val))
        .filter((v) => Number.isFinite(v))
    );
    rawMin = allValues.length > 0 ? Math.min(...allValues) : 0;
    rawMax = allValues.length > 0 ? Math.max(...allValues) : 1;
  }
  // Always include zero in the range
  const minValue = Math.min(rawMin, 0);
  const maxValue = Math.max(rawMax, 0);
  const range = maxValue - minValue === 0 ? 1 : maxValue - minValue;
  const yMin = maxValue - minValue === 0 ? minValue - 1 : minValue;
  const yMax = maxValue - minValue === 0 ? maxValue + 1 : maxValue;

  const scaleX = (index) => paddingX + xStep * (isBar ? index + 0.5 : index);
  const scaleY = (value) => {
    const numeric = Number(value);
    const safeValue = Number.isFinite(numeric) ? numeric : 0;
    return (
      chartHeight -
      paddingBottom -
      ((safeValue - yMin) / range) * usableHeight
    );
  };

  const xAxisY = chartHeight - paddingBottom;

  // Generate more y-axis gridlines for better readability
  const yGridLines = [0, 0.25, 0.5, 0.75, 1].map((ratio) => ({
    ratio,
    value: yMax - (yMax - yMin) * ratio,
  }));

  // Find the closest year index based on mouse position
  const getClosestYearIndex = (svgX) => {
    if (yearsList.length === 0) return null;
    const distances = yearsList.map((_, idx) => {
      const yearX = scaleX(idx);
      return Math.abs(svgX - yearX);
    });
    const minDistance = Math.min(...distances);
    return distances.indexOf(minDistance);
  };

  const handleMouseMove = (event) => {
    const svg = event.currentTarget;
    const rect = svg.getBoundingClientRect();
    const svgX = ((event.clientX - rect.left) / rect.width) * chartWidth;
    const svgY = ((event.clientY - rect.top) / rect.height) * chartHeight;

    // Only show crosshair within chart bounds
    if (
      svgX >= paddingX &&
      svgX <= chartWidth - paddingX &&
      svgY >= paddingTop &&
      svgY <= xAxisY
    ) {
      const yearIndex = getClosestYearIndex(svgX);
      setMousePosition({ x: scaleX(yearIndex), y: svgY, yearIndex });
    } else {
      setMousePosition(null);
    }
  };

  const handleMouseLeave = () => {
    setMousePosition(null);
  };

  return (
    <div className="graph-modal-overlay">
      <div className="graph-modal-content">
        <div className="graph-modal-header">
          <div>
            <p className="graph-modal-header__label">
              Graph
            </p>
            <h3 className="graph-modal-header__title">
              {isBar ? "Net Assets breakdown by account" : "Selected series over forecast years"}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="graph-modal-close"
          >
            Close
          </button>
        </div>
        {seriesList.length === 0 ? (
          <div className="graph-modal-empty">
            Select one or more rows to display the graph.
          </div>
        ) : (
          <>
            <div className="graph-modal-legend">
              {seriesList.map((series) => (
                <span key={series.id} className="graph-modal-legend-item">
                  <span
                    aria-hidden="true"
                    className="graph-modal-legend-item__dot"
                    style={{ background: series.color }}
                  />
                  {series.label}
                </span>
              ))}
            </div>
            <div className="graph-modal-chart-container">
              <svg
                width="100%"
                height="100%"
                viewBox="0 0 1600 700"
                preserveAspectRatio="xMidYMid meet"
                onMouseMove={handleMouseMove}
                onMouseLeave={handleMouseLeave}
              >
                <>
                  <line
                    x1={paddingX}
                    y1={xAxisY}
                    x2={chartWidth - paddingX}
                    y2={xAxisY}
                    className="graph-axis-line"
                  />
                  <line
                    x1={paddingX}
                    y1={paddingTop}
                    x2={paddingX}
                    y2={xAxisY}
                    className="graph-axis-line"
                  />
                  {yearsList.map((year, idx) => {
                    const x = scaleX(idx);
                    const labelY = xAxisY + 15;
                    return (
                      <g key={`x-${year}`}>
                        <line
                          x1={x}
                          y1={paddingTop}
                          x2={x}
                          y2={xAxisY}
                          className="graph-grid-line"
                        />
                        <text
                          x={x}
                          y={labelY}
                          textAnchor="end"
                          className="graph-x-axis-label"
                          transform={`rotate(-45, ${x}, ${labelY})`}
                        >
                          {year}{birthYear ? ` (${Number(year) - birthYear})` : ""}
                        </text>
                      </g>
                    );
                  })}
                  {yGridLines.map(({ ratio, value }) => {
                    const y = scaleY(value);
                    return (
                      <g key={`y-${ratio}`}>
                        <line
                          x1={paddingX}
                          y1={y}
                          x2={chartWidth - paddingX}
                          y2={y}
                          className="graph-grid-line"
                        />
                        <text
                          x={paddingX - 12}
                          y={y + 4}
                          textAnchor="end"
                          className="graph-y-axis-label"
                        >
                          {formatAmount(value)}
                        </text>
                      </g>
                    );
                  })}
                  {/* Red line at y=0 */}
                  <line
                    x1={paddingX}
                    y1={scaleY(0)}
                    x2={chartWidth - paddingX}
                    y2={scaleY(0)}
                    stroke="red"
                    strokeWidth="2"
                    strokeDasharray="none"
                  />
                  {isBar ? (
                    /* ===== STACKED BAR CHART ===== */
                    yearsList.map((_, yi) => {
                      const barWidth = xStep * 0.7;
                      const barX = scaleX(yi) - barWidth / 2;
                      const zeroY = scaleY(0);
                      let posOffset = 0;
                      let negOffset = 0;
                      return (
                        <g key={`bar-group-${yi}`}>
                          {seriesList.map((series) => {
                            const val = Number(series.values?.[yi]) || 0;
                            if (val === 0) return null;
                            let y, h;
                            if (val >= 0) {
                              const top = scaleY(posOffset + val);
                              y = top;
                              h = zeroY - scaleY(posOffset) - (zeroY - scaleY(posOffset + val));
                              h = scaleY(posOffset) - scaleY(posOffset + val);
                              posOffset += val;
                            } else {
                              const top = scaleY(negOffset);
                              y = top;
                              h = scaleY(negOffset + val) - scaleY(negOffset);
                              negOffset += val;
                            }
                            return (
                              <rect
                                key={`${series.id}-bar-${yi}`}
                                x={barX}
                                y={y}
                                width={barWidth}
                                height={Math.max(h, 0)}
                                fill={series.color}
                                opacity={0.85}
                              />
                            );
                          })}
                        </g>
                      );
                    })
                  ) : (
                    /* ===== LINE CHART ===== */
                    seriesList.map((series) => {
                      const points = yearsList
                        .map((_, idx) => {
                          const x = scaleX(idx);
                          const y = scaleY(series.values[idx]);
                          return `${x},${y}`;
                        })
                        .join(" ");
                      return (
                        <g key={series.id}>
                          <polyline
                            fill="none"
                            stroke={series.color}
                            strokeWidth="3"
                            points={points}
                            strokeLinejoin="round"
                            strokeLinecap="round"
                            className="graph-series-line"
                          />
                          {yearsList.map((_, idx) => {
                            const x = scaleX(idx);
                            const y = scaleY(series.values[idx]);
                            const isAdjustable = series.hasModule && onPointDoubleClick;
                            return (
                              <circle
                                key={`${series.id}-pt-${idx}`}
                                cx={x}
                                cy={y}
                                r={5}
                                fill={series.color}
                                stroke="#fff"
                                strokeWidth="2"
                                className="graph-data-point"
                                style={isAdjustable ? { cursor: "pointer" } : undefined}
                                onDoubleClick={
                                  isAdjustable
                                    ? (e) => {
                                        e.stopPropagation();
                                        onPointDoubleClick(
                                          series.id,
                                          series.label,
                                          idx,
                                          yearsList[idx],
                                          series.values[idx]
                                        );
                                      }
                                    : undefined
                                }
                              />
                            );
                          })}
                        </g>
                      );
                    })
                  )}
                  {/* Vertical crosshair line and year highlight */}
                  {mousePosition && !isBar && (
                    <>
                      <line
                        x1={mousePosition.x}
                        y1={paddingTop}
                        x2={mousePosition.x}
                        y2={xAxisY}
                        stroke="#666"
                        strokeWidth="1.5"
                        strokeDasharray="4 2"
                        pointerEvents="none"
                      />
                      <text
                        x={mousePosition.x}
                        y={paddingTop - 10 - seriesList.length * 18}
                        textAnchor="middle"
                        style={{
                          fontSize: "16px",
                          fontWeight: "bold",
                          fill: "var(--ink)",
                        }}
                        pointerEvents="none"
                      >
                        {yearsList[mousePosition.yearIndex]}{birthYear ? ` (${Number(yearsList[mousePosition.yearIndex]) - birthYear})` : ""}
                      </text>
                      {seriesList.map((series, sIdx) => (
                        <text
                          key={series.id || sIdx}
                          x={mousePosition.x}
                          y={paddingTop - 10 - (seriesList.length - 1 - sIdx) * 18}
                          textAnchor="middle"
                          style={{
                            fontSize: "13px",
                            fontWeight: "500",
                            fill: series.color || "#333",
                          }}
                          pointerEvents="none"
                        >
                          {series.label}: {formatAmount(series.values[mousePosition.yearIndex])}
                        </text>
                      ))}
                    </>
                  )}
                  {/* Bar chart crosshair */}
                  {mousePosition && isBar && (
                    <line
                      x1={mousePosition.x}
                      y1={paddingTop}
                      x2={mousePosition.x}
                      y2={xAxisY}
                      stroke="#666"
                      strokeWidth="1.5"
                      strokeDasharray="4 2"
                      pointerEvents="none"
                    />
                  )}
                </>
              </svg>
              {/* Bar chart HTML tooltip */}
              {isBar && mousePosition && (() => {
                const yi = mousePosition.yearIndex;
                const nonZeroSeries = seriesList.filter((s) => (Number(s.values?.[yi]) || 0) !== 0);
                if (nonZeroSeries.length === 0) return null;
                const total = nonZeroSeries.reduce((sum, s) => sum + (Number(s.values?.[yi]) || 0), 0);
                return (
                  <div
                    style={{
                      position: "absolute",
                      top: "60px",
                      right: "20px",
                      background: "white",
                      border: "1px solid #E8E6DF",
                      borderRadius: "8px",
                      padding: "12px 16px",
                      boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
                      maxHeight: "500px",
                      overflowY: "auto",
                      fontSize: "13px",
                      pointerEvents: "none",
                      zIndex: 10,
                    }}
                  >
                    <div style={{ fontWeight: 700, marginBottom: "6px", fontSize: "14px" }}>
                      {yearsList[yi]}{birthYear ? ` (${Number(yearsList[yi]) - birthYear})` : ""}
                    </div>
                    {nonZeroSeries.map((series) => (
                      <div key={series.id} style={{ display: "flex", justifyContent: "space-between", gap: "16px", lineHeight: "1.6" }}>
                        <span style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                          <span style={{ width: "10px", height: "10px", borderRadius: "2px", background: series.color, display: "inline-block" }} />
                          {series.label}
                        </span>
                        <span style={{ fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
                          {formatAmount(series.values[yi])}
                        </span>
                      </div>
                    ))}
                    <div style={{ borderTop: "1px solid #E8E6DF", marginTop: "6px", paddingTop: "6px", fontWeight: 700, display: "flex", justifyContent: "space-between" }}>
                      <span>Net Assets</span>
                      <span>{formatAmount(total)}</span>
                    </div>
                  </div>
                );
              })()}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

FCReviewTableGraphModal.propTypes = {
  isOpen: PropTypes.bool,
  onClose: PropTypes.func,
  graphSeries: PropTypes.arrayOf(
    PropTypes.shape({
      id: PropTypes.string.isRequired,
      label: PropTypes.string.isRequired,
      values: PropTypes.arrayOf(PropTypes.number).isRequired,
      color: PropTypes.string.isRequired,
      hasModule: PropTypes.bool,
    })
  ),
  sortedYears: PropTypes.arrayOf(
    PropTypes.oneOfType([PropTypes.string, PropTypes.number])
  ),
  birthYear: PropTypes.number,
  chartMode: PropTypes.oneOf(["line", "bar"]),
  onPointDoubleClick: PropTypes.func,
};
