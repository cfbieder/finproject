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
} from "../features/Investments/investmentView.jsx";
import { POSITION_COLUMNS } from "../features/Investments/positionColumns.jsx";
import "../components/ReportTabs/ReportTabs.css";
import "./PageLayout.css";
import "./Investments.css";

export default function InvestmentAccount() {
  const { accountId } = useParams();
  const [portfolio, setPortfolio] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

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
  }, []);

  if (loading) return <LoadingSpinner />;
  if (error) {
    return (
      <div className="page-shell">
        <EmptyState message={`Could not load the portfolio — ${error}`} />
      </div>
    );
  }

  const accounts = portfolio?.accounts || [];
  const a = accounts.find((x) => String(x.account_id) === String(accountId));

  if (!a) {
    // A tracked account that has no snapshot, or a stale bookmark. Say which,
    // rather than rendering an empty register that looks like "holds nothing".
    return (
      <div className="page-shell inv-page">
        <Link className="inv-back" to="/investments">
          <ArrowLeft size={14} aria-hidden="true" /> All accounts
        </Link>
        <EmptyState message="No holdings snapshot for that account. It may not be tracked, or the feed has not reported positions for it yet." />
      </div>
    );
  }

  return (
    <div className="page-shell inv-page">
      <Link className="inv-back" to="/investments">
        <ArrowLeft size={14} aria-hidden="true" /> All accounts
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
            to={`/investments/${x.account_id}`}
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
          columns={POSITION_COLUMNS(a.currency)}
          rows={a.positions}
          rowKey={(r) => `${a.account_id}-${r.symbol}`}
          emptyMessage="No positions in this snapshot."
        />

        <Reconciliation a={a} />
      </section>
    </div>
  );
}
