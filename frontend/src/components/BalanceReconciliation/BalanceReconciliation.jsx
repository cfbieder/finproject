import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import Rest from "../../js/rest.js";
import ReconcilePreviewModal from "./ReconcilePreviewModal.jsx";
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
  const color = days >= 7 ? "var(--danger, #c0392b)" : days >= 3 ? "var(--warning, #b9770e)" : null;
  return { text, color };
}

function StatusPill({ label, kind }) {
  return <span className={`bfd-pill bfd-pill-${kind}`}>{label}</span>;
}

// CR060 — the upstream CONNECTION behind this row's feed.
//
// Deliberately silent when the connection is healthy. The row already carries
// four numbers and a status; a green tick per row would be noise, and the header
// pill says "all feeds healthy" once, which is the reassurance that was missing.
// Only a state that needs a human appears here — and it appears on the ROW,
// because "Bank Pekao is dead" means nothing until it is attached to the account
// whose balance stopped moving.
//
// `null` is NOT rendered as healthy: it means either this account has no upstream
// counterpart, or the health service could not be reached — the banner above
// covers the second case, since a per-row "unknown" on every row would be noise
// of exactly the kind this CR just spent a threshold fix removing.
const HEALTH_LABEL = {
  needs_reconnect: "reconnect needed",
  unhealthy: "upstream error",
  never_synced: "never synced",
  stale: "feed silent",
};

function ConnectionHealth({ health }) {
  if (!health || !health.attention) return null;
  const label = HEALTH_LABEL[health.state] || health.state;
  const days = health.days_since_upstream_sync;
  // needs_reconnect is the only state with an action attached, so it is the only
  // one painted as danger; the rest are "look at this", not "do this now".
  const kind = health.state === "needs_reconnect" ? "danger" : "warn";
  return (
    <div
      className={`bfd-${kind}`}
      style={{ fontSize: "0.7rem", fontWeight: 600 }}
      title={
        `${health.institution_name || "This feed"} — ${health.status_text || label}` +
        (days != null ? ` · last upstream sync ${days}d ago` : "")
      }
    >
      ⚠ {label}
      {days != null && days > 0 ? ` · ${days}d` : ""}
    </div>
  );
}

/**
 * BalanceReconciliation (CR023 §4.C) — per fed account, fin's computed balance
 * vs the bank's reported `feed_balances`, sign-aware, with a "Reconcile to feed"
 * action (brokerage → month-end Unrealized-G/L MTM entry; cash → re-anchor
 * opening_balance). ⚠️ Since CR087 P0c the action PREVIEWS first — a dry run
 * computes the figures, `ReconcilePreviewModal` shows `old → new (Δ)` on the
 * Radix `<Modal>`, and only then does the apply run, carrying the approved
 * figures so the server can refuse (409) if they moved. Self-contained: loads
 * its own data on mount.
 */
