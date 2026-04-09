/**
 * Shared period presets for mobile report pages.
 * Each preset returns { fromDate, toDate } as YYYY-MM-DD strings in local time.
 */

const pad = (v) => String(v).padStart(2, "0");
const fmt = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

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

export const DEFAULT_PERIOD_KEY = "this-month";

export function getPreset(key) {
  return PERIOD_PRESETS.find((p) => p.key === key) ?? PERIOD_PRESETS[0];
}
