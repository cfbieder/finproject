import { Toast } from "frontend";

// Toast — transient status banner. The `type` prop drives icon + color.
// Each export is one card cell.

export const Info = () => (
  <Toast type="info" message="Syncing transactions from Chase…" onClose={() => {}} />
);

export const Success = () => (
  <Toast type="success" message="Reconciliation complete — 142 transactions matched." onClose={() => {}} />
);

export const Warning = () => (
  <Toast type="warning" message="3 transactions are missing a category." onClose={() => {}} />
);

export const Error = () => (
  <Toast type="error" message="Couldn't reach the bank feed. Retrying in 30s." onClose={() => {}} />
);
