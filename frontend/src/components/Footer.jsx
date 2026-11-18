import "./Footer.css";

export default function Footer() {
  return (
    <footer className="app-footer">
      <div className="app-footer__inner">
        {/* No version here: it was a hand-typed "v2" that went stale. The live
            version shows in the sidebar and the top strip. */}
        <span className="app-footer__brand">Fin</span>
        <span className="app-footer__separator">|</span>
        <span className="app-footer__tagline">Personal Finance Manager</span>
      </div>
    </footer>
  );
}
