import "./LEGrid.css";

/**
 * CR083 §9 — the warnings that apply to this LE: L2 drift per frozen month, and
 * the L1 / L6 advisories. Every item is a sentence the server wrote from its own
 * arithmetic; this component renders it and derives nothing.
 *
 * Only what FIRES is shown. A panel listing rules that did not fire is the
 * wallpaper that teaches a reader to skip the panel.
 */
function LEAdvisories({ advisories, drift }) {
  const fired = (advisories?.advisories || []).filter((a) => a.fires);
  const drifted = drift?.drifted || [];
  if (!fired.length && !drifted.length) return null;

  return (
    <section className="le-adv" aria-label="Estimate warnings">
      <ul className="le-adv__list">
        {drifted.map((m) => (
          <li key={`L2-${m.month}`} className="le-adv__item">
            <span className="le-adv__id">L2 · drift</span> {m.sentence}
          </li>
        ))}
        {fired.map((a) => (
          <li key={a.id} className="le-adv__item">
            <span className="le-adv__id">{a.id} · {a.label}</span> {a.message}
          </li>
        ))}
      </ul>
    </section>
  );
}

export default LEAdvisories;
