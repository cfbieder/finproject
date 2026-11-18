/** CR105 S2 — the header's month picker (one period for every report). */
import { ChevronLeft, ChevronRight, CalendarClock } from "lucide-react";
import { useHeaderPeriod } from "../../contexts/headerPeriod.js";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export default function HeaderPeriodPicker() {
  const hp = useHeaderPeriod();
  if (!hp) return null;
  const { year, month, isCurrent, setPeriod } = hp;
  // Reports read actuals, so the period stops at the current month; it goes back
  // as far as the pages' own year lists (YEAR_OPTIONS: this year and five before).
  const now = new Date();
  const nowY = now.getFullYear();
  const nowM = now.getMonth() + 1;
  const minY = nowY - 5;
  const years = [];
  for (let y = nowY; y >= minY; y -= 1) years.push(y);
  const clamp = (y, m) => {
    if (y > nowY || (y === nowY && m > nowM)) return [nowY, nowM];
    if (y < minY) return [minY, 1];
    return [y, m];
  };
  const go = (y, m) => setPeriod(...clamp(y, m));

  const shift = (delta) => {
    const d = new Date(year, month - 1 + delta, 1);
    go(d.getFullYear(), d.getMonth() + 1);
  };

  return (
    <div className="wb-period" role="group" aria-label="Report period">
      <CalendarClock size={15} className="wb-period__icon" aria-hidden="true" />
      <button
        type="button"
        className="wb-period__step"
        onClick={() => shift(-1)}
        disabled={year === minY && month === 1}
        aria-label="Previous month"
      >
        <ChevronLeft size={15} />
      </button>
      <select
        className="wb-period__sel"
        value={month}
        onChange={(e) => go(year, Number(e.target.value))}
        aria-label="Report month"
      >
        {MONTHS.map((m, i) => (
          <option key={m} value={i + 1} disabled={year === nowY && i + 1 > nowM}>
            {m}
          </option>
        ))}
      </select>
      <select
        className="wb-period__sel"
        value={year}
        onChange={(e) => go(Number(e.target.value), month)}
        aria-label="Report year"
      >
        {years.map((y) => (
          <option key={y} value={y}>
            {y}
          </option>
        ))}
      </select>
      <button
        type="button"
        className="wb-period__step"
        onClick={() => shift(1)}
        disabled={isCurrent}
        aria-label="Next month"
      >
        <ChevronRight size={15} />
      </button>
      {!isCurrent && (
        <button
          type="button"
          className="wb-period__now"
          onClick={() => setPeriod(nowY, nowM)}
          title="Back to this month"
        >
          This month
        </button>
      )}
    </div>
  );
}
