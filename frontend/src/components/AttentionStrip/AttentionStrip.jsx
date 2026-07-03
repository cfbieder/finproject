import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  CheckCircle2,
  Inbox,
  WifiOff,
  Scale,
  BadgeDollarSign,
} from "lucide-react";
import Rest from "../../js/rest.js";
import "./AttentionStrip.css";

/**
 * AttentionStrip (CR038 P2) — the "needs attention" counts for the weekly
 * refresh → review → reconcile loop, each linking to the page that clears it.
 * Data: GET /api/v2/util/attention-summary. Renders nothing while loading or
 * on fetch failure (the strip is an aid, never a blocker); renders a quiet
 * "all clear" line when every count is zero.
 */
export default function AttentionStrip() {
  const [summary, setSummary] = useState(null);

  useEffect(() => {
    let cancelled = false;
    Rest.fetchJson("/api/v2/util/attention-summary")
      .then((data) => {
        if (!cancelled) setSummary(data);
      })
      .catch(() => {
        /* fail quiet — strip is informational */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!summary) return null;

  const items = [];
  if (summary.review?.count > 0) {
    items.push({
      key: "review",
      to: "/refresh-ps",
      icon: Inbox,
      label: `${summary.review.count} transaction${summary.review.count === 1 ? "" : "s"} to review`,
      tone: "info",
    });
  }
  if (summary.verifyUsd?.count > 0) {
    items.push({
      key: "verifyUsd",
      to: "/refresh-ps",
      icon: BadgeDollarSign,
      label: `${summary.verifyUsd.count} wire-transfer row${summary.verifyUsd.count === 1 ? "" : "s"} — verify USD amount`,
      tone: "warn",
    });
  }
  if (summary.staleFeeds?.count > 0) {
    items.push({
      key: "stale",
      to: "/balance-calibration",
      icon: WifiOff,
      label: `feed data stale on ${summary.staleFeeds.count} account${summary.staleFeeds.count === 1 ? "" : "s"} (oldest ${summary.staleFeeds.worstDays}d)`,
      tone: summary.staleFeeds.worstDays >= 7 ? "alert" : "warn",
    });
  }
  if (summary.mtmDue?.count > 0) {
    items.push({
      key: "mtmDue",
      to: "/balance-calibration",
      icon: Scale,
      label: `MTM booking due for ${summary.mtmDue.count} account${summary.mtmDue.count === 1 ? "" : "s"}${summary.mtmDue.monthEnd ? ` (${summary.mtmDue.monthEnd})` : ""}`,
      tone: "warn",
    });
  }
  if (summary.drift?.fed > 0) {
    items.push({
      key: "driftFed",
      to: "/balance-calibration",
      icon: Scale,
      label: `${summary.drift.fed} fed account${summary.drift.fed === 1 ? "" : "s"} with drift`,
      tone: "warn",
    });
  }
  if (summary.drift?.manual > 0) {
    items.push({
      key: "driftManual",
      to: "/manual-calibration",
      icon: Scale,
      label: `${summary.drift.manual} manual account${summary.drift.manual === 1 ? "" : "s"} with drift`,
      tone: "warn",
    });
  }

  if (items.length === 0) {
    return (
      <section className="attention-strip attention-strip--clear" aria-label="Needs attention">
        <CheckCircle2 size={16} />
        <span>All clear — nothing needs your attention.</span>
      </section>
    );
  }

  return (
    <section className="attention-strip" aria-label="Needs attention">
      <span className="attention-strip__title">
        <AlertTriangle size={15} />
        Needs attention
      </span>
      <div className="attention-strip__items">
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <Link
              key={item.key}
              to={item.to}
              className={`attention-pill attention-pill--${item.tone}`}
            >
              <Icon size={14} />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
