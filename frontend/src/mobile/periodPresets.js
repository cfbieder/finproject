/**
 * Shared period presets for mobile report pages.
 *
 * Two projections of the same preset, because the pages need different shapes:
 *   - `range()`      → { fromDate, toDate } YYYY-MM-DD, for the report endpoints.
 *   - `monthRange()` → { fromMonth, toMonth, actualYear, toYear }, the
 *     PeriodSelector shape the Actuals filter takes (CR068). Feeding this
 *     straight into `periodToFilterFields` is what keeps the mobile and desktop
 *     Actuals pages agreeing on which rows a period contains.
 *
 * One definition per preset, so "This Month" cannot mean two things.
 */

const pad = (v) => String(v).padStart(2, "0");
const fmt = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** { fromDate, toDate } → the month-endpoint shape, both ends inclusive. */
const toMonthRange = ({ fromDate, toDate }) => {
  const [fy, fm] = fromDate.split("-");
  const [ty, tm] = toDate.split("-");
  return {
    fromMonth: fm,
    toMonth: tm,
    actualYear: Number(fy),
    toYear: Number(ty),
  };
};

export const PERIOD_PRESETS = [
  {
    key: "this-month",
    label: "This Month",
    range: () => {
      const now = new Date();
      const from = new Date(now.getFullYear(), now.getMonth(), 1);
      const to = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      return { fromDate: fmt(from), toDate: fmt(to) };
    },
  },
  {
    key: "last-month",
    label: "Last Month",
    range: () => {
      const now = new Date();
      const from = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const to = new Date(now.getFullYear(), now.getMonth(), 0);
      return { fromDate: fmt(from), toDate: fmt(to) };
    },
  },
  {
    key: "this-year",
    label: "This Year",
    range: () => {
      const now = new Date();
      const from = new Date(now.getFullYear(), 0, 1);
      const to = new Date(now.getFullYear(), 11, 31);
      return { fromDate: fmt(from), toDate: fmt(to) };
    },
  },
  {
    key: "last-year",
    label: "Last Year",
    range: () => {
      const now = new Date();
      const from = new Date(now.getFullYear() - 1, 0, 1);
      const to = new Date(now.getFullYear() - 1, 11, 31);
      return { fromDate: fmt(from), toDate: fmt(to) };
    },
  },
];

// Derive the month projection from each preset's own range, so the two can
// never disagree about what a preset covers.
for (const preset of PERIOD_PRESETS) {
  preset.monthRange = () => toMonthRange(preset.range());
}

export const DEFAULT_PERIOD_KEY = "this-month";

export function getPreset(key) {
  return PERIOD_PRESETS.find((p) => p.key === key) ?? PERIOD_PRESETS[0];
}
