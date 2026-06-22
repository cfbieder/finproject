import { KpiCard } from "frontend";

// KpiCard — a single metric tile with trend + optional mini sparkline.
// KpiCards.css references --text/--text-muted/--font-heading which the app never
// defines (latent bug); the Frame supplies them from the real token palette so
// the card renders with correct colors.

const Frame = ({ children }: { children: any }) => (
  <div
    style={{
      ["--text" as any]: "var(--ink)",
      ["--text-muted" as any]: "var(--muted)",
      ["--font-heading" as any]: '"Outfit", sans-serif',
      width: 260,
    }}
  >
    {children}
  </div>
);

const series = [3, 5, 4, 7, 6, 9, 8, 11].map((value) => ({ value }));

export const WithAreaChart = () => (
  <Frame>
    <KpiCard
      title="Net Cash Flow"
      value={1284500}
      changeValue={12.4}
      changeLabel="vs budget"
      chartData={series}
      chartType="area"
    />
  </Frame>
);

export const WithBarChart = () => (
  <Frame>
    <KpiCard
      title="Monthly Spend"
      value={48200}
      changeValue={-3.1}
      changeLabel="vs last month"
      positiveIsGood={false}
      chartData={series}
      chartType="bar"
      chartColor="var(--warning)"
    />
  </Frame>
);

export const Negative = () => (
  <Frame>
    <KpiCard
      title="Operating Result"
      value={-45200}
      changeValue={-8.7}
      changeLabel="vs budget"
    />
  </Frame>
);

export const Simple = () => (
  <Frame>
    <KpiCard title="Accounts Reconciled" value={142} formattedValue="142 / 150" subtitle="6 pending" />
  </Frame>
);
