import { test, expect } from "@playwright/test";

/**
 * A modal opened from INSIDE another modal must still take clicks.
 *
 * The failure this pins is invisible to every other kind of test: "View Output" in the
 * module editor rendered its panel on top, fully drawn, with correct data — and nothing in
 * it worked, not even its own ✕. The editor is a Radix dialog; a modal Radix layer sets
 * `pointer-events: none` on <body> and re-enables it only on the layers it owns, so a
 * hand-rolled overlay rendered beside it inherits `none`. It looks open and behaves like a
 * frozen page, with no error anywhere: the DOM is right, the React state is right, the
 * handlers are attached, and the browser simply never delivers the click.
 *
 * Unit tests cannot see it (jsdom has no hit-testing, and RTL fires events on the node
 * directly), so a browser that refuses to click is the only witness. Playwright's
 * actionability check IS the assertion here — against the unfixed component the click on ✕
 * times out.
 */

const SCENARIO = "E2E Scenario";

test("the module output panel opened from the editor can be closed (nested-dialog pointer-events)", async ({
  page,
}) => {
  await page.goto("/forecast-modules");
  const scenario = page.locator("#fc-scenario-select");
  await scenario.waitFor({ state: "visible" });
  await scenario.selectOption({ label: SCENARIO });

  await page.getByText("E2E Brokerage").first().waitFor();
  await page.getByText("E2E Brokerage").first().click();
  await page.getByRole("button", { name: /Edit/ }).click();

  const editor = page.locator("[role=dialog]").first();
  await expect(editor).toBeVisible();

  await editor.getByRole("button", { name: /View Output/i }).click();

  // Located by TEXT and by CSS on purpose. Role-based locators read the accessibility tree,
  // and the unfixed panel is missing from it entirely — Radix marks everything outside its
  // own dialog `aria-hidden`, so the panel was invisible to assistive tech as well as dead
  // to the mouse. Asserting through roles would fail here for the wrong reason and hide the
  // one that matters: the click below simply never lands.
  const heading = page.getByText("Module Output — E2E Brokerage");
  await expect(heading).toBeVisible();

  await page.locator('button[aria-label="Close module output"]').click();

  await expect(heading).toBeHidden();
  // The editor underneath survives — closing the child must not take its parent with it.
  await expect(editor).toBeVisible();
});