export default function BalanceReconciliation() {
  const [balRecon, setBalRecon] = useState(null);
  const [reconcilingId, setReconcilingId] = useState(null);
  // CR087 P0c — the preview is its own dialog state; `stale` marks a 409.
  const [preview, setPreview] = useState(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [reconcileMsg, setReconcileMsg] = useState(null);
  const [savingMode, setSavingMode] = useState(null);
  const [institutionFilter, setInstitutionFilter] = useState("all"); // feed/institution filter
  const [statusFilter, setStatusFilter] = useState("all"); // reconciliation-status filter
  const [bookDate, setBookDate] = useState(lastMonthEndISO()); // MTM booking date
  // CR065 §11: optional — which OBSERVATION to mark against, when the booking
  // date would pick one taken before that day ended. Blank = same as bookDate.
  const [markBalanceDate, setMarkBalanceDate] = useState("");
  const [uploadAccount, setUploadAccount] = useState(null); // CR036: manual statement upload target
  const [showHelp, setShowHelp] = useState(false); // sign-convention explainer, collapsed by default
  const [plCategories, setPlCategories] = useState([]); // CR080: accrual category options

  // Set how an account reconciles: 'calibrate' (bank/cash → DRIFT), 'mtm'
  // (brokerage / mark-to-market holdings → MTM GAP) or 'accrue' (CR080: yield the
  // feed reports in its balance but never posts as a transaction → ACCRUAL).
  // Harmless on its own — the reconcile action each governs is confirm-gated.
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

  // CR080: which income category an accrue-mode account's yield books to. There
  // is no default by design — booking yield to Unrealized G/L (an EXPENSE
  // category) is the defect the mode exists to fix, so the server refuses both a
  // NULL category in 'accrue' mode and clearing it while the mode is selected.
  const setAccrualCategory = async (accountId, categoryId) => {
    setSavingMode(accountId);
    setReconcileMsg(null);
    try {
      await Rest.patch(`/bank-feed/accrual-category/${accountId}`, {
        categoryId: categoryId === "" ? null : Number(categoryId),
      });
      await loadBalanceRecon();
    } catch (err) {
      setReconcileMsg(`accrual category change failed — ${err.message}`);
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
    // CR080: P&L leaves for the accrual-category picker. Non-fatal — the page's
    // job is reconciliation, and an empty list disables the picker rather than
    // taking the whole table down.
    Rest.get("/categories")
      .then((res) => setPlCategories(res?.data || []))
      .catch(() => setPlCategories([]));
  }, []);

  // CR087 P0c — PREVIEW FIRST. The old flow confirmed a sentence with no figures
  // in it and reported `old → new` in a toast AFTER the write, on an operation
  // that shifts every historical date on the account by one constant.
  // `balanceDate` — which OBSERVATION to measure against — now applies to
  // `accrue` too. Until 2026-09-01 the engine fused it with the entry date for
  // accrue, so sending it from here would have moved the booking date without
  // the label saying so; that split is fixed, and the field means one thing.
  //
  // ⚠️ `bookDate` is deliberately NOT sent for accrue. It defaults to last
  // month-end, so sending it would date EVERY accrual at month-end instead of at
  // the day its observation can speak for. The engine accepts it for accrue (for
  // scripts and deliberate use); the page has no business volunteering it.
  const reconcileBody = (a, extra = {}) =>
    a.reconcile_mode === "mtm"
      ? { bookDate, ...(markBalanceDate ? { balanceDate: markBalanceDate } : {}), ...extra }
      : a.reconcile_mode === "accrue"
        ? { ...(markBalanceDate ? { balanceDate: markBalanceDate } : {}), ...extra }
        : { ...extra };

  const runPreview = async (a) => {
    setPreview({ account: a, data: null, error: null, stale: false });
    setPreviewBusy(true);
    try {
      // dryRun computes and writes nothing — and since P0c it no longer syncs
      // upstream or upserts `bankfeed_balances` either (routes/bankFeed.js).
      const res = await Rest.post(
        `/bank-feed/reconcile/${a.account_id}`,
        reconcileBody(a, { dryRun: true })
      );
      setPreview({ account: a, data: res, error: null, stale: false });
    } catch (err) {
      setPreview({ account: a, data: null, error: err.message, stale: false });
    } finally {
      setPreviewBusy(false);
    }
  };

  const askReconcile = (a) => { runPreview(a); };

  const doReconcile = async () => {
    const a = preview?.account;
    if (!a) return;
    setPreviewBusy(true);
    setReconcilingId(a.account_id);
    setReconcileMsg(null);
    try {
      // bookDate only affects MTM (entry date + balance as-of); calibrate ignores it.
      // CR087 P0c — carry the figures the owner just approved. The server
      // recomputes and returns 409 if they moved, because the apply path
      // re-syncs upstream and a feed row landing in that window silently
      // changes the number that gets written.
      const expect =
        preview?.data && a.reconcile_mode !== "mtm" && a.reconcile_mode !== "accrue"
          ? { new_opening: preview.data.new_opening, feed_date: preview.data.feed_date }
          : null;
      const body = reconcileBody(a, { dryRun: false, ...(expect ? { expect } : {}) });
      const res = await Rest.post(`/bank-feed/reconcile/${a.account_id}`, body);
      setReconcileMsg(
        res.mode === "mtm"
          ? `${a.name}: booked MTM entry ${fmtNum(res.mtm_amount)} dated ${res.month_end}` +
              (res.removed_read_override ? " (read-override removed)" : "") +
              (res.note ? ` — ${res.note}` : "")
          : res.mode === "accrue"
            // A refused run returns 200 with applied:false and the reason. Reporting
            // it as "booked" would be a lie the ledger then contradicts — and the
            // refusal IS the useful outcome, because it usually means a missing
            // transaction rather than yield.
            ? res.applied
              ? `${a.name}: booked accrual ${fmtNum(res.accrual_amount)} dated ${res.book_date}` +
                  ` (${(res.implied_apy * 100).toFixed(2)}%/yr over ${res.period_days}d)` +
                  (res.note ? ` — ${res.note}` : "")
              : `${a.name}: NOT booked — ${res.note || "refused"}`
            : `${a.name}: re-anchored opening balance ${fmtNum(res.old_opening)} → ${fmtNum(res.new_opening)}`
      );
      await loadBalanceRecon();
      setPreview(null);
    } catch (err) {
      // CR087 P0c — a 409 means the figures moved between preview and apply and
      // NOTHING was written. That is a different outcome from a failure, and
      // must not be reported as one: the dialog stays open offering a re-preview
      // rather than closing on a message the owner has to interpret.
      const isStale = err.status === 409 || err.code === "PREVIEW_STALE";
      if (isStale) {
        // ⚠️ Show the server's FRESH figures, do not re-preview. The preview
        // deliberately does not sync (a preview must not write) while the apply
        // does — so on any day the sync brings a newer feed row, re-previewing
        // returns the SAME stale row and 409s again, forever. Found on dev
        // before this shipped: preview computed against feed 2026-08-23, the
        // apply synced and got 2026-08-24. The 409 already carries `current`,
        // which is the number the server would write, so the owner approves
        // THAT and applies again — one extra click, and they see what moved.
        setPreview((p) =>
          p ? { ...p, data: err.current || p.data, stale: true, error: err.message } : p
        );
      } else {
        setReconcileMsg(`${a.name}: reconcile failed — ${err.message}`);
        setPreview(null);
      }
    } finally {
      setPreviewBusy(false);
      setReconcilingId(null);
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

  // CR060 — distinct CONNECTIONS needing attention, not rows. One dead
  // connection can carry several accounts (Revolut had three wallets), and
  // counting rows would report "3 feeds need attention" for a single broken
  // consent — inflating the number the owner is meant to act on.
  //
  // Counted over ALL accounts rather than the filtered view: a feed the current
  // filter hides is still broken, and a count that changes when you filter is a
  // count nobody can trust.
  const feedsNeedingAttention = [
    ...new Map(
      (balRecon.accounts || [])
        .filter((a) => a.feed_health && a.feed_health.attention)
        .map((a) => [a.feed_health.connection_id || a.feed_health.institution_name, a.feed_health]),
    ).values(),
  ];

  // CR060 — mappings pointing at a feed account the feed no longer carries.
  // Counted over ALL rows, not the filtered view, for the same reason
  // feedsNeedingAttention is: a filter hiding a dead account does not revive it.
  const orphanedRows = (balRecon.accounts || []).filter((a) => a.feed_orphaned === true);

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
        {/* CR060 — feed health, stated rather than implied. This CR's own
            argument for the admin page applies here: blank space is an ambiguous
            signal, not a reassuring one, so "all feeds healthy" is said out loud.
            The three cases are deliberately distinct — healthy, N need attention,
            and "we could not ask", which must never be allowed to look healthy. */}
        {/* CR060 — the badge below reports the upstream CONNECTION's health, and
            an orphaned mapping is invisible to it: the connection is perfectly
            healthy, the account just is not on it any more. Without this pill
            the page says "all feeds healthy" beside an account that stopped
            feeding — which is the exact sentence the seven-week Revolut gap
            would have shown, every day, for seven weeks. */}
        {orphanedRows.length > 0 && (
          <StatusPill
            label={`${orphanedRows.length} mapping${orphanedRows.length === 1 ? "" : "s"} point${orphanedRows.length === 1 ? "s" : ""} at a missing feed account`}
            kind="danger"
          />
        )}
        {balRecon.orphans_checked === false && (
          <StatusPill label="mapping check unavailable" kind="warn" />
        )}
        {balRecon.upstream_ok === false ? (
          <StatusPill label="feed health unavailable" kind="warn" />
        ) : feedsNeedingAttention.length > 0 ? (
          <StatusPill
            label={`${feedsNeedingAttention.length} feed${feedsNeedingAttention.length === 1 ? "" : "s"} need attention`}
            kind="danger"
          />
        ) : balRecon.upstream_ok ? (
          <StatusPill label="all feeds healthy" kind="ok" />
        ) : null}
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
      <MtmDateControl
        value={bookDate}
        onChange={setBookDate}
        balanceDate={markBalanceDate}
        onBalanceDateChange={setMarkBalanceDate}
      />
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
            <th>Last calibrated</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {visibleAccounts.map((a) => {
            const isMtm = a.reconcile_mode === "mtm";
            const isAccrue = a.reconcile_mode === "accrue";
            // An accrue account's drift is EXPECTED — it is yield the feed has
            // reported and fin has not booked yet — so it reads muted like mtm,
            // not as the red that means "something is wrong".
            const driftCls =
              a.reconciled === true ? "bfd-ok" : isMtm || isAccrue ? "bfd-muted" : "bfd-danger";
            return (
              <tr key={a.account_id}>
                <td>
                  {a.name}
                  {/* CR087 P1 — 10 of the 20 live calibrate accounts are non-USD
                      (PLN 7 · EUR 3) and this table showed no currency at all,
                      so EUR 1,409.25 sat in the same unlabelled column as USD
                      1,166,089.24. One label per row, because COMPUTED, BANK and
                      DRIFT are all in this currency. */}
                  {a.currency && (
                    <div className="recon-ccy" title={`Figures on this row are in ${a.currency}`}>
                      {a.currency}
                      {a.currency_mismatch && (
                        <span
                          className="recon-ccy__mismatch"
                          title={`fin holds this account as ${a.account_currency} but the feed reports ${a.feed_currency}. The values agree and are simply in different units — no balance check can see that.`}
                        >
                          {" "}⚠ feed says {a.feed_currency}
                        </span>
                      )}
                    </div>
                  )}
                </td>
                <td className="bfd-muted">
                  <select
                    value={a.reconcile_mode || "calibrate"}
                    disabled={savingMode === a.account_id}
                    onChange={(e) => setMode(a.account_id, e.target.value)}
                    title="How this account reconciles: bank (re-anchor opening_balance, shows DRIFT), brokerage (post Unrealized-G/L, shows MTM GAP), or accruing (book the gap to an income category, shows ACCRUAL)"
                  >
                    <option value="calibrate">bank (calibrate)</option>
                    <option value="mtm">brokerage (mtm)</option>
                    <option value="accrue">accruing (accrue)</option>
                  </select>
                  {isAccrue || a.accrual_category_id != null ? (
                    <select
                      className="bfd-accrual-category"
                      value={a.accrual_category_id ?? ""}
                      disabled={savingMode === a.account_id}
                      onChange={(e) => setAccrualCategory(a.account_id, e.target.value)}
                      title={
                        "Which income category this account's yield is booked to. " +
                        "Required for accrue mode and deliberately has NO default — " +
                        "the whole point of the mode is that yield must not land in " +
                        "Unrealized G/L, which is an expense category."
                      }
                    >
                      <option value="">— accrual category —</option>
                      {plCategories.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  ) : null}
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
                <td className={`num ${driftCls}`}>
                  {a.drift != null ? fmtNum(a.drift, 2) : "—"}
                  {a.transfer_balanced === false && (
                    <div
                      className="bfd-danger"
                      style={{ fontSize: "0.7rem" }}
                      title={
                        "Neutralized securities trades come in pairs that cancel. This account has " +
                        `${a.transfer_unpaired_legs} accepted leg(s) with no counter-leg, worth ` +
                        `${fmtNum(a.transfer_imbalance, 2)} — that much of the drift is a bookkeeping ` +
                        "error, not a market move, so reconciling it away would bake it in. " +
                        "Find them in Transfer Analysis."
                      }
                    >
                      {a.transfer_unpaired_legs} unpaired leg
                      {a.transfer_unpaired_legs === 1 ? "" : "s"} {fmtNum(a.transfer_imbalance, 2)}
                    </div>
                  )}
                </td>
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
                  <ConnectionHealth health={a.feed_health} />
                </td>
                {/* CR087 P0a — when this account's opening_balance was last
                    re-anchored, and by how much. `calibrate()` shifts EVERY
                    historical date by one constant and left no record until
                    migration 074; this is the first surface that shows it.
                    ⚠️ The trail starts EMPTY and fills forward, so "no record"
                    is NOT "never calibrated" and must not be rendered as a
                    date, a zero, or a dash that implies either. */}
                <td className="bfd-muted">
                  {a.last_calibrated_at ? (
                    <>
                      <div>{String(a.last_calibrated_at).slice(0, 10)}</div>
                      {a.last_calibrated_delta != null && (
                        <div style={{ fontSize: "0.7rem" }}>
                          moved {fmtNum(a.last_calibrated_delta, 2)}
                          {a.currency ? ` ${a.currency}` : ""}
                        </div>
                      )}
                      {a.calibrations_90d >= 3 && (
                        <div
                          style={{ fontSize: "0.7rem", color: "var(--danger)", fontWeight: 600 }}
                          title="Repeated re-anchoring is a symptom, not a fix — each one silently shifts every historical date on this account. CR080's fabricated loss came from exactly this."
                        >
                          {a.calibrations_90d}× in 90d
                        </div>
                      )}
                    </>
                  ) : (
                    <span title="No re-anchor recorded since the audit trail began (migration 074, 2026-08-23). This is not the same as never calibrated — history before that was not recorded.">
                      no record yet
                    </span>
                  )}
                </td>
                <td>
                  {/* CR060 — an orphaned mapping OUTRANKS every other status,
                      because every other status on this row is computed from a
                      bank figure that froze when the reconnect re-keyed the
                      account. "reconciled" against a stale number is the most
                      misleading thing this table can say. */}
                  {a.feed_orphaned ? (
                    <StatusPill label="feed gone" kind="danger" />
                  ) : a.reconciled == null ? (
                    <StatusPill label="no feed" kind="warn" />
                  ) : a.reconciled ? (
                    <StatusPill label="reconciled" kind="ok" />
                  ) : isMtm ? (
                    <StatusPill label="MTM gap" kind="warn" />
                  ) : isAccrue ? (
                    <StatusPill label="accrual" kind="warn" />
                  ) : (
                    <StatusPill label="drift" kind="danger" />
                  )}
                </td>
                <td className="recon-actions">
                  <button
                    className="generate-report-button"
                    disabled={reconcilingId === a.account_id || a.feed_balance == null || a.feed_orphaned === true}
                    onClick={() => askReconcile(a)}
                    title={
                      a.feed_orphaned
                        ? "This mapping points at a feed account the feed no longer carries — the bank figures are frozen at the last sync before it was re-keyed. Re-map it on Bank feed diagnostic first."
                        : isMtm
                          ? "Post a month-end Unrealized-G/L (MTM) entry"
                          : "Re-anchor opening_balance to the bank balance"
                    }
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

      <p className="recon-next-step">
        Accounts without a feed are reconciled on{" "}
        <Link to="/manual-calibration">Manual Calibration →</Link>
      </p>

      {/* CR087 P0c — Reconcile now goes through a PREVIEW that shows the figures
          before the write, so `ConfirmModal` has no remaining user on this page
          and is gone from it. It is NOT retired app-wide — five other consumers
          remain and CR086 owns that migration, behind CR060's rewrite of
          RefreshFeeds.jsx. */}
      <ReconcilePreviewModal
        open={preview != null}
        preview={preview?.data || null}
        account={preview?.account || null}
        busy={previewBusy}
        error={preview?.error || null}
        stale={preview?.stale === true}
        fmtNum={fmtNum}
        onCancel={() => setPreview(null)}
        onApply={doReconcile}
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
