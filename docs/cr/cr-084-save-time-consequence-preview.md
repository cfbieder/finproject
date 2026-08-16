# CR084 — What this edit does, before you save it

**Status:** **COMPLETE** — server half (§3) and the module-editor wiring (§7) both shipped. §4–5
record the wiring's first attempt, which was built and reverted, because the reason is the point.
**Track:** v3
**Origin:** [CR081 §13](cr-081-ai-line-assistant.md). Both reviewers of CR081 converged on this
independently and preferred it to the AI assistant it was carved out of — it serves **every** edit
the owner makes rather than only AI-proposed ones, and needs no token contract, no closed action
schema and no benchmark table.

---

## 1. The gap

Every edit to a forecast module is committed blind. The owner types a number, saves, regenerates,
and only then finds out what it did — and often not even then, because the figure that moved is
36 years away and nothing puts before beside after.

The measured case for it, from this session: `Sarasota House`'s growth was an **unset field, not a
belief**, and setting it 0 → 1.0 moved SRQ by **916,000**. Nothing at the point of saving suggested
that field carried nearly a million dollars.

## 2. The shape

> **When you save any edit, show what it does before it commits** — net assets before → after,
> nominal **and** in today's money, plus which scenarios actually move.

## 3. Built — the server half

### `forecastScratch.js` — the throwaway copy, extracted

Lifted out of [CR053](cr-053-forecast-auto-adjust.md)'s auto-adjust, where the lifecycle was inline
inside the bisection solver and every helper around it was bisection-specific. `withScratchScenario`
is now shared, and carries CR053's three non-obvious rules verbatim because each is load-bearing:
a scratch must be **STANDALONE** (the 039 trigger rejects a variant-of-variant, and
`generateForecast` force-syncs a variant at Step 0, clobbering anything written before the build);
teardown must **prune the assumptions DOCUMENT** (`deleteScenario` cascades DB children but not the
four shared JSON rows keyed by scenario NAME); and cleanup runs in a **`finally`**, because a leaked
scratch is `is_active = TRUE` and appears in every scenario picker in the app.

### `forecastPreview.js` — both sides are built

⚠️ **The obvious shape is wrong here.** Reading the scenario's stored entries as "before" and
building a scratch for "after" attributes every un-regenerated edit since the last build to the one
change being previewed — and *"an engine change moves nothing until the scenarios are REGENERATED"*
is in the infrastructure guide precisely because **stale entries beside fresh inputs is this
system's normal state**. So the scratch is built **twice**, from one copy, and the only difference
between the two reads is the edit.

A test poisons the real scenario's stored entries with a value no build produces and asserts it
never reaches the result. Verified by making `before` read stored entries and watching two tests
fail.

### The blast radius is COMPUTED, never asserted

[CR081 §5](cr-081-ai-line-assistant.md) claimed "a base edit propagates to four variants" and the
live data contradicted it: a variant carrying its own override for that module keeps its value, so
the base edit reaches it **not at all**. `blastRadius` returns both lists — `moves` and
`doesNotMove` — because the dangerous direction is the one a fixed number hides: the owner fixes the
base, believes five scenarios moved, and two silently kept the old figure.

### Entries are returned RAW

`buildScenarioMatrix`, `fcRealTerms` and `fcWarnings` are all **frontend** modules with no server
twin. Summarising server-side would be a second implementation of figures the Review and Compare
pages already render, and [CR076 §2](cr-076-forecast-model-review.md) published five wrong
net-worth figures the one time that was tried. The client diffs the two entry sets with the same
`compareMatrices` Compare uses, so a preview and a comparison cannot show different arithmetic.

**Endpoint:** `POST /api/v2/forecast/modules/:id/preview` — a POST that writes nothing to the real
scenario. 7 tests. Verified on dev against real data: `Fidelity Stocks` at 1× → 2× inflation shows
**3,413,574 → 8,325,884** at 2062, all four variants named as moving, real module untouched, zero
scratch scenarios and zero scratch rows left in the assumptions document.

## 4. ⚠️ The wiring's FIRST attempt — built, then reverted

*(Kept because the reason is the point. The wiring shipped on the second attempt — see §7.)*

The module editor's Save was wired to this and **reverted before commit**. The browser check found
it: clicking Save produced `400 — Preview could not apply the change to the throwaway copy`.

