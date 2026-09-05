import { describe, it, expect } from "vitest";
import { windowFor } from "../reportWindow.js";

/**
 * CR092 P2 — turning a chosen period into the bridge's two dates.
 *
 * Pure, and worth its own file because BOTH of the things it does are
 * off-by-one traps that produce a plausible-looking report when wrong:
 * the opening boundary is the day BEFORE the period, and the end is clamped
 * to today.
 *
 * `today` is injected rather than read from the clock — a test that pins
 * "clamps to today" against the real date passes for a month and then fails
 * on its own, which is how a suite teaches you to ignore it.
 */

describe("windowFor", () => {
  it("opens on the day BEFORE the period, not its first day", () => {
    // The bridge attributes transactions AFTER fromDate. Passing 2026-01-01
    // for "January onwards" would bury 1 January's own transactions in the
    // opening balance and drop them from the explanation entirely.
    const { fromDate } = windowFor({
      fromYear: 2026, fromMonth: "01", toYear: 2026, toMonth: "03", today: "2026-09-05",
    });
    expect(fromDate).toBe("2025-12-31");
  });

  it("crosses the year boundary correctly", () => {
    // fromMonth 01 means month index 0, i.e. December of the PREVIOUS year —
    // the case a naive `month - 1` turns into month 0 of the same year.
    expect(
      windowFor({ fromYear: 2024, fromMonth: "01", toYear: 2024, toMonth: "12", today: "2026-09-05" })
    ).toEqual({ fromDate: "2023-12-31", toDate: "2024-12-31" });
  });

  it("ends on the last day of the chosen month, including a leap February", () => {
    expect(
      windowFor({ fromYear: 2024, fromMonth: "02", toYear: 2024, toMonth: "02", today: "2026-09-05" }).toDate
    ).toBe("2024-02-29");
    expect(
      windowFor({ fromYear: 2025, fromMonth: "02", toYear: 2025, toMonth: "02", today: "2026-09-05" }).toDate
    ).toBe("2025-02-28");
  });

  it("clamps a future month end to today", () => {
    // Reading a balance at a date the calendar has not reached is exactly the
    // defect the Home hero shipped with in v3.53.0.
    const { toDate } = windowFor({
      fromYear: 2026, fromMonth: "01", toYear: 2026, toMonth: "09", today: "2026-09-05",
    });
    expect(toDate).toBe("2026-09-05");
  });

  it("leaves a past month end alone", () => {
    const { toDate } = windowFor({
      fromYear: 2026, fromMonth: "01", toYear: 2026, toMonth: "08", today: "2026-09-05",
    });
    expect(toDate).toBe("2026-08-31");
  });

  it("returns an inverted window rather than silently repairing it", () => {
    // The page shows a message for this; quietly swapping the dates would
    // answer a question the reader did not ask.
    const { fromDate, toDate } = windowFor({
      fromYear: 2026, fromMonth: "06", toYear: 2026, toMonth: "02", today: "2026-09-05",
    });
    expect(fromDate > toDate).toBe(true);
  });

  it("accepts numeric months as well as the selector's padded strings", () => {
    expect(
      windowFor({ fromYear: 2026, fromMonth: 3, toYear: 2026, toMonth: 5, today: "2026-09-05" })
    ).toEqual({ fromDate: "2026-02-28", toDate: "2026-05-31" });
  });
});
