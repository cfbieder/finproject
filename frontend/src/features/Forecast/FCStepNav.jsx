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
              borderColor: isCurrent ? "var(--primary, #567856)" : "#d1d5db",
              borderRadius: "999px",
              background: isCurrent ? "var(--primary, #567856)" : "white",
              color: isCurrent ? "white" : "#4b5563",
              cursor: isCurrent ? "default" : "pointer",
              transition: "all 0.15s",
              whiteSpace: "nowrap",
            }}
            onMouseEnter={(e) => { if (!isCurrent) { e.target.style.background = "#f0f4ff"; e.target.style.borderColor = "var(--primary, #567856)"; e.target.style.color = "var(--primary, #567856)"; }}}
            onMouseLeave={(e) => { if (!isCurrent) { e.target.style.background = "white"; e.target.style.borderColor = "#d1d5db"; e.target.style.color = "#4b5563"; }}}
          >
            {i + 1}. {step.label}
          </button>
        );
      })}
    </div>
  );
}
