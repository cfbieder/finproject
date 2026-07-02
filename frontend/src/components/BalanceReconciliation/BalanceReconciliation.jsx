import { useEffect, useState } from "react";
import Rest from "../../js/rest.js";
import ConfirmModal from "../ConfirmModal/ConfirmModal.jsx";
import ManualStatementUpload from "../ManualStatementUpload/ManualStatementUpload.jsx";
import MtmDateControl, { lastMonthEndISO } from "../MtmDateControl.jsx";
// Reuse the bank-feed diagnostic styles (bfd-* / num / generate-report-button)…
import "../../pages/BankFeedDiagnostic.css";
// …then layer this panel's own spacing/hierarchy polish on top (scoped .recon-panel).
import "./BalanceReconciliation.css";

function fmtNum(n, decimals = 2) {
  if (n == null || n === "") return "—";
  const v = typeof n === "string" ? parseFloat(n) : n;
  if (!Number.isFinite(v)) return String(n);
  return v.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

// "synced N days ago" from the feed's real upstream sync time (CR035:
// source_synced_at = fintable's "⚡ Last Update", distinct from the balance_date the
// figure is for AND from fin's own poll) — flags a feed the bank stopped refreshing
// even while fin keeps polling it. Weekend-tolerant colour: brokerages don't sync
// on non-trading days, so grey ≤2d / amber 3–6d / red ≥7d. null → "synced —".
function fmtSyncedAgo(ts) {
  if (!ts) return { text: "synced —", color: null };
  const then = new Date(ts);
  if (Number.isNaN(then.getTime())) return { text: "synced —", color: null };
  const days = Math.floor((Date.now() - then.getTime()) / 86400000);
  const text = days <= 0 ? "synced today" : days === 1 ? "synced yesterday" : `synced ${days} days ago`;
  const color = days >= 7 ? "var(--danger, #c0392b)" : days >= 3 ? "var(--warn, #b9770e)" : null;
  return { text, color };
}

function StatusPill({ label, kind }) {
  return <span className={`bfd-pill bfd-pill-${kind}`}>{label}</span>;
}

/**
 * BalanceReconciliation (CR023 §4.C) — per fed account, fin's computed balance
 * vs the bank's reported `feed_balances`, sign-aware, with a "Reconcile to feed"
 * action (brokerage → month-end Unrealized-G/L MTM entry; cash → re-anchor
 * opening_balance). Confirmation goes through the shared ConfirmModal (no native
 * window.confirm). Self-contained: loads its own data on mount.
 */
export default function BalanceReconciliation() {
  const [balRecon, setBalRecon] = useState(null);
  const [reconcilingId, setReconcilingId] = useState(null);
  const [reconcileMsg, setReconcileMsg] = useState(null);
  const [confirm, setConfirm] = useState(null); // { account, title, message, confirmLabel } | null
  const [savingMode, setSavingMode] = useState(null);
  const [institutionFilter, setInstitutionFilter] = useState("all"); // feed/institution filter
  const [statusFilter, setStatusFilter] = useState("all"); // reconciliation-status filter
  const [bookDate, setBookDate] = useState(lastMonthEndISO()); // MTM booking date
  const [uploadAccount, setUploadAccount] = useState(null); // CR036: manual statement upload target
  const [showHelp, setShowHelp] = useState(false); // sign-convention explainer, collapsed by default

  // Set how an account reconciles: 'calibrate' (bank/cash → DRIFT) or 'mtm'
  // (brokerage / mark-to-market holdings → MTM GAP). Harmless on its own.
  const setMode = async (accountId, mode) => {
    setSavingMode(accountId);
    setReconcileMsg(null);
    try {
      await Rest.patch(`/bank-feed/reconcile-mode/${accountId}`, { mode });
      await loadBalanceRecon();
    } catch (err) {
      setReconcileMsg(`mode change failed — ${err.message}`);
    } finally {
      setSavingMode(null);
    }
  };

  // CR028: mark a feed whose transactions are sign-flipped vs fin (e.g. Chase
  // cards report purchases positive). Governs FUTURE promotes — set before import.
  const setNegateTx = async (accountId, negate) => {
    setSavingMode(accountId);
    setReconcileMsg(null);
    try {
      await Rest.patch(`/bank-feed/feed-negate-tx/${accountId}`, { negate });
      await loadBalanceRecon();
    } catch (err) {
      setReconcileMsg(`tx-sign change failed — ${err.message}`);
    } finally {
      setSavingMode(null);
    }
  };

  const loadBalanceRecon = async () => {
    try {
      const res = await Rest.get("/bank-feed/balance-recon");
      setBalRecon(res);
    } catch (err) {
      setReconcileMsg(`Failed to load reconciliation — ${err.message}`);
    }
  };

  useEffect(() => {
    loadBalanceRecon();
  }, []);

  // Open the confirm dialog (the action WRITES, so confirm first).
  const askReconcile = (a) => {
    const action =
      a.reconcile_mode === "mtm"
        ? `post an Unrealized-G/L (MTM) entry for "${a.name}" as of ${bookDate}`
        : `re-anchor opening_balance for "${a.name}" to the bank's reported balance`;
    setConfirm({
      account: a,
      title: "Reconcile to feed",
      message: `Reconcile to feed will ${action}.\n\nContinue?`,
      confirmLabel: "Reconcile to feed",
    });
  };

  const doReconcile = async () => {
    const a = confirm?.account;
    if (!a) return;
    setReconcilingId(a.account_id);
    setReconcileMsg(null);
    try {
      // bookDate only affects MTM (entry date + balance as-of); calibrate ignores it.
      const body = a.reconcile_mode === "mtm" ? { dryRun: false, bookDate } : { dryRun: false };
      const res = await Rest.post(`/bank-feed/reconcile/${a.account_id}`, body);
      setReconcileMsg(
        res.mode === "mtm"
          ? `${a.name}: booked MTM entry ${fmtNum(res.mtm_amount)} dated ${res.month_end}` +
              (res.removed_read_override ? " (read-override removed)" : "") +
              (res.note ? ` — ${res.note}` : "")
          : `${a.name}: re-anchored opening balance ${fmtNum(res.old_opening)} → ${fmtNum(res.new_opening)}`
      );
      await loadBalanceRecon();
    } catch (err) {
      setReconcileMsg(`${a.name}: reconcile failed — ${err.message}`);
    } finally {
      setReconcilingId(null);
      setConfirm(null);
    }
  };

  if (!balRecon) return null;

  // Distinct institutions (feeds) for the filter dropdown; rows with no
  // institution (service unreachable / unmapped) bucket under "Unknown".
  const institutions = Array.from(
    new Set(balRecon.accounts.map((a) => a.institution || "Unknown"))
  ).sort((x, y) => x.localeCompare(y));
  // Reconciliation status of a row: no-feed (no bank balance) / reconciled /
  // mtm (brokerage mark-to-market gap) / drift (cash/bank mismatch).
  const rowStatus = (a) =>
    a.reconciled == null
      ? "no-feed"
      : a.reconciled
        ? "reconciled"
        : a.reconcile_mode === "mtm"
          ? "mtm"
          : "drift";

  // Apply the feed filter first, then tally status counts for the status
  // dropdown (so counts reflect the selected feed), then apply the status filter.
  const byInstitution =
    institutionFilter === "all"
      ? balRecon.accounts
      : balRecon.accounts.filter((a) => (a.institution || "Unknown") === institutionFilter);
  const statusCounts = byInstitution.reduce((m, a) => {
    const s = rowStatus(a);
    m[s] = (m[s] || 0) + 1;
    return m;
  }, {});
  const visibleAccounts =
    statusFilter === "all"
      ? byInstitution
      : byInstitution.filter((a) => rowStatus(a) === statusFilter);
  const visibleUnreconciled = visibleAccounts.filter((a) => a.reconciled === false).length;

  return (
    <section className="bfd-section recon-panel">
      <div className="recon-title-row">
        <h2>Bank reconciliation (CR023)</h2>
        <button
          type="button"
          className="recon-help-toggle"
          aria-expanded={showHelp}
          onClick={() => setShowHelp((v) => !v)}
          title="How reconciliation & the sign settings work"
        >
          {showHelp ? "Hide help ×" : "? Help"}
        </button>
      </div>
      {showHelp && (
        <div className="recon-help">
          <p className="bfd-subtitle">
            Per fed account: fin's <strong>computed</strong> balance
            (<code>opening_balance + Σ tx</code>) vs the bank's <strong>expected</strong>
            balance. <strong>Drift = computed − expected</strong>; RECONCILED only when
            they match. <strong>Brokerage</strong> (mtm) rows show drift by design — the
            un-booked market move the monthly Unrealized-G/L entry recognizes.
          </p>
          <p className="bfd-subtitle">
            Each feed is normalized to fin's convention (a liability is a{" "}
            <strong>negative</strong> balance; purchases are <strong>negative</strong>)
            by <strong>two independent</strong> sign settings:
          </p>
          <ul className="bfd-subtitle" style={{ marginTop: 0 }}>
            <li>
              <strong>Balance sign</strong> (automatic): a liability the bank reports as{" "}
              <code>+owed</code> is stored as <code>−</code> — the raw figure is shown as
              “bank reports … (owed)” when it differs.
            </li>
            <li>
              <strong>Transaction sign</strong> — the <em>flip tx</em> toggle: ON only when
              a feed delivers each <em>purchase</em> as <code>+</code> (and a payment as{" "}
              <code>−</code>), the reverse of fin.
            </li>
          </ul>
          <p className="bfd-subtitle">
            A feed can need one flip but not the other — which is why two cards both marked
            “(owed)” can differ on the checkbox. <strong>Chase</strong> cards (Amazon /
            Marriot) report the balance <em>and</em> purchases as <code>+</code>, so both
            flip. <strong>PKO</strong> reports the balance <code>+owed</code> but purchases
            already as <code>−</code>, so only the balance flips and <em>flip tx</em> stays
            off.
          </p>
        </div>
      )}
      <div className="bfd-feed-card-header">
        <StatusPill
          label={visibleUnreconciled === 0 ? "all reconciled" : `${visibleUnreconciled} unreconciled`}
          kind={visibleUnreconciled === 0 ? "ok" : "warn"}
        />
        <label className="bfd-muted">
          Feed{" "}
          <select
            value={institutionFilter}
            onChange={(e) => setInstitutionFilter(e.target.value)}
            title="Filter rows by feed / institution"
          >
            <option value="all">All feeds ({balRecon.accounts.length})</option>
            {institutions.map((inst) => (
              <option key={inst} value={inst}>
                {inst}
              </option>
            ))}
          </select>
        </label>
        <label className="bfd-muted">
          Status{" "}
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            title="Filter rows by reconciliation status"
          >
            <option value="all">All statuses ({byInstitution.length})</option>
            {[
              ["reconciled", "Reconciled"],
              ["drift", "Drift"],
              ["mtm", "MTM gap"],
              ["no-feed", "No feed"],
            ].map(([val, lbl]) => (
              <option key={val} value={val}>
                {lbl} ({statusCounts[val] || 0})
              </option>
            ))}
          </select>
        </label>
        <span className="bfd-muted">as of {balRecon.asOf}</span>
      </div>
      {reconcileMsg && (
        <div className="recon-status" role="status">
          <span>{reconcileMsg}</span>
          <button
            type="button"
            className="recon-status-x"
            onClick={() => setReconcileMsg(null)}
            aria-label="Dismiss"
            title="Dismiss"
          >
            ×
          </button>
        </div>
      )}
      <MtmDateControl value={bookDate} onChange={setBookDate} />
      <div className="recon-table-wrap">
      <table className="bfd-accounts">
        <thead>
          <tr>
            <th>Account</th>
            <th>Type</th>
            <th className="num">Computed</th>
            <th className="num">Bank (expected)</th>
            <th className="num">Drift</th>
            <th>Feed date</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {visibleAccounts.map((a) => {
            const isMtm = a.reconcile_mode === "mtm";
            const driftCls =
              a.reconciled === true ? "bfd-ok" : isMtm ? "bfd-muted" : "bfd-danger";
            return (
              <tr key={a.account_id}>
                <td>{a.name}</td>
                <td className="bfd-muted">
                  <select
                    value={a.reconcile_mode || "calibrate"}
                    disabled={savingMode === a.account_id}
                    onChange={(e) => setMode(a.account_id, e.target.value)}
                    title="How this account reconciles: bank (re-anchor opening_balance, shows DRIFT) vs brokerage (post Unrealized-G/L, shows MTM GAP)"
                  >
                    <option value="calibrate">bank (calibrate)</option>
                    <option value="mtm">brokerage (mtm)</option>
                  </select>
                  <label
                    className="bfd-negate-toggle"
                    title={
                      "Whether this feed delivers transaction signs reversed vs fin " +
                      "(e.g. Chase cards report a purchase as + and a payment as − — the reverse of fin). " +
                      "INDEPENDENT of the balance '(owed)' sign. ON flips every transaction on import to fin's " +
                      "convention; applies to FUTURE promotes — set before importing this account's feed."
                    }
                  >
                    <input
                      type="checkbox"
                      checked={a.feed_negate_tx === true}
                      disabled={savingMode === a.account_id}
                      onChange={(e) => setNegateTx(a.account_id, e.target.checked)}
                    />
                    flip tx
                  </label>
                  <div className="bfd-muted" style={{ fontSize: "0.7rem" }}>
                    {a.feed_negate_tx === true
                      ? "feed reverses tx signs"
                      : "feed tx signs match fin"}
                  </div>
                </td>
                <td className="num">{fmtNum(a.computed_balance)}</td>
                <td className="num">
                  {a.expected_balance != null ? fmtNum(a.expected_balance) : "—"}
                  {a.feed_balance != null && a.expected_balance != null &&
                    Number(a.feed_balance) !== 0 &&
                    Math.sign(Number(a.feed_balance)) !== Math.sign(Number(a.expected_balance)) && (
                      <div className="bfd-muted" style={{ fontSize: "0.7rem" }}>
                        bank reports {fmtNum(a.feed_balance)} (owed)
                      </div>
                    )}
                </td>
                <td className={`num ${driftCls}`}>{a.drift != null ? fmtNum(a.drift, 2) : "—"}</td>
                <td className="bfd-muted">
                  {a.feed_date || "—"}
                  {a.feed_date && (() => {
                    const s = fmtSyncedAgo(a.feed_synced_at);
                    return (
                      <div
                        style={{ fontSize: "0.7rem", color: s.color || undefined, fontWeight: s.color ? 600 : undefined }}
                        title={a.feed_synced_at || "upstream sync time not reported"}
                      >
                        {s.text}
                      </div>
                    );
                  })()}
                </td>
                <td>
                  {a.reconciled == null ? (
                    <StatusPill label="no feed" kind="warn" />
                  ) : a.reconciled ? (
                    <StatusPill label="reconciled" kind="ok" />
                  ) : isMtm ? (
                    <StatusPill label="MTM gap" kind="warn" />
                  ) : (
                    <StatusPill label="drift" kind="danger" />
                  )}
                </td>
                <td className="recon-actions">
                  <button
                    className="generate-report-button"
                    disabled={reconcilingId === a.account_id || a.feed_balance == null}
                    onClick={() => askReconcile(a)}
                    title={isMtm ? "Post a month-end Unrealized-G/L (MTM) entry" : "Re-anchor opening_balance to the bank balance"}
                  >
                    {reconcilingId === a.account_id ? "…" : "Reconcile"}
                  </button>
                  {a.feed_external_id && (
                    <button
                      className="generate-report-button recon-btn--secondary"
                      onClick={() => setUploadAccount({ external_id: a.feed_external_id, name: a.name })}
                      title="Upload statement — stale-feed fallback: upload this bank's own statement CSV to import only new rows and reconcile (CR036)"
                    >
                      Upload
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      </div>

      <ConfirmModal
        state={confirm}
        busy={reconcilingId != null}
        onConfirm={doReconcile}
        onCancel={() => setConfirm(null)}
      />

      {uploadAccount && (
        <ManualStatementUpload
          account={uploadAccount}
          onClose={() => setUploadAccount(null)}
          onCommitted={loadBalanceRecon}
        />
      )}
    </section>
  );
}
