import { Fragment, useState } from "react";
import { ChevronDown, ChevronRight, AlertTriangle } from "lucide-react";
import Modal from "../Modal/Modal.jsx";
import { useNetWorthBridge } from "../../hooks/useReports.js";
import "./NetWorthBridgeModal.css";

/**
 * NetWorthBridgeModal (CR092) — what drove the hero's change.
 *
 * Explains exactly the window the hero draws: `fromDate`/`toDate` are the
 * series' own endpoints, so `data.change` IS the delta printed on the button
 * that opened this, rather than a second opinion about it.
 *
 * The waterfall is the whole feature. Every bar is a real figure from the
 * server's decomposition, which is exact — so the bars must account for the
 * total with nothing left over, and if the server says they don't (`tieOk`
 * false) the page says so rather than drawing a tidy chart over a broken sum.
 * That is the CR085 defect class read forwards: a display that cannot be wrong
 * on screen is a display that isn't showing you the measurement.
 */

const fullUSD = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const signedUSD = (n) => (n < 0 ? "−" : "+") + fullUSD.format(Math.abs(n));

const prettyDate = (iso) => {
  if (typeof iso !== "string" || iso.length < 10) return iso;
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString("en-US", {
    day: "numeric", month: "short", year: "numeric", timeZone: "UTC",
  });
};

export default function NetWorthBridgeModal({ open, onClose, fromDate, toDate }) {
  const [showMonths, setShowMonths] = useState(false);
  const [showMovers, setShowMovers] = useState(false);
  const { data: payload, isPending, isError, error } = useNetWorthBridge({
    fromDate, toDate, enabled: open,
  });

  const data = payload?.data ?? null;
  const meta = payload?.meta ?? null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="wide"
      title="What changed?"
      description={
        fromDate && toDate
          ? `Net worth from ${prettyDate(fromDate)} to ${prettyDate(toDate)}`
          : undefined
      }
    >
      {isPending && <p className="nwb__state">Working out what moved…</p>}

      {isError && (
        <p className="nwb__state nwb__state--error">
          Could not build the explanation: {error?.message || "unknown error"}
        </p>
      )}

      {data && (
        <div className="nwb">
          {/* The one thing that can invalidate everything below it, so it sits
              above everything below it. */}
          {meta && meta.tieOk === false && (
            <p className="nwb__tie-warning">
              <AlertTriangle size={16} aria-hidden="true" />
              These figures do not add up to the total — they are out by{" "}
              {fullUSD.format(Math.abs(meta.tie))}. Treat the breakdown as
              incomplete.
            </p>
          )}

          <ul className="nwb__summary">
            {data.summary.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>

          <Waterfall data={data} />

          {/* Only when there is more than one month to compare. On the mobile
              home the window is month-over-month, so this section offered a
              "Month by month" breakdown containing exactly one row — a control
              whose promise its content cannot keep. */}
          {data.periods.length > 1 && (
            <Section
              open={showMonths}
              onToggle={() => setShowMonths((v) => !v)}
              label="Month by month"
              hint="These add up to the total above, exactly"
            >
              <PeriodTable periods={data.periods} />
            </Section>
          )}

          <Section
            open={showMovers}
            onToggle={() => setShowMovers((v) => !v)}
            label="Which accounts moved"
            hint="Largest first — money moved between accounts nets to nothing"
          >
            <MoverTable movers={data.movers} />
          </Section>

          {meta && (
            <div className="nwb__notes">
              <p className="nwb__note">{meta.basisNote}</p>
              {meta.caveats?.map((c) => (
                <p className="nwb__note" key={c}>
                  {c}
                </p>
              ))}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

/**
 * Driver bars, each scaled against the LARGEST DRIVER rather than against the
 * net change.
 *
 * Deliberate: the drivers routinely dwarf their own total — a fall of 1.9M is
 * made of a 1.74M write-down against 412K of income — so scaling to the net
 * would push every bar off the row. Scaling to the largest driver keeps the
 * ranking readable, which is the only thing a reader takes from these bars.
 */
function Waterfall({ data }) {
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

            {/* What the driver WAS, named. The whole point of the modal for a
                case like United Beverages: "re-valued −$1.74M" is a category,
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
                  Spread across many {d.namedBy === "category" ? "categories" : "accounts"} —
                  no single one stands out.
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

function Section({ open, onToggle, label, hint, children }) {
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

const COLUMNS = [
  { key: "revaluation", head: "Re-valued" },
  { key: "income", head: "Earned" },
  { key: "spending", head: "Spent" },
  { key: "currency", head: "Currency" },
  { key: "transfers", head: "Transfers" },
];

function PeriodTable({ periods }) {
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

function MoverTable({ movers }) {
  if (!movers.length) return <p className="nwb__state">Nothing moved.</p>;
  return (
    <div className="nwb__scroll">
      <table className="nwb__table">
        <thead>
          <tr>
            <th scope="col">Account</th>
            <th scope="col" className="nwb__num">Change</th>
            {COLUMNS.map((c) => (
              <th scope="col" className="nwb__num" key={c.key}>{c.head}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {movers.map((m) => (
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

const signClass = (n) => (n < 0 ? "is-negative" : n > 0 ? "is-positive" : "is-zero");
