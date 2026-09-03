/**
 * Investments.jsx — CR090 P1. The portfolio summary: every account at a glance.
 *
 * READ-ONLY. This page books nothing, reconciles nothing against the balances
 * fin already holds, and changes no balance (CR090 §0).
 *
 * One row per account, each linking to its own register. Every figure comes from
 * the shared renderers in features/Investments, so the summary and the detail
 * cannot drift into two answers to one question.
 */

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, ChevronRight } from "lucide-react";
import Rest from "../js/rest.js";
import DataTable from "../components/DataTable/DataTable.jsx";
import EmptyState from "../components/EmptyState.jsx";
import LoadingSpinner from "../components/LoadingSpinner.jsx";
import { money, pct } from "../features/Investments/investmentFormat.js";
import "./PageLayout.css";
import "./Investments.css";

const COLUMNS = [
  {
    key: "account_name",
    header: "Account",
    sortable: true,
    render: (a) => (
      <Link className="inv-link" to={`/investments/${a.account_id}`}>
        {a.account_name} <ChevronRight size={13} aria-hidden="true" />
      </Link>
    ),
  },
  {
    key: "custodian_balance",
    header: "Custodian balance",
    numeric: true,
    sortable: true,
    sortValue: (a) => Number(a.custodian_balance) || 0,
    render: (a) => money(a.custodian_balance, a.currency),
  },
  {
    key: "positions_count",
    header: "Positions",
    numeric: true,
    sortable: true,
    render: (a) => a.positions_count,
  },
  {
    key: "residual",
    header: "Not in the feed",
    numeric: true,
    sortable: true,
    sortValue: (a) => Math.abs(Number(a.residual) || 0),
    render: (a) => {
      // Only a MATERIAL residual gets a figure. Four accounts tie within cents,
      // and printing "-$0.02" beside "$31,563.30" would make the one that
      // matters look like more of the same.
      if (!a.residual_known) return <span className="inv-muted">—</span>;
      if (!a.residual_material) return <span className="inv-muted">ties</span>;
      return (
        <span className="inv-warn">
          <AlertTriangle size={13} aria-hidden="true" /> {money(a.residual, a.currency)}
        </span>
      );
    },
  },
  {
    key: "unrealized",
    header: "Unrealized vs cost",
    numeric: true,
    sortable: true,
    sortValue: (a) => Number(a.unrealized.unrealized) || 0,
    render: (a) => {
      const u = a.unrealized;
      if (u.unrealized === null) return <span className="inv-muted">no basis</span>;
      const v = Number(u.unrealized);
      return (
        <span className={v >= 0 ? "inv-pos" : "inv-neg"}>{money(u.unrealized, a.currency)}</span>
      );
    },
  },
  {
    key: "coverage",
    header: "Covered",
    numeric: true,
    render: (a) =>
      a.unrealized.unrealized === null ? (
        <span className="inv-muted">—</span>
      ) : (
        <span className={a.unrealized.band === "insufficient" ? "inv-warn" : ""}>
          {pct(a.unrealized.coverage, 0)}
        </span>
      ),
  },
  {
    key: "quotable",
    header: "Priceable",
    numeric: true,
    render: (a) =>
      a.freshness.unquotable_by_nature ? (
        // A fact about the account, not a warning: bonds and money-market have
        // no market quote by nature and always will (CR074 — a rule that cannot
        // NOT fire carries no information).
        <span className="inv-muted" title="No position in this account has a market quote by nature">
          none
        </span>
      ) : (
        pct(a.freshness.quotable_share, 0)
      ),
  },
];

export default function Investments() {
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
  if (!portfolio || !portfolio.accounts?.length) {
    return (
      <div className="page-shell">
        <EmptyState message="No positions yet. Holdings arrive with the bank feed; once a snapshot has been ingested, each account's positions appear here." />
      </div>
    );
  }

  const t = portfolio.totals;
  const unreconciled = Number(t.unreconciled_residual);
  const polled = [...new Set(portfolio.accounts.map((a) => a.polled_on))].sort();

  return (
    <div className="page-shell inv-page">
      <header className="page-accent__header">
        <h1>Investments</h1>
        <p className="page-accent__sub">What each account holds, as the custodian reports it.</p>
      </header>

      <section className="panel inv-summary">
        <div className="inv-figure inv-figure--primary">
          <span className="inv-figure__label">Total — {t.accounts} accounts</span>
          <span className="inv-figure__value">{money(t.custodian_balance)}</span>
          {/* ⚠️ Sums CUSTODIAN BALANCES, never position rows. Summing positions
              would understate by every unreported option contract. */}
          <span className="inv-figure__sub">sum of custodian balances</span>
        </div>
        {unreconciled !== 0 && (
          <div className="inv-figure">
            <span className="inv-figure__label">Not reported by the feed</span>
            <span className="inv-figure__value inv-neg">{money(t.unreconciled_residual)}</span>
            <span className="inv-figure__sub">
              {pct(unreconciled / Number(t.custodian_balance), 2)} of the portfolio, included in the
              total above
            </span>
          </div>
        )}
        <div className="inv-figure">
          <span className="inv-figure__label">Polled</span>
          {/* The OLDEST material date leads, never the newest — a header stamped
              with the newest timestamp is the likeliest way this page lies. */}
          <span className="inv-figure__value">{polled[0]}</span>
          <span className="inv-figure__sub">
            {polled.length > 1 ? `newest account ${polled[polled.length - 1]}` : "all accounts"}
          </span>
        </div>
      </section>

      <section className="panel">
        <DataTable
          columns={COLUMNS}
          rows={portfolio.accounts}
          rowKey={(a) => a.account_id}
          emptyMessage="No accounts."
          hint="Select an account to see its positions."
        />
      </section>
    </div>
  );
}
