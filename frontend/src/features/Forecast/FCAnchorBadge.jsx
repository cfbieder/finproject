/**
 * FCAnchorBadge (CR064 §3.3) — says when a scenario's modules are anchored at a stale year-end.
 *
 * By the owner's rule (CR075: −2 actual, −1 budget, 0 first forecast year) a scenario starting in
 * P should have its account-matched valued modules anchored at 31 Dec P−2. The badge renders only
 * when some sit earlier ("run the annual close") or when they disagree with each other; a current
 * scenario renders nothing, so it can sit on every page without becoming wallpaper.
 */
import { useEffect, useState } from "react";
import Rest from "../../js/rest.js";
import "./FCAnnualCloseModal.css";

export default function FCAnchorBadge({ scenarioName, refreshKey }) {
  const [all, setAll] = useState([]);

  useEffect(() => {
    if (!scenarioName) return undefined;
    let cancelled = false;
    Rest.get("/forecast/scenarios/anchors")
      .then((r) => { if (!cancelled) setAll(r.data || []); })
      .catch(() => { if (!cancelled) setAll(null); });
    return () => { cancelled = true; };
  }, [scenarioName, refreshKey]);

  // A failed check must not read as "anchors are current".
  if (scenarioName && all === null) {
    return <p className="fc-anchor-badge" role="status">⚠️ Could not check this scenario&apos;s module anchors.</p>;
  }
  const status = scenarioName ? all.find((s) => s.name === scenarioName) : null;
  if (!status || (!status.behind && !status.mixed)) return null;
  const dates = status.anchors.map((a) => `${a.date} (${a.modules})`).join(", ");
  return (
    <p className="fc-anchor-badge" role="status">
      ⚠️{" "}
      {status.behind > 0
        ? `${status.behind} module(s) are anchored before 31 Dec ${status.actualYear}, the last actual year for a forecast starting ${status.periodStart} — run the annual close.`
        : "This scenario's modules are anchored at different year-ends."}{" "}
      <span className="fc-anchor-badge__dates">Anchors: {dates}.</span>
    </p>
  );
}
