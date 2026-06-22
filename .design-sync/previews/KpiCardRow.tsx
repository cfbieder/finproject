import { KpiCard, KpiCardRow } from "frontend";

// KpiCardRow — flex row container that lays out a set of KpiCards. Wide, so the
// card uses column mode. Same token Frame as KpiCard (latent --text/* bug).

const Frame = ({ children }: { children: any }) => (
  <div
    style={{
      ["--text" as any]: "var(--ink)",
      ["--text-muted" as any]: "var(--muted)",
      ["--font-heading" as any]: '"Outfit", sans-serif',
    }}
  >
    {children}
  </div>
);

const up = [3, 4, 4, 6, 5, 8, 9].map((value) => ({ value }));
const down = [9, 8, 8, 6, 7, 5, 4].map((value) => ({ value }));

export const Dashboard = () => (
  <Frame>
    <KpiCardRow>
      <KpiCard title="Net Worth" value={2840000} changeValue={4.2} changeLabel="YTD" chartData={up} />
      <KpiCard title="Cash on Hand" value={184500} changeValue={1.1} changeLabel="vs last month" chartData={up} chartType="bar" />
      <KpiCard title="Monthly Burn" value={-52300} changeValue={-2.8} changeLabel="vs budget" positiveIsGood={false} chartData={down} />
    </KpiCardRow>
  </Frame>
);
