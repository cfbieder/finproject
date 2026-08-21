/**
 * CR085 P1 — start a sensitivity run and poll it.
 *
 * The run is up to 17 engine builds, ~8 seconds. CR084 §8 learned that **the wait has to look
 * like a wait**, so the poll surfaces the server's own build counter rather than a bare spinner
 * that could equally be masking a hung request.
 *
 * ⚠️ A flat `while` loop, not a self-referencing `setTimeout` callback: a `useCallback` that
 * recurses into itself trips `react-hooks/immutability`, and the lint ratchets may only shrink.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import Rest from "../../../js/rest.js";

const POLL_MS = 700;

export default function useSensitivityRun() {
  const [state, setState] = useState({ status: "idle", done: 0, total: 0 });
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const cancelled = useRef(false);

  useEffect(() => {
    cancelled.current = false;
    return () => { cancelled.current = true; };
  }, []);

  const start = useCallback(async (scenario, knobs) => {
    setError(null);
    setResult(null);
    setState({ status: "running", done: 0, total: knobs.length * 2 + 1 });

    let jobId;
    try {
      ({ jobId } = await Rest.post("/forecast/sensitivity", { scenario, knobs })
        .then((r) => r.data));
    } catch (e) {
      // A refused run is the owner's to read — too many knobs, a knob that cannot be moved, or
      // another run already going. It arrives as a 409 carrying a sentence, not a stack trace.
      setError(e?.message || "The run could not be started.");
      setState({ status: "error", done: 0, total: 0 });
      return;
    }

    for (;;) {
      await new Promise((r) => setTimeout(r, POLL_MS));
      if (cancelled.current) return;
      let job;
      try {
        job = await Rest.get(`/forecast/sensitivity/${jobId}`).then((r) => r.data);
      } catch (e) {
        if (cancelled.current) return;
        setError(e?.message || "Lost contact with the run.");
        setState({ status: "error", done: 0, total: 0 });
        return;
      }
      if (cancelled.current) return;

      if (job.status === "running") {
        setState({ status: "running", done: job.done || 0, total: job.total || 0 });
        continue;
      }
      if (job.status === "done") {
        setResult(job.result);
        setState({ status: "done", done: job.total || 0, total: job.total || 0 });
      } else {
        setError(job.error || "The run failed.");
        setState({ status: "error", done: 0, total: 0 });
      }
      return;
    }
  }, []);

  return { start, state, result, error };
}
