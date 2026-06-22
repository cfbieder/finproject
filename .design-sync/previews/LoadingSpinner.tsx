import { LoadingSpinner } from "frontend";

// LoadingSpinner — themed ring + optional label. `size` ∈ sm | md | lg.

export const Default = () => <LoadingSpinner size="md" label="Loading transactions…" />;

export const Small = () => <LoadingSpinner size="sm" label="Saving…" />;

export const NoLabel = () => <LoadingSpinner size="md" label="" />;
