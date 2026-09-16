/**
 * InvestmentAccount.jsx — CR090 P1. One account's register.
 *
 * READ-ONLY (CR090 §0). The account total is ALWAYS the custodian balance; the
 * positions sum to a labelled subtotal and the difference is an explicit
 * residual row.
 *
 * The selector at the top switches accounts without going back to the summary,
 * because comparing two accounts is the reason to be on this page at all.
 */

import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import Rest from "../js/rest.js";
import DataTable from "../components/DataTable/DataTable.jsx";
import EmptyState from "../components/EmptyState.jsx";
import LoadingSpinner from "../components/LoadingSpinner.jsx";
import {
  AsOf,
  AccountFigures,
  Reconciliation,
  QuotePanel,
} from "../features/Investments/investmentView.jsx";
import { POSITION_COLUMNS } from "../features/Investments/positionColumns.jsx";
import SecurityChartModal from "../features/Investments/SecurityChartModal.jsx";
import AccountHistoryChart from "../features/Investments/AccountHistoryChart.jsx";
import "../components/ReportTabs/ReportTabs.css";
import "./PageLayout.css";
import "./Investments.css";

export default function InvestmentAccount() {
  // CR093 §5 — which security's chart is open, if any.
  const [picked, setPicked] = useState(null);
  const { accountId } = useParams();
  const [portfolio, setPortfolio] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  // History is fetched per account and SEPARATELY from the register: it is the
  // slower call and the page is useful without it, so a failure here must not
  // take the positions down with it.
  //
  // Stored WITH the account it belongs to rather than cleared on switch. The
  // obvious `setHistory(null)` at the top of the effect is a synchronous setState
  // in an effect body (cascading render; `Scripts/check-lint-debt.sh` ratchets
  // it) — and comparing the id is also stricter, because it cannot briefly show
  // one account's history under another's name.
  const [history, setHistory] = useState(null);
  // CR090 P2 — the quote refresh. It is a WRITE, and the only one on this page:
  // it stores market facts in `security_quotes` and touches no balance, position
  // or ledger row, so CR090 §0's read-only rule is intact. Quotes are otherwise
  // refreshed on a schedule; nothing is fetched upstream on render (CR061 §5).
  const [refreshing, setRefreshing] = useState(false);
  const [quoteMsg, setQuoteMsg] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  const refreshQuotes = async () => {
    setRefreshing(true);
    setQuoteMsg("");
    try {
      const s = Rest.unwrap(await Rest.post("/investments/quotes/refresh", {})) || {};
      const refused = (s.refused || []).length;
      // A refusal is NAMED, never dropped: a refused quote that left the row at
      // its custodian price would read as "this didn't move" (CR061 §5).
      setQuoteMsg(
        [
          `${s.stored ?? 0} new quote${s.stored === 1 ? "" : "s"}`,
          refused ? `${refused} refused` : null,
          (s.missing || []).length ? `${s.missing.length} with no quote` : null,
          s.error ? `upstream partial: ${s.error}` : null,
        ]
          .filter(Boolean)
          .join(" · "),
      );
      setRefreshKey((k) => k + 1);
    } catch (e) {
      setQuoteMsg(`Could not refresh quotes — ${e.message || e}`);
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    let live = true;
    Rest.fetchJson("/api/v2/investments/portfolio")
      .then((res) => {
        if (!live) return;
        setPortfolio(Rest.unwrap(res));
        setError(null);
      })
      .catch((e) => live && setError(e.message || String(e)))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
    // `refreshKey` re-reads the portfolio after a quote refresh, so the panel
    // shows what was just stored rather than what was on screen before it.
  }, [refreshKey]);

  const shownId = accountId || portfolio?.accounts?.[0]?.account_id;
  useEffect(() => {
    if (!shownId) return undefined;
    let live = true;
    Rest.fetchJson(`/api/v2/investments/accounts/${shownId}/history`)
      .then((res) => live && setHistory({ accountId: shownId, rows: Rest.unwrap(res) }))
      // Deliberately silent: the register above is the page, and an empty chart
      // area says less wrong than an error banner over correct positions.
      .catch(() => live && setHistory({ accountId: shownId, rows: [] }));
    return () => {
      live = false;
    };
  }, [shownId]);

  if (loading) return <LoadingSpinner />;
  if (error) {
    return (
      <div className="page-shell">
        <EmptyState message={`Could not load the portfolio — ${error}`} />
      </div>
    );
  }

  const accounts = portfolio?.accounts || [];
  // `/investments/positions` carries no id — the nav needs a static path, so it
  // opens the first account rather than an empty shell asking to be told which.
  const a = accountId
    ? accounts.find((x) => String(x.account_id) === String(accountId))
    : accounts[0];

  if (!a) {
    // A tracked account that has no snapshot, or a stale bookmark. Say which,
    // rather than rendering an empty register that looks like "holds nothing".
    return (
      <div className="page-shell inv-page">
        <Link className="inv-back" to="/investments">
          <ArrowLeft size={14} aria-hidden="true" /> Investment summary
        </Link>
        <EmptyState message="No holdings snapshot for that account. It may not be tracked, or the feed has not reported positions for it yet." />
      </div>
    );
  }

  return (
    <div className="page-shell inv-page">
      <Link className="inv-back" to="/investments">
        <ArrowLeft size={14} aria-hidden="true" /> Investment summary
      </Link>

      <header className="page-accent__header">
        <h1>{a.account_name}</h1>
        <p className="page-accent__sub">
          <AsOf a={a} />
        </p>
      </header>

      {/* Five accounts, so the whole set is visible at once — a typeahead would
          hide the very comparison this page exists to make.

          Links, not buttons: each account HAS a URL, so it should be
          right-clickable and bookmarkable. Styled with the shared `report-tabs`
          classes the other consolidated reports use, rather than a one-off
          button class — `Scripts/check-button-css.sh` ratchets exactly that. */}
      <nav className="report-tabs" aria-label="Investment accounts">
        {accounts.map((x) => (
          <Link
            key={x.account_id}
            to={`/investments/positions/${x.account_id}`}
            className={`report-tab${x.account_id === a.account_id ? " report-tab--active" : ""}`}
            aria-current={x.account_id === a.account_id ? "page" : undefined}
          >
            {x.account_name}
          </Link>
        ))}
      </nav>

      <section className="panel inv-account">
        {/* No second `AsOf` here — the page header already carries it, and the
            same date twice on one screen reads as two different facts. */}
        <div className="inv-account__header">
          <div className="inv-account__identity">
            <h2>Positions</h2>
          </div>
          <AccountFigures a={a} />
        </div>

        {a.status !== "fetched" && (
          <p className="inv-status-note">
            {a.status === "partial"
              ? "The last fetch for this account did not complete — these positions may be incomplete."
              : a.status === "empty"
              ? "The custodian reported no positions for this account on this date."
              : "No snapshot is available for this date."}
          </p>
        )}

        <DataTable
          columns={POSITION_COLUMNS(a.currency, setPicked)}
          rows={a.positions}
          rowKey={(r) => `${a.account_id}-${r.symbol}`}
          emptyMessage="No positions in this snapshot."
        />

        <Reconciliation a={a} />

        {/* Beneath the reconciliation on purpose: the custodian balance is the
            line directly above, and this panel restates it as the account total
            before stating any live figure. */}
        <QuotePanel
          a={a}
          onRefresh={refreshQuotes}
          refreshing={refreshing}
          message={quoteMsg}
        />
      </section>

      {picked && (
        <SecurityChartModal
          securityId={picked.security_id}
          symbol={picked.symbol}
          onClose={() => setPicked(null)}
        />
      )}

      {String(history?.accountId) === String(a.account_id) && history.rows.length > 0 && (
        <section className="panel inv-account">
          <AccountHistoryChart rows={history.rows} currency={a.currency} />
        </section>
      )}
    </div>
  );
}
