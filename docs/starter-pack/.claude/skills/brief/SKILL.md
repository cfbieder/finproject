---
name: brief
description: Build or refresh the OPERATOR brief (live status page, rebuilt each time) — a single-page status artifact showing live status tiles, the open items split by what is blocking each, progress against the tracker, and recently closed work. Every number is re-derived at build time, never carried forward. Distinct from templates/project-brief.md, which is the frozen founding brief. Use when the user types /brief, or asks for a status page, an operator brief, a stakeholder update, or "update the brief".
---

# /brief — the operator brief

One page that answers *"where does this project stand, and what is waiting for me?"*
Published as an Artifact so it survives the terminal and can be opened on a phone.

⚠️ **Not to be confused with `templates/project-brief.md`** — that is the *founding* brief
(the what and why, written once at kickoff, then frozen as the founding record and fed to
`/kickoff`). This is the *operator* brief: live status, rebuilt from scratch every time it
is refreshed, and never frozen. One is an input to building; the other is a view of it.

## ⛔ It is a roadmap, not a diary

The single most common failure is writing what *happened*. Nobody opening a status page
needs a narrative of the session. They need **done · open · next**, and what is in the way of each.

- ❌ "Today we investigated the backup topology and found…"
- ✅ "**Production copies — 2 · 701 snapshots.** ⚠️ 16 series still read the old target."

If a fact does not change what the reader does next, it belongs in the commit message.

## ⛔ Every number is DERIVED at build time

**Never copy a number from the previous edition.** A number copied into a second document
stops being derived from anything, and it will be wrong before anyone notices — that is
the defect this skill exists to prevent.

Each figure must come from a command you ran *this build*: a metrics query, `git log`,
a `grep -c` of the tracker's own markers, a tool's own output. If you cannot derive a
figure, **omit the tile** — do not carry the old value forward, and do not estimate.

⚠️ If the project has a tool that already computes a figure, use it rather than
re-implementing the count. Two implementations of one rule is how they start disagreeing.

⚠️ **A hand-kept roll-up is a copied number too.** A "summary by status" table in an index, a
test count typed into a doc, a "measured on" figure in status — derive each from the rows it
summarises (normalise free-text status cells to their leading keyword before counting). If the
roll-up disagrees with its own rows, the brief shows the derived figure **and** lists the
disagreement as its own open item.

## ⛔ Decide what may appear on the page

The brief is published off the host. Before the first build, write down which classes of data it
may carry. A finance, medical or client-data project's brief carries **operational** figures —
versions, gate verdicts, feed-health counts, open items — and never the domain's own numbers: no
balances, net worth, account identifiers, names or tax data, however useful the tile. Put that list
in the project's copy of this skill, so a refresh cannot drift past it.

## Phase 0 — find the sources of truth

Look before assuming. Typical sources, in preference order:

| tile / section | derive from |
|---|---|
| live status | metrics API, health endpoints, `docker ps`, cloud CLI |
| progress board | the tracker's own checkboxes (`- [x]` / `- [~]` / `- [ ]`), counted |
| change index | each change doc's own `Status:` header — never a summary table |
| open items | the live roadmap/issue list |
| closed recently | this week's merge/commit history |

If a source is unreachable, say so **on the page** (`⚠️ not verified this build`) rather
than leaving a stale figure that reads as current.

## Phase 1 — structure (fixed, in this order)

1. **Header** — project name, one line of what it is, and the build timestamp in UTC.
2. **Status tiles** — 8–14 one-line facts with a state dot (green / amber / red).
   Live numbers only: hosts up, tests passing, checks failing, open items.
3. **Open items** — the heart of the page. ONE numbered list, split into three lettered
   buckets by **what is in the way** — never by severity, theme or component:

   - **A · Ready now — nothing blocking** — work that could start today.
   - **B · Yours to decide — not code** — a judgement only the owner can make.
   - **C · Waiting — and what on** — blocked, each naming the thing it waits on.

   **The bucket is the owner.** A is the agent's, B is the owner's, C is nobody's until the
   blocker moves. That is why this section carries no owner chips: an item whose owner is
   unclear is an item whose blocker has not been named, and the fix is to name it, not to
   label it.

   Open the section with a **count line** — how many items, and **which came off since the
   last edition**: *"22 items, numbered continuously. Two came off this edition: CR-092 inc 0's
   last piece and CR-103's re-priced line both shipped in 1.70.0 today."* A list that only ever
   grows reads as a backlog nobody works; that line is the evidence it is being worked, and it
   is the one place the previous edition may be consulted — for what LEFT, never for a figure.

   Number **continuously across all three buckets** (A 1–11, B 12–13, C 14–22). An item keeps
   one number wherever it sits, so a move from C to A is visible as a move rather than as a new
   arrival. Renumber only when items leave.

   Each row carries four columns beside its number:

   | bucket | columns |
   |---|---|
   | **A**, **B** | **Item** · **What it is** · **Next step** · **Benefit** |
   | **C** | **Item** · **What it is** · **Waiting on** · **Benefit when unblocked** |

   - **Item** — a short handle, the tracker id where there is one (`CR-092 inc 1`). Mark it ⚡
     when it changed since the last edition.
   - **What it is** — one sentence, written for someone who has not read the tracker.
   - **Next step** — an imperative concrete enough to begin from, with the one fact that makes
     it startable: *"Measure it before 16:00 ET — one batched call over ~19 symbols; the market
     is open now."* Not *"investigate"*.
   - **Waiting on** (C only) — the specific thing, with its **measured distance**: *"6 more
     surface-priced trades — the endpoint reads 14 against the 20 it needs, this build"*. A
     blocker with no distance cannot be told from an excuse. **Re-check each one this build**
     and say so; if it is still blocked for the same reason, say that too.
   - **Benefit** — the argument for doing it, not a restatement of the item. The best ones name
     what is learned either way: *"Either the gate earns its place or it comes out."*
