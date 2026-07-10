/**
 * FCCompareAIPanel (CR040 P3) — on-demand AI narrative for a scenario pair.
 *
 * Reuses the async aiReview infrastructure: POST /ai-review with
 * { scenario: A, compareWith: B } creates a compare conversation (keyed to A,
 * pair persisted via compare_scenario_id), polled via /:id/status. Renders
 * inline with a follow-up box; no apply-actions in compare mode.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Sparkles, Send, RotateCcw } from "lucide-react";
import Rest from "../../js/rest.js";

const POLL_MS = 4000;

export default function FCCompareAIPanel({ scenarioA, scenarioB }) {
  const [review, setReview] = useState(null);
  const [messages, setMessages] = useState([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [input, setInput] = useState("");
  const pollRef = useRef(null);

  const pairReady = scenarioA && scenarioB && scenarioA !== scenarioB;

  const stopPolling = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  const loadConversation = useCallback(async (reviewId) => {
    const conv = await Rest.get(`/ai-review/${reviewId}`);
    setReview(conv.review);
    setMessages(conv.messages || []);
    return conv.review;
  }, []);

  const startPolling = useCallback(
    (reviewId) => {
      stopPolling();
      setPending(true);
      pollRef.current = setInterval(async () => {
        try {
          const status = await Rest.get(`/ai-review/${reviewId}/status`);
          if (status.status === "pending") return;
          stopPolling();
          setPending(false);
          if (status.status === "failed") {
            setError(status.error_message || "AI commentary failed");
          }
          await loadConversation(reviewId);
        } catch (e) {
          stopPolling();
          setPending(false);
          setError(e.message || "Failed to poll AI commentary status");
        }
      }, POLL_MS);
    },
    [loadConversation]
  );

  // On pair change: reset and restore the latest existing conversation.
  useEffect(() => {
    stopPolling();
    setReview(null);
    setMessages([]);
    setPending(false);
    setError("");
    if (!pairReady) return;

    let cancelled = false;
    (async () => {
      try {
        const res = await Rest.get(
          `/ai-review/scenario/${encodeURIComponent(scenarioA)}?compareWith=${encodeURIComponent(scenarioB)}`
        );
        const latest = (res.data || [])[0];
        if (!latest || cancelled) return;
        await loadConversation(latest.id);
        if (latest.status === "pending" && !cancelled) startPolling(latest.id);
      } catch {
        /* no existing conversation is fine */
      }
    })();
    return () => {
      cancelled = true;
      stopPolling();
    };
  }, [scenarioA, scenarioB, pairReady, loadConversation, startPolling]);

  const generate = useCallback(async () => {
    setError("");
    try {
      const res = await Rest.post("/ai-review", {
        scenario: scenarioA,
        compareWith: scenarioB,
      });
      setReview(res.review);
      setMessages([]);
      startPolling(res.review.id);
    } catch (e) {
      setError(e.message || "Failed to start AI commentary");
    }
  }, [scenarioA, scenarioB, startPolling]);

  const sendFollowUp = useCallback(async () => {
    const msg = input.trim();
    if (!msg || !review || pending) return;
    setError("");
    setInput("");
    // Optimistic echo so the question shows while the model thinks
    setMessages((prev) => [...prev, { role: "user", content: msg, id: `local-${prev.length}` }]);
    try {
      await Rest.post(`/ai-review/${review.id}/message`, { message: msg });
      startPolling(review.id);
    } catch (e) {
      setError(e.message || "Failed to send follow-up");
    }
  }, [input, review, pending, startPolling]);

  if (!pairReady) return null;

  const visibleMessages = messages.filter((m, i) => !(i === 0 && m.role === "user"));

  return (
    <div className="fc-compare-ai">
      <div className="fc-compare-ai__head">
        <h3>
          <Sparkles size={15} /> AI Commentary
        </h3>
        {review && !pending && (
          <button
            className="fc-compare-ai__regen"
            onClick={generate}
            title="Start a fresh AI comparison (new conversation)"
          >
            <RotateCcw size={13} /> Regenerate
          </button>
        )}
      </div>

      {error && <div className="fc-compare-ai__error">{error}</div>}

      {!review && !pending && (
        <div className="fc-compare-ai__empty">
          <p>
            Ask the local model to explain where and why “{scenarioB}” differs
            from “{scenarioA}”. Runs on your LAN — no data leaves the network.
          </p>
          <button className="fc-compare-ai__generate" onClick={generate}>
            <Sparkles size={14} /> Generate AI commentary
          </button>
        </div>
      )}

      {visibleMessages.map((m, i) => (
        <div
          key={m.id ?? i}
          className={`fc-compare-ai__msg fc-compare-ai__msg--${m.role}`}
        >
          {m.role === "user" && <span className="fc-compare-ai__msg-label">You</span>}
          <div className="fc-compare-ai__msg-body">{m.content}</div>
        </div>
      ))}

      {pending && (
        <div className="fc-compare-ai__pending">
          Analyzing both scenarios on the local model… this can take a minute
          or two.
        </div>
      )}

      {review && !pending && (
        <div className="fc-compare-ai__followup">
          <input
            type="text"
            value={input}
            placeholder="Ask a follow-up — e.g. “why does B's cash dip in 2031?”"
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && sendFollowUp()}
          />
          <button onClick={sendFollowUp} disabled={!input.trim()} aria-label="Send follow-up">
            <Send size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
