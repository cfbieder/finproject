# CR084 — What this edit does, before you save it

**Status:** **IN-PROGRESS** — the server half is BUILT and tested (§3); the module-editor wiring is
**deliberately NOT shipped** and §5 says exactly why and what it needs.
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
scenario. 6 tests. Verified on dev against real data: `Fidelity Stocks` at 1× → 2× inflation shows
**3,413,574 → 8,325,884** at 2062, all four variants named as moving, real module untouched, zero
scratch scenarios and zero scratch rows left in the assumptions document.

## 4. Not built — and the wiring is the point

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

## 5. What the wiring needs

1. **Extract the body → columns mapping** out of `PUT /modules/:id` into one function used by both
   the route and the preview. Same code, or the preview is a second opinion about the save.
2. **Streams and schedules too** — `replaceModuleSchedules` is where a stream amount edit lands, and
   it is the edit most worth previewing.
3. **Then re-wire Save**, with a preview failure that blocks rather than falls through.
4. **A browser check**, because this one found the defect that unit tests could not.

## 6. Costs accepted knowingly

- **Two real engine builds per preview** (~0.5s each on dev). Preview on save, not on keystroke.
- ⚠️ **Inherited concurrency hazard, NOT fixed:** `copyScenario` and the teardown are both
  read-modify-writes over the same four shared `forecast_assumptions` rows, so a teardown that read
  the document before an owner saved a new inflation path would overwrite that save. CR053 made this
  rare (one owner-initiated solve); a preview per save makes it routine. Needs an advisory lock on a
  fixed assumptions key before the wiring ships.
- **Scratch scenarios are `is_active = TRUE`** and nothing filters them from the pickers, so a
  process killed mid-preview leaves one visible. A startup sweep of `__scratch_%` belongs with §5.
