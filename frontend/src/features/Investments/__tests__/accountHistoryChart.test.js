/**
 * accountHistoryChart.test.js — CR090 P3.
 *
 * `toSeries` is the whole safety of this chart: it puts the two sources in
 * SEPARATE fields so that neither recharts nor a later edit can join them. The
 * hazard is not a crash — it is a smooth, plausible line drawn across a seam no
 * observation validates.
 */

import { describe, test, expect } from "vitest";
import { toSeries } from "../investmentHistory.js";

const row = (over) => ({
  source: "statement",
  observed_on: "2016-03-31",
  polled_on: "2016-03-31",
  valued_on: "2016-03-31",
  sum_market_value: "1000.50",
  positions_count: 3,
  ...over,
});

describe("toSeries — the two series never share a field", () => {
  test("a statement row fills `statement` and leaves `feed` null", () => {
    const [d] = toSeries([row()]);
    expect(d.statement).toBe(1000.5);
    expect(d.feed).toBeNull();
  });

  test("a feed row fills `feed` and leaves `statement` null", () => {
    const [d] = toSeries([row({ source: "bank-feed", valued_on: null, polled_on: "2026-07-04" })]);
    expect(d.feed).toBe(1000.5);
    expect(d.statement).toBeNull();
  });

  test("🔴 every statement point is a null in the feed series, and vice versa", () => {
    // This is what makes `connectNulls={false}` able to refuse the join: there is
    // literally no feed value during the statement era to draw a line through.
    const data = toSeries([
      row({ observed_on: "2016-03-31" }),
      row({ observed_on: "2026-06-30", valued_on: "2026-06-30", polled_on: "2026-06-30" }),
      row({ source: "bank-feed", observed_on: "2026-07-04", valued_on: null, polled_on: "2026-07-04" }),
    ]);
    expect(data.map((d) => d.feed)).toEqual([null, null, 1000.5]);
    expect(data.map((d) => d.statement)).toEqual([1000.5, 1000.5, null]);
  });

  test("🔴 a feed row's valued_on stays null — it is never filled in from polled_on", () => {
    // CR089: nothing upstream states when the feed's values were true. Copying
    // polled_on into it would manufacture a date the custodian never gave.
    // observed_on is what the server derived (COALESCE(valued_on, polled_on)) —
    // for a feed row that IS polled_on, and the raw column stays null beside it.
    const [d] = toSeries([
      row({ source: "bank-feed", observed_on: "2026-07-04", valued_on: null, polled_on: "2026-07-04" }),
    ]);
    expect(d.valued_on).toBeNull();
    expect(d.observed_on).toBe("2026-07-04");
  });

  test("a statement is placed at the date it DESCRIBES, not when it was ingested", () => {
    const [d] = toSeries([row({ observed_on: "2016-03-31", polled_on: "2026-09-05", valued_on: "2016-03-31" })]);
    expect(d.observed_on).toBe("2016-03-31");
    expect(new Date(d.ts).getUTCFullYear()).toBe(2016);
  });

  test("timestamps are UTC midnight, so a point cannot slide a day by timezone", () => {
    const [d] = toSeries([row({ observed_on: "2020-09-30" })]);
    expect(d.ts).toBe(Date.UTC(2020, 8, 30));
  });

  test("no rows is an empty series, not a throw", () => {
    expect(toSeries([])).toEqual([]);
    expect(toSeries(null)).toEqual([]);
  });
});
