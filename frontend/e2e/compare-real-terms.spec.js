import { test, expect } from "@playwright/test";

/**
 * CR079 increment 3 — the real-terms toggle on Compare, checked in a browser.
 *
 * Compare converts at ONE choke point (matA and matB, before `compareMatrices`), so the
 * partial-deflation risk the Review carried is structurally smaller here. What a browser still
 * has to prove is that the choke point is actually ON the path the page renders from — the
 * FCReview.css episode was a change that every unit test and one e2e spec passed while the file
 * it added was never loaded at all.
 *
 * KNOWN LIMIT, stated rather than papered over: `e2e-seed.sql` carries a single scenario, so this
 * runs with A === B, where every delta is zero and zero deflates to zero. The DELTA path is
 * therefore covered by unit test (`fcCompareRealTerms.test.js` pins deflate-then-compare against
 * compare-then-deflate) and not here. What this does cover is the A/B value path — the KPI cards
 * and the table cells in "B" mode — which is where a mis-wired toggle would show up.
 */
test.describe("CR079 — Compare in today's money", () => {
  test("the toggle deflates the A/B values and declares its basis", async ({ page }) => {
    await page.goto("/forecast-review");
    await page.locator("#fc-review-scenario").selectOption({ label: "E2E Scenario" });
    // Compare diffs two /entries payloads, so an ungenerated scenario has nothing to deflate.
    await page.getByRole("button", { name: /^generate/i }).click();
    await expect(page.getByText("Brokerage").first()).toBeVisible({ timeout: 25_000 });

    await page.goto("/forecast-compare");

    // "Δ (B − A)" is every-zero with one generated scenario; the B column carries the figures.
    // `exact` matters: without it "B" also matches the "Δ (B − A)" tab.
    await page.getByRole("tab", { name: "B", exact: true }).click();

    // The default baseline is "Base Case", which exists in the scenarios table but carries no
    // PeriodStart in the assumptions doc — so there is no base year to anchor on and no honest
    // deflator to build. DISABLED rather than absent, and asserted here because it is the path a
    // real half-configured scenario takes.
    const toggle = page.getByRole("checkbox", { name: /Show in .* dollars/i });
    await expect(toggle).toBeVisible();
    await expect(toggle).toBeDisabled();

    await page.locator("#fc-compare-a").selectOption({ label: "E2E Scenario" });
    await expect(toggle).toBeEnabled();   // both sides now declare a period and 2% inflation

    const anyAmount = page.locator("table td").filter({ hasText: /[\d,]{4,}/ }).first();
    await expect(anyAmount).toBeVisible();
    const before = await anyAmount.innerText();

    await toggle.check();

    // The basis sits WITH the numbers. On this page the figures are what get screenshotted into
    // a decision, and a deflated delta looks exactly like a nominal one.
    await expect(page.getByText(/is in .*dollars/i).first()).toBeVisible();

    const after = await anyAmount.innerText();
    expect(after).not.toBe(before);

    await toggle.uncheck();
    await expect(page.getByText(/is in .*dollars/i)).toHaveCount(0);
    expect(await anyAmount.innerText()).toBe(before);
  });
});
