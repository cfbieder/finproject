/**
 * Investments.jsx — CR090 P1. The portfolio, per account.
 *
 * READ-ONLY. This page books nothing, reconciles nothing against the balances
 * fin already holds, and changes no balance (CR090 §0). It reports what the
 * custodian holds.
 *
 * ── The rule the whole page is built around ──
 *
 * The account total is ALWAYS the custodian balance. Positions sum to a
 * labelled subtotal, and the difference is an explicit residual row. On four
 * accounts that is cents; on Fidelity Options it is ~$31.5K, because fintable
 * does not report option contracts. Shown everywhere, the row makes that gap
 * legible instead of absorbing it — and it disappears on its own if the feed
 * ever starts reporting them.
 */

import { useEffect, useState } from "react";
import { AlertTriangle, Info } from "lucide-react";
import Rest from "../js/rest.js";
import DataTable from "../components/DataTable/DataTable.jsx";
import EmptyState from "../components/EmptyState.jsx";
import LoadingSpinner from "../components/LoadingSpinner.jsx";
import "./PageLayout.css";
import "./Investments.css";

/* Money, with its currency. A figure without one can be read wrong (CR087 §2);
   every account here is USD, which makes that cheap rather than optional. */
const money = (n, currency = "USD") => {
  if (n === null || n === undefined || n === "") return "—";
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  return `${v < 0 ? "-" : ""}${currency === "USD" ? "$" : ""}${Math.abs(v).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
};

const pct = (x, digits = 1) =>
  x === null || x === undefined || !Number.isFinite(Number(x))
    ? "—"
    : `${(Number(x) * 100).toFixed(digits)}%`;

/* Quantity carries its unit, because the three conventions are not comparable:
   an equity is shares, a bond is FACE VALUE, a money-market fund is shares at
   par. A bare number invites a comparison that means nothing. */
const UNIT_LABEL = { per_share: "sh", per_1_face: "face", per_100_face: "face", par: "sh" };

/* A bond's price is a fraction of par. Rendering 0.9989 reads as a penny stock;
   the market convention is 99.89 per 100 face. Store raw, transform once. */
function renderPrice(p) {
  if (p.price === null || p.price === undefined) return "—";
  const v = Number(p.price);
  if (p.price_basis === "par") return "par";
  // Two bond conventions live in this portfolio, and only the basis tells them
  // apart — `value = quantity x price` holds for both. A fraction of par
  // (0.9989) is scaled to the market convention; a percent of par (98.745)
  // ALREADY IS that convention and must be left alone. Scaling both was the
  // defect: it rendered a bond priced at 98.745 as 9874.500.
  if (p.price_basis === "per_1_face") return (v * 100).toFixed(3);
  if (p.price_basis === "per_100_face") return v.toFixed(3);
  return v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
}

function ProvenanceChip({ source, basis }) {
  const label =
    source === "quote" ? "IEX · delayed" : source === "close" ? "close" : basis === "par" ? "par" : "custodian";
  return <span className={`inv-chip inv-chip--${source || "custodian"}`}>{label}</span>;
}

/**
 * The account header: the custodian balance, and everything that qualifies it.
 *
 * ⚠️ Freshness reads `valued_on` and NEVER falls back to `polled_on`. A poll
 * date is when the custodian was asked; nothing upstream states when the values
 * were true, and the snapshot polled on the 2nd carries the 31st's closes. So
 * when `valued_on` is null this says "Polled", not "Valued" — a confident
 * "priced at the Nth close" would be a label lying about correct figures.
 */
function AccountHeader({ a }) {
  const u = a.unrealized;
  const f = a.freshness;
  return (
    <div className="inv-account__header">
      <div className="inv-account__identity">
        <h2>{a.account_name}</h2>
        <div className="inv-account__asof">
          {a.valued_on ? `Valued ${a.valued_on}` : `Polled ${a.polled_on}`}
          {!a.valued_on && (
            <span
              className="inv-hint"
              title="The feed states when it was polled, not when the values were true. A snapshot polled today can carry a previous session's closing prices."
            >
              <Info size={13} aria-hidden="true" /> poll date
            </span>
          )}
        </div>
      </div>

      <div className="inv-account__figures">
        <div className="inv-figure inv-figure--primary">
          <span className="inv-figure__label">Custodian balance</span>
          <span className="inv-figure__value">{money(a.custodian_balance, a.currency)}</span>
        </div>
        <div className="inv-figure">
          <span className="inv-figure__label">Unrealized vs cost</span>
          <span
            className={`inv-figure__value ${
              u.unrealized === null ? "" : Number(u.unrealized) >= 0 ? "inv-pos" : "inv-neg"
            }`}
          >
            {u.unrealized === null ? "—" : money(u.unrealized, a.currency)}
          </span>
          <span className="inv-figure__sub">
            {u.unrealized === null
              ? "no cost basis"
              : `${pct(u.unrealized_pct)} · ${pct(u.coverage, 0)} covered`}
            {u.band === "partial" && <span className="inv-badge">partial</span>}
            {u.band === "insufficient" && <span className="inv-badge inv-badge--warn">low coverage</span>}
          </span>
        </div>
        <div className="inv-figure">
          <span className="inv-figure__label">Priceable by market</span>
          <span className="inv-figure__value">{pct(f.quotable_share, 0)}</span>
          <span className="inv-figure__sub">
            {f.unquotable_by_nature
              ? "no market quote by nature"
              : `${pct(1 - f.quotable_share, 0)} priced by the custodian`}
          </span>
        </div>
      </div>
    </div>
  );
}

/**
 * The reconciliation. Positions sum to a subtotal; the residual is explicit; the
 * account total is the custodian's own number.
 */
function Reconciliation({ a }) {
  if (!a.residual_known) {
    return (
      <div className="inv-recon inv-recon--unknown">
        <span>Positions reported</span>
        <span>{money(a.sum_market_value, a.currency)}</span>
        <span className="inv-recon__note">
          No custodian balance for this snapshot — a back-dated day carries positions and no
          reconciliation.
        </span>
      </div>
    );
  }
  const material = a.residual_material;
  return (
    <div className={`inv-recon ${material ? "inv-recon--material" : ""}`}>
      <div className="inv-recon__row">
        <span>Positions reported ({a.positions_count})</span>
        <span>{money(a.sum_market_value, a.currency)}</span>
      </div>
      <div className="inv-recon__row inv-recon__row--residual">
        <span>
          {material && <AlertTriangle size={14} aria-hidden="true" />} Not reported by the feed
        </span>
        <span>{money(a.residual, a.currency)}</span>
      </div>
      <div className="inv-recon__row inv-recon__row--total">
        <span>{a.account_name} — custodian balance</span>
        <span>{money(a.custodian_balance, a.currency)}</span>
      </div>
      {material && (
        <p className="inv-recon__explain">
          {pct(Number(a.residual) / Number(a.custodian_balance), 1)} of this account is not in the
          feed. Option contracts are not reported by the custodian's data provider, so they appear
          here rather than in the table — this figure moves as they trade.
        </p>
      )}
    </div>
  );
}

/* ⚠️ No Name column in P1. The upstream sets `name == symbol` for EVERY
   instrument it reports — equities and CUSIPs alike — so the service nulls the
   echo and the column rendered as dashes on every row of every account. A
   column of em-dashes is not "a blank is a finding", it is a wasted column.
   It comes back when something actually supplies names (a security master, or
   the statement backfill), and the service already carries the field. */
const COLUMNS = (currency) => [
  { key: "symbol", header: "Symbol", sortable: true },
  {
    key: "market_value",
    header: "Market value",
    numeric: true,
    sortable: true,
    sortValue: (r) => Number(r.market_value) || 0,
    render: (r) => money(r.market_value, r.currency || currency),
  },
  {
    key: "share",
    header: "% of acct",
    numeric: true,
    sortable: true,
    sortValue: (r) => Number(r.share_of_account) || 0,
    render: (r) => pct(r.share_of_account),
  },
  {
    key: "quantity",
    header: "Quantity",
    numeric: true,
    // ⚠️ Not sortable, deliberately. Sorting by quantity ranks 100,000 of bond
    // FACE VALUE above 100 shares of an equity — three units in one column, so
    // the ordering would be meaningless.
    render: (r) =>
      `${Number(r.quantity).toLocaleString("en-US", { maximumFractionDigits: 4 })} ${
        UNIT_LABEL[r.price_basis] || ""
      }`,
  },
  { key: "price", header: "Price", numeric: true, render: renderPrice },
  {
    key: "provenance",
    header: "Priced",
    render: (r) => <ProvenanceChip source={r.price_source} basis={r.price_basis} />,
  },
  {
    key: "cost_basis",
    header: "Cost basis (total)",
    numeric: true,
    render: (r) => money(r.cost_basis, r.currency || currency),
  },
  {
    key: "ugl",
    header: "Unrealized",
    numeric: true,
    render: (r) => {
      // Only where there is a basis to compare against. A zero basis is "none by
      // nature" (cash, money-market), and rendering 0.00 there would read as
      // "flat" rather than "not applicable".
      // Par instruments have no market gain by nature — a money-market fund is
      // bought and held at par. Rendering $0.00 reads as "flat", which claims a
      // measurement; "—" says there is nothing to measure, which is the truth.
      if (r.price_basis === "par") return "—";
      if (r.cost_basis === null || Number(r.cost_basis) <= 0) return "—";
      const g = Number(r.market_value) - Number(r.cost_basis);
      return <span className={g >= 0 ? "inv-pos" : "inv-neg"}>{money(g, r.currency || currency)}</span>;
    },
  },
];

function Account({ a }) {
  return (
    <section className="panel inv-account">
      <AccountHeader a={a} />
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
        columns={COLUMNS(a.currency)}
        rows={a.positions}
        rowKey={(r) => `${a.account_id}-${r.symbol}`}
        emptyMessage="No positions in this snapshot."
      />
      <Reconciliation a={a} />
    </section>
  );
}

export default function Investments() {
  const [portfolio, setPortfolio] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;
    setLoading(true);
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

  return (
    <div className="page-shell inv-page">
      <header className="page-accent__header">
        <h1>Investments</h1>
        <p className="page-accent__sub">
          What each account holds, as the custodian reports it.
        </p>
      </header>

      <section className="panel inv-summary">
        <div className="inv-figure inv-figure--primary">
          <span className="inv-figure__label">Total — {t.accounts} accounts</span>
          <span className="inv-figure__value">{money(t.custodian_balance)}</span>
          {/* ⚠️ This sums CUSTODIAN BALANCES, never position rows. Summing
              positions would understate by every unreported option contract. */}
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
      </section>

      {portfolio.accounts.map((a) => (
        <Account key={a.account_id} a={a} />
      ))}
    </div>
  );
}
