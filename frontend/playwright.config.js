import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright — smoke tests over the money paths (CR043 Phase 4).
 *
 * These exist for ONE failure class: the page that renders EMPTY instead of wrong.
 *
 * Almost every bug found in the 2026-07-13 session was of that shape — a modal that showed
 * "no transfers" while the report behind it displayed the transfer; a write API that
 * dropped a field and returned 200; a list endpoint whose envelope changed and would have
 * rendered zero modules. Unit tests passed through all of it, because a unit test on a code
 * path that never receives data passes happily. Only a human clicking found them.
 *
 * So the assertions here are deliberately about VALUES, not just "the page loaded":
 * net worth is 108,500.00, the module list is non-empty, the periodic transfer appears in a
 * MIDDLE year of its range. `server/db/e2e-seed.sql` builds a world where those numbers are
 * exact and hand-checkable — because an e2e suite whose pages are legitimately blank can
 * never detect a page that is WRONGLY blank.
 *
 * The suite runs against a THROWAWAY Postgres + API (see Scripts/e2e.sh), never dev or prod.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false, // the suite writes (module save); serial keeps it deterministic
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : [["list"]],
  timeout: 30_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL: process.env.E2E_BASE_URL || "http://localhost:4173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },

  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
