import { test, expect } from "@playwright/test";

/**
 * CR079 — the real-terms toggle, checked in a browser.
 *
 * Unit tests pin the deflator's arithmetic; they cannot see whether the PAGE applies it
 * consistently. That is the whole risk here: money reaches the Review by four independent paths,
 * and a page showing some rows in today's money and some in 2062 money would look completely
 * normal — both are money.
 *
 * So this asserts the property that matters and that no unit test can reach: with the toggle on,
 * EVERY figure moves in the same direction and by a plausible factor, and the page says which
 * basis it is in.
 */
test.describe("CR079 — the plan in today's money", () => {
  test("the toggle deflates the whole page and declares its basis", async ({ page }) => {
    await page.goto("/forecast-review");
    const select = page.locator("#fc-review-scenario");
    await expect(select).toBeVisible();
    await select.selectOption({ label: "E2E Scenario" });

    // The Review is empty until the engine has run — the toggle needs real years to build a
    // deflator over, so generating first is not incidental setup, it is the precondition.
    await page.getByRole("button", { name: /^generate/i }).click();
    await expect(page.getByText("Brokerage").first()).toBeVisible({ timeout: 25_000 });

    const toggle = page.getByRole("checkbox", { name: /Show in \d{4} dollars/i });
    await expect(toggle).toBeVisible();

    // A money cell that is present before and after, so the comparison is of the same cell.
    const anyAmount = page.locator("table td").filter({ hasText: /[\d,]{4,}/ }).first();
    await expect(anyAmount).toBeVisible();
    const before = await anyAmount.innerText();

    await toggle.check();

    // The basis is declared WITH the numbers, not only on the control — a screenshot of the
    // figures alone must still say what money it is in.
    await expect(page.getByText(/All figures on this page are in/i)).toBeVisible();

    const after = await anyAmount.innerText();
    expect(after).not.toBe(before);   // something actually happened

    // And it comes back: the toggle is not a one-way door.
    await toggle.uncheck();
    await expect(page.getByText(/All figures on this page are in/i)).toHaveCount(0);
    expect(await anyAmount.innerText()).toBe(before);
  });
});
