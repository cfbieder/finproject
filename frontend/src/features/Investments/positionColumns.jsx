/**
 * positionColumns.jsx — CR090 P1. The positions table's column spec.
 *
 * Its own module because it is not a component but does return JSX: keeping it
 * out of investmentView.jsx leaves that file exporting components only.
 */

import { money, pct, UNIT_LABEL, renderPrice } from "./investmentFormat.js";
import { ProvenanceChip } from "./investmentView.jsx";

/* The Name column was removed in P1 and is back: the upstream sets
   `name == symbol` for every instrument it reports, so the service nulls the
   echo and every row rendered as a dash. CR061 P2's statement backfill now
   supplies real names for **88 of the 94 live positions (94%)** — `DIA` reads
   "SPDR DOW JONES INDL AVERAGE ETF TR UNIT SER 1" rather than "DIA".
   The remaining 6 are CUSIPs the feed holds but no statement covers, bought
   after the last statement date (2026-06-30); they still render "—", which is
   the honest answer rather than a repeated symbol. */
export const POSITION_COLUMNS = (currency, onPickSecurity) => [
  {
    key: "symbol",
    header: "Symbol",
    sortable: true,
    /* CR093 §5 — the symbol opens that security's chart. A BUTTON, not a link:
       it opens a dialog rather than navigating, and there is no URL for it.

       ⚠️ Every row is clickable, including the 52% of value that cannot be
       charted. The dialog is where the reason lives ("this instrument is not
       quoted on a market") along with the bond's rating, coupon and maturity —
       so a bond row is not a dead end, and the affordance does not have to
       predict what the server will say. */
    render: (r) => (onPickSecurity && r.security_id ? (
      <button
        type="button"
        className="btn btn--ghost btn--xs inv-symbol"
        onClick={() => onPickSecurity(r)}
        title={`Chart and details for ${r.symbol}`}
      >
        {r.symbol}
      </button>
    ) : r.symbol),
  },
  {
    key: "name",
    header: "Name",
    sortable: true,
    // Names run to 120 characters; the cell clips and carries the full string as
    // a tooltip rather than wrapping and making every row two lines tall.
    render: (r) => (r.name ? <span className="inv-name" title={r.name}>{r.name}</span> : "—"),
  },
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
    // FACE VALUE above 100 shares of an equity — three units in one column.
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
      // A par instrument has no market gain by nature — a money-market fund is
      // bought and held at par. Rendering $0.00 reads as "flat", which claims a
      // measurement; "—" says there is nothing to measure.
      if (r.price_basis === "par") return "—";
      if (r.cost_basis === null || Number(r.cost_basis) <= 0) return "—";
      const g = Number(r.market_value) - Number(r.cost_basis);
      return <span className={g >= 0 ? "inv-pos" : "inv-neg"}>{money(g, r.currency || currency)}</span>;
    },
  },
];
