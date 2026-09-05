import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import Modal from "../Modal/Modal.jsx";
import { useNetWorthBridge } from "../../hooks/useReports.js";
import {
  Waterfall,
  Section,
  PeriodTable,
  MoverTable,
  BridgeNotes,
} from "../../features/NetWorthBridge/bridgeParts.jsx";
import { fullUSD, prettyDate, totalsFrom } from "../../features/NetWorthBridge/bridgeFormat.js";

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
 *
 * CR092 P2: the rendering lives in `features/NetWorthBridge/bridgeParts.jsx`,
 * shared with the `/net-worth-drivers` report. This file is now the modal
 * wrapper and nothing else.
 */
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
              hint="These add up to the total above"
            >
              <PeriodTable periods={data.periods} totals={totalsFrom(data)} />
            </Section>
          )}

          <Section
            open={showMovers}
            onToggle={() => setShowMovers((v) => !v)}
            label="Which accounts moved"
            hint="Largest first — money moved between accounts nets to nothing"
          >
            {/* Foots even though the list is capped: the `Other accounts` row
                carries everything not shown, so "All accounts" is a real total
                rather than a subtotal wearing one's name. */}
            <MoverTable
              movers={data.movers}
              totals={totalsFrom(data)}
              remainder={data.remainder}
            />
          </Section>

          <BridgeNotes meta={meta} />
        </div>
      )}
    </Modal>
  );
}
