import { useEffect, useState } from "react";
import Rest from "../../js/rest.js";
import ConfirmModal from "../ConfirmModal/ConfirmModal.jsx";
import MtmDateControl, { lastMonthEndISO } from "../MtmDateControl.jsx";
// Reuse the bank-feed diagnostic styles (bfd-* / num / generate-report-button).
import "../../pages/BankFeedDiagnostic.css";

function fmtNum(n, decimals = 2) {
  if (n == null || n === "") return "—";
  const v = typeof n === "string" ? parseFloat(n) : n;
  if (!Number.isFinite(v)) return String(n);
  return v.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function StatusPill({ label, kind }) {
  return <span className={`bfd-pill bfd-pill-${kind}`}>{label}</span>;
}

/**
 * ManualReconciliation (CR033) — the non-fed twin of BalanceReconciliation.
 * Per balance-sheet account WITHOUT a bank feed: fin's computed balance vs a
 * CURRENT balance the user types in, with the same source-aware "Reconcile"
 * action (brokerage → month-end Unrealized-G/L MTM entry; cash → re-anchor
 * opening_balance). No feed/sign toggles — the entered figure is already in
 * fin's signed convention. Self-contained: loads its own data on mount.
 */
export default function ManualReconciliation() {
  const [recon, setRecon] = useState(null);
  const [reconcilingId, setReconcilingId] = useState(null);
  const [msg, setMsg] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [savingMode, setSavingMode] = useState(null);
  const [savingBalanceId, setSavingBalanceId] = useState(null);
  const [edits, setEdits] = useState({}); // { [accountId]: "string being typed" }
  const [typeFilter, setTypeFilter] = useState("all"); // asset | liability
  const [statusFilter, setStatusFilter] = useState("all");
  const [bookDate, setBookDate] = useState(lastMonthEndISO()); // MTM booking date

  const load = async () => {
    try {
      const res = await Rest.get("/manual-calibration/recon");
      setRecon(res);
    } catch (err) {
      setMsg(`Failed to load — ${err.message}`);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const setMode = async (accountId, mode) => {
    setSavingMode(accountId);
    setMsg(null);
    try {
      await Rest.patch(`/manual-calibration/reconcile-mode/${accountId}`, { mode });
      await load();
    } catch (err) {
      setMsg(`mode change failed — ${err.message}`);
    } finally {
      setSavingMode(null);
    }
  };

  // Persist the typed current balance (on blur / Enter). Skips the call when the
  // value is unchanged or not a finite number.
  const saveBalance = async (a) => {
    const raw = edits[a.account_id];
    if (raw == null) return; // not edited
    const trimmed = String(raw).trim();
    if (trimmed === "") return;
    const val = Number(trimmed);
    if (!Number.isFinite(val)) {
      setMsg(`${a.name}: "${trimmed}" is not a number`);
      return;
    }
    if (a.entered_balance != null && val === Number(a.entered_balance)) {
      // unchanged — drop the local edit, no write
      setEdits((e) => {
        const { [a.account_id]: _, ...rest } = e;
        return rest;
      });
      return;
    }
    setSavingBalanceId(a.account_id);
    setMsg(null);
    try {
      await Rest.put(`/manual-calibration/balance/${a.account_id}`, { balance: val });
      setEdits((e) => {
        const { [a.account_id]: _, ...rest } = e;
        return rest;
      });
      await load();
    } catch (err) {
      setMsg(`${a.name}: save failed — ${err.message}`);
    } finally {
      setSavingBalanceId(null);
    }
  };

  const askReconcile = (a) => {
    const action =
      a.reconcile_mode === "mtm"
        ? `post an Unrealized-G/L (MTM) entry for "${a.name}" as of ${bookDate}`
        : `re-anchor opening_balance for "${a.name}" to the entered balance`;
    setConfirm({
      account: a,
      title: "Reconcile",
      message: `Reconcile will ${action}.\n\nContinue?`,
      confirmLabel: "Reconcile",
    });
  };

  const doReconcile = async () => {
    const a = confirm?.account;
    if (!a) return;
    setReconcilingId(a.account_id);
    setMsg(null);
    try {
      // bookDate only affects MTM (the entry date + balance as-of); calibrate ignores it.
      const body = a.reconcile_mode === "mtm" ? { dryRun: false, bookDate } : { dryRun: false };
      const res = await Rest.post(`/manual-calibration/reconcile/${a.account_id}`, body);
      setMsg(
        res.mode === "mtm"
          ? `${a.name}: MTM ${fmtNum(res.mtm_amount)} dated ${res.month_end}` +
              (res.note ? ` — ${res.note}` : "")
          : `${a.name}: opening_balance ${fmtNum(res.old_opening)} → ${fmtNum(res.new_opening)}`
      );
      await load();
    } catch (err) {
      setMsg(`${a.name}: reconcile failed — ${err.message}`);
    } finally {
      setReconcilingId(null);
      setConfirm(null);
    }
  };

  if (!recon) return null;

  // Reconciliation status: pending (no balance entered) / reconciled / mtm / drift.
  const rowStatus = (a) =>
    a.reconciled == null
      ? "pending"
      : a.reconciled
        ? "reconciled"
        : a.reconcile_mode === "mtm"
          ? "mtm"
          : "drift";

  const byType =
    typeFilter === "all"
      ? recon.accounts
      : recon.accounts.filter((a) => a.account_type === typeFilter);
  const statusCounts = byType.reduce((m, a) => {
    const s = rowStatus(a);
    m[s] = (m[s] || 0) + 1;
    return m;
  }, {});
  const visible =
    statusFilter === "all" ? byType : byType.filter((a) => rowStatus(a) === statusFilter);
  const visibleUnreconciled = visible.filter((a) => a.reconciled === false).length;

  return (
    <section className="bfd-section">
      <h2>Manual reconciliation (CR033)</h2>
      <p className="bfd-subtitle">
        Per non-fed balance-sheet account: fin&apos;s <strong>computed</strong> balance
        (<code>opening_balance + Σ tx</code>) vs a <strong>current balance you type
        in</strong>. <strong>Drift = computed − entered</strong>; RECONCILED only when
        they match. <strong>Brokerage</strong> (mtm) accounts post a month-end
        Unrealized-G/L entry; <strong>cash/bank</strong> accounts re-anchor the
        opening balance.
      </p>
      <p className="bfd-subtitle" style={{ marginTop: 0 }}>
        Enter the balance in <strong>fin&apos;s own sign convention</strong> — the same
        signed figure the Computed column shows (an asset is <code>+</code>, a liability
        is <code>−</code>). There is no feed, so no balance-sign or flip-tx toggle.
      </p>
      <div className="bfd-feed-card-header">
        <StatusPill
          label={visibleUnreconciled === 0 ? "all reconciled" : `${visibleUnreconciled} unreconciled`}
          kind={visibleUnreconciled === 0 ? "ok" : "warn"}
        />
        <label className="bfd-muted">
          Type{" "}
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            title="Filter rows by account type"
          >
            <option value="all">All types ({recon.accounts.length})</option>
            <option value="asset">Assets</option>
            <option value="liability">Liabilities</option>
          </select>
        </label>
        <label className="bfd-muted">
          Status{" "}
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            title="Filter rows by reconciliation status"
          >
            <option value="all">All statuses ({byType.length})</option>
            {[
              ["reconciled", "Reconciled"],
              ["drift", "Drift"],
              ["mtm", "MTM gap"],
              ["pending", "Pending entry"],
            ].map(([val, lbl]) => (
              <option key={val} value={val}>
                {lbl} ({statusCounts[val] || 0})
              </option>
            ))}
          </select>
        </label>
        <MtmDateControl value={bookDate} onChange={setBookDate} />
        <span className="bfd-muted">as of {recon.asOf}</span>
        {msg && <span className="bfd-muted"> · {msg}</span>}
      </div>
      <table className="bfd-accounts">
        <thead>
          <tr>
            <th>Account</th>
            <th>Type</th>
            <th className="num">Computed</th>
            <th className="num">Current balance</th>
            <th className="num">Drift</th>
            <th>Entered date</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {visible.map((a) => {
            const isMtm = a.reconcile_mode === "mtm";
            const status = rowStatus(a);
            const driftCls =
              a.reconciled === true ? "bfd-ok" : isMtm ? "bfd-muted" : "bfd-danger";
            const editVal =
              edits[a.account_id] != null
                ? edits[a.account_id]
                : a.entered_balance != null
                  ? String(a.entered_balance)
                  : "";
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
                  <div className="bfd-muted" style={{ fontSize: "0.7rem" }}>
                    {a.account_type} · {a.currency}
                  </div>
                </td>
                <td className="num">{fmtNum(a.computed_balance)}</td>
                <td className="num">
                  <input
                    type="number"
                    step="0.01"
                    className="num"
                    style={{ width: "9rem", textAlign: "right" }}
                    value={editVal}
                    placeholder="enter…"
                    disabled={savingBalanceId === a.account_id}
                    onChange={(e) =>
                      setEdits((ed) => ({ ...ed, [a.account_id]: e.target.value }))
                    }
                    onBlur={() => saveBalance(a)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") e.currentTarget.blur();
                    }}
                    title="Type the current balance in fin's sign convention (asset +, liability −). Saves on blur / Enter."
                  />
                </td>
                <td className={`num ${driftCls}`}>{a.drift != null ? fmtNum(a.drift, 2) : "—"}</td>
                <td className="bfd-muted">{a.entered_date || "—"}</td>
                <td>
                  {status === "pending" ? (
                    <StatusPill label="pending" kind="warn" />
                  ) : status === "reconciled" ? (
                    <StatusPill label="reconciled" kind="ok" />
                  ) : status === "mtm" ? (
                    <StatusPill label="MTM gap" kind="warn" />
                  ) : (
                    <StatusPill label="drift" kind="danger" />
                  )}
                </td>
                <td>
                  <button
                    className="generate-report-button"
                    disabled={reconcilingId === a.account_id || a.entered_balance == null}
                    onClick={() => askReconcile(a)}
                    title={
                      a.entered_balance == null
                        ? "Enter a current balance first"
                        : isMtm
                          ? "Post a month-end Unrealized-G/L (MTM) entry"
                          : "Re-anchor opening_balance to the entered balance"
                    }
                  >
                    {reconcilingId === a.account_id ? "…" : "Reconcile"}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <ConfirmModal
        state={confirm}
        busy={reconcilingId != null}
        onConfirm={doReconcile}
        onCancel={() => setConfirm(null)}
      />
    </section>
  );
}
