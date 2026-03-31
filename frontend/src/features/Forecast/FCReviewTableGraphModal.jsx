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
  const xStep =
    yearsList.length > 1 ? usableWidth / (yearsList.length - 1) : 0;

  const allValues = seriesList.flatMap((series) =>
    (series.values || [])
      .map((val) => Number(val))
      .filter((v) => Number.isFinite(v))
  );
  const rawMin = allValues.length > 0 ? Math.min(...allValues) : 0;
  const rawMax = allValues.length > 0 ? Math.max(...allValues) : 1;
  // Always include zero in the range
  const minValue = Math.min(rawMin, 0);
  const maxValue = Math.max(rawMax, 0);
  const range = maxValue - minValue === 0 ? 1 : maxValue - minValue;
  const yMin = maxValue - minValue === 0 ? minValue - 1 : minValue;
  const yMax = maxValue - minValue === 0 ? maxValue + 1 : maxValue;

  const scaleX = (index) => paddingX + xStep * index;
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
              Selected series over forecast years
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
                  {seriesList.map((series) => {
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
                            />
                          );
                        })}
                      </g>
                    );
                  })}
                  {/* Vertical crosshair line and year highlight */}
                  {mousePosition && (
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
                        y={paddingTop - 10}
                        textAnchor="middle"
                        style={{
                          fontSize: "16px",
                          fontWeight: "bold",
                          fill: "#333",
                        }}
                        pointerEvents="none"
                      >
                        {yearsList[mousePosition.yearIndex]}{birthYear ? ` (${Number(yearsList[mousePosition.yearIndex]) - birthYear})` : ""}
                      </text>
                    </>
                  )}
                </>
              </svg>
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
    })
  ),
  sortedYears: PropTypes.arrayOf(
    PropTypes.oneOfType([PropTypes.string, PropTypes.number])
  ),
  birthYear: PropTypes.number,
};
