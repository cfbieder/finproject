# CR061 — Investment holdings and market prices — PLANNED (statement reader built; fintable side not started)

**Built so far (2026-07-31):** `parse-fidelity-statement.js` reads holdings totals — market value,
total cost basis and **unrealized gain/loss** per account — straight out of the custodian's statement
PDFs, for all **117 account-statements** across 2016–2026. That is not the fintable holdings ingest
this CR is about, but it is the first real unrealized-G/L series fin has ever had, and it establishes
the two facts the ingest will need: the custodian's `Change in Investment Value` **cannot** measure
return (it absorbs transfers), while market value minus cost basis can. Full reasoning and the
cross-validation in [CR058 §12.8–12.9](cr-058-quicken-valuation-anchors.md). Nothing is written to
the ledger and `securities` is still 0 rows.

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
