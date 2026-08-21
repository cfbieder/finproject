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
import { bandLabel, knobTrajectory } from "./utils/fcSensitivityUtils.js";
import { tornadoColors, seriesColors } from "./utils/fcSeriesPalette.js";
import useTheme from "../../hooks/useTheme.js";

export default function FCSensitivityTrajectoryModal({ open, onClose, result, row, shared }) {
  const { theme } = useTheme();
  const [metric, setMetric] = useState(TRAJECTORY_METRICS[0].key);
  const [mode, setMode] = useState("absolute");

  const colors = {
    ...tornadoColors(theme),
    // The base line takes slot 0 of the categorical set, exactly as Multi-Compare's base does,
    // so "the bold one is the plan as it stands" reads the same on both pages.
    base: seriesColors(theme)[0],
  };

  const { years, series } = row && shared
    ? knobTrajectory(result, row.knobId, shared, metric, colors, mode)
    : { years: [], series: [] };

  const title = row ? `${row.knob.module} · ${row.knob.label ?? row.knob.field}` : "Trajectory";

  return (
    <Modal open={open} onClose={onClose} title={title} size="chart">
      <div className="fc-sens-trajectory">
        <div className="fc-sens-trajectory-head">
          <p className="fc-sens-trajectory-lead">
            Moved {bandLabel(row?.knob || {})} against the plan as it stands. The bar is only the
            final year; this is the path it takes to get there.
          </p>
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
        </div>

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

        {row?.regimeChange && (
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
  row: PropTypes.object,
  shared: PropTypes.object,
};
