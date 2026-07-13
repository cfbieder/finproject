import { useNavigate, useLocation } from "react-router-dom";
import { routes } from "../../config/routes.jsx";
import "./FCStepNav.css";

/**
 * The steps are DERIVED from the route config (`step` / `stepLabel`), not restated here.
 *
 * They used to be a hand-kept list in this file, and the sidebar kept its own — so the two
 * drifted: same six pages, different order, different names ("FC Mapping" here vs "Income &
 * Expense Mapping" there — the developer vocabulary CR042 T2 opened by objecting to). Two
 * lists of the same thing that disagree is worse than one long list. One source now; the
 * sidebar renders `step` + `label`, this renders `step` + `stepLabel`, and they cannot
 * diverge.
 */
const STEPS = routes
  .filter((route) => route.step)
  .sort((a, b) => a.step - b.step)
  .map((route) => ({ path: route.path, label: route.stepLabel || route.label }));

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
