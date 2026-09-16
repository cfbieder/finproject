/**
 * investmentView.jsx — CR090 P1. Shared components for the Investments section.
 *
 * Components ONLY — the formatters live in investmentFormat.js and the column
 * spec in positionColumns.jsx, so each module exports one kind of thing and
 * React Fast Refresh keeps working.
 */

import { AlertTriangle, Info, RefreshCw } from "lucide-react";
import { money, pct } from "./investmentFormat.js";

export function ProvenanceChip({ source, basis }) {
  const label =
    source === "quote"
      ? "IEX · delayed"
      : source === "close"
      ? "close"
      : basis === "par"
      ? "par"
      : "custodian";
  return <span className={`inv-chip inv-chip--${source || "custodian"}`}>{label}</span>;
}

/**
 * When the values were true — or, honestly, that we do not know.
 *
 * ⚠️ Reads `valued_on` and NEVER falls back to `polled_on`. A poll date is when
 * the custodian was asked; the snapshot polled on the 2nd carries the 31st's
 * closes, and nothing upstream states the valuation date. A confident "priced at
 * the Nth close" would be a label lying about correct figures.
 */
export function AsOf({ a }) {
  return (
    <span className="inv-account__asof">
      {a.valued_on ? `Valued ${a.valued_on}` : `Polled ${a.polled_on}`}
      {!a.valued_on && (
        <span
          className="inv-hint"
          title="The feed states when it was polled, not when the values were true. A snapshot polled today can carry a previous session's closing prices."
        >
          <Info size={13} aria-hidden="true" /> poll date
        </span>
      )}
    </span>
  );
}

export function AccountFigures({ a }) {
  const u = a.unrealized;
  const f = a.freshness;
  return (
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
      {/* CR090 P2. Cash and money market, because an account that is 40% cash is
          a different thing from one that is fully invested — and on this
          portfolio one account is entirely cash. */}
      {a.cash && (
        <div className="inv-figure">
          <span className="inv-figure__label">Cash &amp; money market</span>
          <span className="inv-figure__value">{pct(a.cash.cash_share, 0)}</span>
          {/* "of reported positions" is load-bearing on Fidelity Options, where
              the one position the feed reports IS cash and the option contracts
              are the residual below — so this reads 100% of a $70K subtotal, not
              of the $103K account. */}
          <span className="inv-figure__sub">
            {`${money(a.cash.cash_value, a.currency)} of reported positions`}
          </span>
        </div>
      )}
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
  );
}

/**
 * The reconciliation. Positions sum to a subtotal; the residual is explicit; the
 * account total is the custodian's own number — never the sum of the rows.
 */
export function Reconciliation({ a }) {
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

/* A quote's timestamp, stated in UTC to the minute. Not `toLocaleString()`:
   CR087 §6 counts 22 locale-dependent renderings as a defect, and a time that
   reads differently on two machines is the same failure as a locale-dependent
   number. */
const quoteTime = (iso) => {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : `${d.toISOString().slice(0, 16).replace("T", " ")} UTC`;
};

/**
 * The live-quote overlay — CR090 P2. A PANEL BESIDE the custodian total, never
 * a revaluation of it.
 *
 * 🔴 Only 47.5% of this portfolio by value can be quoted at all; the rest is
 * CUSIP bonds, a mutual fund and money market that no equity feed prices. So
 * the custodian balance above stays the account total and this states a
 * difference over the quoted rows. An account with nothing quotable is greyed
 * and says why — never a Δ of 0.00, which reads as "the market didn't move".
 */
export function QuotePanel({ a, onRefresh, refreshing, message }) {
  const q = a.quotes || { quoted_positions: 0 };
  const none = !q.quoted_positions;
  const delta = q.delta === null || q.delta === undefined ? null : Number(q.delta);
  const stalest = quoteTime(q.oldest_quote_at);

  return (
    <div className={`inv-quotes${none ? " inv-quotes--none" : ""}`}>
      <div className="inv-quotes__head">
        <h3 className="inv-quotes__title">
          Live-adjusted value
          <span className="inv-chip inv-chip--quote">IEX · delayed</span>
        </h3>
        {onRefresh && (
          <button
            type="button"
            className="btn btn--sm btn--outline"
            onClick={onRefresh}
            disabled={refreshing}
          >
            <RefreshCw size={13} aria-hidden="true" />
            {refreshing ? "Refreshing…" : "Refresh quotes"}
          </button>
        )}
      </div>

      {none ? (
        <p className="inv-quotes__empty">
          {a.freshness.unquotable_by_nature
            ? "No position in this account can be quoted — bonds, CDs and deposits have no market quote by nature."
            : "No quotes stored for this account's positions yet. Quotes refresh on a schedule during market hours."}
        </p>
      ) : (
        <>
          <div className="inv-quotes__figures">
            <div className="inv-figure">
              <span className="inv-figure__label">Custodian balance</span>
              <span className="inv-figure__value">{money(a.custodian_balance, a.currency)}</span>
              <span className="inv-figure__sub">the account total, unchanged</span>
            </div>
            <div className="inv-figure">
              <span className="inv-figure__label">Live-adjusted</span>
              <span className="inv-figure__value">{money(q.live_adjusted_total, a.currency)}</span>
              <span className="inv-figure__sub">hybrid — quoted rows repriced, the rest as reported</span>
            </div>
            <div className="inv-figure">
              <span className="inv-figure__label">Δ since the snapshot</span>
              <span className={`inv-figure__value ${delta >= 0 ? "inv-pos" : "inv-neg"}`}>
                {money(q.delta, a.currency)}
              </span>
              {/* Built as ONE string rather than JSX fragments: a sentence split
                  across text nodes reads the same but cannot be asserted, and a
                  figure nobody can test is how this page would drift. */}
              <span className="inv-figure__sub">
                {`${pct(q.coverage, 0)} of reported positions quoted (${q.quoted_positions})`}
              </span>
            </div>
          </div>
          {/* The STALEST quote, never the newest — a header stamped with the
              newest timestamp on the page is how this surface would lie. */}
          <p className="inv-quotes__note">
            {`${stalest ? `Oldest quote ${stalest}` : "Quote times unknown"} · ${pct(
              1 - q.coverage,
              0,
            )} of this account has no market quote and is carried at the custodian's price.`}
          </p>
        </>
      )}
      {message && <p className="inv-quotes__note inv-quotes__note--msg">{message}</p>}
    </div>
  );
}
