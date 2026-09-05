import { Fragment, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, ArrowDown, ArrowUp } from "lucide-react";
import {
  fullUSD,
  signedUSD,
  signClass,
  prettyDate,
  COLUMNS,
} from "./bridgeFormat.js";
import "./bridgeParts.css";

/**
 * The rendered halves of a net-worth bridge, shared by BOTH surfaces (CR092 P2).
 *
 * Extracted from `NetWorthBridgeModal` when the drivers report was added rather
 * than copied into it. Two renderings of one measurement is how a modal and a
 * report start disagreeing about the same number while each stays internally
 * consistent — the failure this repo keeps paying for. There is one waterfall,
 * one period table and one account grid; the modal and the report differ only
 * in what they wrap them in.
 *
 * The one deliberate difference is the account grid: the modal shows the server's
 * top movers unsorted-by-column, the report takes every account and lets a
 * column be sorted. Same component, same cells, a `sortable` flag.
 */

/**
 * Driver bars, each scaled against the LARGEST DRIVER rather than against the
 * net change.
 *
 * Deliberate: the drivers routinely dwarf their own total — a fall of 1.9M is
 * made of a 1.74M write-down against 412K of income — so scaling to the net
 * would push every bar off the row. Scaling to the largest driver keeps the
 * ranking readable, which is the only thing a reader takes from these bars.
 */
export function Waterfall({ data }) {
  const widest = Math.max(...data.drivers.map((d) => Math.abs(d.amount)), 1);

  return (
    <table className="nwb__waterfall">
      <caption className="nwb__caption">
        How {fullUSD.format(Math.abs(data.change))}{" "}
        {data.change < 0 ? "came off" : "was added to"} net worth
      </caption>
      <tbody>
        <tr className="nwb__row nwb__row--anchor">
          <th scope="row">{prettyDate(data.from.date)}</th>
          <td className="nwb__bar-cell" />
          <td className="nwb__amount">{fullUSD.format(data.from.netWorth)}</td>
        </tr>
        {data.drivers.map((d) => (
          <Fragment key={d.key}>
            <tr className="nwb__row">
              <th scope="row">{d.label}</th>
              <td className="nwb__bar-cell">
                <span
                  className={
                    "nwb__bar " + (d.amount < 0 ? "is-negative" : "is-positive")
                  }
                  style={{ width: `${(Math.abs(d.amount) / widest) * 100}%` }}
                />
              </td>
              <td
                className={
                  "nwb__amount " + (d.amount < 0 ? "is-negative" : "is-positive")
                }
              >
                {signedUSD(d.amount)}
              </td>
            </tr>

            {/* What the driver WAS, named. The whole point for a case like
                United Beverages: "re-valued −$1.74M" is a category,
                "United Beverages −$1,873,619" is an answer. */}
            {d.contributors?.map((c) => (
              <tr className="nwb__row nwb__row--contrib" key={d.key + "|" + c.label}>
                <td className="nwb__contrib-label">{c.label}</td>
                <td className="nwb__bar-cell" />
                <td className={"nwb__amount " + signClass(c.amount)}>
                  {signedUSD(c.amount)}
                </td>
              </tr>
            ))}

            {/* A cancelling driver names no item, because naming its biggest
                legs under a near-zero net is what misleads. It says the thing
                the reader actually wants instead: the money moved, it did not
                go anywhere. */}
            {d.offsetting && (
              <tr className="nwb__row nwb__row--contrib" key={d.key + "|offset"}>
                <td className="nwb__contrib-label" colSpan={3}>
                  {fullUSD.format(d.gross)} moved in both directions and almost
                  entirely cancelled — {signedUSD(d.amount)} is all that reached
                  net worth.
                </td>
              </tr>
            )}

            {!d.offsetting && d.contributors?.length === 0 && (
              <tr className="nwb__row nwb__row--contrib" key={d.key + "|none"}>
                <td className="nwb__contrib-label" colSpan={3}>
                  Spread across many{" "}
                  {d.namedBy === "category" ? "categories" : "accounts"} — no
                  single one stands out.
                </td>
              </tr>
            )}
          </Fragment>
        ))}
        <tr className="nwb__row nwb__row--anchor">
          <th scope="row">{prettyDate(data.to.date)}</th>
          <td className="nwb__bar-cell" />
          <td className="nwb__amount">{fullUSD.format(data.to.netWorth)}</td>
        </tr>
      </tbody>
    </table>
  );
}

