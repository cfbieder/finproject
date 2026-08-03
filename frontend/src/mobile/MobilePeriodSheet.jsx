import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { PERIOD_PRESETS } from "./periodPresets.js";
import MobileSheet from "./MobileSheet.jsx";

const MONTH_ABBR = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

const pad2 = (v) => String(v).padStart(2, "0");

/** "2026-08" ⇄ { year, month } — the value shape of <input type="month">. */
const toInputMonth = (year, month) => `${year}-${month}`;
const fromInputMonth = (value) => {
  const [y, m] = String(value ?? "").split("-");
  const year = Number(y);
  return Number.isFinite(year) && m ? { year, month: m } : null;
};

/** Step a single month, carrying the year. */
const stepMonth = (year, month, delta) => {
  const index = Number(month) - 1 + delta;
  return {
    year: year + Math.floor(index / 12),
    month: pad2(((index % 12) + 12) % 12 + 1),
  };
};

/**
 * Period picker for a phone (CR068).
 *
 * Emits the PeriodSelector shape — { fromMonth, toMonth, actualYear, toYear } —
 * which `periodToFilterFields` turns into filter fields. Whole months only,
 * which is the desktop page's own granularity; a day-level range would be a
 * filter the two pages do not share.
 *
 * The month stepper is the point of this sheet. "Last month" is a preset, but
 * "three months ago" is four taps on a desktop dropdown and one arrow here.
 */
export default function MobilePeriodSheet({ open, value, onApply, onClose }) {
  const [from, setFrom] = useState({
    year: value?.actualYear,
    month: value?.fromMonth,
  });
  const [to, setTo] = useState({
    year: value?.toYear ?? value?.actualYear,
    month: value?.toMonth,
  });

  // Re-seed from the caller each time it opens, so a cancelled sheet never
  // leaks its edits into the next open.
  useEffect(() => {
    if (!open) return;
    setFrom({ year: value?.actualYear, month: value?.fromMonth });
    setTo({ year: value?.toYear ?? value?.actualYear, month: value?.toMonth });
    // Read at open time on purpose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  const isSingleMonth =
    from.year === to.year && from.month === to.month;

  const applyPreset = (preset) => {
    const r = preset.monthRange();
    setFrom({ year: r.actualYear, month: r.fromMonth });
    setTo({ year: r.toYear, month: r.toMonth });
  };

  // The stepper moves BOTH ends when the range is a single month — which is the
  // common case and what the arrows look like they do. On a real range it moves
  // only the end being stepped, so a Jan–Aug range doesn't silently collapse.
  const step = (delta) => {
    if (isSingleMonth) {
      const next = stepMonth(from.year, from.month, delta);
      setFrom(next);
      setTo(next);
    } else {
      setTo(stepMonth(to.year, to.month, delta));
    }
  };

  const emit = () => {
    onApply?.({
      fromMonth: from.month,
      toMonth: to.month,
      actualYear: from.year,
      toYear: to.year,
    });
  };

  const label = isSingleMonth
    ? `${MONTH_ABBR[Number(from.month) - 1]} ${from.year}`
    : `${MONTH_ABBR[Number(from.month) - 1]} ${from.year} – ${
        MONTH_ABBR[Number(to.month) - 1]
      } ${to.year}`;

  return (
    <MobileSheet
      open={open}
      title="Period"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="m-btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="m-btn m-btn--primary" onClick={emit}>
            Apply
          </button>
        </>
      }
    >
      <div className="m-period-body">
        <div className="m-stepper">
          <button
            type="button"
            className="m-stepper__arrow"
            onClick={() => step(-1)}
            aria-label="Previous month"
          >
            <ChevronLeft size={22} />
          </button>
          <span className="m-stepper__label">{label}</span>
          <button
            type="button"
            className="m-stepper__arrow"
            onClick={() => step(1)}
            aria-label="Next month"
          >
            <ChevronRight size={22} />
          </button>
        </div>

        <div className="m-period-row" role="group" aria-label="Period presets">
          {PERIOD_PRESETS.map((preset) => (
            <button
              key={preset.key}
              type="button"
              className="m-period-pill"
              onClick={() => applyPreset(preset)}
            >
              {preset.label}
            </button>
          ))}
        </div>

        <div className="m-period-custom">
          <label className="m-period-custom__field">
            <span>From</span>
            <input
              type="month"
              className="m-select"
              value={toInputMonth(from.year, from.month)}
              onChange={(e) => {
                const parsed = fromInputMonth(e.target.value);
                if (parsed) setFrom(parsed);
              }}
            />
          </label>
          <label className="m-period-custom__field">
            <span>To</span>
            <input
              type="month"
              className="m-select"
              value={toInputMonth(to.year, to.month)}
              onChange={(e) => {
                const parsed = fromInputMonth(e.target.value);
                if (parsed) setTo(parsed);
              }}
            />
          </label>
        </div>
      </div>
    </MobileSheet>
  );
}
