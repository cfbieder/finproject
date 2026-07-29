# CR061 — Investment holdings and market prices — PLANNED (nothing built)

Fill fin's empty securities tables from fintable's holdings snapshots, and give the app a market-price
source it has never had.

Roadmap anchor: [project-roadmap.md#cr061](../current/project-roadmap.md#cr061). **Track: v3.**
**Split out of [CR059](cr-059-fintable-api-ingestion.md) §15B+C** — that CR replaces a pipe; this one
is the reason the pipe was worth replacing.

## Why

`securities` and `quicken_price_staging` are **0 rows**. Everything downstream has been working around
that absence:

- [CR056](cr-056-investment-returns.md) had to derive investment returns from **ledger postings**
  rather than positions, and its `Unattributed` row exists because of it.
- [CR058](cr-058-quicken-valuation-anchors.md) reconstructs brokerage history from **Quicken exports**
  because nothing else knows what was held.
- [CR020](cr-020-stock-investment-module.md) has been a planning skeleton for the same reason.

`GET /accounts/{id}/holdings` returns daily snapshots — quantity, price, market value, cost basis —
for the six Fidelity accounts. `GET /prices` (public, no auth) returns US equity quotes and
split/dividend-adjusted history.

## Known constraints, to design around rather than discover

- **`cost_basis` is the position total, not per share** — a provider quirk fintable passes through.
- **No history pagination on holdings**: one call per day per account, so a backfill is slow by
  construction.
- Snapshots exist only from whenever fintable began recording — this does not recover 2019.
- Prices default to the **IEX** feed: one exchange, not the consolidated tape, cacheable up to an hour,
  and `volume` is IEX-only. Fine for valuing a position; not a quote.

## Depends on

[CR059](cr-059-fintable-api-ingestion.md) P1's adapter and, for the holdings half, its P4 cutover.
