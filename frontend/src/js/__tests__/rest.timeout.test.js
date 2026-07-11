import { describe, it, expect, vi, afterEach } from "vitest";
import Rest from "../rest.js";

/**
 * Rest.fetchWithTimeout — the AbortController timeout that turns an
 * infinite-hang fetch (stale service worker, dead proxy) into a surfaced
 * error instead of a forever spinner.
 */

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("Rest.fetchWithTimeout", () => {
  it("rejects with a readable timeout error when the fetch never settles", async () => {
    vi.useFakeTimers();
    // A fetch that only ever settles by honoring the abort signal (models a
    // hung request that the timeout must abort).
    vi.stubGlobal("fetch", (_url, opts) =>
      new Promise((_resolve, reject) => {
        opts.signal.addEventListener("abort", () => {
          const err = new Error("aborted");
          err.name = "AbortError";
          reject(err);
        });
      })
    );

    const p = Rest.fetchWithTimeout("/api/x", { timeoutMs: 5000 });
    const assertion = expect(p).rejects.toThrow(/timed out after 5s/);
    await vi.advanceTimersByTimeAsync(5000);
    await assertion;
  });

  it("resolves normally when the fetch is fast", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ status: 200, ok: true })));
    const res = await Rest.fetchWithTimeout("/api/x", { timeoutMs: 5000 });
    expect(res.status).toBe(200);
  });

  it("timeoutMs:0 disables the timeout (no signal injected)", async () => {
    const fetchMock = vi.fn(async () => ({ status: 200, ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    await Rest.fetchWithTimeout("/api/x", { timeoutMs: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // no AbortController signal is attached when the timeout is disabled
    const opts = fetchMock.mock.calls[0][1] ?? {};
    expect(opts.signal).toBeUndefined();
  });

  it("rethrows a caller-initiated abort as-is (not remapped to a timeout)", async () => {
    const controller = new AbortController();
    vi.stubGlobal("fetch", (_url, opts) =>
      new Promise((_resolve, reject) => {
        opts.signal.addEventListener("abort", () => {
          const err = new Error("aborted");
          err.name = "AbortError";
          reject(err);
        });
      })
    );
    const p = Rest.fetchWithTimeout("/api/x", {
      timeoutMs: 60000,
      signal: controller.signal,
    });
    controller.abort();
    await expect(p).rejects.toHaveProperty("name", "AbortError");
  });
});
