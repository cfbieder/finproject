import { useNavigate, useLocation } from "react-router-dom";

const STEPS = [
  { path: "/forecast-mapping", label: "FC Mapping" },
  { path: "/forecast-scenarios", label: "Scenarios" },
  { path: "/forecast-modules", label: "Modules" },
  { path: "/forecast-setup-exp", label: "Expenses" },
  { path: "/forecast-review", label: "Review" },
  { path: "/forecast-compare", label: "Compare" },
];

export default function FCStepNav() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const idx = STEPS.findIndex((s) => s.path === pathname);
  if (idx === -1) return null;

  return (
    <div style={{
      display: "flex", justifyContent: "center", alignItems: "center",
      gap: "0.25rem", padding: "0.4rem 1rem",
    }}>
      {STEPS.map((step, i) => {
        const isCurrent = i === idx;
        return (
          <button
            key={step.path}
            onClick={() => !isCurrent && navigate(step.path)}
            style={{
              padding: "0.3rem 0.75rem",
              fontSize: "0.78rem",
              fontWeight: isCurrent ? 600 : 400,
              border: "1px solid",
              borderColor: isCurrent ? "var(--primary)" : "var(--border)",
              borderRadius: "999px",
              background: isCurrent ? "var(--primary)" : "var(--surface-elevated)",
              color: isCurrent ? "var(--on-accent)" : "var(--ink-secondary)",
              cursor: isCurrent ? "default" : "pointer",
              transition: "all 0.15s",
              whiteSpace: "nowrap",
            }}
            onMouseEnter={(e) => { if (!isCurrent) { e.target.style.background = "var(--primary-subtle)"; e.target.style.borderColor = "var(--primary)"; e.target.style.color = "var(--primary)"; }}}
            onMouseLeave={(e) => { if (!isCurrent) { e.target.style.background = "var(--surface-elevated)"; e.target.style.borderColor = "var(--border)"; e.target.style.color = "var(--ink-secondary)"; }}}
          >
            {i + 1}. {step.label}
          </button>
        );
      })}
    </div>
  );
}
