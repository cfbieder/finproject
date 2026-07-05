import { useEffect, useState } from "react";
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

const SIGN_OPTIONS = [
  { value: "signed", label: "amounts already signed (outflows negative)" },
  { value: "debitPositive", label: "outflows are positive (flip sign)" },
  { value: "split", label: "separate debit / credit columns" },
];

const EMPTY_MAPPING = {
  dateCol: "", dateFormat: "", amountCol: "", sign: "signed", creditCol: "",
  descCol: "", catCol: "", currencyCol: "", currency: "USD",
};

/**
 * ManualStatementUpload (CR036) — the stale-feed fallback UI. Upload a bank's own
 * statement export for one fed account; the system parses it (per-bank format
 * profile), classifies each row against the existing ledger (imports ONLY new
 * ones), and previews the reconciled drift against the statement's stated
 * balance. Preview writes nothing; Commit writes + promotes + reconciles.
 *
 * P2: if no installed format matches, "Map columns…" inspects the file and lets
 * the owner point at the date/amount/description columns, pick the date format
 * and sign convention, type the statement balance, preview with that mapping,
 * and save it as a reusable named format.
 */
export default function ManualStatementUpload({ account, onClose, onCommitted }) {
  const [csv, setCsv] = useState("");
  const [fileName, setFileName] = useState("");
  const [profileId, setProfileId] = useState(""); // "" = auto-detect
  const [profiles, setProfiles] = useState([]);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  // mapper state
  const [mapperOpen, setMapperOpen] = useState(false);
  const [inspection, setInspection] = useState(null);
  const [mapping, setMapping] = useState(EMPTY_MAPPING);
  const [statedBalance, setStatedBalance] = useState({ magnitude: "", date: "" });
  const [saveLabel, setSaveLabel] = useState("");
  const [savedMsg, setSavedMsg] = useState(null);

  useEffect(() => {
    Rest.fetchJson("/api/v2/bank-feed/manual/profiles")
      .then((d) => setProfiles(d?.profiles || []))
      .catch(() => setProfiles([]));
  }, []);

  const readFile = (file) => {
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      setCsv(String(reader.result || ""));
      setPreview(null); setResult(null); setInspection(null); setMapperOpen(false);
    };
    reader.readAsText(file);
  };

  // Build the declarative profile spec from the mapping selections (or null
  // while the required fields are missing).
  const mappingSpec = (() => {
    if (!mapperOpen || !mapping.dateCol || !mapping.amountCol || !mapping.dateFormat) return null;
    return {
      columns: {
        transaction_date: mapping.dateCol,
        amount: mapping.amountCol,
        ...(mapping.descCol ? { description: mapping.descCol } : {}),
        ...(mapping.catCol ? { category_hint: mapping.catCol } : {}),
        ...(mapping.currencyCol ? { currency: mapping.currencyCol } : {}),
      },
      date: { format: mapping.dateFormat },
      amount: {
        ...(mapping.sign === "debitPositive" ? { debitPositive: true } : {}),
        ...(mapping.sign === "split" && mapping.creditCol ? { creditColumn: mapping.creditCol } : {}),
      },
      currency: mapping.currency || "USD",
    };
  })();

  const statedBalanceBody = () =>
    statedBalance.magnitude !== "" && statedBalance.date
      ? { statedBalance: { magnitude: Number(statedBalance.magnitude), date: statedBalance.date } }
      : {};

  const requestBody = () => {
    const body = { accountExternalId: account.external_id, csv, ...statedBalanceBody() };
    if (mapperOpen && mappingSpec) body.profile = mappingSpec;
    else if (profileId) body.profileId = profileId;
    return body;
  };

  const doInspect = async () => {
    setBusy(true); setError(null); setSavedMsg(null);
    try {
      const r = await Rest.post("/bank-feed/manual/inspect", { csv });
      setInspection(r);
      setMapperOpen(true);
      setPreview(null);
      setMapping((m) => ({ ...m, dateFormat: m.dateFormat || (r.dateFormats && r.dateFormats[0]) || "" }));
    } catch (err) {
      setError(err.message);
    } finally { setBusy(false); }
  };

  const doPreview = async () => {
    setBusy(true); setError(null); setResult(null); setSavedMsg(null);
    try {
      setPreview(await Rest.post("/bank-feed/manual/preview", requestBody()));
    } catch (err) {
      setError(err.message); setPreview(null);
    } finally { setBusy(false); }
  };

  const doCommit = async () => {
    setBusy(true); setError(null);
    try {
      const r = await Rest.post("/bank-feed/manual/commit", requestBody());
      setResult(r);
      if (onCommitted) onCommitted();
    } catch (err) {
      setError(err.message);
    } finally { setBusy(false); }
  };

  const doSaveProfile = async () => {
    if (!mappingSpec || !saveLabel.trim()) return;
    setBusy(true); setError(null);
    try {
      const r = await Rest.post("/bank-feed/manual/save-profile", {
        label: saveLabel.trim(),
        kind: account.account_type === "liability" ? "liability" : "asset",
        currency: mapping.currency || "USD",
        spec: mappingSpec,
      });
      const saved = r?.profile;
      setSavedMsg(`Saved as "${saved?.label}" — it will auto-match next time.`);
      const d = await Rest.fetchJson("/api/v2/bank-feed/manual/profiles").catch(() => null);
      if (d?.profiles) setProfiles(d.profiles);
      if (saved?.profile_id) { setProfileId(saved.profile_id); setMapperOpen(false); }
    } catch (err) {
      setError(err.message);
    } finally { setBusy(false); }
  };

  const rec = preview && preview.reconcile;
  const reconciles = rec && rec.reconciles === true;
  const noBalance = rec && rec.fin_balance == null;
  const colSelect = (value, onChange, { optional = true } = {}) => (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      {optional ? <option value="">—</option> : <option value="">choose…</option>}
      {(inspection?.headers || []).map((h) => (
        <option key={h} value={h}>{h}</option>
      ))}
    </select>
  );

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
            <select value={mapperOpen ? "__mapper__" : profileId}
              onChange={(e) => {
                if (e.target.value === "__mapper__") { doInspect(); return; }
                setMapperOpen(false); setProfileId(e.target.value); setPreview(null);
              }}>
              <option value="">auto-detect</option>
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>{p.label}{p.custom ? " (saved)" : ""}</option>
              ))}
              <option value="__mapper__">Map columns…</option>
            </select>
          </label>
          <button className="generate-report-button" disabled={!csv.trim() || busy || (mapperOpen && !mappingSpec)} onClick={doPreview}>
            {busy && !result ? "Parsing…" : "Preview"}
          </button>
        </div>

        {mapperOpen && inspection && (
          <div className="msu-mapper">
            <div className="msu-mapper-grid">
              <label>Date column<br />{colSelect(mapping.dateCol, (v) => setMapping({ ...mapping, dateCol: v }), { optional: false })}</label>
              <label>Date format<br />
                <select value={mapping.dateFormat} onChange={(e) => setMapping({ ...mapping, dateFormat: e.target.value })}>
                  {(inspection.dateFormats || []).map((f) => <option key={f} value={f}>{f}</option>)}
                </select>
              </label>
              <label>Amount column<br />{colSelect(mapping.amountCol, (v) => setMapping({ ...mapping, amountCol: v }), { optional: false })}</label>
              <label>Sign convention<br />
                <select value={mapping.sign} onChange={(e) => setMapping({ ...mapping, sign: e.target.value })}>
                  {SIGN_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </label>
              {mapping.sign === "split" && (
                <label>Credit column<br />{colSelect(mapping.creditCol, (v) => setMapping({ ...mapping, creditCol: v }), { optional: false })}</label>
              )}
              <label>Description column<br />{colSelect(mapping.descCol, (v) => setMapping({ ...mapping, descCol: v }))}</label>
              <label>Category column<br />{colSelect(mapping.catCol, (v) => setMapping({ ...mapping, catCol: v }))}</label>
              <label>Currency column<br />{colSelect(mapping.currencyCol, (v) => setMapping({ ...mapping, currencyCol: v }))}</label>
              {!mapping.currencyCol && (
                <label>Currency<br />
                  <input type="text" maxLength={3} value={mapping.currency}
                    onChange={(e) => setMapping({ ...mapping, currency: e.target.value.toUpperCase() })} />
                </label>
              )}
              <label>Statement balance (as printed)<br />
                <input type="number" step="0.01" placeholder="e.g. 7930.84" value={statedBalance.magnitude}
                  onChange={(e) => setStatedBalance({ ...statedBalance, magnitude: e.target.value })} />
              </label>
              <label>Balance as of<br />
                <input type="date" value={statedBalance.date}
                  onChange={(e) => setStatedBalance({ ...statedBalance, date: e.target.value })} />
              </label>
            </div>

            <div className="msu-rows-wrap msu-sample">
              <table className="bfd-accounts msu-rows">
                <thead>
                  <tr>{(inspection.headers || []).map((h) => <th key={h}>{h}</th>)}</tr>
                </thead>
                <tbody>
                  {(inspection.sampleRows || []).map((r, i) => (
                    <tr key={i}>{(inspection.headers || []).map((h, k) => <td key={k}>{r[k]}</td>)}</tr>
                  ))}
                </tbody>
              </table>
            </div>

            {preview && (
              <div className="msu-save">
                <input type="text" placeholder="Save format as… (e.g. Wise EUR)" value={saveLabel}
                  onChange={(e) => setSaveLabel(e.target.value)} />
                <button className="generate-report-button" disabled={busy || !saveLabel.trim()} onClick={doSaveProfile}>
                  Save format
                </button>
              </div>
            )}
            {savedMsg && <div className="msu-saved">✓ {savedMsg}</div>}
          </div>
        )}

        {csv && !preview && !mapperOpen && (
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

            {rec && noBalance && (
              <div className="msu-recon msu-warn">
                <div className="msu-verdict">
                  No statement balance available for this format — enter it in the mapper (or commit
                  rows only and reconcile afterwards from this page).
                </div>
              </div>
            )}

            {rec && !noBalance && (
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
