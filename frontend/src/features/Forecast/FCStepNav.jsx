import { useNavigate, useLocation } from "react-router-dom";
import "./FCStepNav.css";

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
    <nav className="fc-step-nav" aria-label="Forecast steps">
      {STEPS.map((step, i) => {
        const isCurrent = i === idx;
        return (
          <button
            key={step.path}
            type="button"
            className={`fc-step-nav__step${isCurrent ? " fc-step-nav__step--current" : ""}`}
            aria-current={isCurrent ? "step" : undefined}
            onClick={() => !isCurrent && navigate(step.path)}
          >
            {i + 1}. {step.label}
          </button>
        );
      })}
    </nav>
  );
}
