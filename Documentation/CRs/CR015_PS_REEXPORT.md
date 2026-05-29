**Status:** OBSOLETE 2026-05-28 — [Plan](../FC_NEXT_STEPS.md#cr015)

> **Obsolete.** PocketSmith is being removed entirely via [CR021](CR021_BANK_FEED_SERVICE.md), so there is no longer a PS instance to re-export to.

# CR015 — Re-export Changes Back to PocketSmith

Today, the app pulls from PocketSmith and lets users edit categorisation / amounts / dates locally. Those edits never propagate back to PocketSmith. This CR adds a one-way push so PocketSmith stays in sync with our authoritative ledger.

## Scope

- Push transaction edits (category, description, date, amount changes flagged via `accepted=true`) to PocketSmith via the v2 API (`PUT /transactions/:id`).
- Decide policy on which fields are user-canonical vs PocketSmith-canonical (likely: category + description + date are ours, amount/currency are theirs).
- Idempotency: track `last_pushed_at` per transaction or use ETags so we don't re-push unchanged rows.
- Failure handling: surface push errors in the UI; queue retries.

## Open questions

- Bulk push vs per-edit push? Bulk likely cheaper given PocketSmith rate limits.
- Conflict policy when PS has changed the row server-side since last fetch.

## Acceptance criteria

- A transaction edited locally appears with the same data when fetched fresh from PocketSmith.
- A failed push doesn't lose user data; user gets a clear error and can retry.

## Related

CR014 (PocketSmith Replacement) may obsolete this CR if we move off PocketSmith entirely. Coordinate priority.
