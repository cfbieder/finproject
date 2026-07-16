import { useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import Modal from "../../components/Modal/Modal.jsx";
import Rest from "../../js/rest.js";
import { formatMoney } from "./utils/fcWarnings.js";
import "./FCAutoAdjustModal.css";

/**
 * FCAutoAdjustModal (CR053) — solve the least uniform spend cut that funds the plan.
 *
 * The user picks a set of expense lines and (optionally) a maximum cut. The server deep-copies the
 * scenario into a throwaway scratch, threshold-searches the retained fraction until the engine's
 * own `Cash Shortfall` disappears (~10 builds, async job + poll), and reports the least cut. Apply
 * persists it as a CR050 override on a variant (a base scenario gets a "… — reduced spend" variant;
 * the base is never mutated) and re-verifies by rebuilding.
 *
 * @param {boolean}  open
 * @param {string}   scenarioName   the scenario currently under review
 * @param {number}   cashSweepLow   the low band (shown for context)
 * @param {Function} onClose
 * @param {Function} onApplied      (result) => void — parent reloads / switches to the variant
 */
export default function FCAutoAdjustModal({ open, scenarioName, cashSweepLow, onClose, onApplied }) {
  // This component is mounted fresh each time it opens (parent renders it conditionally with a
  // key), so these initial values ARE the per-open reset — no state-resetting effect needed.
  const [lines, setLines] = useState([]);
  const [selected, setSelected] = useState(() => new Set());
  const [maxCutPct, setMaxCutPct] = useState("");
  const [loadingLines, setLoadingLines] = useState(true);
  const [solving, setSolving] = useState(false);
  const [result, setResult] = useState(null);
  const [applying, setApplying] = useState(false);
  const [applied, setApplied] = useState(null);
  const [error, setError] = useState("");
  const pollRef = useRef(null);

  const key = (l) => `${l.type}:${l.id}`;

  // Load candidate expense lines once on mount (fetch is the only side effect here).
  useEffect(() => {
    let cancelled = false;
    Rest.fetchJson(`/api/v2/forecast/auto-adjust/lines/${encodeURIComponent(scenarioName)}`)
      .then((res) => !cancelled && setLines(res?.lines || []))
      .catch((e) => !cancelled && setError(e.message || "Failed to load expense lines"))
      .finally(() => !cancelled && setLoadingLines(false));
    return () => {
      cancelled = true;
      if (pollRef.current) clearTimeout(pollRef.current);
    };
  }, [scenarioName]);

  const toggle = (l) => {
    setResult(null);
    setApplied(null);
    setSelected((prev) => {
      const next = new Set(prev);
      const k = key(l);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  };

  const selectedLines = lines.filter((l) => selected.has(key(l)));
  const selectedTotal = selectedLines.reduce((sum, l) => sum + Math.abs(Number(l.amount) || 0), 0);

  const minRetain = (() => {
    const pct = parseFloat(maxCutPct);
    if (!Number.isFinite(pct) || pct <= 0) return 0;
    return Math.max(0, Math.min(0.99, (100 - pct) / 100));
  })();

  // Function declaration (hoisted) so the recursive setTimeout can reference it.
  function poll(jobId) {
    Rest.fetchJson(`/api/v2/forecast/auto-adjust/solve/${jobId}`)
      .then((res) => {
        if (res.status === "running") {
          pollRef.current = setTimeout(() => poll(jobId), 1500);
        } else if (res.status === "done") {
          setResult(res.result);
          setSolving(false);
        } else {
          setError(res.error || "Solve failed");
          setSolving(false);
        }
      })
      .catch((e) => {
        setError(e.message || "Solve failed");
        setSolving(false);
      });
  }

  const handleSolve = () => {
    setError("");
    setResult(null);
    setApplied(null);
    setSolving(true);
    Rest.post("/forecast/auto-adjust/solve", {
      scenarioName,
      lines: selectedLines.map((l) => ({ type: l.type, id: l.id })),
      minRetain,
    })
      .then((res) => poll(res.jobId))
      .catch((e) => {
        setError(e.message || "Could not start solve");
        setSolving(false);
      });
  };

  const handleApply = () => {
    setError("");
    setApplying(true);
    Rest.post("/forecast/auto-adjust/apply", {
      scenarioName,
      lines: selectedLines.map((l) => ({ type: l.type, id: l.id })),
      retain: result.retain,
    })
      .then((res) => {
        setApplied(res);
        if (onApplied) onApplied(res);
      })
      .catch((e) => setError(e.message || "Apply failed"))
      .finally(() => setApplying(false));
  };

  const canSolve = selectedLines.length > 0 && !solving && !applying;

  const footer = applied ? (
    <button type="button" className="btn btn-primary" onClick={onClose}>
      Done
    </button>
  ) : (
    <>
      <button type="button" className="btn" onClick={onClose} disabled={applying}>
        Cancel
      </button>
      {result && result.feasible && !result.alreadyFunded ? (
        <button type="button" className="btn btn-primary" onClick={handleApply} disabled={applying}>
          {applying ? "Applying…" : `Apply ${result.cutPct}% cut`}
        </button>
      ) : (
        <button type="button" className="btn btn-primary" onClick={handleSolve} disabled={!canSolve}>
          {solving ? "Solving…" : "Solve"}
        </button>
      )}
    </>
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Auto-adjust spending to fund the plan"
      description={`Find the smallest uniform cut to the chosen expense lines so no year falls below the ${formatMoney(cashSweepLow)} cash band.`}
      size="wide"
      footer={footer}
      dismissable={!solving && !applying}
    >
      <div className="fc-autoadjust">
        {error && (
          <div className="fc-autoadjust__error" role="alert">
            <AlertTriangle size={15} /> {error}
          </div>
        )}

        {applied ? (
          <ApplyResult applied={applied} />
        ) : (
          <>
            <p className="fc-autoadjust__hint">
              Select the expense lines you're willing to reduce. The same percentage is applied to
              every year (so each line keeps its shape). Cutting more lines, or bigger ones, makes a
              shortfall easier to close.
            </p>

            {loadingLines ? (
              <div className="fc-autoadjust__loading">
                <Loader2 size={16} className="fc-autoadjust__spin" /> Loading expense lines…
              </div>
            ) : (
              <div className="fc-autoadjust__lines">
                {lines.length === 0 && <p className="fc-autoadjust__empty">No expense lines to cut.</p>}
                {lines.map((l) => (
                  <label key={key(l)} className="fc-autoadjust__line">
                    <input
                      type="checkbox"
                      checked={selected.has(key(l))}
                      onChange={() => toggle(l)}
                    />
                    <span className="fc-autoadjust__line-name">{l.name}</span>
                    <span className="fc-autoadjust__line-type">{l.type === "module" ? "module" : "item"}</span>
                    <span className="fc-autoadjust__line-amt">
                      {formatMoney(Math.abs(Number(l.amount) || 0))}
                      {l.currency && l.currency !== "USD" ? ` ${l.currency}` : ""}/yr
                    </span>
                  </label>
                ))}
              </div>
            )}

            <div className="fc-autoadjust__controls">
              <div className="fc-autoadjust__selected">
                {selectedLines.length} selected · {formatMoney(selectedTotal)}/yr base spend
              </div>
              <label className="fc-autoadjust__maxcut">
                Don't cut more than
                <input
                  type="number"
                  min="1"
                  max="99"
                  value={maxCutPct}
                  placeholder="—"
                  onChange={(e) => setMaxCutPct(e.target.value)}
                />
                %
              </label>
            </div>

            {result && <SolveResult result={result} />}
          </>
        )}
      </div>
    </Modal>
  );
}

function SolveResult({ result }) {
  if (result.alreadyFunded) {
    return (
      <div className="fc-autoadjust__result fc-autoadjust__result--ok">
        <CheckCircle2 size={16} /> This scenario already stays funded every year — no cut needed.
      </div>
    );
  }
  if (!result.feasible) {
    return (
      <div className="fc-autoadjust__result fc-autoadjust__result--bad">
        <AlertTriangle size={16} />
        <div>
          Even cutting these lines by the maximum, <strong>{formatMoney(result.residual)}</strong> of
          shortfall remains. Select more (or larger) lines, raise the max cut, or rank another sweep
          source / schedule a disposal instead.
        </div>
      </div>
    );
  }
  return (
    <div className="fc-autoadjust__result fc-autoadjust__result--ok">
      <CheckCircle2 size={16} />
      <div>
        Cutting the selected spending by <strong>{result.cutPct}%</strong> every year funds the plan.
        Shortfall <strong>{formatMoney(result.shortfallBefore)}</strong> →{" "}
        <strong>{formatMoney(result.shortfallAfter)}</strong>.
        <div className="fc-autoadjust__result-sub">
          Solved in {result.evals} projection{result.evals === 1 ? "" : "s"}. Apply saves this as a
          variant override — your base scenario is left unchanged.
        </div>
      </div>
    </div>
  );
}

function ApplyResult({ applied }) {
  return (
    <div className="fc-autoadjust__result fc-autoadjust__result--ok">
      <CheckCircle2 size={16} />
      <div>
        Applied a <strong>{applied.cutPct}%</strong> cut to{" "}
        <strong>{applied.appliedTo}</strong>
        {applied.createdVariant ? " (new variant created from your base scenario)" : ""}.{" "}
        {applied.verifiedFunded ? (
          <>Rebuilt and verified: the plan now stays funded every year.</>
        ) : (
          <>
            A residual of <strong>{formatMoney(applied.shortfallAfter)}</strong> remains after the
            rebuild — you may need a larger cut or a second lever.
          </>
        )}
      </div>
    </div>
  );
}
