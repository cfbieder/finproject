import { Link, useLocation } from "react-router-dom";

/**
 * NotFound — the catch-all route (CR086). A mistyped or retired URL used to render an empty
 * layout with no message, which reads as "the page is broken" rather than "this page does not
 * exist".
 */
export default function NotFound() {
  const { pathname } = useLocation();
  return (
    <div style={{ padding: "2rem 1rem", maxWidth: "40rem" }}>
      <h1 style={{ marginTop: 0 }}>Page not found</h1>
      <p style={{ color: "var(--ink-secondary)" }}>
        Nothing lives at <code>{pathname}</code>. It may have moved, or the link may be mistyped.
      </p>
      <Link to="/" className="btn btn--primary">Go to Home</Link>
    </div>
  );
}