4. **Progress** — the board or session table, if the project has a tracker. Chips per item.
5. **Change index** — every change request / ADR / epic with its real status.
6. **Closed recently** — what shipped, newest first; trim to ~10, older belongs in history.
   One ✅ line each: **the claim**, the release it shipped in, then *what was actually wrong* —
   the defect, not the feature name — and the finding worth carrying if there was one. "Fixed
   the chart" tells the reader nothing. *"77 rows said the re-quote was still to come, hours
   after it had run — a row cannot tell 'not run' from 'ran and abstained'"* tells them what
   class of thing this project gets wrong, which is the only reason to keep the section.

Sections the project has no source for are **omitted**, not faked with placeholder text.

## Phase 2 — write it

- Lead each item with the **claim**, then the evidence. The reader skims bold text.
- Mark severity inline so it survives skimming: ⛔ blocking · ⚠️ caution · ⭐ notable ·
  ✅ done · ⚡ changed · 🔴 serious.
- **Put an item in a bucket by naming its blocker, not by how it feels.** "Needs thought"
  is not a blocker; "needs a decision on which evidence set" is, and that is bucket B. If
  nothing can be named, it is bucket A and it is startable today.
- Keep a cell to one or two sentences. Link out for depth.
- ⚠️ **Delete stale items.** An item that was completed must leave the list and appear in
  *Closed recently* instead — an open-items list carrying finished work trains the reader to
  distrust the whole page. Say in the count line which ones left.
- ⚠️ **A bucket-C item whose blocker was not re-checked this build is not verified.**
  Re-check it and say so on the row, or move it to A. "Waiting" is the easiest place on the
  page for a dead item to hide, because nothing about it looks wrong.

## Phase 3 — validate BEFORE publishing

Run every check, and fix rather than publish over a failure:

1. **Re-derive the headline numbers a second time** and confirm they match what you wrote.
2. **Cross-check against the tracker** with the project's own tool if one exists.
3. **Balance the tags** — count opening vs closing `div`/`p`/`span`/`li`. A mismatched tag
   silently swallows a section.
4. **Check the open-items list against itself**: the count line matches the number of rows;
   the numbers run continuously from 1 with no gap and no repeat across A, B and C; every
   bucket-C row names something specific in *Waiting on*; and no row is already done.
5. **Check links resolve** — a brief pointing at a file that no longer exists is worse than
   one that stays silent.

## Phase 4 — publish in place

Publish with the **Artifact** tool. On a refresh, pass the **same URL** so the link the
user already has keeps working — never create a second artifact for the same brief.
Report the URL and, in two or three lines, only what *changed* since the last edition.

## Skeleton

Self-contained HTML; no external CSS or JS. Theme-aware, mobile-first.

⛔ **The dark-mode block is `@media` OUTSIDE, selector inside** — the reverse is CSS nesting
and fails silently on the viewer's default "system" theme, which is where most readers are.
Define every token on bare `:root` first; a colour whose only definition sits inside a media
or `[data-theme]` block renders one theme's text on the other theme's background.

