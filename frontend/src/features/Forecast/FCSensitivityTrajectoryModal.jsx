/**
 * CR085 P2 — the trajectory behind one bar.
 *
 * ⚠️ WHY A BAR IS NOT ENOUGH. The tornado ranks on net assets at the FINAL year, and that single
 * number cannot say WHEN the damage lands. A knob that costs 70K by 2062 and one that runs the
 * plan dry in 2041 can draw the same bar. This is the picture that separates them, and it is the
 * same chart `/forecast-multi-compare` draws — `FCTrajectoryChart`, reused unchanged, so the two
 * pages cannot drift on tooltip, axis or palette.
 *
 * Three lines only — base, the knob's down run, its up run. Cross-knob comparison is what the
 * tornado is FOR; overlaying every run would be the spaghetti CR067 capped this chart at seven to
 * avoid.
 */
import PropTypes from "prop-types";
import { useState } from "react";
import Modal from "../../components/Modal/Modal.jsx";
import FCTrajectoryChart from "./FCTrajectoryChart.jsx";
import { METRICS as TRAJECTORY_METRICS } from "./utils/fcTrajectoryMetrics.js";
import {
  bandLabel, combinedTrajectory, knobTrajectory,
} from "./utils/fcSensitivityUtils.js";
import { tornadoColors } from "./utils/fcSeriesPalette.js";
import useTheme from "../../hooks/useTheme.js";
import { formatKpiValue } from "../../components/KpiCards.jsx";

export default function FCSensitivityTrajectoryModal({
  open, onClose, result, row, shared, combined, combinedState, interaction,
}) {
  const { theme } = useTheme();
  const [metric, setMetric] = useState(TRAJECTORY_METRICS[0].key);
  const [mode, setMode] = useState("absolute");

  // `base` comes from the tornado palette, where it is a NEUTRAL and carries a dash. It used to
  // borrow the categorical slot 0 — which is blue, and so is the favourable pole, so the reference
  // line and one of the two measurements were the same colour.
  const colors = tornadoColors(theme);

  // One modal, two subjects: a single knob's two ends, or every knob moved at once.
  const isCombined = row === "__combined__";

  const { years, series } = (() => {
    if (!shared) return { years: [], series: [] };
    if (isCombined) return combinedTrajectory(combined, shared, metric, colors);
    return row ? knobTrajectory(result, row.knobId, shared, metric, colors, mode)
      : { years: [], series: [] };
  })();

  const title = isCombined
    ? "Every change at once"
    : row ? `${row.knob.module} · ${row.knob.label ?? row.knob.field}` : "Trajectory";

  return (
    <Modal open={open} onClose={onClose} title={title} size="chart">
      <div className="fc-sens-trajectory">
        <div className="fc-sens-trajectory-head">
          <p className="fc-sens-trajectory-lead">
            {isCombined
              ? "The plan built once with every one of these moved at the same time — against the plan as it stands."
              : `Moved ${bandLabel(row?.knob || {})} against the plan as it stands. The bar is only the final year; this is the path it takes to get there.`}
          </p>
          {!isCombined && (
          <div className="fc-sens-trajectory-mode" role="group" aria-label="View">
            <button
              type="button"
              className={mode === "absolute" ? "is-active" : ""}
              onClick={() => setMode("absolute")}
            >
              Absolute
            </button>
            <button
              type="button"
              className={mode === "delta" ? "is-active" : ""}
              onClick={() => setMode("delta")}
              title="Subtract the base, so the two runs fan out at their own scale instead of overlapping it"
            >
              Difference from base
            </button>
          </div>
          )}
        </div>

        {isCombined && combinedState?.status === "running" && (
          <p className="fc-sens-note">
            Building {combinedState.done}/{combinedState.total}…
          </p>
        )}
        {isCombined && combinedState?.status === "error" && (
          <p className="fc-sens-error">{combinedState.error}</p>
        )}

        {series.length > 0 ? (
          <FCTrajectoryChart
            title=""
            years={years}
            series={series}
            metric={metric}
            onMetricChange={setMetric}
            height={340}
          />
        ) : (
          <p className="fc-sens-note">
            This knob&apos;s runs could not be rebuilt into a trajectory.
          </p>
        )}

        {/* ⚠️ THE SUM APPEARS ONLY AS THE THING THE MEASUREMENT IS COMPARED AGAINST.
            §5.4 forbids displaying a sum of impacts on its own, because the model is
            path-dependent — the sweep sells different assets when several things move at once, so
            adding the bars gives a number the engine never produces. Showing the measured
            combination beside it is what turns that objection into the answer. */}
        {isCombined && interaction && (
          <table className="fc-tornado-table fc-sens-interaction">
            <tbody>
              <tr>
                <th scope="row">If you just added the bars up</th>
                <td>{formatKpiValue(interaction.summed)}</td>
              </tr>
              <tr>
                <th scope="row">Measured, all moved together</th>
                <td><strong>{formatKpiValue(interaction.measured)}</strong></td>
              </tr>
              <tr>
                <th scope="row">The difference — how they interact</th>
                <td>
                  {formatKpiValue(interaction.interaction)}{" "}
                  <span className="fc-sens-interaction-verdict">
                    {Math.abs(interaction.interaction) < 1
                      ? "they act independently here"
                      : interaction.worseThanSum
                        ? "they COMPOUND — worse together than apart"
                        : "they OFFSET — better together than apart"}
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
        )}

        {!isCombined && row?.regimeChange && (
          <p className="fc-sens-trajectory-regime">
            ⚠ This knob&apos;s two ends are not mirror images, so watch where the lines stop being
            parallel — that is usually the cash sweep firing on one side, a forced sale that
            changes everything after it.
          </p>
        )}
      </div>
    </Modal>
  );
}

FCSensitivityTrajectoryModal.propTypes = {
  open: PropTypes.bool,
  onClose: PropTypes.func.isRequired,
  result: PropTypes.object,
  // Either a ranked row, or the sentinel "__combined__".
  row: PropTypes.oneOfType([PropTypes.object, PropTypes.string]),
  shared: PropTypes.object,
  combined: PropTypes.object,
  combinedState: PropTypes.object,
  interaction: PropTypes.object,
};
