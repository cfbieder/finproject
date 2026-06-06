**Status:** PLANNED (scoped, not started). — [anchor](../FC_NEXT_STEPS.md#cr029)

# CR029 — Fintable Sheet Pruning (bank-feed admin action)

**Created:** 2026-06-06 · **Follows:** [CR021](CR021_BANK_FEED_SERVICE.md) (bank-feed service), [CR023](CR023_POCKETSMITH_REMOVAL.md) (PS→Feeds cutover).

> **Target repo:** this CR is implemented in the **`bank-feed/` microservice** (`~/Programs/fin/bank-feed/`), which is a **separate, gitignored repo** with its own history — not the `psproject` tree. Paths below are relative to `~/Programs/fin/bank-feed/`. This CR file lives in `psproject` only as the design record.

## 1. Why

Fintable extracts bank activity into a Google Sheet (Accounts + Transactions tabs), which bank-feed reads on each sync. Fintable **appends** new transactions to the bottom of the Transactions tab and never removes old ones, so the tab grows without bound. Two ceilings make this a real problem over time:

- **Hard cap:** Google Sheets allows **10M cells** → ~**1.25M transaction rows** at 8 columns/row.
- **Soft cap (hit far sooner):** both Fintable's sync and the Sheets API `values.get` read **slow down** as the tab grows, lengthening every sync.

The key enabling fact: **the sheet is a relay buffer, not a system of record.** Every row is already mirrored, deduplicated, into Postgres `feed_transactions` (keyed on stable `external_id`, the GoCardless hash, with `UNIQUE(account_id, external_id)`), and `feed_transactions.raw` stores the **full original Raw Data JSON** of each row. Consuming apps (fin, ocme) read `/v1/transactions` from Postgres — **never the sheet**. So old sheet rows that have been synced are pure redundancy, and deleting them loses nothing.

**Decision (owner, 2026-06-06):** **Postgres-only** archival — hard-delete pruned rows; the DB mirror (incl. `raw` JSON) is the sole archive. No separate archive spreadsheet/tab.

## 2. What this delivers

A guarded **"Prune sheet…"** admin action that deletes Transactions-tab rows older than a cutoff, after proving each is already in Postgres. Surfaced in the existing admin UI next to "Sync now".

## 3. Phase 0 — Prerequisites (do FIRST, one-time)

These gate the whole CR; do not start backend work until both pass.

1. **Grant write access + scope.**
   - Re-share the Fintable Google Sheet with the bank-feed **service account email as Editor** (currently Viewer).
   - In `src/adapters/googleSheets.js`, change `SCOPES` from `https://www.googleapis.com/auth/spreadsheets.readonly` → `https://www.googleapis.com/auth/spreadsheets` (read-write). This is the service's first write scope — note the elevated blast radius in the deploy.
2. **Manual safety test — confirm Fintable tolerates external row deletion.**
   - By hand, delete a small batch of **old** rows (older than ~90 days) from the bottom-history of the Transactions tab.
   - Trigger a Fintable sync.
   - **Confirm:** Fintable does **not** re-add or duplicate the deleted rows. (Fintable's docs indicate Sheets deletions are *not* auto-restored — unlike Airtable Force Re-Sync — and that it tracks its watermark server-side; this test verifies it for our connection.)
   - **Abort criterion:** if Fintable re-appends or duplicates, stop — pruning is unsafe with this Fintable connection and the CR must be redesigned (e.g. Fintable-side sync-start-date management instead).

## 4. Backend — `POST /v1/admin/prune-sheet`

New guarded endpoint (admin-key auth, same as the other `/v1` writes).

**Params:** `before` (ISO date cutoff; default `today − N months`, **N ≥ 4** so the cutoff is safely older than the ~90-day bank transaction-history window — beyond it neither Fintable nor a future sync can re-introduce the row), `dryRun` (boolean, default `true`).

**Algorithm:**
1. **Sync first** — run `runSync({trigger:'prune'})` so Postgres is guaranteed current with the sheet before anything is deleted.
2. **Scan** the Transactions tab (reuse `readSheet`); collect data rows (never the header) whose `⚡ Date` (Excel serial → date) `< before`.
3. **Verify mirror** — for each candidate, confirm its `⚡ Transaction ID` (`external_id`) **exists in `feed_transactions`**. **Refuse to delete any row not found in the DB.** Report the unmirrored count separately.
4. **Delete** (only when `dryRun=false`) — `sheets.spreadsheets.batchUpdate` with `DeleteDimension` (ROWS) on the **Transactions tab only**, processed **bottom-up** (descending row index) so deletions don't shift the indices of not-yet-deleted rows. Batch the ranges. Never touch the header row or the Accounts tab.
5. **Audit** — write a `sync_jobs`-style row (`trigger='prune'`) recording cutoff, scanned/eligible/confirmed/deleted counts.

**Return:** `{ cutoff, scanned, eligible, confirmedInDb, unmirrored, deleted }`.

**Safety invariants:**
- Worst case is benign: if a deleted row ever reappears in a later sheet state, the existing `ON CONFLICT (account_id, external_id) DO UPDATE` upsert re-absorbs it idempotently — no duplicates.
- Transactions tab only; header row never deleted; Accounts tab never touched.
- Nothing is deleted that isn't first proven present in `feed_transactions`.

## 5. Frontend — admin UI (`src/routes/admin.js`)

The admin page is a single self-contained file (server-rendered HTML + vanilla JS, no build step). Add:
- A **"Prune sheet…"** button next to "Sync now".
- A cutoff control (months-back selector or date input; default N from §4).
- A **mandatory dry-run preview** — calls the endpoint with `dryRun=true`, shows e.g. *"Would delete 4,210 rows older than 2026-02-06 — all 4,210 confirmed in DB (0 unmirrored)."* — gating an explicit **Confirm** before the real (`dryRun=false`) call.
- If `unmirrored > 0`, **block** the real delete and tell the user to sync/investigate first.

## 6. Tests

- Converter/handler unit tests: cutoff filtering (rows on both sides of `before`), header-row exclusion, unmirrored-row refusal, bottom-up delete index ordering, dry-run writes nothing.
- Mock the Sheets `batchUpdate` client; assert `DeleteDimension` ranges are correct and descending.

## 7. Non-goals

- Archiving pruned rows anywhere outside Postgres (explicitly declined — Postgres `raw` JSON is the archive).
- Pruning the **Accounts** tab (small, bounded — not a growth problem).
- Pruning the Postgres `feed_transactions` table itself (that's the durable store; out of scope).
- Any write-back to Fintable or changes to Fintable's own sync settings.
- Automating prune on a schedule — **manual, operator-initiated only** in this CR (a cron could follow once §3.2 has held up in practice).

## 8. Risks

- **Fintable owns the sheet.** Deleting rows under a third-party sync tool is inherently "verify in your environment" — §3.2 is the gate. Docs suggest Sheets deletions are safe; the manual test confirms it.
- **Elevated scope.** Granting the service account write access widens blast radius; the endpoint's only write is scoped `DeleteDimension` on the Transactions tab, but the credential itself can now edit the sheet. Note in deploy/runbook.
- **Cutoff too recent.** A cutoff inside the ~90-day bank window risks Fintable/sync re-introducing rows; the `N ≥ 4 months` default and a server-side floor prevent this.
