/**
 * BankFeedDiagnostic — read-only diagnostic surface for the bank-feed
 * microservice (CR021, Phase 7 spike). Validates that fin can consume
 * bank-feed's /v1/* contract before any v3 cutover work begins.
 *
 * Fetches /api/v2/bank-feed/diagnostic which aggregates: connection,
 * staleness, sync history, balance reconciliation, accounts, recent txns.
 *
 * Never mutates anything in fin or bank-feed.
 */

import { useEffect, useState } from "react";
import Rest from "../js/rest";
import "./BankFeedDiagnostic.css";

function fmtNum(n, decimals = 2) {
  if (n == null || n === "") return "—";
  const v = typeof n === "string" ? parseFloat(n) : n;
  if (!Number.isFinite(v)) return String(n);
  return v.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function fmtDateTime(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function StatusPill({ label, kind }) {
  return <span className={`bfd-pill bfd-pill-${kind}`}>{label}</span>;
}

export default function BankFeedDiagnostic() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [mappings, setMappings] = useState(null);
  const [finAccounts, setFinAccounts] = useState([]);
  const [savingId, setSavingId] = useState(null);
  const [mapError, setMapError] = useState(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await Rest.get("/bank-feed/diagnostic");
      setData(result);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // CR022 R1 — per-account mapping + ignore management.
  const loadMappings = async () => {
    setMapError(null);
    try {
      const res = await Rest.get("/bank-feed/account-mappings");
      setMappings(res.accounts || []);
      setFinAccounts(res.fin_accounts || []);
    } catch (err) {
      setMapError(err.message);
    }
  };

  const saveMapping = async (externalId, accountId, ignored) => {
    setSavingId(externalId);
    setMapError(null);
    try {
      await Rest.put(`/bank-feed/account-mappings/${externalId}`, {
        accountId,
        ignored,
      });
      await loadMappings();
    } catch (err) {
      setMapError(err.message);
    } finally {
      setSavingId(null);
    }
  };

  useEffect(() => {
    load();
    loadMappings();
  }, []);

  return (
    <div className="bfd-page">
      <header className="bfd-header">
        <h1>Bank Feed Diagnostic</h1>
        <div className="bfd-actions">
          <button onClick={load} disabled={loading} className="generate-report-button">
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </header>

      <p className="bfd-subtitle">
        Read-only view of <code>bank-feed</code>'s <code>/v1/*</code> contract
        (CR021). Phase 7 spike — used to verify fin can consume bank-feed
        before v3 cutover (CR022).
      </p>

      {mapError && (
        <div className="bfd-error">
          <strong>Mapping error:</strong> {mapError}
        </div>
      )}

      {mappings && (
        <section className="bfd-section">
          <h2>Account mapping (CR022 R1)</h2>
          <p className="bfd-subtitle">
            Map each bank-feed account to a fin account to import its
            transactions. An unmapped account stays <strong>pending</strong> and
            is never imported. Toggle <em>ignore</em> to suppress a mapped
            account. Changes save immediately.
          </p>
          <table className="bfd-accounts">
            <thead>
              <tr>
                <th>Bank-feed account</th>
                <th>Cur</th>
                <th className="num">Staged (pending)</th>
                <th>Status</th>
                <th>Fin account</th>
                <th>Ignore</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {mappings.map((m) => (
                <tr key={m.external_id}>
                  <td>{m.name}</td>
                  <td>{m.currency}</td>
                  <td className="num">{m.staged_unpromoted}</td>
                  <td>
                    <StatusPill
                      label={m.status}
                      kind={
                        m.status === "mapped"
                          ? "ok"
                          : m.status === "ignored"
                          ? "warn"
                          : "danger"
                      }
                    />
                  </td>
                  <td>
                    <select
                      value={m.mapped_account_id || ""}
                      disabled={savingId === m.external_id}
                      onChange={(e) =>
                        saveMapping(
                          m.external_id,
                          e.target.value ? Number(e.target.value) : null,
                          m.ignored
                        )
                      }
                    >
                      <option value="">— unmapped (pending) —</option>
                      {finAccounts.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input
                      type="checkbox"
                      checked={m.ignored}
                      disabled={savingId === m.external_id || !m.mapped_account_id}
                      onChange={(e) =>
                        saveMapping(m.external_id, m.mapped_account_id, e.target.checked)
                      }
                    />
                  </td>
                  <td>{savingId === m.external_id ? "saving…" : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {error && (
        <div className="bfd-error">
          <strong>Could not reach bank-feed:</strong> {error}
          <div className="bfd-error-hint">
            Check that <code>BANK_FEED_URL</code> and{" "}
            <code>BANK_FEED_API_KEY</code> are set on the fin-server process,
            and that bank-feed is running on the configured URL.
          </div>
        </div>
      )}

      {data && (
        <>
          <section className="bfd-section">
            <h2>Service</h2>
            <table className="bfd-kv">
              <tbody>
                <tr>
                  <th>bank-feed URL</th>
                  <td>
                    <code>{data.bank_feed_url}</code>
                  </td>
                </tr>
                <tr>
                  <th>Fetched at</th>
                  <td>{fmtDateTime(data.fetched_at)}</td>
                </tr>
                <tr>
                  <th>Service health</th>
                  <td>
                    {data.health?.error ? (
                      <StatusPill label={data.health.error} kind="danger" />
                    ) : (
                      <>
                        <StatusPill
                          label={data.health?.status || "?"}
                          kind={data.health?.status === "ok" ? "ok" : "warn"}
                        />{" "}
                        <span className="bfd-muted">
                          v{data.health?.version} · db {data.health?.db}
                        </span>
                      </>
                    )}
                  </td>
                </tr>
              </tbody>
            </table>
          </section>

          {data.feeds_health?.error ? (
            <section className="bfd-section">
              <h2>Feed health</h2>
              <div className="bfd-error">
                Failed to load feed health: {data.feeds_health.error}
              </div>
            </section>
          ) : (
            <section className="bfd-section">
              <h2>Feed health</h2>
              {data.feeds_health?.feeds?.map((f) => (
                <div key={f.id} className="bfd-feed-card">
                  <header className="bfd-feed-card-header">
                    <h3>
                      {f.institution_name}{" "}
                      <span className="bfd-muted">({f.source})</span>
                    </h3>
                    <div className="bfd-feed-pills">
                      <StatusPill
                        label={f.is_stale ? "STALE" : "fresh"}
                        kind={f.is_stale ? "danger" : "ok"}
                      />
                      <span className="bfd-muted">
                        last sync {fmtDateTime(f.last_synced_at)} ·{" "}
                        {f.hours_since_last_sync}h ago
                      </span>
                    </div>
                  </header>
                  <div className="bfd-feed-stats">
                    <div>
                      <strong>7-day syncs:</strong>{" "}
                      <span className="bfd-ok">
                        {f.sync_health_7d?.succeeded} ok
                      </span>
                      {f.sync_health_7d?.failed > 0 && (
                        <>
                          {" / "}
                          <span className="bfd-danger">
                            {f.sync_health_7d.failed} failed
                          </span>
                        </>
                      )}
                    </div>
                    {f.sync_health_7d?.most_recent_error && (
                      <div className="bfd-muted">
                        Last error{" "}
                        {fmtDateTime(f.sync_health_7d.most_recent_error_at)}:{" "}
                        <code>{f.sync_health_7d.most_recent_error}</code>
                      </div>
                    )}
                  </div>

                  <table className="bfd-accounts">
                    <thead>
                      <tr>
                        <th>Account</th>
                        <th>Currency</th>
                        <th>Type</th>
                        <th>Last tx</th>
                        <th className="num">Reported balance</th>
                        <th className="num">Expected balance</th>
                        <th className="num">Drift</th>
                        <th>Reconcile</th>
                      </tr>
                    </thead>
                    <tbody>
                      {f.accounts?.map((a) => {
                        const r = a.balance_reconciliation || {};
                        return (
                          <tr key={a.id}>
                            <td>{a.name}</td>
                            <td>{a.currency}</td>
                            <td>{a.type}</td>
                            <td>
                              {a.most_recent_transaction_date || "—"}
                              {a.days_since_last_transaction != null && (
                                <span className="bfd-muted">
                                  {" "}({a.days_since_last_transaction}d)
                                </span>
                              )}
                              {a.is_inactive && (
                                <>
                                  {" "}
                                  <StatusPill label="inactive" kind="warn" />
                                </>
                              )}
                            </td>
                            <td className="num">
                              {r.reconcilable ? fmtNum(r.reported_current_balance) : "—"}
                            </td>
                            <td className="num">
                              {r.reconcilable ? fmtNum(r.expected_current_balance) : "—"}
                            </td>
                            <td className="num">
                              {r.reconcilable ? fmtNum(r.drift, 4) : "—"}
                            </td>
                            <td>
                              {r.reconcilable ? (
                                r.drift_significant ? (
                                  <StatusPill label="DRIFT" kind="danger" />
                                ) : (
                                  <StatusPill label="ok" kind="ok" />
                                )
                              ) : (
                                <span className="bfd-muted">
                                  n/a — {r.reason}
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ))}
            </section>
          )}

          <section className="bfd-section">
            <h2>Recent transactions (last 20 from bank-feed)</h2>
            {data.recent_transactions?.error ? (
              <div className="bfd-error">
                {data.recent_transactions.error}
              </div>
            ) : (
              <table className="bfd-tx-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Account</th>
                    <th>Description</th>
                    <th className="num">Amount</th>
                    <th>Cur</th>
                    <th>External ID</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recent_transactions?.transactions?.map((t) => {
                    const acct = data.accounts?.accounts?.find(
                      (a) => String(a.id) === String(t.account_id)
                    );
                    const isNeg = parseFloat(t.amount) < 0;
                    return (
                      <tr key={t.id}>
                        <td>{t.transaction_date}</td>
                        <td>{acct ? acct.name : `acct ${t.account_id}`}</td>
                        <td className="bfd-desc">{t.description}</td>
                        <td className={`num ${isNeg ? "bfd-danger" : "bfd-ok"}`}>
                          {fmtNum(t.amount)}
                        </td>
                        <td>{t.currency}</td>
                        <td className="bfd-muted bfd-extid">{t.external_id}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </section>
        </>
      )}
    </div>
  );
}
