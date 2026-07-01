import { useState } from "react";
import Rest from "../../js/rest.js";
import "../../pages/BankFeedDiagnostic.css";
import "./ManualStatementUpload.css";

function fmtNum(n, decimals = 2) {
  if (n == null || n === "") return "—";
  const v = typeof n === "string" ? parseFloat(n) : n;
  if (!Number.isFinite(v)) return String(n);
  return v.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

const CLASS_LABEL = {
  new: ["new", "ok"],
  "ledger-duplicate": ["already in ledger", "muted"],
  "exact-duplicate": ["already imported", "muted"],
};

/**
 * ManualStatementUpload (CR036) — the stale-feed fallback UI. Upload a bank's own
 * statement export for one fed account; the system parses it (per-bank format
 * profile), classifies each row against the existing ledger (imports ONLY new
 * ones), and previews the reconciled drift against the statement's stated
 * balance. Preview writes nothing; Commit writes + promotes + reconciles.
 */
export default function ManualStatementUpload({ account, onClose, onCommitted }) {
  const [csv, setCsv] = useState("");
  const [fileName, setFileName] = useState("");
  const [profileId, setProfileId] = useState(""); // "" = auto-detect
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  const readFile = (file) => {
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => { setCsv(String(reader.result || "")); setPreview(null); setResult(null); };
    reader.readAsText(file);
  };

  const doPreview = async () => {
    setBusy(true); setError(null); setResult(null);
    try {
      const body = { accountExternalId: account.external_id, csv };
      if (profileId) body.profileId = profileId;
      setPreview(await Rest.post("/bank-feed/manual/preview", body));
    } catch (err) {
      setError(err.message); setPreview(null);
    } finally { setBusy(false); }
  };

  const doCommit = async () => {
    setBusy(true); setError(null);
    try {
      const body = { accountExternalId: account.external_id, csv };
      if (profileId) body.profileId = profileId;
      const r = await Rest.post("/bank-feed/manual/commit", body);
      setResult(r);
      if (onCommitted) onCommitted();
    } catch (err) {
      setError(err.message);
    } finally { setBusy(false); }
  };

  const rec = preview && preview.reconcile;
  const reconciles = rec && rec.reconciles === true;

  return (
    <div className="msu-overlay" role="dialog" aria-modal="true">
      <div className="msu-modal">
        <div className="msu-head">
          <h3>Upload statement — {account.name}</h3>
          <button className="msu-x" onClick={onClose} aria-label="Close">×</button>
        </div>

        <p className="bfd-muted msu-intro">
          Fallback for when this account's live feed is stale. Upload the bank's own CSV export;
          only rows not already in the ledger are imported, and the statement's stated balance is
          reconciled. Preview writes nothing.
        </p>

        <div className="msu-controls">
          <label className="msu-file">
            <input type="file" accept=".csv,text/csv,text/plain"
              onChange={(e) => readFile(e.target.files && e.target.files[0])} />
            {fileName ? `📄 ${fileName}` : "Choose CSV file…"}
          </label>
          <label className="bfd-muted">
            Format:&nbsp;
            <select value={profileId} onChange={(e) => setProfileId(e.target.value)}>
              <option value="">auto-detect</option>
              <option value="barclays_luxury_card">Barclays / Luxury Card</option>
            </select>
          </label>
          <button className="generate-report-button" disabled={!csv.trim() || busy} onClick={doPreview}>
            {busy && !result ? "Parsing…" : "Preview"}
          </button>
        </div>

        {csv && !preview && (
          <textarea className="msu-paste" value={csv} rows={4}
            onChange={(e) => { setCsv(e.target.value); setPreview(null); }}
            spellCheck={false} />
        )}

        {error && <div className="msu-error">⚠ {error}</div>}

        {preview && (
          <div className="msu-preview">
            <div className="msu-summary">
              <span className="bfd-pill bfd-pill-ok">{preview.counts.new} new</span>
              <span className="bfd-pill bfd-pill-muted">{preview.counts.ledgerDuplicate} already in ledger</span>
              <span className="bfd-pill bfd-pill-muted">{preview.counts.exactDuplicate} already imported</span>
              <span className="bfd-muted">· format: {preview.profileId}</span>
            </div>

            {rec && (
              <div className={`msu-recon ${reconciles ? "msu-ok" : "msu-warn"}`}>
                <div className="msu-recon-grid">
                  <span>Current computed</span><span className="num">{fmtNum(rec.current_computed)}</span>
                  <span>+ new rows ({preview.counts.new})</span><span className="num">{fmtNum(rec.new_rows_sum)}</span>
                  <span>= after import</span><span className="num">{fmtNum(rec.hypothetical_computed)}</span>
                  <span>Statement balance</span><span className="num">{fmtNum(rec.fin_balance)}</span>
                  <span><strong>Drift</strong></span>
                  <span className="num"><strong>{fmtNum(rec.drift)}</strong></span>
                </div>
                <div className="msu-verdict">
                  {reconciles
                    ? "✓ Reconciles to the statement balance."
                    : `⚠ Will not reconcile — ${fmtNum(rec.drift)} residual after importing new rows. You can still commit and then use “Reconcile to feed” to re-anchor, or investigate the residual first.`}
                </div>
              </div>
            )}

            {preview.warnings && preview.warnings.length > 0 && (
              <ul className="msu-warnings">
                {preview.warnings.map((w, i) => <li key={i}>{w}</li>)}
              </ul>
            )}

            <div className="msu-rows-wrap">
              <table className="bfd-accounts msu-rows">
                <thead>
                  <tr><th>Date</th><th className="num">Amount</th><th>Description</th><th>Status</th></tr>
                </thead>
                <tbody>
                  {preview.rows.map((r, i) => {
                    const [lbl, kind] = CLASS_LABEL[r.classification] || [r.classification, "muted"];
                    return (
                      <tr key={i} className={r.classification === "new" ? "msu-row-new" : "msu-row-dup"}>
                        <td>{r.transaction_date}</td>
                        <td className="num">{fmtNum(r.amount)}</td>
                        <td>{r.description}</td>
                        <td><span className={`bfd-pill bfd-pill-${kind}`}>{lbl}</span></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {result ? (
              <div className="msu-result">
                ✓ Imported {result.promote.inserted} new row(s)
                {result.promote.skippedDup ? `, skipped ${result.promote.skippedDup} duplicate(s)` : ""}
                {result.promote.linked ? `, linked ${result.promote.linked}` : ""}.
                {result.reconcile && (
                  <> Reconcile now: drift {fmtNum(result.reconcile.drift)} —{" "}
                    {result.reconcile.reconciled ? "reconciled." : "residual remains (use Reconcile to feed)."}</>
                )}
                <div><button className="generate-report-button" onClick={onClose}>Done</button></div>
              </div>
            ) : (
              <div className="msu-actions">
                <button className="generate-report-button" disabled={busy || preview.counts.new === 0} onClick={doCommit}>
                  {busy ? "Importing…" : `Commit ${preview.counts.new} new row(s)`}
                </button>
                <button className="msu-cancel" onClick={onClose} disabled={busy}>Cancel</button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
