**Status:** ✅ COMPLETED — released v3.0.84–86 (2026-07-12), migration 038. — [Roadmap](../current/project-roadmap.md)

# CR047 — Income-Only Tax Rate Override on a Forecast Module

**Opened:** 2026-07-12 · **Track:** v3 · **Migration:** 038

## 1. The gap

`tax_rate_override` (migration 010) overrides the tax rate on a module for **both** realized
capital gains **and** income. That conflates two different taxes, and there is a real case
where they diverge:

> United Beverages' dividend is received **already net of Polish tax**, so the only
> incremental **US** tax on that income is ~3%. But a future **sale** of the business is
> still an ordinary capital gain at the scenario rate.

Today that is inexpressible. Setting `tax_rate_override = 3` would also tax the eventual
disposal at 3% — understating the tax on the gain, silently, for the whole horizon.

## 2. The change

**Migration 038** adds one nullable column, `forecast_modules.income_tax_rate_override`.

Two rates, because they are two taxes:

| tax | rate |
|---|---|
| realized capital gains (disposal) | `tax_rate_override` ?? scenario rate |
| **income** (dividends, rent, yield) | **`income_tax_rate_override`** ?? `tax_rate_override` ?? scenario rate |

- **NULL falls back**, so every existing module is byte-identical (test X4). This is opt-in
  only, exactly as the owner asked — the default is always the default rate.
- **`0` is a real rate**, not "unset": income taxed at nothing (test X2). Hence `!= null`
  checks, never truthiness.
- The override applies to **all** of a module's income — amount-based and yield-based — and
  to the deferred base-year income tax.
- The **cash-sweep** capital-gains tax (CR045 P2a) is a *gain*, so it keeps
  `tax_rate_override` / the scenario rate. Correct: a forced liquidation is a sale.

**UI:** the Tax section of `FCModulesEdit` now names what each rate actually taxes (v3.0.85) —
"Tax Rate Override" / "Income Tax Rate Override" gave no way to guess that the first covered
gains *and* income while the second was a narrower override of one part of it:

| label | field | taxes |
|---|---|---|
| **Full Tax Override (%) — gains + income** | `TaxRateOverride` | everything on the module |
| **Recurring Income Tax Override (%) — income only** | `IncomeTaxRateOverride` | recurring income only; wins over Full |

Blank on either = fall back.

**The copy path carries the column** and the copy regression test covers it — the CR045 §1
bug class (a column a copy silently drops is a scenario that silently computes something
else) is not repeating.

## 3. Verification

Tests X1–X4 (+4, 342 backend green). X1 is the load-bearing one: it isolates the capital
gains tax with a no-income baseline module and proves a 3% income override cuts the income
tax to 3/25 of the scenario charge **while leaving the disposal-year gains tax untouched**.

Live on dev against the real United Beverages module (scenario rate 25%):

| year | tax before | with income @ 3% | |
|---|---|---|---|
| 2028 | −$30,962 | −$3,715 | 12.0% = 3/25 |
| 2029 | −$31,349 | −$3,762 | 12.0% = 3/25 |

## 4. Status

| Item | State |
|---|---|
| Migration 038 | ✅ dev + prod |
| Engine (income vs gains rates split) | ✅ +4 tests |
| Route DTO / create / update / allowlist / **copy** | ✅ |
| `FCModulesEdit` field | ✅ |
| Deploy | ✅ v3.0.84; labels renamed v3.0.85; **save-payload fix v3.0.86** |

## 5. The save silently dropped the field (v3.0.86)

Reported by the owner: set the override, save, come back — the field is empty.

`FCModuleManage.saveModule` builds the PUT body as an explicit **whitelist**. A field the
editor renders but the builder omits is simply **not sent**: no error, no warning, the value
is just gone. `IncomeTaxRateOverride` was never added to it — **and neither were CR046's four
window dates**, so those never persisted from the UI either.

Both CRs were verified end-to-end with `curl` against the API, which **bypassed the one layer
that was broken**. Green tests and a working API said nothing about whether the Save button
sent the field.

Fix: the builder is extracted to `features/Forecast/utils/fcModulePayload.js` and its test
asserts **every field in `FIELD_SECTIONS` reaches the payload** — so the next field added to
the editor cannot be dropped the same way. +4 tests (178 frontend green).
