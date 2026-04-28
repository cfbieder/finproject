import { useState, useEffect, useRef, useCallback } from "react";
import Rest from "../../js/rest.js";
import EmptyState from "../../components/EmptyState.jsx";
import { useToast } from "../../contexts";

const POLL_INTERVAL_MS = 8000;

function fireBrowserNotification(scenarioName) {
  if (typeof Notification === "undefined") return;
  if (Notification.permission !== "granted") return;
  if (typeof document !== "undefined" && document.visibilityState === "visible") return;
  try {
    new Notification("AI plan review ready", {
      body: `Your forecast review for "${scenarioName}" is complete.`,
      tag: "fc-ai-review",
    });
  } catch (_) { /* noop */ }
}

const NOTIF_PRIMER_DISMISSED_KEY = "fcAiReview.notifPrimerDismissed";

function shouldShowNotificationPrimer() {
  if (typeof Notification === "undefined") return false;
  if (Notification.permission !== "default") return false;
  try {
    return localStorage.getItem(NOTIF_PRIMER_DISMISSED_KEY) !== "true";
  } catch (_) {
    return true;
  }
}

/**
 * Parses action blocks from AI response content.
 * Looks for ```action ... ``` blocks containing JSON.
 */
function parseActions(content) {
  const actions = [];
  const regex = /```action\s*\n([\s\S]*?)\n```/g;
  let match;
  while ((match = regex.exec(content)) !== null) {
    try {
      actions.push(JSON.parse(match[1].trim()));
    } catch (e) { /* skip malformed */ }
  }
  return actions;
}

/**
 * Renders markdown-like content with action blocks as Apply buttons
 */
