/**
 * positionColumns.jsx — CR090 P1. The positions table's column spec.
 *
 * Its own module because it is not a component but does return JSX: keeping it
 * out of investmentView.jsx leaves that file exporting components only.
 */

import { money, pct, UNIT_LABEL, renderPrice } from "./investmentFormat.js";
import { ProvenanceChip } from "./investmentView.jsx";

/* ⚠️ No Name column. The upstream sets `name == symbol` for EVERY instrument it
   reports, so the service nulls the echo and the column rendered as dashes on
   every row of every account. It returns when something supplies real names. */
export const POSITION_COLUMNS = (currency) => [
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
