import { useNavigate, useLocation } from "react-router-dom";

const STEPS = [
  { path: "/forecast-mapping", label: "FC Mapping" },
  { path: "/forecast-scenarios", label: "Scenarios" },
  { path: "/forecast-modules", label: "Modules" },
  { path: "/forecast-setup-exp", label: "Expenses" },
  { path: "/forecast-review", label: "Review" },
];

export default function FCStepNav() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const idx = STEPS.findIndex((s) => s.path === pathname);
  if (idx === -1) return null;

  const prev = idx > 0 ? STEPS[idx - 1] : null;
  const next = idx < STEPS.length - 1 ? STEPS[idx + 1] : null;

  return (
    <div style={{
      display: "flex", justifyContent: "space-between", alignItems: "center",
      padding: "0.35rem 1rem", fontSize: "0.8rem",
    }}>
      {prev ? (
        <button
          onClick={() => navigate(prev.path)}
          style={{
            background: "none", border: "none", cursor: "pointer",
            color: "var(--primary, #1e40af)", fontWeight: 500, fontSize: "0.8rem",
            display: "flex", alignItems: "center", gap: "0.25rem",
          }}
        >
          &larr; {prev.label}
        </button>
      ) : <span />}
      <span style={{ color: "var(--text-secondary)", fontSize: "0.75rem" }}>
        Step {idx + 1} of {STEPS.length}
      </span>
      {next ? (
        <button
          onClick={() => navigate(next.path)}
          style={{
            background: "none", border: "none", cursor: "pointer",
            color: "var(--primary, #1e40af)", fontWeight: 500, fontSize: "0.8rem",
            display: "flex", alignItems: "center", gap: "0.25rem",
          }}
        >
          {next.label} &rarr;
        </button>
      ) : <span />}
    </div>
  );
}
