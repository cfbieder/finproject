import { describe, it, expect } from "vitest";
import { scenarioOptions, scenarioOptionTitle, VARIANT_MARK } from "../scenarioOptions.js";

/**
 * The one thing these tests have to pin is that the list is REGROUPED, not merely relabelled.
 * The real data hides that: "2026 Base" sorts before every one of its variants, so grouping and
 * alphabetical order happen to agree and a broken implementation would still look right. Every
 * ordering assertion below therefore uses a base that does NOT sort first.
 */
const base = (id, Name) => ({ id, Name, ParentId: null });
const variant = (id, Name, ParentId) => ({ id, Name, ParentId });

describe("scenarioOptions", () => {
  it("marks a variant and keeps it under its base", () => {
    const rows = [
      base(1, "A Standalone"),
      base(2, "B Base"),
      variant(3, "C Variant of B", 2),
      base(4, "D Standalone"),
    ];
    // Grouping and alphabetical order agree here; the next test is the one that separates them.
    expect(scenarioOptions(rows).map((o) => o.label)).toEqual([
      "A Standalone",
      "B Base",
      `${VARIANT_MARK} C Variant of B`,
      "D Standalone",
    ]);
  });

  it("keeps the bare scenario name as the option value", () => {
    const options = scenarioOptions([base(1, "2026 Base"), variant(2, "2026 Downside", 1)]);
    expect(options.map((o) => o.name)).toEqual(["2026 Base", "2026 Downside"]);
    expect(options[1].isVariant).toBe(true);
    expect(options[1].baseName).toBe("2026 Base");
    expect(scenarioOptionTitle(options[1])).toBe('Variant of "2026 Base"');
    expect(scenarioOptionTitle(options[0])).toBeUndefined();
  });

  it("renders a variant whose base is absent rather than dropping it", () => {
    // A dropped option is unselectable — worse than an unmarked one.
    const options = scenarioOptions([variant(9, "Orphaned Variant", 404)]);
    expect(options).toHaveLength(1);
    expect(options[0]).toMatchObject({ name: "Orphaned Variant", label: "Orphaned Variant", isVariant: false });
  });

  it("lifts variants out of alphabetical order and files them under their own base", () => {
    // Rows arrive ORDER BY name. Relabelling alone would leave this reading A, B, M, Z — the
    // variants stranded above the base they belong to. Only regrouping produces the order below.
    const rows = [
      variant(2, "A Variant", 1),
      variant(3, "B Variant", 1),
      base(4, "M Standalone"),
      base(1, "Z Base"),
    ];
    expect(scenarioOptions(rows).map((o) => o.label)).toEqual([
      "M Standalone",
      "Z Base",
      `${VARIANT_MARK} A Variant`,
      `${VARIANT_MARK} B Variant`,
    ]);
  });

  it("accepts the snake_case row shape served by /forecast/scenarios", () => {
    const rows = [
      { id: 1, name: "Base" },
      { id: 2, name: "Var", parent_scenario_id: 1 },
    ];
    expect(scenarioOptions(rows).map((o) => o.label)).toEqual(["Base", `${VARIANT_MARK} Var`]);
  });

  it("tolerates bare name strings, empty input and unnamed rows", () => {
    expect(scenarioOptions(["Solo"]).map((o) => o.label)).toEqual(["Solo"]);
    expect(scenarioOptions([])).toEqual([]);
    expect(scenarioOptions(undefined)).toEqual([]);
    expect(scenarioOptions(null)).toEqual([]);
    expect(scenarioOptions([{ id: 1 }])).toEqual([]);
  });
});
