import { expect } from "@playwright/test";

/**
 * Shared e2e helpers.
 *
 * ── confirmSavePreview ──
 *
 * CR084 (v3.29.0) made saving an existing forecast module open a consequence preview FIRST —
 * net assets before → after, plus which scenarios move — and nothing is written until it is
 * confirmed.
 *
 * Every spec that drives a module save therefore has a second `[role=dialog]` on the page between
 * the click and the confirm, and the editor never closes on its own. Both are strict-mode
 * violations rather than assertion failures, which is why the CI failure read as
 * "resolved to 2 elements" rather than as a missing save. Two specs hit it
 * (`write-paths.spec.js`, `cr051-currency.spec.js`), so the step lives here rather than in each.
 *
 * Scoped to the preview's own root (`.fc-save-preview`) rather than to "the second dialog" —
 * ordering is not a contract. A DRAFT is exempt from the preview (it has no "before"), so this
 * returns quietly when none appears, which keeps it usable on the create path as well as the edit
 * path.
 */
export async function confirmSavePreview(page) {
  const preview = page.locator("[role=dialog]").filter({ has: page.locator(".fc-save-preview") });
  try {
    await preview.waitFor({ state: "visible", timeout: 5000 });
  } catch {
    return; // no preview — a draft, or a save that never opened one
  }
  await preview.getByRole("button", { name: /Save this change/i }).click();
  await expect(preview).toBeHidden();
}
