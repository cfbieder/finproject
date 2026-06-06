# CR023 — PS → Feeds Migration Tracker

**Status:** LIVE tracker (created 2026-06-05) · companion to [CR023](CR023_POCKETSMITH_REMOVAL.md) §5 (runbook) / §6 (exit criteria).
**Purpose:** the per-account backlog for retiring PocketSmith. PS stays the live catch-all until **every active balance-sheet account** is (a) on a direct feed and reconciling, (b) moved to manual/Excel ([CR025](CR025_MANUAL_TRANSACTION_ENTRY.md)), or (c) explicitly frozen/archived. When the live "still PS-dependent" query (§4) returns empty, the CR023 §6 exit criteria hold and PS removal can be scheduled.

Dispositions below are **owner-confirmed (2026-06-05)**. Verify live state before acting (`balance-recon` monitor + the §4 query).

## 1. Cut over — DONE (24 accounts)

On a direct bank feed, reconciling to `feed_balances` (cash/card) or by-design month-end MTM (brokerage). PS-side cutoff active.

| fin id | account | feed mode | notes |
|---|---|---|---|
| 4 | PKO - USD | calibrate | |
| 12 | PKO EUR | calibrate | |
| 14 | Caixa EUR | calibrate | first EUR (Caixa) feed |
| 18 | PKO | calibrate | |
| 19 | PKO Savings | calibrate | |
| 67 | PKO VISA Infinity CB | calibrate | |
| 69 | PKO VISA Infinity KB | calibrate | |
| 62 | LUXURY CARD | calibrate | first Plaid/US card; `feed_sign=+1` (see §10.4) |
| 63 | Hilton Honors Aspire | calibrate | Amex via Fintable; `feed_sign=+1` (cut over 2026-06-05) |
| 61 | Bonvoy Amex (Marriott Bonvoy Brilliant) | calibrate | Amex via Fintable; `feed_sign=+1` (2026-06-05) |
| 64 | Delta SkyMiles Reserve | calibrate | Amex via Fintable; `feed_sign=+1` (2026-06-05) |
| 13 | WISE - EUR | calibrate | Wise via Fintable (asset, no `feed_sign`); PS stopped (2026-06-05) |
| 8 | Wise - USD | calibrate | Wise via Fintable (asset); PS stopped (2026-06-05) |
| 20 | WISE - PLN | calibrate | Wise via Fintable (asset, balance 0); PS stopped (2026-06-05) |
| 26 | Fidelity IRA | mtm | |
| 27 | Fidelity Stocks | mtm | |
| 28 | Fidelity Options | mtm (`trade_treatment=income`) | |
| 30 | Fidelity Cash Mgt | calibrate | cash hub |
| 31 | Fidelity Bond | mtm | basis-anchored |
| 6 | Chase Checking | calibrate | US bank (asset); cut over 2026-06-06 (cutoff 2026-06-02) |
| 7 | Chase Saving | calibrate | US bank (asset); cut over 2026-06-06 (cutoff 2026-05-12) |
| 60 | Amazon Visa | calibrate | Chase card; `feed_negate_tx=TRUE` (Chase reports purchases positive), `feed_sign` default; cutoff 2026-06-03. Import pending (owner "Import now") |
| 59 | Marriot Visa | calibrate | Chase card; `feed_negate_tx=TRUE`, `feed_sign` default; cutoff 2026-05-19. Reconciles to −266.25 once the 2026-06-04 payment is imported (drift = that one unpromoted tx; no calibrate needed). Cut over 2026-06-06 after the converter shared-name fix (Marriott/Prime both labelled "CREDIT CARD") |
| 22 | Santandar | calibrate | mapped+non-ignored — fed since last tracker update (cut over outside this thread); §3 still lists it as manual/CR025 — **verify disposition** |

## 2. Active PS-residual — needs migration (the real backlog)

Non-fed accounts with recent PS transaction activity. These currently depend on PS for new data.

| fin id | account | type | cur | balance | last PS | disposition (confirmed) |
|---|---|---|---|---|---|---|
| 45 | OCME Sp. z o.o. | asset | PLN | 131,500 | 2026-05-26 | **manual/CR025** (loan receivable; also offset-fed from PKO transfers). No feed, no cutoff. |
| 10 | Capital One Savings | asset | USD | 10,257 | 2026-05-31 | **add to Fintable → feed** |
| 16 | Revolut-EUR | asset | EUR | 33 | 2026-05-23 | **try feed; manual/CR025 if not reachable** |
| 41 | SP - Panorama Mar 6 | asset | EUR | 421,992 | 2026-05-25 | **manual/CR025 periodic valuation** (see §3) |

