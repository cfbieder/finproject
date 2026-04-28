**Status:** COMPLETED — [Plan](../NEXT_STEPS.md#cr012)

# CR012 — Opening Balance Calibration

Accurate balance sheet via `opening_balance + SUM(transactions)` instead of relying on PocketSmith's stale `closing_balance`. Lets the app derive balances at any point in time and stay correct after edits.

## Outcome

- Migration 016 adds `opening_balance`, `opening_balance_date`, `last_calibrated_at`, `ps_transaction_account_id` to `accounts`.
- API:
  - `POST /api/v2/accounts/map-ps-accounts` — maps PocketSmith transaction account IDs.
  - `POST /api/v2/accounts/calibrate` — back-calculates opening balances using PocketSmith API `current_balance` as authoritative anchor; falls back to `closing_balance` for unmapped accounts.
  - `GET /api/v2/accounts/calibration-status` — calculated vs PS comparison.
- Frontend: Balance Calibration page at `/balance-calibration` (moved from Settings to Transactions category).
- 16 integration tests covering calibration logic, balance calculation at multiple dates, recalibration after data changes, and edge cases.

## Key references

- Migration: `016_opening_balance.sql`.
- Routes: `server/src/v2/routes/accounts.js`.
- Tests: `server/src/v2/routes/__tests__/calibration.test.js`.
- Frontend: `frontend/src/pages/BalanceCalibration.jsx`, REST helpers in `rest.js`.
