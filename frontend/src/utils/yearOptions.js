/**
 * Single source of truth for the earliest year selectable when viewing ACTUALS.
 *
 * Historical imports (e.g. the Quicken backfill, CR019) reach back ~20 years, so
 * every period selector that views actual transactions/balances must be able to
 * reach the imported history. Budget/forecast selectors are forward-scoped and
 * intentionally do NOT use this floor.
 */
export const EARLIEST_ACTUAL_YEAR = 2000;