function MessageContent({ content, onApply, appliedActions }) {
  // Split content around action blocks
  const parts = [];
  let lastIdx = 0;
  const regex = /```action\s*\n([\s\S]*?)\n```/g;
  let match;
  let actionIdx = 0;

  while ((match = regex.exec(content)) !== null) {
    if (match.index > lastIdx) {
      parts.push({ type: "text", value: content.slice(lastIdx, match.index) });
    }
    try {
      const action = JSON.parse(match[1].trim());
      const key = `${action.type}-${action.module_id || action.incexp_id || action.scenario_id}-${action.field}`;
      const isApplied = appliedActions.has(key);
      parts.push({ type: "action", value: action, key, isApplied, idx: actionIdx++ });
    } catch (e) {
      parts.push({ type: "text", value: match[0] });
    }
    lastIdx = match.index + match[0].length;
  }
  if (lastIdx < content.length) {
    parts.push({ type: "text", value: content.slice(lastIdx) });
  }

  return (
    <div>
      {parts.map((part, i) => {
        if (part.type === "text") {
          return <div key={i} style={{ whiteSpace: "pre-wrap" }}>{part.value}</div>;
        }
        const a = part.value;
        return (
          <div key={i} style={{
            margin: "0.5rem 0", padding: "0.6rem 0.8rem", borderRadius: "0.5rem",
            background: part.isApplied ? "#f0fdf4" : "#eff6ff",
            border: `1px solid ${part.isApplied ? "#86efac" : "#bfdbfe"}`,
            fontSize: "0.82rem",
          }}>
            <div style={{ fontWeight: 600, marginBottom: "0.25rem" }}>
              {part.isApplied ? "Applied" : "Recommendation"}:
              {" "}{a.field?.replace(/_/g, " ")} → {a.proposed_value}
              {a.current_value != null && <span style={{ color: "#808E9B" }}> (was {a.current_value})</span>}
            </div>
            {a.reason && <div style={{ color: "#4A5568", fontSize: "0.78rem" }}>{a.reason}</div>}
            {!part.isApplied && (
              <button
                onClick={() => onApply(a, part.key)}
                style={{
                  marginTop: "0.4rem", padding: "0.25rem 0.75rem", borderRadius: "0.375rem",
                  border: "1px solid #7FA37F", background: "#7FA37F", color: "white",
                  fontSize: "0.78rem", fontWeight: 600, cursor: "pointer",
                }}
              >
                Apply Change
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function FCAIReviewDrawer({ isOpen, onClose, scenarioName, onUnreadChange }) {
  const [reviews, setReviews] = useState([]);
  const [activeReviewId, setActiveReviewId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [error, setError] = useState("");
  const [appliedActions, setAppliedActions] = useState(new Set());
  const [confirmAction, setConfirmAction] = useState(null);
  const [unreadIds, setUnreadIds] = useState(() => new Set());
  const [notifPrimerOpen, setNotifPrimerOpen] = useState(false);
  const pendingActionRef = useRef(null);
  const messagesEndRef = useRef(null);
  const isOpenRef = useRef(isOpen);
  const { showSuccess, showError } = useToast();

  const runWithPermissionGate = useCallback((action) => {
    if (shouldShowNotificationPrimer()) {
      pendingActionRef.current = action;
      setNotifPrimerOpen(true);
    } else {
      action();
    }
  }, []);

  const handlePrimerAllow = async () => {
    setNotifPrimerOpen(false);
    try { await Notification.requestPermission(); } catch (_) { /* noop */ }
    const action = pendingActionRef.current;
    pendingActionRef.current = null;
    if (action) action();
  };

  const handlePrimerDecline = () => {
    setNotifPrimerOpen(false);
    try { localStorage.setItem(NOTIF_PRIMER_DISMISSED_KEY, "true"); } catch (_) { /* noop */ }
    const action = pendingActionRef.current;
    pendingActionRef.current = null;
    if (action) action();
  };

  // Keep a ref so the polling closure can read the latest isOpen without re-creating the interval
  useEffect(() => { isOpenRef.current = isOpen; }, [isOpen]);

  // Clear unread badge when the drawer opens. Single set on transition; no cascade risk.
  useEffect(() => {
    if (isOpen) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setUnreadIds(new Set());
    }
  }, [isOpen]);

  // Notify parent whenever the unread count crosses zero
  useEffect(() => {
    onUnreadChange?.(unreadIds.size > 0);
  }, [unreadIds, onUnreadChange]);

  const hasPendingReview = reviews.some(r => r.status === "pending");
  const activeReview = reviews.find(r => r.id === activeReviewId);
  const activeIsPending = activeReview?.status === "pending";

  // Load review history when scenario changes
  useEffect(() => {
    if (!isOpen || !scenarioName) return;
    Rest.get(`/ai-review/scenario/${encodeURIComponent(scenarioName)}`)
      .then(r => setReviews(r.data || []))
      .catch(() => {});
  }, [isOpen, scenarioName]);

  const loadConversation = useCallback(async (reviewId) => {
    try {
      const r = await Rest.get(`/ai-review/${reviewId}`);
      setMessages(r.messages || []);
      setActiveReviewId(reviewId);
      setError("");
    } catch (e) {
      setError(e.message);
    }
  }, []);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Poll for pending reviews; runs in the background even when the drawer is closed
  // so notifications still fire.
  useEffect(() => {
    const pendingIds = reviews.filter(r => r.status === "pending").map(r => r.id);
    if (pendingIds.length === 0) return;

    let cancelled = false;
    const tick = async () => {
      for (const id of pendingIds) {
        try {
          const status = await Rest.get(`/ai-review/${id}/status`);
          if (cancelled) return;
          if (status.status === "completed") {
            const conv = await Rest.get(`/ai-review/${id}`);
            if (cancelled) return;
            setReviews(prev => prev.map(r => r.id === id ? { ...r, status: "completed" } : r));
            if (id === activeReviewId) setMessages(conv.messages || []);
            if (!isOpenRef.current) {
              setUnreadIds(prev => {
                const next = new Set(prev);
                next.add(id);
                return next;
              });
            }
            showSuccess(`AI plan review ready${id === activeReviewId ? "" : " — open from the history list"}`);
            fireBrowserNotification(scenarioName);
          } else if (status.status === "failed") {
            setReviews(prev => prev.map(r => r.id === id ? { ...r, status: "failed", error_message: status.error_message } : r));
            const msg = status.error_message || "AI plan review failed";
            if (id === activeReviewId) setError(msg);
            showError(`AI plan review failed: ${msg}`);
          }
        } catch (_) { /* keep polling on transient errors */ }
      }
    };

    const handle = setInterval(tick, POLL_INTERVAL_MS);
    return () => { cancelled = true; clearInterval(handle); };
  }, [reviews, activeReviewId, scenarioName, showSuccess, showError]);

  const handleNewReview = () => {
    if (hasPendingReview) return;
    runWithPermissionGate(async () => {
      setError("");
      try {
        const r = await Rest.post("/ai-review", { scenario: scenarioName });
        const review = { ...r.review, status: "pending" };
        setReviews(prev => [review, ...prev]);
        setActiveReviewId(review.id);
        setMessages([
          { role: "user", content: "Please review my financial plan and provide your analysis." },
        ]);
      } catch (e) {
        setError(e.message || "Failed to create review");
      }
    });
  };

  const handleSendMessage = (e) => {
    e.preventDefault();
    if (!input.trim() || !activeReviewId || activeIsPending) return;
    const msg = input.trim();
    setInput("");
    setMessages(prev => [...prev, { role: "user", content: msg }]);
    setError("");
    runWithPermissionGate(async () => {
      try {
        await Rest.post(`/ai-review/${activeReviewId}/message`, { message: msg });
        setReviews(prev => prev.map(r => r.id === activeReviewId ? { ...r, status: "pending" } : r));
      } catch (err) {
        setError(err.message || "Failed to send message");
      }
    });
  };

  const handleDeleteReview = async (e, reviewId) => {
    e.stopPropagation();
    try {
      await Rest.del(`/ai-review/${reviewId}`);
      setReviews(prev => prev.filter(r => r.id !== reviewId));
      if (activeReviewId === reviewId) {
        setActiveReviewId(null);
        setMessages([]);
      }
    } catch (e) {
      setError(e.message || "Failed to delete review");
    }
  };

  const handleApply = (action, key) => {
    setConfirmAction({ action, key });
  };

  const confirmApply = async () => {
    if (!confirmAction) return;
    try {
      await Rest.post("/ai-review/apply", { action: confirmAction.action });
      setAppliedActions(prev => new Set([...prev, confirmAction.key]));
      setConfirmAction(null);
    } catch (e) {
      setError(e.message || "Failed to apply change");
      setConfirmAction(null);
    }
  };

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: "fixed", inset: 0, background: "rgba(15,23,42,0.3)",
          backdropFilter: "blur(2px)", zIndex: 10100,
        }}
      />

      {/* Drawer */}
      <div style={{
        position: "fixed", top: 0, right: 0, bottom: 0, width: "min(600px, 90vw)",
        background: "white", boxShadow: "-8px 0 30px rgba(0,0,0,0.15)",
        display: "flex", flexDirection: "column", zIndex: 10200,
        animation: "slideInRight 0.2s ease-out",
      }}>
        {/* Header */}
        <div style={{
          padding: "1rem 1.25rem", borderBottom: "1px solid #E8E6DF",
          display: "flex", justifyContent: "space-between", alignItems: "center",
        }}>
          <div>
            <h3 style={{ margin: 0, fontSize: "1.1rem", fontWeight: 700 }}>AI Plan Review</h3>
            <span style={{ fontSize: "0.8rem", color: "#808E9B" }}>Scenario: {scenarioName}</span>
          </div>
          <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
            <button
              onClick={handleNewReview}
              disabled={hasPendingReview}
              title={hasPendingReview ? "A review is already in progress" : ""}
              style={{
                padding: "0.35rem 0.75rem", borderRadius: "0.375rem", fontSize: "0.8rem",
                fontWeight: 600, border: "1px solid #7FA37F",
                background: hasPendingReview ? "#cbd5cb" : "#7FA37F",
                color: "white", cursor: hasPendingReview ? "not-allowed" : "pointer",
              }}
            >
              + New Review
            </button>
            <button
              onClick={onClose}
              style={{ background: "none", border: "none", fontSize: "1.5rem", cursor: "pointer", color: "#808E9B" }}
            >
              &times;
            </button>
          </div>
        </div>

        {/* History sidebar / conversation */}
        <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
          {/* Review list */}
          <div style={{
            width: "160px", borderRight: "1px solid #E8E6DF", overflowY: "auto",
            background: "#f8fafc", flexShrink: 0, fontSize: "0.78rem",
          }}>
            {reviews.map(r => (
              <div
                key={r.id}
                onClick={() => loadConversation(r.id)}
                style={{
                  padding: "0.6rem 0.75rem", cursor: "pointer", borderBottom: "1px solid #E8E6DF",
                  background: r.id === activeReviewId ? "#eff6ff" : "transparent",
                  fontWeight: r.id === activeReviewId ? 600 : 400,
                  position: "relative",
                }}
              >
                <button
                  onClick={(e) => handleDeleteReview(e, r.id)}
                  title="Delete review"
                  style={{
                    position: "absolute", top: "0.35rem", right: "0.35rem",
                    background: "none", border: "none", cursor: "pointer",
                    color: "#A0AEB9", fontSize: "0.85rem", lineHeight: 1,
                    padding: "0.1rem 0.25rem", borderRadius: "0.25rem",
                  }}
                  onMouseEnter={e => e.currentTarget.style.color = "#C0504D"}
                  onMouseLeave={e => e.currentTarget.style.color = "#A0AEB9"}
                >
                  &times;
                </button>
                <div style={{ fontSize: "0.75rem", color: "#808E9B" }}>
                  {new Date(r.created_at).toLocaleDateString()}
                </div>
                <div style={{ marginTop: "0.15rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", paddingRight: "1rem" }}>
                  {r.title || "Review"}
                </div>
                {r.status === "pending" && (
                  <div style={{ marginTop: "0.25rem", fontSize: "0.7rem", color: "#7FA37F", fontWeight: 600 }}>
                    <span className="fc-ai-spin" style={{ display: "inline-block", marginRight: "0.3rem" }}>⟳</span>
                    Generating…
                  </div>
                )}
                {r.status === "failed" && (
                  <div style={{ marginTop: "0.25rem", fontSize: "0.7rem", color: "#C0504D", fontWeight: 600 }}>
                    Failed
                  </div>
                )}
              </div>
            ))}
            {reviews.length === 0 && (
              <div style={{ padding: "1rem", color: "#A0AEB9", textAlign: "center" }}>
                No reviews yet
              </div>
            )}
          </div>

          {/* Messages */}
          <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <div style={{ flex: 1, overflowY: "auto", padding: "1rem" }}>
              {messages.length === 0 && !activeIsPending && (
                <EmptyState variant="ai-review" message="Ready to review your plan. Click &quot;+ New Review&quot; to send your forecast to the local AI for analysis." />
              )}

              {messages.map((msg, i) => (
                <div key={i} style={{
                  marginBottom: "1rem",
                  padding: "0.75rem 1rem",
                  borderRadius: "0.75rem",
                  background: msg.role === "user" ? "#eff6ff" : "#f8fafc",
                  border: `1px solid ${msg.role === "user" ? "#bfdbfe" : "#E8E6DF"}`,
                  fontSize: "0.85rem", lineHeight: 1.6,
                }}>
                  <div style={{ fontWeight: 700, fontSize: "0.72rem", color: "#808E9B", marginBottom: "0.35rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                    {msg.role === "user" ? "You" : "AI Advisor"}
                  </div>
                  <MessageContent
                    content={msg.content}
                    onApply={handleApply}
                    appliedActions={appliedActions}
                  />
                </div>
              ))}

              {activeIsPending && (
                <div style={{ padding: "1rem", color: "#808E9B", fontStyle: "italic", display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  <span className="fc-ai-spin" style={{ display: "inline-block" }}>⟳</span>
                  <span>Analyzing your plan… (this may take up to a minute on the first call — feel free to close this drawer; you'll get a notification when it's ready)</span>
                </div>
              )}

              {error && (
                <div style={{ padding: "0.75rem", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: "0.5rem", color: "#C0504D", fontSize: "0.85rem" }}>
                  {error}
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            {activeReviewId && (
              <form onSubmit={handleSendMessage} style={{
                padding: "0.75rem 1rem", borderTop: "1px solid #E8E6DF",
                display: "flex", gap: "0.5rem",
              }}>
                <input
                  type="text"
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  placeholder={activeIsPending ? "Waiting for current response…" : "Ask a follow-up question..."}
                  disabled={activeIsPending}
                  className="form-input"
                  style={{ flex: 1, fontSize: "0.85rem" }}
                />
                <button
                  type="submit"
                  disabled={!input.trim() || activeIsPending}
                  style={{
                    padding: "0.4rem 1rem", borderRadius: "0.375rem", fontSize: "0.85rem",
                    fontWeight: 600, border: "none", cursor: "pointer",
                    background: input.trim() ? "#7FA37F" : "#E8E6DF",
                    color: input.trim() ? "white" : "#A0AEB9",
                  }}
                >
                  Send
                </button>
              </form>
            )}
          </div>
        </div>
      </div>

      {/* Confirm Apply Modal */}
      {confirmAction && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(15,23,42,0.5)",
          display: "flex", alignItems: "center", justifyContent: "center",
          zIndex: 10300,
        }}>
          <div style={{
            background: "white", borderRadius: "0.75rem", padding: "1.5rem",
            width: "min(440px, 90vw)", boxShadow: "0 20px 40px rgba(0,0,0,0.2)",
          }}>
            <h4 style={{ margin: "0 0 1rem", fontSize: "1rem" }}>Confirm Change</h4>
            <table style={{ width: "100%", fontSize: "0.85rem", borderCollapse: "collapse" }}>
              <tbody>
                <tr>
                  <td style={{ padding: "0.4rem 0", color: "#808E9B" }}>Field</td>
                  <td style={{ padding: "0.4rem 0", fontWeight: 600 }}>{confirmAction.action.field?.replace(/_/g, " ")}</td>
                </tr>
                <tr>
                  <td style={{ padding: "0.4rem 0", color: "#808E9B" }}>Current</td>
                  <td style={{ padding: "0.4rem 0" }}>{confirmAction.action.current_value}</td>
                </tr>
                <tr>
                  <td style={{ padding: "0.4rem 0", color: "#808E9B" }}>Proposed</td>
                  <td style={{ padding: "0.4rem 0", fontWeight: 600, color: "#6B8E6B" }}>{confirmAction.action.proposed_value}</td>
                </tr>
                {confirmAction.action.reason && (
                  <tr>
                    <td style={{ padding: "0.4rem 0", color: "#808E9B" }}>Reason</td>
                    <td style={{ padding: "0.4rem 0", fontSize: "0.8rem" }}>{confirmAction.action.reason}</td>
                  </tr>
                )}
              </tbody>
            </table>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem", marginTop: "1.25rem" }}>
              <button
                onClick={() => setConfirmAction(null)}
                style={{ padding: "0.4rem 1rem", borderRadius: "0.375rem", border: "1px solid #d1d5db", background: "white", cursor: "pointer", fontSize: "0.85rem" }}
              >
                Cancel
              </button>
              <button
                onClick={confirmApply}
                style={{ padding: "0.4rem 1rem", borderRadius: "0.375rem", border: "none", background: "#7FA37F", color: "white", cursor: "pointer", fontSize: "0.85rem", fontWeight: 600 }}
              >
                Apply
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Notification permission primer */}
      {notifPrimerOpen && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(15,23,42,0.5)",
          display: "flex", alignItems: "center", justifyContent: "center",
          zIndex: 10300,
        }}>
          <div style={{
            background: "white", borderRadius: "0.75rem", padding: "1.5rem",
            width: "min(440px, 90vw)", boxShadow: "0 20px 40px rgba(0,0,0,0.2)",
          }}>
            <h4 style={{ margin: "0 0 0.75rem", fontSize: "1rem" }}>Get notified when ready?</h4>
            <p style={{ margin: 0, fontSize: "0.85rem", color: "#4A5568", lineHeight: 1.55 }}>
              AI plan reviews can take up to a minute. With your permission, the browser can show a desktop notification when the review is done — even if you've switched tabs or closed this drawer.
            </p>
            <p style={{ margin: "0.75rem 0 0", fontSize: "0.78rem", color: "#808E9B", lineHeight: 1.5 }}>
              You'll always see an in-app toast when the review completes. This is just for desktop notifications.
            </p>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem", marginTop: "1.25rem" }}>
              <button
                onClick={handlePrimerDecline}
                style={{ padding: "0.4rem 1rem", borderRadius: "0.375rem", border: "1px solid #d1d5db", background: "white", cursor: "pointer", fontSize: "0.85rem" }}
              >
                Not now
              </button>
              <button
                onClick={handlePrimerAllow}
                style={{ padding: "0.4rem 1rem", borderRadius: "0.375rem", border: "none", background: "#7FA37F", color: "white", cursor: "pointer", fontSize: "0.85rem", fontWeight: 600 }}
              >
                Enable notifications
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes slideInRight {
          from { transform: translateX(100%); }
          to { transform: translateX(0); }
        }
        @keyframes fcAiSpin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        .fc-ai-spin { animation: fcAiSpin 1.4s linear infinite; }
      `}</style>
    </>
  );
}
