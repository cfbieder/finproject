**Status:** COMPLETED — [Plan](../FC_NEXT_STEPS.md#cr004)

# CR004 — FC Inc/Exp Mapping Layer (Phase 2B FC Lines)

Introduced user-defined Forecast Lines that decouple budget categories from forecast outputs. Mapping page lets users define FC Lines, assign budget categories via drag/drop, and set line types (BS Module Expense/Income, Forecast Expense/Income).

## Outcome

- New tables: `fc_lines`, `fc_line_categories` (migration 007).
- New page: `/forecast-mapping` (FCLineMapping).
- Forecast Review P&L is now driven by FC Line names (`/api/v2/fc-lines/review-structure`) instead of the COA tree.
- "Generate Suggestions" populates FC Lines from P&L parent accounts not yet covered.
- Coverage indicator on the mapping page shows assignment completeness.

## Key references

- Migration: `server/db/migrations/007_fc_lines.sql`
- Repository: `server/src/v2/repositories/fcLines.js`
- Routes: `server/src/v2/routes/fcLines.js`
- Frontend: `frontend/src/pages/FCLineMapping.jsx`

## Engine integration

Engine now resolves `expense_fc_line_id` / `income_fc_line_id` and writes entries with FC Line names. See CR003 for full engine work.
