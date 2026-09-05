# CR093 — fund classification sheet (28 funds)

**For the owner to correct.** Change the `Proposed` column where I have it wrong; anything you
leave stands. This is the single highest-value item in CR093 — it decides **$566,716, 14.6% of the
portfolio** — and no market-data vendor could answer it: Tradier returns `null` asset class for
every fund tested.

| # | Ticker | Value | Stored now | **Proposed** | Why |
|---|---|---|---|---|---|
| 1 | `FLDR` | $533,703 | `equity` | **`bond`** (**CHANGE**) | 🔴 Short-duration BOND factor ETF. Largest holding in the portfolio. |
| 2 | `DIA` | $194,943 | `equity` | **`equity`** (unchanged) | Dow 30. Held in TWO accounts. |
| 3 | `QQQ` | $162,573 | `equity` | **`equity`** (unchanged) | Nasdaq-100. |
| 4 | `FCNTX` | $149,751 | `mutual_fund` | **`mutual_fund`** (unchanged) | Open-end fund — no intraday market, so no quote and no chart. Already classed mutual_fund. |
| 5 | `SPY` | $96,646 | `equity` | **`equity`** (unchanged) | S&P 500. |
| 6 | `TQQQ` | $60,638 | `equity` | **`equity`** (unchanged) | ⚠️ 3x LEVERAGED Nasdaq-100. Same sector shape as QQQ, very different risk — worth its own flag beyond asset class. |
| 7 | `SPYD` | $59,844 | `equity` | **`equity`** (unchanged) | S&P 500 high dividend. |
| 8 | `FBCG` | $39,446 | `equity` | **`equity`** (unchanged) | Blue-chip growth. |
| 9 | `JEPI` | $34,458 | `equity` | **`equity`** (unchanged) | ⚠️ Covered-call income strategy — equity exposure with an option overlay. |
| 10 | `SPHD` | $31,614 | `equity` | **`equity`** (unchanged) | S&P 500 high dividend / low volatility. |
| 11 | `SCHD` | $26,310 | `equity` | **`equity`** (unchanged) | US dividend equity. |
| 12 | `XLE` | $25,848 | `equity` | **`equity`** (unchanged) | ✅ SINGLE-SECTOR — 100% Energy. No API lookup needed. |
| 13 | `SPLV` | $23,573 | `equity` | **`equity`** (unchanged) | S&P 500 low volatility. |
| 14 | `TDIV` | $23,168 | `equity` | **`equity`** (unchanged) | ✅ SINGLE-SECTOR — Nasdaq technology dividend. Effectively 100% Technology. |
| 15 | `EOS` | $21,986 | `equity` | **`equity`** (unchanged) | ⚠️ Closed-end covered-call fund. CEF — premium/discount to NAV. |
| 16 | `BDJ` | $18,391 | `equity` | **`equity`** (unchanged) | ⚠️ Closed-end enhanced dividend fund. CEF — premium/discount to NAV. |
| 17 | `HYG` | $17,822 | `equity` | **`bond`** (**CHANGE**) | 🔴 High-yield CORPORATE BOND ETF. |
| 18 | `DVY` | $16,497 | `equity` | **`equity`** (unchanged) | US select dividend. |
| 19 | `IDV` | $15,293 | `equity` | **`equity`** (unchanged) | International select dividend — non-US. |
| 20 | `IXUS` | $13,963 | `equity` | **`equity`** (unchanged) | Total international ex-US. |
| 21 | `FUTY` | $13,883 | `equity` | **`equity`** (unchanged) | ✅ SINGLE-SECTOR — 100% Utilities. No API lookup needed. |
| 22 | `DLN` | $13,801 | `equity` | **`equity`** (unchanged) | US large-cap dividend. |
| 23 | `DGRW` | $12,624 | `equity` | **`equity`** (unchanged) | US quality dividend growth. |
| 24 | `FDD` | $11,524 | `equity` | **`equity`** (unchanged) | European select dividend — non-US. |
| 25 | `DES` | $10,739 | `equity` | **`equity`** (unchanged) | US small-cap dividend. |
| 26 | `NVG` | $9,560 | `equity` | **`bond`** (**CHANGE**) | 🔴 Municipal bond closed-end fund. ⚠️ CEF — can trade at a premium/discount to NAV. |
| 27 | `KBWD` | $8,484 | `equity` | **`equity`** (unchanged) | ✅ SINGLE-SECTOR — KBW high-dividend FINANCIALS. No API lookup needed. |
| 28 | `AGG` | $5,631 | `equity` | **`bond`** (**CHANGE**) | 🔴 Core US aggregate BOND ETF. |

**28 funds, $1,652,713.** Proposed changes: **4**, moving **$566,716** from equity to bond.

## Four funds need no sector lookup at all

`XLE` Energy · `FUTY` Utilities · `TDIV` Technology · `KBWD` Financials — single-sector by
construction, so their weights are known without any API. That is 4 of 28 the provider never has to
answer for.

## Three flags that are not asset class, and matter anyway

- **`TQQQ` is 3x leveraged.** Its sector shape is QQQ's; its risk is not. A sector chart treating
  $60,638 of TQQQ as ordinary Nasdaq exposure understates it threefold.
- **`JEPI`, `EOS`, `BDJ` are covered-call / option-income strategies.** Equity exposure with an
  option overlay — the income is written premium, not dividends, which matters for CR093 P3.
- **`NVG`, `EOS`, `BDJ` are closed-end funds.** They trade at a premium or discount to NAV, so
  market value and underlying value are not the same number.

