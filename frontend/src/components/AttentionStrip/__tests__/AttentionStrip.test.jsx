import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const fetchJson = vi.fn();
vi.mock("../../../js/rest.js", () => ({ default: { fetchJson: (...a) => fetchJson(...a) } }));
const { default: AttentionStrip } = await import("../AttentionStrip.jsx");

const quiet = {
  review: { count: 0 }, verifyUsd: { count: 0 }, wrongCurrency: { count: 0 },
  staleFeeds: { count: 0, worstDays: null }, needsReconnect: { count: 0 },
  drift: { fed: 0, manual: 0 }, mtmDue: { count: 0 },
};
const show = () => render(<MemoryRouter><AttentionStrip /></MemoryRouter>);

describe("AttentionStrip", () => {
  afterEach(cleanup);

  it("🔴 says so when bank-feed's own sync is stalled, though every per-bank signal is fresh", async () => {
    // 2026-10-01/02: 30h of rolled-back syncs read as "All clear".
    fetchJson.mockResolvedValueOnce({
      ...quiet,
      feedService: { stalled: true, hoursSinceSync: 30, lastError: "insert guard: 67 new …" },
    });
    show();
    const pill = await screen.findByText(/bank-feed has not synced for 30h/);
    expect(pill.closest("a").getAttribute("href")).toBe("/bank-feed-diagnostic");
    expect(pill.closest("a").getAttribute("title")).toMatch(/insert guard/);
    expect(screen.queryByText(/All clear/)).toBeNull();
  });

  it("stays all clear when the service is syncing, or could not be asked", async () => {
    fetchJson.mockResolvedValueOnce({ ...quiet, feedService: { stalled: false, hoursSinceSync: 0 } });
    show();
    expect(await screen.findByText(/All clear/)).toBeTruthy();
    cleanup();
    fetchJson.mockResolvedValueOnce({ ...quiet, feedService: null });
    show();
    expect(await screen.findByText(/All clear/)).toBeTruthy();
  });
});
