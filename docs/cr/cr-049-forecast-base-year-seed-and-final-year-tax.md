**Status:** ✅ COMPLETED — [Roadmap](../current/project-roadmap.md)

# CR049 — Forecast: Base-Year Seed Duplication + Final-Year Sweep Tax

**Opened:** 2026-07-13 · **Closed:** 2026-07-13 · **Track:** v3 · **Migration:** none

Two silent-wrong-number engine bugs, both found from one owner question: *"why is the cash
sweep not taking from Fidelity Stock when cash is below and fixed income is also out?"*

The premise turned out to be false — in "2026 Base" the sweep **does** reach Fidelity Stocks
(2061: $618K, 2062: $852K), because the priority-1 module isn't actually exhausted until 2061.
But chasing the numbers surfaced the real defects: the 2062 bar showed **cash at −$60,521**
while $4.3M of sellable stock sat in the module.

## 1. A1 — The final-year sale never funded its own tax

A forced liquidation realizes a capital gain, and the tax is deferred +1y — that deferral is
what keeps the sweep a single forward pass with no fixed point to solve. The **last** year has
no next year to defer into, so the tax landed in the same year, applied *after* the band check.

2062 therefore: the sweep pulled $852,297 from Fidelity Stocks, restored cash to the $200K low
band, and was then handed a **$205,116 tax bill on that very sale** with nothing sold to cover
it. No `Cash Shortfall` entry was written, because as far as the band check was concerned the
year had balanced. The model ended showing negative cash beside millions in sellable stock —
the exact thing the sweep exists to prevent.

**Fix:** the drain cascade (`cash-sweep.js`) is now re-entrant. In the final year the sweep
pays the tax, re-checks the band, and sells again — each pass only has to fund the tax *on the
previous pass's tax*, so the residual shrinks by the effective tax rate each round and it
converges in a few passes (backstop: `MAX_FINAL_YEAR_PASSES`, unreachable below a 100% rate).
The passes are folded back into one entry per `(year, account, module, comment)` so the owner
sees one sale and one tax bill, not a dozen shrinking rows. If the ranked modules genuinely
cannot fund the tax, the residue is now reported as a `Cash Shortfall` instead of silent
negative cash.

Chosen over a closed-form gross-up (`W = need / (1 − rate × (1 − basisRatio))`): exact in one
pass, but it would have to re-derive the whole waterfall — untaxed swept balance, then the
primary's own balance, then each backup at its own rate and basis ratio — as a **second** copy
of the arithmetic in `realize()` / `availableFrom()`. That duplication is precisely what A2 is.

## 2. A2 — The engine kept a drifted copy of the base-year query

The sweep's opening cash is the BaseYear NCF (CR045 P1b). The engine computed it with its own
hand-copied SQL, under a comment promising it *"Must mirror crud.getBaseYearValues EXACTLY"*.
It did not. Its expense branch was gated:

```sql
SELECT SUM(CASE WHEN a.account_type = 'liability'
                THEN -m.expense_amount * (...half-year...)
                ELSE 0 END)      -- every non-liability module expense → zero
```

Real-estate modules are `asset`, not `liability`, so **Property Costs — $64,717 in 2026 —
was worth nothing in the opening cash**, while the engine went on paying those same costs out
of `Bank Accounts` in all 36 forecast years.

| 2026 base-year NCF | |
|---|---|
| Review / `crud.getBaseYearValues` | −149,399 |
| Engine's sweep seed | −84,682 |
| Difference | **64,717** = 2026 Property Costs |

Because the sweep pins cash to the band every year, the error did not wash out: it rode the
whole horizon as a constant offset. The engine's internal cash sat **$64,717 above** the line
the Review displayed, and it under-drew from the sweep by that much in aggregate. The Review
was right; the engine was the optimistic one.

**Fix:** the duplicated SQL is deleted. `index.js` calls `crud.getBaseYearValues(scenarioId,
baseYear, dbc)` — the one query that produces the figure — passing its own transaction client
(`getBaseYearValues` gained an optional `client` param, defaulting to the pool, so existing
callers are unchanged). The two figures can no longer disagree, because there is only one.

The comment had been asserting the mirror for at least one CR cycle and they silently stopped
matching anyway. **A code comment is not a constraint.**

## 3. Effect on the model ("2026 Base")

| 2062 | Before | After |
|---|---|---|
| Cash (Bank Accounts) | **−60,521** | **200,000** — exactly the low band |
| Sold from Fidelity Stocks | 852,297 | **1,146,965** |
| Capital-gains tax | 352,477 | **438,332** |
| Cash shortfalls, whole horizon | 0 (but cash negative) | 0, and cash never below band |

The displayed cash line now sits precisely on the band in every swept year. Both symptoms had
the same root: the model was quietly ~$65K richer than the plan, and the terminal-year sale
never paid for itself. Selling ~$295K more stock in 2062 is the honest cost of the tax bill.

Engine byte-parity with v3.0.93 is deliberately broken (the numbers were wrong). Prod
regenerated on deploy.

## 4. Tests

`cash-sweep.test.js`: the three tests that encoded the old terminal-year behavior are rewritten
to the new rule, plus a new case where the ranked modules cannot fund the tax and the residue
must surface as a `Cash Shortfall`. The CR048 A2 basis test moved off the last year so the
terminal-year rule doesn't tangle with what it actually asserts. 352 backend tests pass.

Verified end-to-end against a `sync-db-prod-to-dev.sh` restore of the live model, not only in
unit tests.

## 5. Known issue left open

**"2026 Downside" has no sweep backup.** `Fidelity Stocks` carries no `cash_sweep_priority` in
that scenario (it does in "2026 Base" and "2026 Base - Market Returns"), so the engine reports
a **−$766,103 shortfall in 2062 while $1,199,353 of stock sits untouched**. That is the CR045
§5 opt-in rule working as designed — an unranked module means "I cannot sell this" — but for a
liquid brokerage account it is almost certainly a data slip from when the scenario was created.
A one-row data fix (`cash_sweep_priority = 2`), left to the owner because it changes Downside's
conclusions.
