// Pinned BEFORE any Date is constructed. The CI runner is UTC, where the buggy
// `new Date("2021-08-19")` also yields the 19th — so a TZ-neutral version of the
// display test below passes against the bug it is meant to catch. The defect only
// exists west of UTC, so the test has to stand there. (America/New_York is where
// the owner reads the app.)
// (via globalThis — `process` is not a browser global, and eslint lints src/ with
// browser globals only; this avoids suppressing no-undef.)
globalThis.process.env.TZ = "America/New_York";

import { describe, it, expect } from "vitest";
import { parseEditFormValue, formatIsoInputDate } from "../transactionUtils.js";
import { parseDisplayDate } from "../../../utils/dateHelpers.js";

/**
 * Two date bugs found by the owner on a real edit (v3.6.1). Both were silent —
 * nothing in the suite touched either path.
 *
 * 1. The edit payload. `parseEditFormValue(v, "date")` returned a Date OBJECT.
 *    It survived as far as JSON.stringify, which serializes to a full ISO
 *    instant, and the API's assertDateString requires /^\d{4}-\d{2}-\d{2}$/ —
 *    so the PATCH 400'd with "transaction_date must be a YYYY-MM-DD date
 *    string". Because a single-row edit always includes Date via consensus, this
 *    rejected EVERY single-row edit regardless of which field was being changed.
 *
 * 2. The table display. `new Date("2021-08-19")` parses as UTC midnight, so
 *    toLocaleDateString() renders 18 August anywhere west of UTC. The row for
 *    2021-08-19 read "Aug 18, 2021" while the edit modal's picker said 19.
 */

describe("parseEditFormValue — date fields", () => {
  it("returns a YYYY-MM-DD string, never a Date object", () => {
    const { valid, parsed } = parseEditFormValue("2021-08-19", "date");
    expect(valid).toBe(true);
    expect(parsed).toBe("2021-08-19");
    expect(parsed).not.toBeInstanceOf(Date);
  });

  it("survives JSON.stringify as a bare date — the actual failure", () => {
    const { parsed } = parseEditFormValue("2021-08-19", "date");
    const body = JSON.stringify({ Date: parsed });
    expect(body).toBe('{"Date":"2021-08-19"}');
    // The server's guard, reproduced verbatim.
    expect(/^\d{4}-\d{2}-\d{2}$/.test(JSON.parse(body).Date)).toBe(true);
  });

  it("narrows a full ISO instant to its calendar day", () => {
    const { valid, parsed } = parseEditFormValue("2021-08-19T00:00:00.000Z", "date");
    expect(valid).toBe(true);
    expect(parsed).toBe("2021-08-19");
  });

  it("rejects unparseable input", () => {
    expect(parseEditFormValue("not-a-date", "date")).toEqual({ valid: false, parsed: null });
  });

  it("treats an empty value as 'no change', not invalid", () => {
    expect(parseEditFormValue("", "date")).toEqual({ valid: true, parsed: null });
  });

  it("round-trips: what the form seeds is what the payload sends", () => {
    const seeded = formatIsoInputDate("2021-08-19");
    expect(seeded).toBe("2021-08-19");
    expect(parseEditFormValue(seeded, "date").parsed).toBe("2021-08-19");
  });
});

describe("parseDisplayDate — date-only strings are LOCAL days", () => {
  it("stands west of UTC, or it proves nothing", () => {
    // Guard on the guard: if a future Node ignores a runtime TZ change, this fails
    // loudly instead of the suite quietly going green in UTC where the bug hides.
    expect(new Date("2021-08-19").getDate()).toBe(18);
  });

  it("keeps the calendar day the database stores", () => {
    // The whole bug: 19, not the 18 the naive parse gives in this timezone.
    expect(parseDisplayDate("2021-08-19").getDate()).toBe(19);
    expect(parseDisplayDate("2021-08-19").getMonth()).toBe(7);
    expect(parseDisplayDate("2021-08-19").getFullYear()).toBe(2021);
  });

  it("renders the same day the database stores", () => {
    const shown = parseDisplayDate("2021-08-19").toLocaleDateString("en-US", {
      month: "short", day: "numeric", year: "numeric",
    });
    expect(shown).toBe("Aug 19, 2021");
  });

  it("passes through a real instant untouched", () => {
    // A value carrying a time denotes a moment, not a calendar day — no pinning.
    const d = parseDisplayDate("2021-08-19T23:30:00Z");
    expect(d.toISOString()).toBe("2021-08-19T23:30:00.000Z");
  });

  it("passes a Date object through, and rejects junk", () => {
    const now = new Date();
    expect(parseDisplayDate(now)).toBe(now);
    expect(parseDisplayDate("")).toBeNull();
    expect(parseDisplayDate(null)).toBeNull();
    expect(parseDisplayDate("garbage")).toBeNull();
  });
});
