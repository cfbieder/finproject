/**
 * MobileReconcile — phone-friendly balance reconciliation (CR038 P4).
 *
 * Closes the weekly loop on mobile: lists the fed + manual accounts that need
 * action (drift, MTM gap, stale feed) and offers a tap-to-reconcile with a
 * two-tap confirm. Deliberately minimal — no flip-tx, no mode editing, no
 * phantom-gain override, no statement upload; anything unusual points back to
 * the desktop calibration pages.
 *
 * Endpoints (same as the desktop pages):
 *  - GET  /api/v2/bank-feed/balance-recon
 *  - GET  /api/v2/manual-calibration/recon
 *  - POST /api/v2/bank-feed/reconcile/:id        { bookDate? }  (mtm only)
 *  - POST /api/v2/manual-calibration/reconcile/:id { bookDate? } (mtm only)
 */
import { useCallback, useEffect, useState } from "react";
import { Loader2, Scale, CheckCircle2, AlertTriangle } from "lucide-react";
import Rest from "../../js/rest.js";
import { formatLocalDate } from "../../utils/dateHelpers.js";

const fmtAmount = (n) => {
  const v = Number(n) || 0;
  const s = new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Math.abs(v));
  return v < 0 ? `(${s})` : s;
};

const lastMonthEnd = () => {
  const now = new Date();
  return formatLocalDate(new Date(now.getFullYear(), now.getMonth(), 0));
};

const staleDays = (syncedAt) => {
  if (!syncedAt) return null;
  const t = new Date(syncedAt).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.floor((Date.now() - t) / 86400000);
};

export default function MobileReconcile() {
  const [fed, setFed] = useState(null);
  const [manual, setManual] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [status, setStatus] = useState(null); // { type, message }
  const [armedKey, setArmedKey] = useState(null); // two-tap confirm
  const [busyKey, setBusyKey] = useState(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const [fedRes, manRes] = await Promise.all([
        Rest.fetchJson("/api/v2/bank-feed/balance-recon").catch(() => null),
        Rest.fetchJson("/api/v2/manual-calibration/recon").catch(() => null),
      ]);
      setFed(fedRes?.accounts ?? null);
      setManual(manRes?.accounts ?? null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const doReconcile = async (kind, acct) => {
    const key = `${kind}:${acct.account_id}`;
    if (busyKey) return;
    if (armedKey !== key) {
      setArmedKey(key);
      return;
    }
    setArmedKey(null);
    setBusyKey(key);
    setStatus(null);
    try {
      const base =
        kind === "fed"
          ? "/api/v2/bank-feed/reconcile"
          : "/api/v2/manual-calibration/reconcile";
      const isMtm = acct.reconcile_mode === "mtm";
      const body = isMtm ? { bookDate: lastMonthEnd() } : {};
      const res = await Rest.fetchJson(`${base}/${acct.account_id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res?.implausible) {
        setStatus({
          type: "error",
          message: `${acct.name}: MTM looks implausible (${Math.round((res.implausible_pct || 0) * 100)}%) — review on desktop.`,
        });
      } else {
        setStatus({
          type: "success",
          message: isMtm
            ? `${acct.name}: booked MTM ${fmtAmount(res?.mtm_amount)} (${res?.month_end || lastMonthEnd()})`
            : `${acct.name}: re-anchored — reconciled.`,
        });
      }
      await load();
    } catch (err) {
      setStatus({
        type: "error",
        message: `${acct.name}: ${err?.message ?? "reconcile failed"}`,
      });
    } finally {
      setBusyKey(null);
    }
  };

  const renderRow = (kind, a) => {
    const key = `${kind}:${a.account_id}`;
    const days = kind === "fed" ? staleDays(a.feed_synced_at) : null;
    const isStale = days != null && days >= 3;
    const target = kind === "fed" ? a.feed_balance : a.entered_balance;
    const actionable = a.reconciled === false;
    const isMtm = a.reconcile_mode === "mtm";
    return (
      <div className="m-tx" key={key}>
        <span className="m-tx__desc">
          {a.name} <span style={{ color: "var(--muted)" }}>· {isMtm ? "MTM" : "calibrate"}</span>
        </span>
        <span
          className={"m-tx__amt " + ((Number(a.drift) || 0) < 0 ? "m-tx__amt--neg" : "m-tx__amt--pos")}
        >
          {fmtAmount(a.drift)}
        </span>
        <span className="m-tx__meta">
          book {fmtAmount(a.computed_balance)} vs {kind === "fed" ? "feed" : "entered"}{" "}
          {target != null ? fmtAmount(target) : "—"}
          {isStale ? ` · synced ${days}d ago` : ""}
        </span>
        {actionable && (
          <button
            type="button"
            className={"m-btn" + (armedKey === key ? " m-btn--primary" : "")}
            style={{ width: "100%", marginTop: 8 }}
            disabled={busyKey != null}
            onClick={() => doReconcile(kind, a)}
          >
            {busyKey === key ? (
              <Loader2 size={16} className="m-spin" />
            ) : (
              <Scale size={16} />
            )}
            {busyKey === key
              ? "Working…"
              : armedKey === key
              ? "Tap again to confirm"
              : isMtm
              ? `Book MTM (${lastMonthEnd()})`
              : "Reconcile"}
          </button>
        )}
        {!actionable && isStale && (
          <span className="m-tx__meta" style={{ color: "var(--warning, var(--muted))" }}>
            Feed stale — upload a statement from the desktop page if it stays dead.
          </span>
        )}
      </div>
    );
  };

  const fedNeedy = (fed || []).filter(
    (a) => a.reconciled === false || (staleDays(a.feed_synced_at) ?? 0) >= 3
  );
  const manualNeedy = (manual || []).filter((a) => a.reconciled === false);
  const allClear = !isLoading && fedNeedy.length === 0 && manualNeedy.length === 0;

  return (
    <div>
      {isLoading && (
        <div className="m-state">
          <Loader2 size={28} className="m-spin" />
          <span>Loading reconciliation…</span>
        </div>
      )}

      {status && (
        <div
          className="m-pill"
          style={{
            display: "flex",
            width: "100%",
            justifyContent: "center",
            marginBottom: 14,
            color: status.type === "error" ? "var(--danger)" : "var(--success, var(--primary))",
          }}
        >
          {status.type === "error" ? <AlertTriangle size={14} /> : <CheckCircle2 size={14} />}
          {status.message}
        </div>
      )}

      {allClear && (
        <div className="m-state">
          <CheckCircle2 size={28} />
          <span>All accounts reconciled — nothing to do.</span>
        </div>
      )}

      {!isLoading && fedNeedy.length > 0 && (
        <>
          <h2 className="m-section-h">Fed accounts</h2>
          <div className="m-tx-list">{fedNeedy.map((a) => renderRow("fed", a))}</div>
        </>
      )}

      {!isLoading && manualNeedy.length > 0 && (
        <>
          <h2 className="m-section-h">Manual accounts</h2>
          <div className="m-tx-list">{manualNeedy.map((a) => renderRow("manual", a))}</div>
        </>
      )}

      <p style={{ marginTop: 14, fontSize: 13, color: "var(--muted)", lineHeight: 1.5 }}>
        MTM accounts book to the last completed month-end. Sign flips, reconcile
        modes, overrides, and statement uploads live on the desktop calibration
        pages.
      </p>
    </div>
  );
}
