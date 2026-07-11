**Status:** RELEASED v3.0.11 (2026-06-06). — [anchor](../current/project-roadmap.md#cr030)

# CR030 — Retire automated PocketSmith (keep one-time CSV upload)

**Created:** 2026-06-06 · **Follows:** [CR023](cr-023-pocketsmith-removal.md) (PS→Feeds cutover — feed side complete, 28 fed / 2 manual).

> Owner directive (2026-06-06): with every feed-able account on a direct bank feed, retire the **automated** PocketSmith integration **safely**, but **keep the one-time PS CSV upload** for a later release (occasional historical imports). Historical `source='pocketsmith'` data stays **frozen — never deleted**.

## 1. Scope

**Removed — automated PS API + legacy PS calibration:**

| Layer | Item |
|---|---|
| Services | `server/src/v2/services/refreshPsApiV2.js` (PS API txn fetch), `server/src/services/retrieval/pocketsmith.js` (PS API SDK), `server/src/services/retrieval/psdataConverter.js` (API-shaped converter, only used by the above) |
| Routes (`ingestPs.js`) | `POST /api/v2/ingest-ps/refresh-ps` + its only-caller helper `computeRefreshReviewBreakdown` |
| Routes (`accounts.js`) | `POST /map-ps-accounts`, `POST /calibrate`, `GET /calibration-status` + the PS SDK import / `PS_API_KEY` auth |
| Frontend | `RefreshPS.jsx` — dropped the **Refresh PS Data** button + handler and the **Accept PS** button (kept Refresh Feed Data + review/accept); `BalanceCalibration.jsx` — dropped the **PocketSmith calibration (legacy)** section (Map PS Accounts / Load Status / Calibrate All), kept the bank-reconciliation table; `rest.js` — `mapPsAccounts`/`calibrateAccounts`/`fetchCalibrationStatus`; mobile `MobileRefreshPS.jsx` + `/m/refresh-ps` route + redirect + home tile |
| Tests | `routes/__tests__/calibration.test.js` (tested the removed `/calibrate`) |

**Kept — one-time CSV upload + history (owner ask):**
- `UploadPS.jsx` + routes `/upload-ps`, `/analyze-ps`, `/clearall`, `/psdata/count`, `/psdata/options`, `/sync-to-transactions`
- `psCsvIngestorV2.js`, `repositories/psdata.js`, `bankfeed_staging`/`psdata_staging`
- All historical `source='pocketsmith'` transactions (frozen)
- The `pocketsmith` source-mapping (account↔PS-name) used by CSV-upload matching

## 2. Why it's safe

- **No PS cron** exists — automated PS was manual-button-only, so nothing scheduled breaks.
- `RefreshPS.jsx` and `BalanceCalibration.jsx` are **shared** with live bank-feed features — edits were surgical (button/handler removals), bank-feed refresh + the reconciliation table (incl. the per-feed filter) untouched. `vite build` passes.
- The legacy `/calibrate` is superseded by bank-feed `reconcileToFeed` (the "Reconcile to feed" action), already the live model.
- Backend: no remaining requirers of the deleted modules (verified); server suite has no new failures from this change (pre-existing dev-DB integration failures are unrelated).

## 3. Follow-ups (later release)

- The one-time PS CSV **upload page stays**; a future CR (per CR027-E "legacy retirement") may move it under a "Migrate-once" data-source IA and/or remove it once no further historical imports are needed.
- `PS_API_KEY` / `PS_USER_ID` env vars are now unused by code; can be dropped from compose/.env at a convenient time (left in place to avoid touching deploy config in this CR).
- Exit gate: OCME 45 + SP-Panorama 41 (manual/CR025) age out of the 45-day PS-dependency window; then the CR023 §6 exit criteria fully hold.
