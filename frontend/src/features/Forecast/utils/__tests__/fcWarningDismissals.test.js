import { describe, test, expect } from "vitest";
import { warningFingerprint, partitionDismissed } from "../fcWarnings.js";

/**
 * CR074 — the half of dismissal that can go wrong silently.
 *
 * The server just stores `{ warningId: fingerprint }`. Everything that decides whether a
 * dismissed warning STAYS dismissed happens here, and getting it wrong has one specific cost:
 * a warning that should have come back stays hidden, and the panel under-reports the plan's
 * problems — the exact failure CR045 built it to prevent.
 */

const w = (over = {}) => ({
  id: "sweep-source-exhausted",
  severity: "warning",
  years: [2061],
  amount: null,
  detail: "Fidelity Fixed Income (priority 1) is drained to zero by 2061.",
  ...over,
});

describe("warningFingerprint", () => {
  test("is stable for the same warning", () => {
    expect(warningFingerprint(w())).toBe(warningFingerprint(w()));
  });

  test("ignores year ORDER but not year CONTENT", () => {
    expect(warningFingerprint(w({ years: [2029, 2030] })))
      .toBe(warningFingerprint(w({ years: [2030, 2029] })));
    expect(warningFingerprint(w({ years: [2029, 2030] })))
      .not.toBe(warningFingerprint(w({ years: [2029, 2031] })));
  });

  test("changes when the YEAR moves — the case that makes dismissal safe", () => {
    // Accepting "drained by 2061" must not silence "drained by 2041".
    expect(warningFingerprint(w({ years: [2061] })))
      .not.toBe(warningFingerprint(w({ years: [2041] })));
  });

  test("changes when the AMOUNT moves", () => {
    expect(warningFingerprint(w({ amount: -1000 })))
      .not.toBe(warningFingerprint(w({ amount: -2000 })));
  });

  test("changes when the DETAIL sentence moves — that is where the rules put their figures", () => {
    // "Cost basis and market value are both $3.9M" → "$2.1M" is a different claim.
    expect(warningFingerprint(w({ detail: "both $3.9M" })))
      .not.toBe(warningFingerprint(w({ detail: "both $2.1M" })));
  });

  test("changes when the severity escalates", () => {
    expect(warningFingerprint(w({ severity: "warning" })))
      .not.toBe(warningFingerprint(w({ severity: "error" })));
  });

  test("distinguishes null from 0 in amount", () => {
    // Number(null) is 0, so a naive canonicaliser folds these together.
    expect(warningFingerprint(w({ amount: null })))
      .not.toBe(warningFingerprint(w({ amount: 0 })));
  });
});

describe("partitionDismissed", () => {
  test("with no dismissals, everything is visible", () => {
    const { visible, dismissed } = partitionDismissed([w()], {});
    expect(visible).toHaveLength(1);
    expect(dismissed).toHaveLength(0);
  });

  test("a matching fingerprint hides the warning", () => {
    const one = w();
    const { visible, dismissed } = partitionDismissed([one], {
      [one.id]: warningFingerprint(one),
    });
    expect(visible).toHaveLength(0);
    expect(dismissed).toHaveLength(1);
  });

  test("a STALE fingerprint brings it back, flagged", () => {
    // The dismissal was recorded when the drain was 2061; the plan now says 2041.
    const accepted = w({ years: [2061] });
    const current = w({ years: [2041] });
    const { visible, dismissed } = partitionDismissed([current], {
      [accepted.id]: warningFingerprint(accepted),
    });
    expect(dismissed).toHaveLength(0);
    expect(visible).toHaveLength(1);
    // Flagged, so the panel can say it came back rather than looking never-dismissed —
    // otherwise the owner re-reasons from scratch about something they already judged.
    expect(visible[0].staleDismissal).toBe(true);
  });

  test("an unrelated dismissal does not hide a different warning", () => {
    const shown = w({ id: "negative-cash" });
    const { visible } = partitionDismissed([shown], { "some-other-warning": "abc" });
    expect(visible).toHaveLength(1);
  });

  test("splits a mixed list without losing or duplicating anything", () => {
    const a = w({ id: "a" });
    const b = w({ id: "b", years: [2030] });
    const c = w({ id: "c", years: [2035] });
    const { visible, dismissed } = partitionDismissed([a, b, c], {
      a: warningFingerprint(a),
      c: "stale-value",
    });
    expect(dismissed.map((x) => x.id)).toEqual(["a"]);
    expect(visible.map((x) => x.id)).toEqual(["b", "c"]);
    expect(visible.length + dismissed.length).toBe(3);
  });
});
