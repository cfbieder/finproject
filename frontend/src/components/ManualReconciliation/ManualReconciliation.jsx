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

  // edits[accountId] = { balance?: string, date?: string } (in-progress per-row edit)
  const patchEdit = (id, patch) => setEdits((ed) => ({ ...ed, [id]: { ...ed[id], ...patch } }));
  const clearEdit = (id) =>
    setEdits((ed) => {
      const { [id]: _drop, ...rest } = ed;
      return rest;
    });

  // Persist the typed balance + its as-of date (commits once when focus leaves
  // the cell). Skips when nothing was edited or the value/date is unchanged.
  const saveBalance = async (a) => {
    const e = edits[a.account_id];
    if (!e || (e.balance == null && e.date == null)) return; // nothing edited
    const rawBal = e.balance != null ? e.balance : a.entered_balance != null ? String(a.entered_balance) : "";
    const trimmed = String(rawBal).trim();
    if (trimmed === "") return;
    const val = Number(trimmed);
    if (!Number.isFinite(val)) {
      setMsg(`${a.name}: "${trimmed}" is not a number`);
      return;
    }
    // as-of date: the edited date, else the existing entry's date, else the
    // page's "Book MTM as of" date (so period-end work lines up by default).
    const date = (e.date != null ? e.date : a.entered_date) || bookDate;
    if (a.entered_balance != null && val === Number(a.entered_balance) && date === a.entered_date) {
      clearEdit(a.account_id); // unchanged
      return;
    }
    setSavingBalanceId(a.account_id);
    setMsg(null);
    try {
      await Rest.put(`/manual-calibration/balance/${a.account_id}`, { balance: val, balanceDate: date });
      clearEdit(a.account_id);
      await load();
    } catch (err) {
      setMsg(`${a.name}: save failed — ${err.message}`);
    } finally {
      setSavingBalanceId(null);
    }
  };

  // Clear an account's entered balance (back to pending) — e.g. one entered with
  // the wrong date. Clears the local edit first so the cell-blur can't re-save.
  const resetBalance = async (a) => {
    clearEdit(a.account_id);
    setSavingBalanceId(a.account_id);
    setMsg(null);
    try {
      await Rest.del(`/manual-calibration/balance/${a.account_id}`);
      await load();
      setMsg(`${a.name}: entered balance cleared`);
    } catch (err) {
      setMsg(`${a.name}: clear failed — ${err.message}`);
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
        <span className="bfd-muted">as of {recon.asOf}</span>
      </div>
      {msg && (
        <p className="bfd-muted" style={{ margin: "6px 0 0", lineHeight: 1.4 }}>{msg}</p>
      )}
      <MtmDateControl value={bookDate} onChange={setBookDate} />
      <table className="bfd-accounts">
        <thead>
          <tr>
            <th>Account</th>
            <th>Type</th>
            <th className="num">Computed</th>
            <th className="num">Current balance</th>
            <th className="num">Drift</th>
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
            const edit = edits[a.account_id] || {};
            const balVal =
              edit.balance != null ? edit.balance : a.entered_balance != null ? String(a.entered_balance) : "";
            const dateVal = edit.date != null ? edit.date : a.entered_date || bookDate;
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
                  <div
                    className="bfd-balance-cell"
                    onBlur={(e) => {
                      // commit once when focus leaves the whole cell (not when
                      // moving between the balance and date inputs)
                      if (!e.currentTarget.contains(e.relatedTarget)) saveBalance(a);
                    }}
                  >
                    <input
                      type="number"
                      step="0.01"
                      className="num bfd-balance-amt"
                      value={balVal}
                      placeholder="enter…"
                      disabled={savingBalanceId === a.account_id}
                      onChange={(ev) => patchEdit(a.account_id, { balance: ev.target.value })}
                      onKeyDown={(ev) => {
                        if (ev.key === "Enter") ev.currentTarget.blur();
                      }}
                      title="Balance in fin's sign convention (asset +, liability −). Saves on blur / Enter."
                    />
                    <div className="bfd-balance-asof">
                      <span className="bfd-muted">as of</span>
                      <input
                        type="date"
                        value={dateVal}
                        disabled={savingBalanceId === a.account_id}
                        onChange={(ev) => patchEdit(a.account_id, { date: ev.target.value })}
                        onKeyDown={(ev) => {
                          if (ev.key === "Enter") ev.currentTarget.blur();
                        }}
                        title="Date this balance is as of (e.g. a period-end). Defaults to the 'Book MTM as of' date — set it to a past period-end to mark there."
                      />
                      {a.entered_balance != null && (
                        <button
                          type="button"
                          className="bfd-balance-reset"
                          aria-label="Clear entered balance"
                          disabled={savingBalanceId === a.account_id}
                          onClick={() => resetBalance(a)}
                          title="Clear the entered balance for this account (back to pending)"
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  </div>
                </td>
                <td className={`num ${driftCls}`}>{a.drift != null ? fmtNum(a.drift, 2) : "—"}</td>
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
