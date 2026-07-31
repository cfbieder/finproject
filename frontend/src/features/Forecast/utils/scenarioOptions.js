/**
 * CR050 — a scenario dropdown that shows lineage.
 *
 * "2026 Downside" and "2026 SRQ House Purchase" are not peers of "2026 Base", they are variants OF
 * it — but every picker in the app rendered one flat alphabetical list, so the only way to know
 * which was which was to remember. Here a variant is indented under its own base and marked, so the
 * shape of the list is the shape of the lineage.
 *
 * The value stays the scenario NAME on every option: that is what the pickers already store, pass to
 * the API and persist in localStorage. Only the visible label changes.
 */

/** "↳ " — nesting arrow, so the mark and the indent are the same glyph. */
export const VARIANT_MARK = "↳";

const nameOf = (s) => (typeof s === "string" ? s : s?.Name ?? s?.name ?? "");
const idOf = (s) => (typeof s === "string" ? null : s?.id ?? null);
const parentIdOf = (s) =>
  typeof s === "string" ? null : s?.ParentId ?? s?.parent_scenario_id ?? null;

/**
 * Flatten scenarios into option rows, each variant directly under its base.
 *
 * Bases keep the incoming order (the API sorts by name); variants keep it too, within their base.
 * A variant whose base is missing from the list — filtered out, or not loaded — is rendered as a
 * top-level row rather than dropped, because a scenario absent from its own picker is unselectable.
 *
 * @param {Array} scenarios - assumptions.scenarios rows (or bare name strings)
 * @returns {Array<{name: string, label: string, isVariant: boolean, baseName: string|null}>}
 */
export function scenarioOptions(scenarios) {
  const list = (Array.isArray(scenarios) ? scenarios : []).filter((s) => nameOf(s));
  const ids = new Set(list.map(idOf).filter((id) => id != null));

  const isRoot = (s) => {
    const parent = parentIdOf(s);
    return parent == null || !ids.has(parent);
  };

  const out = [];
  for (const scenario of list) {
    if (!isRoot(scenario)) continue;

    const baseName = nameOf(scenario);
    out.push({ name: baseName, label: baseName, isVariant: false, baseName: null });

    const id = idOf(scenario);
    if (id == null) continue;
    for (const child of list) {
      if (isRoot(child) || parentIdOf(child) !== id) continue;
      out.push({
        name: nameOf(child),
        label: `${VARIANT_MARK} ${nameOf(child)}`,
        isVariant: true,
        baseName,
      });
    }
  }
  return out;
}

/** The `title` for an option, so hovering says in words what the arrow says in shape. */
export function scenarioOptionTitle(option) {
  return option.isVariant ? `Variant of "${option.baseName}"` : undefined;
}
