import { PeriodCountSelector } from "frontend";

// PeriodCountSelector — labelled numeric select for how many periods to show.

export const Default = () => (
  <PeriodCountSelector value={3} onChange={() => {}} options={[1, 2, 3, 6, 12]} />
);

export const Compare = () => (
  <PeriodCountSelector label="Compare periods" value={2} onChange={() => {}} options={[1, 2, 3, 4]} />
);
