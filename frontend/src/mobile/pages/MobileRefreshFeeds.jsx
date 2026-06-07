/**
 * MobileRefreshFeeds — phone-friendly bank-feed refresh.
 *
 * Scope (CR026 mobile, refresh + status only): trigger a bank-feed pull and
 * show what landed (new / linked / staged / ignored), the last refresh/ingest
 * times, and how many transactions are waiting for review. Categorizing and
 * accepting those rows stays on the desktop "Refresh Feeds" page (/refresh-ps) —
 * that workflow is modal-heavy and a poor fit for a small screen.
 *
 * Endpoints (verified against pages/RefreshPS.jsx):
 *  - POST /api/v2/ingest-bank-feed/refresh { sinceDays }
 *      → { ingest: { staged }, sync: { inserted, linked, ignoredAccounts } }
 *  - GET  /api/v2/util/appdata → records carrying lastIngest / lastRefresh
 *  - POST /api/v2/ingest-ps/review-new-transactions → { data: [...] } (count)
 */
import { useCallback, useEffect, useState } from "react";
import { Loader2, RefreshCw, AlertTriangle, ClipboardList } from "lucide-react";
import Rest from "../../js/rest.js";

const DAYS_OPTIONS = [7, 14, 30, 60, 90];

/** Latest valid Date across all records for a given field, or null. */
function latestDate(records, field) {
  const dates = records
    .map((item) => item?.[field])
    .map((d) => (d ? new Date(d) : null))
    .filter((d) => d instanceof Date && !Number.isNaN(d.getTime()));
  return dates.length
    ? dates.reduce((a, b) => (b > a ? b : a), dates[0])
    : null;
}

export default function MobileRefreshFeeds() {
  const [days, setDays] = useState(14);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [result, setResult] = useState(null); // { inserted, linked, staged, ignored }
  const [status, setStatus] = useState(null); // { type, message }

  const [lastRefresh, setLastRefresh] = useState(null);
  const [lastIngest, setLastIngest] = useState(null);
  const [pendingCount, setPendingCount] = useState(null);
  const [isLoadingMeta, setIsLoadingMeta] = useState(true);

  const loadMeta = useCallback(async () => {
    setIsLoadingMeta(true);
    try {
      const [appdata, review] = await Promise.all([
        Rest.fetchJson("/api/v2/util/appdata").catch(() => null),
        Rest.fetchJson("/api/v2/ingest-ps/review-new-transactions", {
          method: "POST",
        }).catch(() => null),
      ]);
      const records = Array.isArray(appdata) ? appdata : [];
      setLastRefresh(latestDate(records, "lastRefresh"));
      setLastIngest(latestDate(records, "lastIngest"));
      setPendingCount(Array.isArray(review?.data) ? review.data.length : null);
    } finally {
      setIsLoadingMeta(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    loadMeta().finally(() => {
      if (cancelled) return;
    });
    return () => {
      cancelled = true;
    };
  }, [loadMeta]);

  const handleRefresh = async () => {
    if (isRefreshing) return;
    setIsRefreshing(true);
    setStatus({ type: "info", message: "Refreshing bank-feed data…" });
    setResult(null);
    try {
      const res = await Rest.fetchJson("/api/v2/ingest-bank-feed/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sinceDays: days }),
      });
      const ing = res?.ingest ?? {};
      const syn = res?.sync ?? {};
      setResult({
        inserted: syn.inserted ?? 0,
        linked: syn.linked ?? 0,
        staged: ing.staged ?? 0,
        ignored: (syn.ignoredAccounts ?? []).length,
      });
      setStatus({ type: "success", message: "Bank feed refreshed." });
      await loadMeta();
    } catch (err) {
      setStatus({
        type: "error",
        message: err?.message ?? "Failed to refresh bank-feed data",
      });
    } finally {
      setIsRefreshing(false);
    }
  };

  return (
    <div>
      <div className="m-page-meta">
        <span className="m-pill">
          {isLoadingMeta
            ? "Loading status…"
            : lastRefresh
            ? `Last refresh: ${lastRefresh.toLocaleString()}`
            : "No refresh recorded yet"}
        </span>
      </div>

      <div className="m-refresh-bar">
        <select
          className="m-select"
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
          disabled={isRefreshing}
          aria-label="History window in days"
          style={{ flex: "0 0 auto", width: "auto" }}
        >
          {DAYS_OPTIONS.map((d) => (
            <option key={d} value={d}>
              {d} days
            </option>
          ))}
        </select>
        <button
          type="button"
          className="m-btn m-btn--primary"
          onClick={handleRefresh}
          disabled={isRefreshing}
        >
          {isRefreshing ? (
            <Loader2 size={18} className="m-spin" />
          ) : (
            <RefreshCw size={18} />
          )}
          {isRefreshing ? "Refreshing…" : "Refresh feeds"}
        </button>
      </div>

      {status && (
        <div
          className={
            "m-pill" +
            (status.type === "error" ? " m-pill--error" : "")
          }
          style={{
            display: "flex",
            width: "100%",
            justifyContent: "center",
            marginBottom: 14,
            color:
              status.type === "error"
                ? "var(--danger)"
                : status.type === "success"
                ? "var(--success, var(--primary))"
                : "var(--ink-secondary)",
          }}
        >
          {status.type === "error" && <AlertTriangle size={14} />}
          {status.message}
        </div>
      )}

      {result && (
        <>
          <h2 className="m-section-h">Last refresh</h2>
          <div className="m-kpis m-kpis--grid">
            <div className="m-kpi">
              <span className="m-kpi__label">New</span>
              <span className="m-kpi__value m-kpi__value--positive">
                {result.inserted}
              </span>
            </div>
            <div className="m-kpi">
              <span className="m-kpi__label">Linked to PS</span>
              <span className="m-kpi__value">{result.linked}</span>
            </div>
            <div className="m-kpi">
              <span className="m-kpi__label">Staged</span>
              <span className="m-kpi__value">{result.staged}</span>
            </div>
            <div className="m-kpi">
              <span className="m-kpi__label">Ignored accts</span>
              <span className="m-kpi__value">{result.ignored}</span>
            </div>
          </div>
        </>
      )}

      <h2 className="m-section-h">Review queue</h2>
      <div className="m-pill" style={{ display: "flex", width: "100%" }}>
        <ClipboardList size={14} />
        {pendingCount == null
          ? "Review count unavailable"
          : pendingCount === 0
          ? "Nothing waiting for review"
          : `${pendingCount} transaction${
              pendingCount === 1 ? "" : "s"
            } waiting for review`}
      </div>
      <p
        style={{
          marginTop: 10,
          fontSize: 13,
          color: "var(--muted)",
          lineHeight: 1.5,
        }}
      >
        Categorizing and accepting reviewed transactions is done on the desktop
        “Refresh Feeds” page.
      </p>

      {lastIngest && (
        <p style={{ marginTop: 18, fontSize: 12, color: "var(--muted)" }}>
          Last ingest: {lastIngest.toLocaleString()}
        </p>
      )}
    </div>
  );
}
