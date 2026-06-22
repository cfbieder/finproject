import { EmptyState } from "frontend";

// EmptyState — illustration + message for empty views. `variant` picks the art.

export const NoData = () => (
  <EmptyState variant="no-data" message="No transactions in this period" />
);

export const Searching = () => (
  <EmptyState variant="searching" message="No accounts match your search" />
);

export const Finance = () => (
  <EmptyState variant="finance" message="Connect a bank feed to get started" />
);

export const Upload = () => (
  <EmptyState variant="upload" message="Drop a Quicken export here to import" />
);