export function Section({ open, onToggle, label, hint, children }) {
  return (
    <div className="nwb__section">
      <button
        type="button"
        className="nwb__section-toggle"
        onClick={onToggle}
        aria-expanded={open}
      >
        {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        <span className="nwb__section-label">{label}</span>
        <span className="nwb__section-hint">{hint}</span>
      </button>
      {open && <div className="nwb__section-body">{children}</div>}
    </div>
  );
}

export function PeriodTable({ periods }) {
  return (
    <div className="nwb__scroll">
      <table className="nwb__table">
        <thead>
          <tr>
            <th scope="col">Period</th>
            <th scope="col" className="nwb__num">Change</th>
            {COLUMNS.map((c) => (
              <th scope="col" className="nwb__num" key={c.key}>{c.head}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {periods.map((p) => (
            <tr key={p.key}>
              <th scope="row">
                {p.label}
                {/* A part-month sits beside full ones and would otherwise read
                    as a quiet month rather than a short one. */}
                {p.partial && <span className="nwb__partial"> (part)</span>}
              </th>
              <td className={"nwb__num " + signClass(p.change)}>
                {signedUSD(p.change)}
              </td>
              {COLUMNS.map((c) => (
                <td className={"nwb__num " + signClass(p.drivers[c.key])} key={c.key}>
                  {p.drivers[c.key] ? signedUSD(p.drivers[c.key]) : "—"}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * The account grid.
 *
 * `sortable` is what the report adds over the modal. The modal shows the
 * server's top 12 and the order IS the answer ("largest first"); the report
 * shows every account, and an unsorted 58-row grid is a worse object than the
 * capped one it replaced — "which account carried the currency hit" is a
 * question the data can already answer and a fixed sort cannot.
 *
 * Sorting is on the ABSOLUTE value, matching the server's own "largest first":
 * a driver column holds both signs, and ranking it raw would bury the biggest
 * negative under every small positive.
 */
export function MoverTable({ movers, sortable = false }) {
  const [sort, setSort] = useState({ key: "change", dir: "desc" });

  const rows = useMemo(() => {
    if (!sortable) return movers;
    const value = (m) => (sort.key === "change" ? m.change : m.drivers[sort.key] ?? 0);
    const sign = sort.dir === "desc" ? 1 : -1;
    return [...movers].sort((a, b) => sign * (Math.abs(value(b)) - Math.abs(value(a))));
  }, [movers, sortable, sort]);

  if (!movers.length) return <p className="nwb__state">Nothing moved.</p>;

  const header = (key, head, extraClass = "nwb__num") => {
    if (!sortable) {
      return <th scope="col" className={extraClass} key={key}>{head}</th>;
    }
    const active = sort.key === key;
    return (
      <th scope="col" className={extraClass} key={key} aria-sort={active ? (sort.dir === "desc" ? "descending" : "ascending") : "none"}>
        <button
          type="button"
          className={"nwb__sort" + (active ? " is-active" : "")}
          onClick={() =>
            setSort((s) =>
              s.key === key
                ? { key, dir: s.dir === "desc" ? "asc" : "desc" }
                : { key, dir: "desc" }
            )
          }
        >
          {head}
          {active &&
            (sort.dir === "desc" ? <ArrowDown size={12} /> : <ArrowUp size={12} />)}
        </button>
      </th>
    );
  };

  return (
    <div className="nwb__scroll">
      <table className="nwb__table">
        <thead>
          <tr>
            <th scope="col">Account</th>
            {header("change", "Change")}
            {COLUMNS.map((c) => header(c.key, c.head))}
          </tr>
        </thead>
        <tbody>
          {rows.map((m) => (
            <tr key={m.path}>
              <th scope="row">
                {m.account}
                {m.currency !== "USD" && (
                  <span className="nwb__ccy"> {m.currency}</span>
                )}
              </th>
              <td className={"nwb__num " + signClass(m.change)}>
                {signedUSD(m.change)}
              </td>
              {COLUMNS.map((c) => (
                <td className={"nwb__num " + signClass(m.drivers[c.key])} key={c.key}>
                  {m.drivers[c.key] ? signedUSD(m.drivers[c.key]) : "—"}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * The basis note and the two caveats the method cannot see past. Rendered by
 * both surfaces — a consumer that drops `meta` shows a breakdown with all its
 * disclosure stripped off.
 */
export function BridgeNotes({ meta }) {
  if (!meta) return null;
  return (
    <div className="nwb__notes">
      <p className="nwb__note">{meta.basisNote}</p>
      {meta.caveats?.map((c) => (
        <p className="nwb__note" key={c}>
          {c}
        </p>
      ))}
    </div>
  );
}