```html
<title>Fleet Brief</title>
<style>
:root{--bg:#faf9f7;--fg:#1a1a1a;--dim:#6b6b6b;--line:#e2e0dc;--card:#fff;
      --g:#2e7d32;--w:#b26a00;--r:#c62828;--accent:#1f4e79}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){
  --bg:#16181c;--fg:#e8e6e3;--dim:#9a9a9a;--line:#2c2f36;--card:#1d2026}}
:root[data-theme="dark"]{--bg:#16181c;--fg:#e8e6e3;--dim:#9a9a9a;--line:#2c2f36;--card:#1d2026}
body{background:var(--bg);color:var(--fg);font:15px/1.55 system-ui,-apple-system,sans-serif;
     margin:0 auto;padding:24px;max-width:900px}
h1{font-size:24px;margin:0 0 4px} h2{font-size:13px;text-transform:uppercase;
   letter-spacing:.08em;color:var(--dim);margin:32px 0 12px}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:10px}
.tile{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:12px}
.tile b{display:block;font-size:20px;font-variant-numeric:tabular-nums}
.tile span{color:var(--dim);font-size:12.5px}
.net .nrow{display:flex;align-items:center;gap:10px;padding:6px 0;border-bottom:1px solid var(--line)}
.dot{width:9px;height:9px;border-radius:50%;flex:none}
.dot.g{background:var(--g)} .dot.w{background:var(--w)} .dot.r{background:var(--r)}
.lbl{flex:1;color:var(--dim)} .val{font-variant-numeric:tabular-nums}
.count{color:var(--dim);font-size:13.5px;margin:0 0 18px;max-width:70ch}
h3{font-size:14px;margin:22px 0 8px;font-weight:600}
h3 .band{color:var(--dim);font-weight:400}
table{width:100%;border-collapse:collapse;font-size:13.5px}
td,th{border-bottom:1px solid var(--line);padding:6px 8px;text-align:left;vertical-align:top}
th{font-size:11.5px;text-transform:uppercase;letter-spacing:.06em;color:var(--dim);font-weight:600}
td.n{font-variant-numeric:tabular-nums;color:var(--dim);width:2.2rem;text-align:right}
td.it{font-weight:600;min-width:11rem}
.wrap{overflow-x:auto} code{font-size:12.5px;background:var(--line);padding:1px 4px;border-radius:3px}
/* One table per bucket, but ONE number sequence across all three. On a phone each
   row stacks with its column name as a label, so no cell loses its heading. */
@media (max-width:640px){
  .items thead{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
  .items tr{display:block;border-bottom:1px solid var(--line);padding:10px 0}
  .items td{display:block;border:0;padding:2px 0}
  .items td.n{display:inline;width:auto;text-align:left}
  .items td.it{display:inline}
  .items td[data-l]::before{content:attr(data-l);display:block;font-size:11px;
    text-transform:uppercase;letter-spacing:.06em;color:var(--dim);margin-top:6px}
}
</style>

<h1>Project Brief</h1>
<p style="color:var(--dim);margin:0 0 20px">One line on what this is · generated 2026-01-01 00:00Z</p>

<h2>Status</h2>
<div class="net">
  <div class="nrow"><span class="dot g"></span><span class="lbl">Hosts</span><span class="val">25 / 25 up</span></div>
</div>

<h2>Open items</h2>
<p class="count">22 items, numbered continuously. Two came off this edition:
   <b>CR-092 inc 0</b>'s last piece and <b>CR-103</b>'s re-priced line, both shipped in 1.70.0.</p>

<h3>A <span class="band">· Ready now — nothing blocking</span></h3>
<div class="wrap"><table class="items">
  <thead><tr><th>#</th><th>Item</th><th>What it is</th><th>Next step</th><th>Benefit</th></tr></thead>
  <tbody>
    <tr><td class="n">1</td><td class="it">Liquidity gate ⚡</td>
        <td data-l="What it is">Whether the gate ever changes an outcome, or silently passes everything</td>
        <td data-l="Next step">Measure it before 16:00 ET — one batched call over ~19 symbols</td>
        <td data-l="Benefit">Either the gate earns its place or it comes out</td></tr>
  </tbody>
</table></div>

<h3>B <span class="band">· Yours to decide — not code</span></h3>
<div class="wrap"><table class="items">
  <thead><tr><th>#</th><th>Item</th><th>What it is</th><th>Next step</th><th>Benefit</th></tr></thead>
  <tbody>
    <tr><td class="n">12</td><td class="it">Near-miss grading</td>
        <td data-l="What it is">Whether those rows get a confidence grade at all, and from which evidence</td>
        <td data-l="Next step">Decide the evidence set — only 4 of 13 caveats are computable</td>
        <td data-l="Benefit">Without it, "High" would mean two things in one app</td></tr>
  </tbody>
</table></div>

<h3>C <span class="band">· Waiting — and what on</span></h3>
<div class="wrap"><table class="items">
  <thead><tr><th>#</th><th>Item</th><th>What it is</th><th>Waiting on</th><th>Benefit when unblocked</th></tr></thead>
  <tbody>
    <tr><td class="n">14</td><td class="it">Sensitivity test</td>
        <td data-l="What it is">The last open piece of the calibration program</td>
        <td data-l="Waiting on">6 more surface-priced trades — the endpoint reads 14 of 20, this build</td>
        <td data-l="Benefit when unblocked">Closes the program; the book accumulates ~a dozen a week</td></tr>
  </tbody>
</table></div>

<h2>Closed recently</h2>
<ul>
  <li>✅ <b>The claim, as a claim</b> (1.70.0) — what was actually wrong, in one or two
      clauses, and the finding worth carrying.</li>
</ul>
```

## Rules

- ⛔ **Never invent a figure.** Omit the tile.
- ⛔ **Never carry a number forward** from the previous edition.
- ⛔ **Never publish over a failed validation** — fix, then publish.
- ⚠️ Re-read the previous edition before refreshing: items it lists as pending may be done,
  and a stale open-items list is the fastest way to lose the reader's trust. It is consulted
  for **which items left** and for nothing else — never for a figure.
- ⚠️ Keep the title stable across editions; it is how the artifact is found again.
