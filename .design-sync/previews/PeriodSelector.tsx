import { PeriodSelector } from "frontend";

// PeriodSelector — compound period/range control with presets (This Month, YTD,
// Last Year…) and from/to month + actual/budget year pickers. Renders fully from
// its own defaults.

export const Default = () => <PeriodSelector onChange={() => {}} />;

export const NoBudgetYear = () => <PeriodSelector hideBudgetYear onChange={() => {}} />;

export const YearRange = () => <PeriodSelector enableYearRange onChange={() => {}} />;
