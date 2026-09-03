/**
 * investmentView.jsx — CR090 P1. Shared components for the Investments section.
 *
 * Components ONLY — the formatters live in investmentFormat.js and the column
 * spec in positionColumns.jsx, so each module exports one kind of thing and
 * React Fast Refresh keeps working.
 */

import { AlertTriangle, Info } from "lucide-react";
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
