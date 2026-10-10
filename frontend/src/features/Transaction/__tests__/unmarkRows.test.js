import { describe, it, expect } from "vitest";
import { unmarkRows } from "../transactionUtils.js";

const rows = (...ids) => ids.map((id) => ({ _id: id }));

describe("unmarkRows — Actuals' marked working set", () => {
  it("keeps marks the search box is hiding (the 'netf' regression)", () => {
    // 5 marked and loaded; the search shows only n1, n2, which are unmarked.
    const marked = new Set(["n1", "n2", "a", "b", "c"]);
    const next = unmarkRows(marked, new Set(["n1", "n2"]), rows("n1", "n2", "a", "b", "c"));
    expect([...next].sort()).toEqual(["a", "b", "c"]);
  });

  it("forgets a mark whose row is no longer loaded (edited out of the filters)", () => {
    const marked = new Set(["a", "b", "gone"]);
    const next = unmarkRows(marked, new Set(["a"]), rows("a", "b"));
    expect([...next]).toEqual(["b"]);
  });

  it("returns an empty set when the last marked rows are unmarked", () => {
    expect(unmarkRows(new Set(["a"]), new Set(["a"]), rows("a", "b")).size).toBe(0);
  });
});
