# CR073 — Two recurrence guards: the orphan amount, and the two projections

**Status:** COMPLETED — v3.17.1 (2026-08-06) · no migration
**Track:** v3
**Origin:** owner instruction 2026-08-06 (*"6. go and fix · 7. add guard"*), closing two items both
CR072 reviewers asked to be numbered separately.

This CR is small and deliberately unglamorous. Neither item adds a feature; both stop a specific
failure from happening a fourth time. They ship together because they are the same kind of work and
the same release.

---

## 1. The orphan amount — roadmap Known Issue #2

### What happened

`Sarasota House` carried an expense of **45,000** with `fc_line_id` NULL. The engine's stream loop
in `fcbuilder-module.js` does:

```js
for (const { stream, usd } of streamsUSD) {
  const line = stream.lineName;
  if (!line) continue;            // ← posts nowhere
  addValuesToCategoryRow(...);
}
```

…and then the **cash** path below it takes *every* stream regardless of its line. So the money left
Bank Accounts and appeared on no expense row at all. Measured on prod: **−1,203,432 across 21
years**, with Net Cash Flow and the Expenses metric disagreeing by exactly that amount and nothing
on any screen able to say why.

[CR062](cr-062-forecast-loan-module.md) identified this exact hazard for loans and closed it with
`assertLoanHasInterestLine` — *"a blank or unknown expense category gives Bank Accounts −25,625 a
year with the expense row all zeros."* **Nothing guarded the same shape on an asset.**

The cost itself materialised in v3.17.0's regenerate, at the figure predicted to the cent. What
remained open was the guard: nothing refused the state.

### What was built

`assertStreamsHaveLines(streams)` beside the loan guard in `server/src/v2/routes/forecast.js`, on
both POST and PUT.

**Keyed on the amount being non-zero**, because that is what makes a stream produce a flow at all.
A 0-amount stream posts nothing in any mode, so leaving its line unset is harmless and stays legal:
**15 such rows exist on prod** and refusing them would block edits that are not the bug.

**Verified before shipping: 0 rows on prod are in the refused state**, so the guard closes a hazard
rather than blocking an existing edit.

On PUT it checks **only what the body sends** — a PUT that never mentions streams leaves them alone,
so refusing it on the strength of a stored row would block edits to unrelated fields.

### And a sentence, not a 400

The server guard is the backstop — the only thing that can catch a write from anywhere. But the
form lets you type an amount and not pick a line, so the reachable path was "save → raw 400". The
editor now checks the same condition before saving and names the card to go and fix, following the
idiom already in `FCModuleManage.jsx` for the empty-module case: *"The API refuses this too;
catching it here is what turns a 400 into a sentence the owner can act on."*

---

## 2. The two module projections

### What happened

`GET /modules` and `GET /modules/:id` each built their own hand-written PascalCase object of ~35
keys. They drifted **three times in three days**, every time the same way round — DETAIL missing
something LIST had — and every time it surfaced as the module editor guessing at state it should
have been told:

| | field | how it showed |
|---|---|---|
| v3.14.2 | `HasValuation` | the form could not tell whether a module has a balance sheet |
| v3.15.0 | the sweep fields | `buildModulePayload` had to guess the sweep rank |
| v3.16.0 | `fc_line_name` | the Actual field read "no line set" on every module that had one |

The v3.16.0 half was one layer down: the LIST built its streams in SQL with a join to `fc_lines`,
while DETAIL came through `crud.loadModuleStreams`, which did a bare `SELECT *` and had no join at
all. The editor loads from DETAIL.

### What was built

- **`moduleCommonFields(m)`** — the keys both endpoints project, in one place. Both spread it.
  Adding a column there reaches both at once.
- **`loadModuleStreams` now joins `fc_lines`**, so a stream carries `fc_line_name` whichever
  endpoint returned it.
- **`forecast.projection-parity.test.js`** — the part that makes it stick, because a future author
  can still add a key to one endpoint by hand. It asserts on the **responses**, not on the helper:
  a test that only checked the helper would pass while one endpoint quietly stopped spreading it.

Deliberately **not** flattened, and pinned by a test so a later "fix" cannot flatten them either:

- `Type` — LIST capitalises it for display, DETAIL sends it raw because the editor's select matches
  on the stored value. Normalising that silently is a behaviour change, not a de-duplication.
- LIST-only: `Scenario`, the retired per-direction columns, the CR071 disposal **scalars**,
  `Inheritance`. DETAIL-only: the `Invest`/`Dispose` **rows**, the `Growth` alias.

### The refactor was verified against the old code, not just against tests

Every module response changes shape here, so the check was the API equivalent of the sums gate:
`GET /modules?scenario=2026 Base` fetched from **dev (new code)** and **prod (still v3.17.0)** and
compared.

- **Key sets identical** — `[]` in both directions, for module keys *and* stream keys.
- **Zero type changes** across every shared key.
- The 31 value differences are dev-vs-prod **data** (dev has not been refreshed since the CR071
  prod edits). The proof they are data and not projection: every differing key appears in **both**
  its snake_case and PascalCase form — `comment`/`Comment`, `growth_rate`/`GrowthRate`,
  `setup_status`/`SetupStatus`. A projection change would show on the PascalCase side only.

---

## 3. What the build taught

- **A truncated grep is not proof of absence.** Auditing what remained open on CR072, `head -20` on
  a grep hid the two copy buttons' call sites and I recorded them as never built. They existed, in
  the footer. A browser probe that printed nothing was then read as agreement rather than as an
  inconclusive check. Corrected in CR072 §3 and §12.
- **Two fixtures were testing nothing, and the guard exposed them.** `cr051.incexp-currency`'s
  first case asserts a 400 for an unconvertible currency — with the guard in place it would have
  400'd for the *missing line* instead and passed while testing nothing. It now asserts the
  refusal *reason*.
- **Tests can pass on dev and fail on CI, and this nearly did.** The new fixtures inserted
  `line_type = 'expense'`, which is not one of the five values migration 007's CHECK allows. It
  passed locally because **dev and prod have no such constraint** — 007 was auto-baselined on both,
  so it never ran there — while CI and the e2e harness build a fresh DB from the whole chain and
  enforce it. Caught by the e2e run, not by any unit test. See Known Issue #18.

---

## 4. Gate

824 backend (10 new) · 447 frontend · 8/8 e2e · lint 0 errors · six ratchets · clean build.
No migration. No forecast numbers move: the guard refuses a state no prod row is in, and the
projection refactor was proven key-for-key identical against the running old code.

Both guards were falsified before being kept — the guard's three refusal tests fail with the
`assertStreamsHaveLines` calls removed, and the parity test fails both when the shared spread is
dropped from one endpoint and when the `fc_lines` join is removed from `loadModuleStreams`.
