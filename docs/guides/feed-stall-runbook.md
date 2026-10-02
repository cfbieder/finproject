# Runbook — no new feed transactions

**Symptom:** the morning review queue is empty when it normally has a batch, or Home shows
**"bank-feed has not synced for Nh — no new transactions are arriving"** (since v3.70.0).

**Written after 2026-10-01/02**, when bank-feed rolled back every sync for ~30 hours and fin's Home
strip read *"all clear"* throughout. Nothing here needs code; it needs the steps in order.

---

## 1. Locate the break — three layers, check them top-down

The path is **Fintable → bank-feed (:3007) → fin staging → fin review queue**. Each layer has its
own clock; find the first one that stopped.

| # | Question | Command | Healthy |
|---|---|---|---|
| a | Did fin's 06:00 pull run, and did it get anything? | `tail -5 logs/refresh-bank-feed.log` | `OK … new=N` with N > 0 on a weekday |
| b | Is bank-feed syncing? | `docker logs --since 6h bank-feed-app 2>&1 \| grep -E "\[sync [0-9]+\] (done\|FAILED)" \| tail` | `done` every hour |
| c | Why not? | `curl -s localhost:3005/api/v2/bank-feed/health/feeds` → `service.most_recent_error`, `…_at` | no error newer than the last success |
| d | Is a bank's consent dead? | Home strip **"needs re-authorising"**, or `curl -s localhost:3005/api/v2/util/attention-summary` → `needsReconnect` | 0 |

- **(a) shows `new=0` and (b) shows `FAILED`** → bank-feed is the break. Go to §2.
- **(a) `new=0`, (b) `done`** → bank-feed has nothing new either: check (d), then Fintable itself
  (Bank Feed Setup → connections, `days_since_new_data`). A quiet weekend also looks like this.
- **(a) `new>0`** but the queue is empty → nothing is broken; promotion is manual. Press
  **Refresh Feed Data** on Refresh Feeds.
- **(a) missing today's line** → the cron did not run (`crontab -l`; host up?).

⚠️ **fin's "stale feeds" count does not cover this.** It reads each bank's sync time *as Fintable
reports it*, which stays fresh while bank-feed refuses every batch. The `feedService` pill (§1c's
data) is the one that does.

## 2. bank-feed is failing — read the error, then match it

| Error contains | Meaning | Go to |
|---|---|---|
| `insert guard: N new transactions of M fetched exceeds L` | More rows are new than the guard allows. Either a **busy day** (month-end, a day of backlog) or **Fintable re-minted ids** — the duplicate-everything failure the guard exists for | §3 |
| `429` / `rate` | Fintable is rate-limiting | wait an hour; the scheduler retries |
| `ECONNREFUSED` / pool / `db` | bank-feed lost its database (e.g. `bank-feed-db` restarted) | `docker restart bank-feed-app`, then §4 |
| `needs_reconnect` / consent | a bank's PSD2 consent expired | Bank Feed Setup → **Re-authorise** |

A failed sync **does not advance** bank-feed's high-water mark, so each retry re-fetches everything
since the last success. A guard trip therefore **never clears by itself** — the backlog only grows.

## 3. Insert guard tripped — prove which case before forcing anything

Run the read-only replay. It repeats one sync inside a transaction it always rolls back and reports,
for every row the sync would insert, whether bank-feed already holds a **same-value twin** (same
account, same amount, date ±3) under a different id:

```bash
docker cp Scripts/bank-feed-guard-replay.js bank-feed-app:/tmp/replay.js
docker exec -w /app bank-feed-app node /tmp/replay.js
docker exec bank-feed-app rm -f /tmp/replay.js
```

- **`VERDICT: no twins`** → genuine new activity. Unblock with ONE sync at a higher ratio — this sets
  the ratio for that process only; the running service is untouched:
  ```bash
  docker exec -w /app -e FINTABLE_API_MAX_INSERT_RATIO=0.5 bank-feed-app node -e "
  require('/app/src/services/fintableSync').requestSync({trigger:'manual',force:true})
    .then(r=>{console.log(r.status, JSON.stringify((r.summary||r).transactions));process.exit(0)})
    .catch(e=>{console.error(e.message);process.exit(1)})"
  ```
  Expect `succeeded` and `inserted` ≈ the replay's count. Run it between the scheduler's hourly ticks
  (`docker logs --timestamps bank-feed-app | grep fetching | tail -2`). Inserts are keyed on
  `(account_id, external_id)`, so an overlap cannot duplicate.
- **`VERDICT: N twin(s)`** → **stop.** Do not raise the limit — that is exactly what turns duplicates
  loose on fin. This is the [CR059 §22](../cr/cr-059-fintable-api-ingestion.md) id-re-mint shape; take it
  to bank-feed (its `HANDOFFS.md`) with the replay output.

Measured 2026-10-02: **79 would insert, 0 twins**, dated 09-30 (54) · 10-01 (24) · 10-02 (1) — month-end
posting volume on an incremental batch of only 261 rows, against a 25% ratio sized for ~905-row sweeps.

**Settings** (bank-feed, read from its `.env` over `docker-compose.yml` defaults): `FINTABLE_API_MAX_INSERT_RATIO`
(0.25), `FINTABLE_API_MIN_INSERT_FLOOR` (**100** in `.env` since 2026-10-02; compose default 25),
`FINTABLE_API_MAX_INSERTS` (300). A change needs `docker compose up -d --no-deps app` in `bank-feed/`.
The precise fix — trip on value-twins instead of a ratio — is requested in bank-feed's `HANDOFFS.md`
(2026-10-02).

## 4. Pull it through to fin

```bash
BASE_URL=http://localhost:3005 ./Scripts/refresh-bank-feed.sh   # stages; same as the 06:00 cron
```

Expect `new=N`. Then Refresh Feeds → **Refresh Feed Data** promotes the staged rows into
*Review & Edit New*.

⚠️ **Until they are accepted, fed accounts show drift** — bank-feed's balances are already current
while the ledger lacks the transactions behind them (2026-10-02: fed drift 1 → 9). Do not reconcile
anything before the queue is cleared; re-check drift after.

## 5. After

- Confirm the next scheduled sync: `docker logs --since 2h bank-feed-app | grep -E "done|FAILED"`.
- Home's `feedService` pill clears on its own once a sync succeeds.
- If you changed a bank-feed setting, record it in `bank-feed/HANDOFFS.md` (newest entry at the top,
  *below* the format example) — commit it in the bank-feed repo, from a worktree outside `psproject/`.