**Owner-confirmed plan (2026-06-05):** the **8 US accounts** (5 cards + Chase ×2 + Capital One) → **add to Fintable, feed path** (proven by the Luxury card 62). **Fintable DOES support Amex** — the 3 Amex cards (Hilton 63, Bonvoy 61, Delta 64) cut over 2026-06-05 (all `feed_sign=+1`, reconciled to the cent; PS deactivated for them). **Chase ×2 (6/7) + both Chase cards cut over 2026-06-06:** Amazon Visa (60) and Marriot Visa (59) use `feed_negate_tx=TRUE` (Chase reports purchases positive) with `feed_sign` left at the liability default (−1) — **not** `feed_sign=+1` as originally planned here; the negate-tx mechanism (migration 030) superseded the feed_sign approach for Chase. Marriot needed the bank-feed converter shared-name fix first (Marriott/Prime both labelled "CREDIT CARD" on Fintable collided 32 tx onto Prime). **Remaining US:** Capital One (10) only. **Wise ×3 (EUR/USD/PLN) cut over via Fintable 2026-06-05** (assets, no `feed_sign`; PLN reconciled, EUR/USD small recent-activity drift clearing on next Import; PS stopped). **Revolut-EUR** → best-effort feed, manual/CR025 fallback. Each fed account follows the [CR023 §5](CR023_POCKETSMITH_REMOVAL.md) runbook (map → `feed_sign` if US card → `seed-bankfeed-cutoffs.js` → gate on `balance-recon`).

## 3. Dormant holdings — periodic valuation (no streaming feed possible)

Carry balances but no transactional activity since 2026-05; illiquid funds / property / inter-company. Never streaming-fed; PS only held occasional manual valuation entries. **Disposition: manual/Excel periodic update via CR025.** Do **not** block the "active data" exit but need a non-PS update path.

**Confirmed (2026-06-05): manual/CR025 periodic for all below** (+ SP-Panorama 41 from §2):

`21 PKO-Deposits (600k)`, `209 PKO TFI (400k PLN)`, `33 CVC Fund VIII (566k EUR)`, `34 CVC Fund IX (156k EUR)`, `43 United Beverages (27.6M PLN)`, `44 Barkeria (3.9M PLN)`, `47 PL-Niemena (4.3M PLN)`, `48 PL-Muszlowa (165k)`, `36 US-Nokomis (340k)`, `37 US-Casarina (920k)`, `53 Tax Reserve US (−35k)`, `22 Santander (5.2k)`, `50 Misc Investments (1.4k)`, `24 WISE-GBP (3.68)`, `41 SP-Panorama (422k EUR)`.

## 4. Live exit-monitor (run against prod :5433)

**Reusable script:** `server/src/v2/scripts/ps-exit-monitor.js` (read-only; `--days N` window, `--json`). Prints fed count + the still-PS-dependent list + an EXIT-GATE-MET/NOT-MET verdict. Run from host against prod: `DATABASE_URL=<prod> node server/src/v2/scripts/ps-exit-monitor.js`. As of 2026-06-05 (after Luxury + 3 Amex + 3 Wise): **19 fed, 8 PS-dependent**. As of **2026-06-06** (after Chase ×2 + both Chase cards 59/60 + Santandar 22): **24 fed, 4 PS-dependent** (Capital One 10, OCME 45, SP-Panorama 41, Revolut-EUR 16).

The underlying query — "still PS-dependent" = non-fed, non-ignored account with PS rows in the window. When it returns **zero rows**, CR023 §6 criteria #2/#3 hold for the active set.

```sql
WITH fed AS (
  SELECT account_id FROM account_source_mappings
  WHERE source='bank-feed' AND ignored=false AND account_id IS NOT NULL
)
SELECT a.id, a.name, a.account_type,
       MAX(t.transaction_date) AS last_ps,
       COUNT(*) FILTER (WHERE t.transaction_date >= CURRENT_DATE - 45) AS ps_last_45d
FROM transactions t
JOIN accounts a ON a.id = t.account_id
WHERE t.source='pocketsmith'
  AND a.section='balance_sheet'
  AND a.id NOT IN (SELECT account_id FROM fed)
GROUP BY a.id, a.name, a.account_type
HAVING COUNT(*) FILTER (WHERE t.transaction_date >= CURRENT_DATE - 45) > 0
ORDER BY last_ps DESC;
```

As of 2026-06-06 this returns **4 accounts** (Capital One 10, OCME 45, SP-Panorama 41, Revolut-EUR 16). The exit gate is met when every row here is either fed (leaves the list) or the owner has switched it to manual (PS rows stop arriving, so it ages out of the 45-day window).

## 5. Exit-criteria status (CR023 §6)

1. Every active account fed+reconciling / manual / frozen — **in progress** (24 fed; §2 backlog down to Capital One 10; depends on CR025 shipping for the manual accounts incl. 45).
2. No active account depends on PS for new data — **not yet** (§4 query non-empty).
3. Source-partitioned PS-rec list empty — **shrinking** (depopulates as §2 accounts migrate).

**Hard dependency:** CR025 (manual entry) must ship before the manual-bucket accounts (45 + §3 holdings + any §2 that go manual) can leave PS. PS removal execution stays deferred until §4 is empty.
