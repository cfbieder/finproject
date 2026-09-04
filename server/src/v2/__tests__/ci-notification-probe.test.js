'use strict';
/**
 * ci-notification-probe.test.js — TEMPORARY. NEVER MERGE.
 *
 * Fails on purpose, on a throwaway branch, to prove that GitHub's
 * "Actions -> Email -> Only notify for failed workflows" setting actually
 * delivers. There is no API for notification preferences, so making it fire is
 * the only way to know. Roadmap known issue #12: five red `main` runs went
 * unnoticed for days, and the repo turned out to have ZERO watchers.
 *
 * Delete this branch once the email is confirmed.
 */

describe('CI failure notification probe', () => {
  it('fails deliberately so the owner finds out by email, not by looking', () => {
    expect('did the email arrive?').toBe('yes — delete this branch');
  });
});
