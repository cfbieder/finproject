# CR074 — Dismissing a cash-health warning

**Status:** COMPLETED — v3.18.0 (2026-08-06) · migration **061**
**Track:** v3
**Origin:** owner, 2026-08-06 — *"On this page can we click to dismiss a warning? Include a button
to dismiss one by one and dismiss all."*

---

## 1. The problem

The Cash Health panel on `/forecast-review` was showing **21 issues** (25 on dev). Most of them
had already been read, judged and accepted — `"Barkeria Sp. z o.o." income is taxed at the full
rate, in PLN` is a design decision, not a defect. A list that long is a list nobody reads, and the
ones that matter are buried among the ones that don't.

## 2. What makes this risky, and the three properties that answer it

[CR045](cr-045-forecast-cash-warnings-liquidation.md) §1 built this panel because a **$20M unfunded
shortfall sat on this page unremarked** — a quiet page was mistaken for a healthy plan. A dismiss
button is, precisely, a way to make the page quiet. So the feature is defined by what it must not
be able to do:

**1. Dismissed is never invisible.** The header keeps counting the **full** number of issues and
says how many are dismissed beside it — `Cash health — 25 issues · 3 dismissed`. One click shows
them again, struck through. The panel can never report fewer problems than the plan has.

**2. All-dismissed is not all-clear.** With every issue accepted the panel says exactly that, in
its own state: *"All 25 issues are dismissed — nothing is fixed, they are accepted."* It does
**not** fall through to the existing `Cash stays funded across every forecast year` banner, which
is a claim about the plan and would become a lie. The all-clear is now gated on
`warnings.length === 0` — the raw list, before dismissal is applied.

**3. A dismissal expires when the warning changes.** This is the one that needed design.

`sweep-source-exhausted` is the same warning id whether the drain lands in **2061** or in **2041**.
A dismissal keyed on the id alone would let one click in a comfortable year permanently silence
the rule — including the moment it turns urgent. So a dismissal is stored against a
**fingerprint** of what the warning asserts: `warningFingerprint(w)` hashes its severity, the
years it names, the amount it carries, and its detail sentence — which is where the rules put
their figures (*"Cost basis and market value are both $3.9M"*).

A dismissal suppresses a warning only while the fingerprint still matches. Change the plan and the
warning returns **on its own**, flagged `staleDismissal`, saying *"You dismissed this before — it
is back because its figures changed."* Saying so matters: otherwise it reads as a warning never
accepted, and the owner re-reasons from scratch about something they already judged.

The hash is FNV-1a, deliberately not cryptographic — it is a change-detector, not a security
boundary. A collision would un-dismiss or mis-suppress one warning; it cannot corrupt anything.

## 3. Scope: per scenario

Warning ids embed a module **name**, and the same module exists in every scenario with different
numbers. Accepting `disposal-no-gain-Barkeria Sp. z o.o.` on Base must not silence the same
finding on `2026 Upside`. `forecast_warning_dismissals` is therefore keyed
`UNIQUE (scenario_id, warning_id)`, and every route resolves the scenario by name first.

`ON DELETE CASCADE` from `forecast_scenarios`: a deleted scenario's judgements are meaningless.

## 4. What shipped

**Migration 061** — `forecast_warning_dismissals (scenario_id, warning_id, fingerprint,
dismissed_at)`.

**Three routes**, all scenario-scoped:

| | |
|---|---|
| `GET /forecast/warnings/dismissals?scenario=` | `{ [warningId]: fingerprint }` — the shape the panel filters with |
| `POST /forecast/warnings/dismissals` | `{ scenario, items: [{warningId, fingerprint}] }` — one item or twenty, so **"Dismiss all" is one request** rather than N racing writes against the same unique index. Upserts, so re-dismissing after the figures moved replaces the fingerprint |
| `DELETE /forecast/warnings/dismissals?scenario=[&warningId=]` | restore one, or — with no `warningId` — the whole scenario, the undo for "Dismiss all" |

A dismissal **with no fingerprint is refused (400)**: it could never expire, which is the one
behaviour this feature must not have.

**UI** — a `×` on every row, `Dismiss all N` and `Show N dismissed` / `Restore all` in the header
bar. Writes are optimistic and reconciled: a reading surface that round-trips on every click feels
broken, and a failure puts the rows straight back with the reason. If the dismissal store cannot be
read at all, the panel **shows everything** rather than nothing.

## 5. Verified in a browser, not only in jsdom

Driven on dev against the real 25-issue panel:

| step | result |
|---|---|
| dismiss one | 25 → **24** visible; header `25 issues · 1 dismissed` |
| **reload** | still 24 — the reason this is in the database and not `localStorage` |
| show dismissed | 1 row, struck through, correct title |
| Dismiss all 24 | 0 visible; header `25 issues · 25 dismissed` |
| | **all-clear banner count: 0** — property 2 holds |
| Restore all | back to 25 |

And the safety property, forced rather than waited for: with the stored fingerprints overwritten in
the database to simulate the figures moving, **both warnings returned to the visible list** with
the stale notice, and the header went back to 25.

## 6. Gate

835 backend (11 new) · 459 frontend (12 new) · 8/8 e2e · lint 0 errors · six ratchets · clean
build. Migration 061 applied to dev through `migrate.js`, and proven to apply to a **fresh** DB by
the e2e run, which builds the whole chain from empty.

**No forecast numbers move.** Nothing here touches the engine, the modules or the entries — the
warnings are a pure client-side derivation over what the Review page already loads, and the only
new state is which of them the owner has read.
