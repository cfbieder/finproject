import { describe, it, expect } from "vitest";
import { feedStatusItems } from "./feedStatus.js";

/** The feed-status lines both Refresh Feeds pages show (desktop and phone). */
describe("feedStatusItems", () => {
  it("says so when bank-feed could not be asked", () => {
    expect(feedStatusItems(null)).toEqual([
      { type: "warning", message: "Feed service status unavailable — bank-feed could not be asked." },
    ]);
  });

  it("reports a healthy sync, then stale and reconnect counts", () => {
    const items = feedStatusItems({
      feedService: { stalled: false, hoursSinceSync: 3, lastSyncAt: "2026-11-19T08:00:00Z" },
      staleFeeds: { count: 2, worstDays: 5 },
      needsReconnect: { count: 1 },
    });
    expect(items.map((i) => i.type)).toEqual(["info", "warning", "error"]);
    expect(items[0].message).toMatch(/^Feeds last synced 3h ago/);
    expect(items[1].message).toBe("2 accounts not synced by the bank in 3+ days (oldest 5 days)");
    expect(items[2].message).toBe("1 bank connection needs reconnecting (consent expired)");
  });

  it("flags a stalled service with its error", () => {
    const [item] = feedStatusItems({ feedService: { stalled: true, hoursSinceSync: 72, lastError: "timeout" } });
    expect(item).toEqual({ type: "error", message: "Feeds stalled: last successful sync 3 days ago — timeout" });
  });
});
