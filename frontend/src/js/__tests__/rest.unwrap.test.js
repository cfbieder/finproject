import { describe, it, expect } from "vitest";
import Rest from "../rest.js";

/**
 * Rest.unwrap is the bridge for CR043 N8: the v2 API returns `{data: …}` from 63 handlers
 * and the bare value from ~27. Callers had to know which, and guessing wrong fails SILENTLY
 * — `undefined.map` never runs, the page just renders empty. That is how Modify Transfer
 * broke (GET /forecast/modules returns a bare array; GET /forecast/modules/:id returns
 * {data}), so these edges are worth pinning.
 */
describe("Rest.unwrap", () => {
  it("unwraps the envelope", () => {
    expect(Rest.unwrap({ data: [1, 2] })).toEqual([1, 2]);
    expect(Rest.unwrap({ data: { id: 7 } })).toEqual({ id: 7 });
    expect(Rest.unwrap({ success: true, data: [1] })).toEqual([1]);
    expect(Rest.unwrap({ data: [1], meta: { total: 1 } })).toEqual([1]);
  });

  it("passes a bare payload through untouched — the whole point of the two-phase migration", () => {
    // A caller routed through unwrap() must behave identically BEFORE its endpoint is
    // enveloped and AFTER, so the server can be migrated one route at a time.
    expect(Rest.unwrap([1, 2])).toEqual([1, 2]);
    expect(Rest.unwrap({ id: 7, name: "x" })).toEqual({ id: 7, name: "x" });
  });

  it("does NOT unwrap a payload that merely HAS a data field", () => {
    // e.g. a report whose own shape includes `data` alongside other keys — unwrapping that
    // would throw away the rest of the response.
    const report = { data: [1], generatedAt: "2026-07-13", currency: "USD" };
    expect(Rest.unwrap(report)).toEqual(report);
  });

  it("preserves falsy and empty payloads rather than collapsing them", () => {
    // `{data: null}` means "the server said null", not "no response".
    expect(Rest.unwrap({ data: null })).toBeNull();
    expect(Rest.unwrap({ data: [] })).toEqual([]);
    expect(Rest.unwrap({ data: 0 })).toBe(0);
    expect(Rest.unwrap(null)).toBeNull();
    expect(Rest.unwrap(undefined)).toBeUndefined();
  });
});

describe("Rest.rows — a list helper returns a list, or nothing", () => {
  // THE REGRESSION. Both FC-line totals routes echo their argument alongside `data`
  // (`{data, year}`, `{data, budgetYear}`), so `unwrap` correctly declines to strip the
  // envelope and hands back the OBJECT. Every `for (const r of rows)` then threw
  // "is not iterable", and the v3.16.0 stream-card reference block was dead from the day it
  // shipped — invisible to a check that stops at the endpoint instead of the render.
  it("an envelope with a sibling key still yields the array", () => {
    expect(Rest.rows({ data: [1, 2], year: 2025 })).toEqual([1, 2]);
    expect(Rest.rows({ data: [3], budgetYear: 2026 })).toEqual([3]);
  });

  it("a plain envelope and a bare array both work", () => {
    expect(Rest.rows({ data: [1] })).toEqual([1]);
    expect(Rest.rows([1, 2])).toEqual([1, 2]);
  });

  it("anything that is not a list becomes an empty list, never a guess", () => {
    for (const junk of [null, undefined, {}, { data: null }, { data: "x" }, 42, "s"]) {
      expect(Rest.rows(junk)).toEqual([]);
    }
  });
});
