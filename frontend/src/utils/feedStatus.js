/**
 * The bank-feed status lines both Refresh Feeds pages show (desktop since
 * v3.94.0, the phone since the CR105 tail pass), built from
 * GET /api/v2/util/attention-summary — the same source as Home's attention
 * strip. One function, so the phone and the desktop cannot drift apart again.
 *
 * @returns {{ type: "info"|"warning"|"error", message: string }[]}
 */
const ago = (hours) =>
  hours < 1 ? "less than an hour ago" : hours < 48 ? `${hours}h ago` : `${Math.floor(hours / 24)} days ago`;

export function feedStatusItems(summary) {
  const items = [];
  const svc = summary?.feedService;
  if (!svc) {
    items.push({ type: "warning", message: "Feed service status unavailable — bank-feed could not be asked." });
  } else if (svc.stalled) {
    items.push({
      type: "error",
      message: `Feeds stalled: last successful sync ${ago(svc.hoursSinceSync)}${svc.lastError ? ` — ${svc.lastError}` : ""}`,
    });
  } else {
    items.push({
      type: "info",
      message: `Feeds last synced ${ago(svc.hoursSinceSync)} (${new Date(svc.lastSyncAt).toLocaleString()})`,
    });
  }
  const stale = summary?.staleFeeds?.count ?? 0;
  if (stale > 0) {
    items.push({
      type: "warning",
      message: `${stale} account${stale === 1 ? "" : "s"} not synced by the bank in 3+ days (oldest ${summary.staleFeeds.worstDays} days)`,
    });
  }
  const reconnect = summary?.needsReconnect?.count ?? 0;
  if (reconnect > 0) {
    items.push({
      type: "error",
      message: `${reconnect} bank connection${reconnect === 1 ? " needs" : "s need"} reconnecting (consent expired)`,
    });
  }
  return items;
}
