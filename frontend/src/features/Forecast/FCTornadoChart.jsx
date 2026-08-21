/**
 * CR085 P1 — the tornado: which assumption is load-bearing.
 *
 * One row per knob, two bars per row (the knob's low and high end), diverging from an anchor at
 * zero, sorted by the larger of the two impacts.
 *
 * ⚠️ COLOUR ENCODES *FAVOURABLE*, NOT SIGN AND NOT SIDE. Liabilities are stored negative, so
 * "+10% on market_value" grows a house and grows a mortgage's debt; and on "total unfunded
 * shortfall" a fall is good. Painting by the arithmetic sign would be confidently backwards for
 * every loan in the plan, and would paint the best outcome as the alarming one on one of the two
 * metrics. Each bar therefore asks the metric which direction is better.
 *
 * ⚠️ EVERY BAR CARRIES ITS OWN ±. The bars answer "how much does a PLAUSIBLE move in this knob
 * move the plan", not "which knob is most sensitive per unit" — a ±1pp on a rate and a ±10% on a
 * level are not the same size of question. Printing the band beside each row is what stops
 * "biggest bar" being read as "biggest risk" without seeing the nudge that produced it.
 */
import PropTypes from "prop-types";
import {
  Bar, BarChart, Cell, LabelList, ReferenceLine, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from "recharts";
import useTheme from "../../hooks/useTheme.js";
import { chartChrome, tooltipStyle, tornadoColors } from "./utils/fcSeriesPalette.js";
import { bandLabel } from "./utils/fcSensitivityUtils.js";
import { formatKpiValue } from "../../components/KpiCards.jsx";

const ROW_HEIGHT = 46;

/**
 * The value at the OUTER end of each bar, so magnitude is readable without hovering.
 *
 * Module scope, not a closure inside the component: attaching propTypes to a function created
 * during render trips `react-hooks/immutability`, and the lint ratchets may only shrink.
 */
function OuterLabel({ x, y, width, height, value, ink }) {
  if (!Number.isFinite(value) || value === 0) return null;
  const negative = value < 0;
  // ⚠️ Normalise the rect. For a bar left of the axis recharts hands back a NEGATIVE `width`, so
  // `x` is the anchor end rather than the outer end — reading them raw put every negative label
  // INSIDE its own bar, dark ink on a dark red fill, which is where this was first caught.
  const left = Math.min(x, x + width);
  const right = Math.max(x, x + width);
  return (
    <text
      x={negative ? left - 6 : right + 6}
      y={y + height / 2}
      dy={4}
      textAnchor={negative ? "end" : "start"}
      // Text wears TEXT tokens, never the series colour — the mark beside it carries identity.
      fill={ink}
      fontSize={11}
    >
      {formatKpiValue(value)}
    </text>
  );
}

OuterLabel.propTypes = {
  x: PropTypes.number, y: PropTypes.number, width: PropTypes.number,
  height: PropTypes.number, value: PropTypes.number, ink: PropTypes.string,
};

const knobLabel = (knob) =>
  `${knob.module} · ${knob.label ?? knob.field}`;

export default function FCTornadoChart({ rows, metric, anchor, onSelect }) {
  const { theme } = useTheme();
  const colors = tornadoColors(theme);
  const chrome = chartChrome(theme);
  const lowerIsBetter = metric?.better === "lower";

  const colorFor = (delta) => {
    const favourable = lowerIsBetter ? delta < 0 : delta > 0;
    return favourable ? colors.favourable : colors.adverse;
  };

  const data = rows.map((r) => ({
    label: knobLabel(r.knob),
    band: bandLabel(r.knob),
    low: r.low,
    high: r.high,
    regimeChange: r.regimeChange,
  }));

  // A symmetric domain, so a bar's LENGTH is comparable left to right. An auto domain would make
  // a one-sided knob look balanced.
  const extent = Math.max(
    ...data.flatMap((d) => [Math.abs(d.low), Math.abs(d.high)]),
    1
  );

  // ⚠️ HEADROOM FOR THE OUTER LABELS. The domain used to stop at the longest bar, so that bar's
  // own value label was drawn past the plot edge — on the left it landed on top of the Y-axis
  // category text ("CVC Fund VIII · Growth (× inflation)" with "($69.1K)" through it), which is
  // what a single-row run looks like. 12% of the extent is enough for a "($198.3K)" at 11px.
  const padded = extent * 1.12;

  // ⚠️ TICKS ARE PINNED, and 0 IS ONE OF THEM. Left to itself recharts chose a "nice" set that
  // did not include zero — the centre tick read $1.7K while the anchor line sat at 0 — which on a
  // DIVERGING chart is the one number that must be labelled correctly: every bar is a distance
  // from it.
  const ticks = [-extent, -extent / 2, 0, extent / 2, extent];


  return (
    <div className="fc-tornado">
      {/* Two marks ⇒ a legend is always present, and it names the DIRECTION, not the side. */}
      <div className="fc-tornado-legend">
        <span>
          <i style={{ background: colors.favourable }} aria-hidden="true" />
          {lowerIsBetter ? "moves the shortfall down" : "raises net assets"}
        </span>
        <span>
          <i style={{ background: colors.adverse }} aria-hidden="true" />
          {lowerIsBetter ? "moves the shortfall up" : "lowers net assets"}
        </span>
      </div>

      <ResponsiveContainer width="100%" height={Math.max(data.length * ROW_HEIGHT + 48, 160)}>
        <BarChart data={data} layout="vertical" margin={{ top: 8, right: 72, bottom: 8, left: 8 }}>
          <XAxis
            type="number"
            domain={[-padded, padded]}
            ticks={ticks}
            tickFormatter={(v) => (v === 0 ? "anchor" : formatKpiValue(v))}
            stroke={chrome.ink}
            tick={{ fill: chrome.ink, fontSize: 11 }}
          />
          <YAxis
            type="category"
            dataKey="label"
            width={230}
            stroke={chrome.ink}
            tick={{ fill: chrome.ink, fontSize: 12 }}
          />
          {/* The neutral midpoint a diverging scale needs — a gray, never a third hue. */}
          <ReferenceLine x={0} stroke={colors.axis} strokeWidth={1.5} />
          <Tooltip
            contentStyle={tooltipStyle}
            cursor={{ fill: chrome.grid, fillOpacity: 0.35 }}
            formatter={(value, name, item) => [
              `${formatKpiValue(value)}  (${item?.payload?.band ?? ""} ${name})`,
              metric?.label ?? "",
            ]}
            labelFormatter={(l) => l}
          />
          {/* 2px surface gap between the two bars of a row — `barGap` in surface, not a stroke. */}
          <Bar
            dataKey="low"
            barSize={13}
            radius={[4, 4, 4, 4]}
            isAnimationActive={false}
            onClick={(d) => onSelect?.(rows[d?.index ?? -1])}
            cursor={onSelect ? "pointer" : undefined}
          >
            {data.map((d) => (
              <Cell key={`low-${d.label}`} fill={colorFor(d.low)} />
            ))}
            <LabelList dataKey="low" content={(p) => <OuterLabel {...p} ink={chrome.ink} />} />
          </Bar>
          <Bar
            dataKey="high"
            barSize={13}
            radius={[4, 4, 4, 4]}
            isAnimationActive={false}
            onClick={(d) => onSelect?.(rows[d?.index ?? -1])}
            cursor={onSelect ? "pointer" : undefined}
          >
            {data.map((d) => (
              <Cell key={`high-${d.label}`} fill={colorFor(d.high)} />
            ))}
            <LabelList dataKey="high" content={(p) => <OuterLabel {...p} ink={chrome.ink} />} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>

      {/* The accessible table view: the same numbers as the bars, plus the band that produced
          them. It replaces an earlier list that simply repeated the row labels — which cost a
          third of the panel and told the reader nothing the chart had not already said. */}
      <table className="fc-tornado-table">
        <caption>
          Each knob moved on its own, everything else held still. The ± is the move that produced
          the bar — so a longer bar is not automatically a bigger risk.
          {onSelect && " Open a row to see the path, not just where it ends."}
        </caption>
        <thead>
          <tr>
            <th scope="col">Assumption</th>
            <th scope="col">Moved by</th>
            <th scope="col">Down</th>
            <th scope="col">Up</th>
            <th scope="col"><span className="sr-only">Warning</span></th>
          </tr>
        </thead>
        <tbody>
          {data.map((d, i) => (
            <tr key={d.label}>
              <th scope="row">
                {/* The row, not only the bar, opens the trajectory: a 13px bar is a poor hit
                    target, and a button is reachable by keyboard where an SVG rect is not. */}
                {onSelect ? (
                  <button type="button" className="fc-tornado-open" onClick={() => onSelect(rows[i])}>
                    {d.label}
                  </button>
                ) : d.label}
              </th>
              <td>{d.band}</td>
              <td>{formatKpiValue(d.low)}</td>
              <td>{formatKpiValue(d.high)}</td>
              <td>
                {d.regimeChange && (
                  <span className="fc-tornado-regime" title={
                    "This knob's two ends are not mirror images. That usually means the cash "
                    + "sweep fired on one side — a forced sale that changes everything after it "
                    + "— so the plan does not respond smoothly here."
                  }>
                    ⚠ not symmetric
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="fc-tornado-anchor">
        Anchor — {metric?.label}: <strong>{formatKpiValue(anchor)}</strong>,
        rebuilt for this run rather than read from the saved forecast.
      </p>
    </div>
  );
}

FCTornadoChart.propTypes = {
  rows: PropTypes.arrayOf(PropTypes.object).isRequired,
  metric: PropTypes.object,
  anchor: PropTypes.number,
  onSelect: PropTypes.func,
};
