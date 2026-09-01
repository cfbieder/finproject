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
import {
  AccountPicker,
  buildHierarchyOptions,
} from "../components/AccountPicker/AccountPicker.jsx";
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
  const [accountOptions, setAccountOptions] = useState([]);
  const [savingId, setSavingId] = useState(null);
  const [mapError, setMapError] = useState(null);
  const [recon, setRecon] = useState(null);
  // CR060 — mappings pointing at a feed account that no longer exists, and the
  // link-minting that can create exactly that situation.
  const [orphans, setOrphans] = useState(null);
  const [minting, setMinting] = useState(null);
  const [link, setLink] = useState(null);
  const [linkError, setLinkError] = useState(null);

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
      // `null` means bank-feed had nothing to say, which is NOT the same as
      // "no orphans" — keep the distinction all the way to the render.
      setOrphans(res.orphaned_mappings ?? null);
    } catch (err) {
      setMapError(err.message);
    }
  };

  // COA options for the typeahead picker (leaves get breadcrumb labels).
  const loadAccountOptions = async () => {
    try {
      const rows = await Rest.fetchAccountsV2();
      setAccountOptions(buildHierarchyOptions(rows));
    } catch (err) {
      setMapError(err.message);
    }
  };

  // CR022 §G trust signal — PS↔bank-feed reconciliation per account.
  const loadRecon = async () => {
    try {
      const res = await Rest.get("/bank-feed/reconciliation?sinceDays=30");
      setRecon(res);
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
      await loadRecon();
    } catch (err) {
      setMapError(err.message);
    } finally {
      setSavingId(null);
    }
  };

  // CR060 — mint a single-use browser URL and show it. Deliberately NOT
  // window.open: this page is routinely viewed from another device over
  // Tailscale, and a popup that a blocker eats looks exactly like a failure.
  const mintLink = async (connectionId, label) => {
    setMinting(connectionId || "new");
    setLink(null);
    setLinkError(null);
    try {
      const res = await Rest.post(
        connectionId
          ? `/bank-feed/connections/${connectionId}/link`
          : "/bank-feed/connections/link",
        {}
      );
      setLink({ ...res.link, label, connectionId: connectionId || null });
    } catch (err) {
      setLinkError(err.message);
    } finally {
      setMinting(null);
    }
  };

  // Trigger a fin-side import (bank-feed → staging → promote), then reload views.
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState(null);
  const runImport = async () => {
    setImporting(true);
    setImportMsg(null);
    try {
      const res = await Rest.post("/ingest-bank-feed/refresh", { sinceDays: 30 });
      const s = res.sync || {};
      setImportMsg(
        `Imported: ${s.inserted ?? 0} new, ${s.linked ?? 0} linked to PS, ` +
        `${(s.unmappedAccounts || []).length} account(s) pending, ${(s.ignoredAccounts || []).length} ignored.`
      );
      await Promise.all([load(), loadMappings(), loadRecon()]);
    } catch (err) {
      setImportMsg(`Import failed: ${err.message}`);
    } finally {
      setImporting(false);
    }
  };

  useEffect(() => {
    load();
    loadMappings();
    loadAccountOptions();
    loadRecon();
  }, []);

  // fin-side last pull (from sync_metadata via /diagnostic), with staleness color.
  const lastSync = data?.last_fin_sync;
  const lastSyncAt = lastSync?.last_sync_at;
  const hoursSince = lastSyncAt ? (Date.now() - new Date(lastSyncAt).getTime()) / 3.6e6 : null;
  const lastSyncKind =
    hoursSince == null ? "warn" : hoursSince <= 24 ? "ok" : hoursSince <= 72 ? "warn" : "danger";

  return (
    <div className="bfd-page">
      <header className="bfd-header">
        <h1>Bank Feed Setup</h1>
        <div className="bfd-actions">
          <button onClick={runImport} disabled={importing} className="generate-report-button">
            {importing ? "Importing…" : "Import now"}
          </button>
          <button onClick={load} disabled={loading} className="generate-report-button">
            {loading ? "Refreshing…" : "Refresh view"}
          </button>
        </div>
      </header>

      <p className="bfd-subtitle">
        Map <code>bank-feed</code> accounts and monitor sync health &amp; PS
        reconciliation (CR022). Map accounts below; day-to-day refresh + review
        lives on the <strong>Refresh Feeds</strong> page. <strong>Import now</strong>{" "}
        here pulls the latest and promotes mapped accounts into the ledger.
      </p>

      <div className="bfd-feed-card-header">
        <StatusPill
          label={
            lastSyncAt
              ? `last import: ${fmtDateTime(lastSyncAt)}` + (lastSync.last_sync_status === "error" ? " (errored)" : "")
              : "never imported (fin side)"
          }
          kind={lastSync?.last_sync_status === "error" ? "danger" : lastSyncKind}
        />
        {hoursSince != null && (
          <span className="bfd-muted">{Math.round(hoursSince)}h ago · {lastSync.last_sync_count ?? 0} rows</span>
        )}
      </div>

      {importMsg && (
        <div className={importMsg.startsWith("Import failed") ? "bfd-error" : "bfd-subtitle"}>
          {importMsg}
        </div>
      )}

      {mapError && (
        <div className="bfd-error">
          <strong>Mapping error:</strong> {mapError}
        </div>
      )}

      {mappings && (
        <section className="bfd-section">
          <h2>Account mapping (CR022 R1)</h2>

          {/* CR060 — the table below is built by walking the FEED, so a mapping
              whose feed account has vanished does not appear in it at all. It
              has to be stated separately or it is stated nowhere. */}
          {orphans && orphans.length > 0 && (
            <div className="bfd-error" role="alert">
              <strong>
                {orphans.length === 1
                  ? "1 mapping points"
                  : `${orphans.length} mappings point`}{" "}
                at a feed account that no longer exists.
              </strong>{" "}
              {orphans.length === 1 ? "That fin account has" : "These fin accounts have"}{" "}
              stopped feeding, silently — no error, just a balance
              that stops moving. A bank reconnect re-keys accounts, which is how this
              happens. Re-map {orphans.length === 1 ? "it" : "each one"} to its new feed
              account below.
              <ul>
                {orphans.map((m) => (
                  <li key={m.mapping_id}>
                    <strong>{m.mapped_account_name || `fin account ${m.mapped_account_id}`}</strong>{" "}
                    → missing feed account <code>{m.external_id}</code>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {orphans === null && (
            <p className="bfd-subtitle">
              Orphaned-mapping check did not run — bank-feed returned no accounts. That is
              not the same as “none”.
            </p>
          )}
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
                <th>Institution</th>
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
                  {/* Which bank this account is at. Several feed accounts carry
                      near-identical names across DIFFERENT institutions, and the
                      name alone cannot tell them apart. Null when bank-feed was
                      unreachable — "—", never a guess. */}
                  <td>{m.institution || <span className="bfd-muted">—</span>}</td>
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
                    <AccountPicker
                      value={m.mapped_account_id || ""}
                      options={accountOptions}
                      placeholder="— unmapped (pending) —"
                      onChange={(accountId) =>
                        saveMapping(
                          m.external_id,
                          accountId ? Number(accountId) : null,
                          m.ignored
                        )
                      }
                    />
                  </td>
                  <td>
                    <input
                      type="checkbox"
                      checked={m.ignored}
                      disabled={savingId === m.external_id}
                      title="Ignore this account on every feed upload (no mapping needed)"
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

      {recon && recon.accounts.some((a) => a.matched + a.ps_only > 0) && (
        <section className="bfd-section">
          <h2>PS ↔ bank-feed reconciliation (CR022 §G)</h2>
          <p className="bfd-subtitle">
            Accounts <strong>not yet cut over</strong> — still in PS↔bank-feed
            parallel run (no cutoff set), over the last {recon.sinceDays} days.
            Cut-over accounts (a <code>promote_from_date</code> is set) are excluded:
            their PS rows are pre-cutoff history, not gaps. <strong>PS-only</strong> =
            PocketSmith transactions with no bank-feed match — i.e. transactions
            bank-feed <em>missed</em>. A clean parallel run drives PS-only to{" "}
            <strong>0</strong> before an account is cut over. bank-feed-only is
            informational (usually bank-feed being more complete). This panel
            depopulates as accounts migrate; once empty, the PS rec is no longer needed.
          </p>
          <div className="bfd-feed-card-header">
            <StatusPill
              label={recon.total_ps_only === 0 ? "no gaps" : `${recon.total_ps_only} PS-only`}
              kind={recon.total_ps_only === 0 ? "ok" : "danger"}
            />
            <span className="bfd-muted">across accounts still PS-fed</span>
          </div>
          <table className="bfd-accounts">
            <thead>
              <tr>
                <th>Account</th>
                <th className="num">Matched</th>
                <th className="num">PS-only (missed)</th>
                <th className="num">bank-feed-only</th>
              </tr>
            </thead>
            <tbody>
              {recon.accounts
                .filter((a) => a.matched + a.ps_only > 0)
                .map((a) => (
                  <tr key={a.account_id}>
                    <td>{a.account_name}</td>
                    <td className="num">{a.matched}</td>
                    <td className={`num ${a.ps_only > 0 ? "bfd-danger" : "bfd-ok"}`}>{a.ps_only}</td>
                    <td className="num bfd-muted">{a.bank_feed_only}</td>
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

          {/* CR060 — bank connections, and the reconnect that is this page's whole
              point. `upstream` is bank-feed's passthrough of fintable's own
              connection list; when it could not be read we say so rather than
              rendering an empty, reassuring section. */}
          {data.feeds_health?.upstream?.connections?.length > 0 && (
            <section className="bfd-section">
              <h2>Bank connections (CR060)</h2>
              <p className="bfd-subtitle">
                A bank consent expires periodically — roughly every 90 days on the
                GoCardless connections — and re-authorising means logging into the bank,
                which needs a real browser. These buttons mint a{" "}
                <strong>single-use link, valid 30 minutes</strong>; nothing is changed
                until you open it and sign in.{" "}
                <strong>
                  After re-authorising, reload this page and check the account mapping
                  section above
                </strong>{" "}
                — a reconnect can re-key accounts, which leaves the fin mapping pointing
                at nothing.
              </p>

              {link && (
                <div className="bfd-ok-box" role="status">
                  <strong>Link ready{link.label ? ` for ${link.label}` : ""}.</strong>{" "}
                  <a href={link.url} target="_blank" rel="noopener noreferrer">
                    Open it to sign in at your bank →
                  </a>
                  <div className="bfd-muted">
                    Single use, expires {fmtDateTime(link.expires_at)}. If it lapses, mint
                    another.
                  </div>
                </div>
              )}
              {linkError && <div className="bfd-error" role="alert">{linkError}</div>}

              <table className="bfd-accounts">
                <thead>
                  <tr>
                    <th>Institution</th>
                    <th>Provider</th>
                    <th className="num">Accounts</th>
                    <th>State</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {data.feeds_health.upstream.connections.map((c) => (
                    <tr key={c.connection_id}>
                      <td>{c.institution_name}</td>
                      <td className="bfd-muted">{c.provider}</td>
                      <td className="num">{c.accounts_count}</td>
                      <td>
                        <StatusPill
                          label={
                            c.needs_reconnect
                              ? "NEEDS RECONNECT"
                              : c.healthy
                                ? "healthy"
                                : "unhealthy"
                          }
                          kind={c.needs_reconnect || !c.healthy ? "danger" : "ok"}
                        />
                      </td>
                      <td>
                        <button
                          type="button"
                          onClick={() => mintLink(c.connection_id, c.institution_name)}
                          disabled={minting !== null}
                        >
                          {minting === c.connection_id ? "Minting…" : "Re-authorise"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <p>
                <button
                  type="button"
                  onClick={() => mintLink(null, "a new bank")}
                  disabled={minting !== null}
                >
                  {minting === "new" ? "Minting…" : "Connect a new bank…"}
                </button>
              </p>
            </section>
          )}

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
              {/* Service-wide, and said once. These numbers were printed on EVERY
                  card as though each belonged to that institution: `sync_jobs`
                  carries no connection_id, so one error — same message, same
                  timestamp — was attributed to all thirteen. A card could read
                  "165 syncs ok" directly above "last sync 893h ago". */}
              {data.feeds_health?.service && (
                <p className="bfd-subtitle">
                  <strong>Service (all feeds):</strong>{" "}
                  <span className="bfd-ok">
                    {data.feeds_health.service.sync_health_7d?.succeeded} syncs ok
                  </span>
                  {data.feeds_health.service.sync_health_7d?.failed > 0 && (
                    <>
                      {" / "}
                      <span className="bfd-danger">
                        {data.feeds_health.service.sync_health_7d.failed} failed
                      </span>
                    </>
                  )}{" "}
                  in 7 days
                  {data.feeds_health.service.most_recent_error && (
                    <>
                      {" · last error "}
                      {fmtDateTime(data.feeds_health.service.most_recent_error_at)}:{" "}
                      <code>{data.feeds_health.service.most_recent_error}</code>
                    </>
                  )}
                  {data.feeds_health.service.connections_without_accounts > 0 && (
                    <>
                      {" · "}
                      {data.feeds_health.service.connections_without_accounts} superseded
                      connection record
                      {data.feeds_health.service.connections_without_accounts === 1 ? "" : "s"}{" "}
                      carry no accounts and are not shown
                    </>
                  )}
                </p>
              )}
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
                                ) : r.balance_ahead_of_stream ? (
                                  <span title="Bank balance is ahead of the posted transaction stream — a blocked/pending authorization, not a feed error.">
                                    <StatusPill label="blocked tx" kind="warn" />
                                  </span>
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
