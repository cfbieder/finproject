**Status:** COMPLETED — [Plan](../FC_NEXT_STEPS.md#cr009)

# CR009 — Transfer Analysis + Manual Match Groups + transfer_matched Flag

Match transfer debit/credit pairs by amount within a date tolerance. Persistent many-to-one manual match groups for cases like one lump credit matching multiple split debits. `transfer_matched` flag on transactions enables a Transfer Status filter on the Actuals page.

## Outcome

- New page: `/transfer-analysis` (`TransferAnalysis.jsx`).
- Standard categories: exact base_amount match (within $0.01), configurable date tolerance (default 5 days).
- FX category: 1% base_amount tolerance, 1-day date window — recognizes both `Transfer - FX` and legacy `FX` names.
- New tables: `transfer_match_groups`, `transfer_match_group_members` (migration 005).
- New API: `POST/GET/DELETE /api/v2/transfer-match-groups`.
- Manually matched transactions excluded from auto-matching algorithm.
- Sticky action bar on selection: count, net base amount (green when zero), Link as Matched, Clear.
- `transfer_matched` boolean column added to transactions (migration 006, partial index). Persisted as side effect when Transfer Analysis runs (true for auto-matched + manual groups, false for unmatched).
- Click-to-change transfer type modal: matched pairs update both transactions, unmatched updates only the clicked one, manual groups update all members.
- Transfer Status filter (All / Matched / Unmatched) added to Actuals page filter panel.

## Key references

- Migrations: `005_transfer_match_groups.sql`, `006_transfer_matched_flag.sql`.
- Repository / route: `server/src/v2/repositories/transferMatchGroups.js`, `server/src/v2/routes/transferMatchGroups.js`.
- Endpoint: `GET /api/v2/transactions/transfer-analysis` (in `routes/transactions.js`).
- Frontend: `frontend/src/pages/TransferAnalysis.jsx`.