**Cause:** the preview was handed the editor's **wire payload** (`{ Name, Account, Growth, Streams,
… }`) and passed it to `repo.updateModule`, which takes **column names**. The `PUT /modules/:id`
route does that translation in **24 mapping branches** plus stream and schedule handling.

**Why that is not a small bug.** A preview that applies a *different* transformation from the save
previews something the save will not do. The partial version is worse than none: a preview that
silently ignored stream edits would show "no change" for an owner who had just changed an amount —
the same shape as [CR079 §3](cr-079-real-terms-view.md)'s partially-deflated page, invisible because
both readings look like money.

**A defect I introduced and removed:** the first wiring caught a preview failure and *saved anyway*.
That silently wrote a module while reporting nothing — a failed preview must never become an
unpreviewed write. It is gone with the wiring; when this ships, a preview failure must block or ask,
never proceed.

The finished modal component was **deleted rather than left unreferenced**. An orphaned file that
every gate passes is exactly how `FCReview.css` shipped unloaded in v3.25.0.

## 5. What the wiring needed (all done — see §7)

1. **Extract the body → columns mapping** out of `PUT /modules/:id` into one function used by both
   the route and the preview. Same code, or the preview is a second opinion about the save.
2. **Streams and schedules too** — `replaceModuleSchedules` is where a stream amount edit lands, and
   it is the edit most worth previewing.
3. **Then re-wire Save**, with a preview failure that blocks rather than falls through.
4. **A browser check**, because this one found the defect that unit tests could not.

## 6. Costs accepted knowingly

- **Two real engine builds per preview** (~0.5s each on dev). Preview on save, not on keystroke.
- ⚠️ **Concurrency on the shared assumptions document — half fixed, half residual.** Those four rows
  are touched twice per scratch: `copyScenario` adds the scratch's entries, the teardown removes
  them. Both were read-modify-writes in CR053, so either could overwrite an owner's concurrent save
  of a new inflation path — the quiet failure CR064 documents, a build at **0% inflation for the
  whole horizon**. CR053 made it rare (one owner-initiated solve); a preview on every save makes it
  routine, so it could not simply be inherited.
  **Fixed:** the teardown's filter now runs *inside* the UPDATE — one statement, no window.
  **Residual:** `copyScenario` is still a read-modify-write and was deliberately left alone, because
  it is shared with every other caller of scenario copy. The window is now one statement wide rather
  than the ~1s of a whole preview.
- **Scratch scenarios are `is_active = TRUE`** and nothing filters them from the pickers, so a
  process killed mid-preview leaves one visible. A startup sweep of `__scratch_%` is **still open** — see §9.

---

## 7. Shipped — the wiring, second attempt

### `services/moduleWrite.js` — one mapping, two callers

`PUT /modules/:id`'s 24-branch body→columns translation is **extracted**, and the route now calls it
rather than owning it. The preview applies the edit through the same three steps the save performs,
in the same order: **the shared mapping → `replaceModuleSchedules` → `replaceModuleStreams`**.

The schedule call carries the route's guard verbatim — `replaceModuleSchedules` DELETEs before it
reinserts, so calling it for a body that never mentions a schedule would wipe the module's disposals
on the copy and report a vast difference the real save would never produce.

Deliberately NOT extracted: the sweep-priority **clash** checks and the loan-retype snapshot. Those
query other rows and belong to request handling. The sweep priority **mapping** did move, because it
changes what the engine reads.

### A test that only the extraction makes possible

`previews a STREAM edit` adds a 40,000/yr expense stream and asserts cash out falls. A stream amount
does not live on the module row at all — it is written by `replaceModuleStreams` from the editor's
`Streams` array — so the column-only version would have shown **"no change"** to an owner who had
just edited the amount. That is the case worth having, and it is why the mapping was extracted
rather than reimplemented.

The suite also caught the contract change: three tests patched `{ growth_rate }` (a column) and went
green-to-red the moment the endpoint began taking the editor's wire shape.

### ⚠️ The browser check found it again — a third time

The wiring rendered nothing on the first run. `HTTP 200`, no console error, no exception: the shared
`Modal` primitive takes **`open`**, and the component passed **`isOpen`**. An undefined prop is not
an error, so the dialog simply never opened and every other gate stayed green.

That is now three defects in this CR that only a browser found — the wire/column mismatch, the
silent save-on-failure, and this. Unit tests assert behaviour and text; they cannot see a component
that isn't there.

### What the finished thing does

Verified on dev against `2026 Base`:

| | now | after saving | change |
|---|--:|--:|--:|
| nominal | 4,031,239 | 10,063,962 | **+6,032,723** |
| in 2026 dollars | 1,657,217 | 4,137,232 | **+2,480,015** |

…for `Fidelity Stocks` growth 1× → 2× inflation, naming all four variants that would move. Cancel
leaves the module at 1.0000, with **zero** scratch scenarios and **zero** scratch rows in the
assumptions document.

**A useful second result:** opening the editor and saving with **no change** reports `+0` and says
so. The round trip through `buildModulePayload` → preview → engine is lossless; a lossy mapping
would have shown a spurious delta, and that is the cheapest ongoing check that the two paths still
agree.

**A preview failure now BLOCKS.** The first attempt caught the error and saved anyway — a silent
write reported as nothing. The owner is now told the change was **not** saved and can retry or
cancel.

**Gate:** 981 backend (+7) · 517 frontend · lint 0 errors · six ratchets · no migration · no engine
change, so no regenerate and no fingerprint movement.

## 8. The wait needed to look like a wait (2026-08-16)

Owner-reported, and a real gap rather than polish: the modal opened on the RESPONSE, so for the
second or more it takes to run two engine builds the screen did nothing at all — indistinguishable
from a dead button, on the one control whose entire job is to say *"wait, look at this first"*.
The modal's own loading branch existed and was effectively unreachable.

The dialog now opens on the **click**, with a spinner and *"running the forecast twice…"*, and the
module name is passed separately so the title is right before the data arrives. Measured in a
browser: **spinner at 140 ms, results at ~1.0 s.** A preview failure closes the dialog rather than
leaving a permanent spinner, and returns the error to the editor where the unsaved change still is.

**A second defect the same check found:** the confirm button read **"Saving…"** while the preview was
still building — directly contradicting the note below it, which says nothing has been saved yet, on
the one screen whose whole purpose is that distinction. There are three states, not two: it now
reads *"Working it out…"* → *"Saving…"* → *"Save this change"*. It is disabled throughout the wait,
verified by sampling it every 120 ms rather than once.

## 9. Still open

Neither blocks anything shipped; both are recorded so they are not rediscovered.

1. **`copyScenario` is still a read-modify-write** over the four shared `forecast_assumptions` rows
   (§6). The teardown half was fixed; this half was deliberately left because it is shared with every
   other caller of scenario copy and changing it belongs to its own change. The window is one
   statement wide.
2. **No startup sweep for stale `__scratch_%` scenarios.** The `finally` covers every failure short
   of the process dying mid-preview; if that happens the copy is left `is_active = TRUE` and shows up
   in every scenario picker. Nothing filters them today.
