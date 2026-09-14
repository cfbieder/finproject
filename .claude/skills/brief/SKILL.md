---
name: brief
description: Build or refresh the OPERATOR brief (live status page, rebuilt each time) — a single-page status artifact showing live status tiles, owned next actions, progress against the tracker, and recently closed work. Every number is re-derived at build time, never carried forward. Fin copy: operational figures only, never the ledger's numbers. Use when the user types /brief, or asks for a status page, an operator brief, a stakeholder update, or "update the brief".
---

# /brief — the operator brief

One page that answers *"where does this project stand, and what is waiting for me?"*
Published as an Artifact so it survives the terminal and can be opened on a phone.

Adapted from starter pack v1.8.2 (`docs/starter-pack/.claude/skills/brief/`). Fix practice there first, then sync this copy.

## ⛔ It is a roadmap, not a diary

The single most common failure is writing what *happened*. Nobody opening a status page
needs a narrative of the session. They need **done · open · next**, and who owns each.

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
disagreement as a `me` action.

## ⛔ What may appear on Fin's page

Fin is a personal-finance ledger and the brief is published off the host. **Operational figures only.**

- ✅ versions and tags, CI and ratchet verdicts, container health, migration filenames, CR and
  known-issue counts and titles, feed-health **counts** and days-stale.
- ⛔ **never:** balances, net worth or forecast figures, transaction amounts, holdings, account
  names or numbers, an institution named beside an amount, FBAR/tax data, anything from `.env`.
- ⚠️ CR titles are fine; CR *status prose* and `status.md` headlines routinely quote money
  (e.g. a bank named beside an uninsured figure). Paraphrase to *what is done / open*; never
  copy those sentences onto the page.

## Phase 0 — Fin's sources of truth

Run each command **this build**. A tile whose command fails is shown `⚠️ not verified this build`
or omitted — never filled from the last edition. Commands verified 2026-09-14.

- **Release** — `cat VERSION` · `git describe --tags --abbrev=0`.
- **Prod up** — `docker ps --format '{{.Names}}\t{{.Status}}'` for `fin-server`, `fin-frontend`,
  `fin-postgres`; `curl -sf -m5 http://localhost:3005/api/v2/health` (`status` only).
- **CI on main** — `./Scripts/check-ci.sh --latest --quiet`; exit 0 green · 1 RED · 2 running ·
  3/4 omit the tile.
- **Migrations** — repo `ls server/db/migrations | tail -1` vs prod
  `docker exec fin-postgres psql -U fin -d fin -tAc "SELECT max(filename) FROM schema_migrations"`.
  Amber when they differ (a merged migration not yet on prod).
- **Feed health** — `curl -sf -m5 http://localhost:3005/api/v2/util/attention-summary`, **counts
  only**: `needsReconnect.count` (red if > 0), `staleFeeds.count` + `worstDays`, `review.count`,
  `mtmDue.count`. No account or institution names.
- **Ratchets** — the verdict line of `Scripts/check-lint-debt.sh` and `Scripts/check-api-envelope.sh`.
- **CR progress** — count the index **rows**, never its hand-kept *Summary by status* table:
  ```
  grep -E '^\| \[CR[0-9]+' docs/cr/README.md | awk -F'|' '{print $3}' | sed -E 's/[*✅ ]//g' \
    | grep -oE '^(COMPLETED|COMPLETE|IN-PROGRESS|OPEN|PLANNED|DEFERRED|SUPERSEDED|OBSOLETE)' \
    | sed 's/^COMPLETE$/COMPLETED/' | sort | uniq -c
  ```
  If it disagrees with the roll-up table, show the derived figure and add a `me` card to fix the table.
- **Known issues** — `awk '/^## 3\. Known Issues/{f=1;next} /^## 4\./{f=0} f' docs/current/project-roadmap.md | grep -oE '^- \[[ x]\]' | sort | uniq -c`.
- **Do next** — `docs/current/status.md` → *Next*, each item cross-checked against its CR's own
  status line (drop anything already done). Items under *"With the owner, do not start unasked"*
  are `you` cards; bank-feed / ocr-llm handoffs are `blocked` naming that repo.
- **Closed recently** — `git log --since='14 days ago' --format='%h %ad %s' --date=short | grep ' release: '`
  (titles only — trim any amount out of a release subject).
- **ocr-llm inbox** — the output of `.claude/hooks/handoff-inbox.sh`; silence means nothing owed.

⚠️ **Tests are not run for the brief.** The DB-backed suites share dev Postgres (`:5434`) with any
other session, and the count in `docs/current/test-overview.md` is typed, i.e. carried forward.
CI's verdict is the tile.

## Phase 1 — structure (fixed, in this order)

1. **Header** — project name, one line of what it is, and the build timestamp in UTC.
2. **Status tiles** — 8–14 one-line facts with a state dot (green / amber / red).
   Live numbers only: hosts up, tests passing, checks failing, open items.
3. **Do next** — the heart of the page. Numbered action cards, **each with an owner chip**:
   `you` (needs a decision), `me` (agent can do it), `needs hands` (physical / on-site),
   `blocked` (name the blocker). Order by what unblocks the most, not by severity.
4. **Progress** — the board or session table, if the project has a tracker. Chips per item.
5. **Change index** — every change request / ADR / epic with its real status.
6. **Closed recently** — what shipped, newest first. Trim to ~10; older belongs in history.

Sections the project has no source for are **omitted**, not faked with placeholder text.

## Phase 2 — write it

- Lead each item with the **claim**, then the evidence. The reader skims bold text.
- Mark severity inline so it survives skimming: ⛔ blocking · ⚠️ caution · ⭐ notable ·
  ✅ done · ⚡ changed · 🔴 serious.
- Name owners explicitly. An action with no owner is scheduled by nobody.
- Keep an action card to ~3 sentences. Link out for depth.
- ⚠️ **Delete stale items.** An action that was completed must leave the page — a
  "Do next" list carrying finished work trains the reader to distrust the whole page.

## Phase 3 — validate BEFORE publishing

Run every check, and fix rather than publish over a failure:

1. **Re-derive the headline numbers a second time** and confirm they match what you wrote.
2. **Cross-check against the tracker** with the project's own tool if one exists.
3. **Balance the tags** — count opening vs closing `div`/`p`/`span`/`li`. A mismatched tag
   silently swallows a section.
4. **Confirm every action card has an owner chip**, and that no item is already done.
5. **Check links resolve** — a brief pointing at a file that no longer exists is worse than
   one that stays silent.

## Phase 4 — publish in place

Publish with the **Artifact** tool. On a refresh, pass the **same URL** so the link the
user already has keeps working — never create a second artifact for the same brief.
Report the URL and, in two or three lines, only what *changed* since the last edition.

**Fin:** on the first publish, record the URL in `docs/current/status.md` → *Conventions & drills*
as `Operator brief: <url>` — that is where `/close` step 5 looks for it. On a refresh, read it from there.

## Skeleton

Self-contained HTML; no external CSS or JS. Theme-aware, mobile-first.

⛔ **The dark-mode block is `@media` OUTSIDE, selector inside** — the reverse is CSS nesting
and fails silently on the viewer's default "system" theme, which is where most readers are.
Define every token on bare `:root` first; a colour whose only definition sits inside a media
or `[data-theme]` block renders one theme's text on the other theme's background.

```html
<title>Fin Brief</title>
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
.act{display:flex;gap:12px;align-items:flex-start;background:var(--card);
     border:1px solid var(--line);border-left:3px solid var(--accent);
     border-radius:8px;padding:12px;margin-bottom:10px}
.act.you{border-left-color:var(--w)} .act.blocked{border-left-color:var(--r)}
.act .n{font-weight:700;color:var(--dim);min-width:18px}
.act .body{flex:1} .act p{margin:4px 0 0;color:var(--dim);font-size:13.5px}
.who{font-size:11px;padding:2px 8px;border-radius:99px;border:1px solid var(--line);white-space:nowrap}
.who.you{background:var(--w);color:#fff} .who.me{background:var(--accent);color:#fff}
.who.hands{background:var(--r);color:#fff}
table{width:100%;border-collapse:collapse;font-size:13.5px}
td,th{border-bottom:1px solid var(--line);padding:6px 8px;text-align:left}
.wrap{overflow-x:auto} code{font-size:12.5px;background:var(--line);padding:1px 4px;border-radius:3px}
</style>

<h1>Project Brief</h1>
<p style="color:var(--dim);margin:0 0 20px">One line on what this is · generated 2026-01-01 00:00Z</p>

<h2>Status</h2>
<div class="net">
  <div class="nrow"><span class="dot g"></span><span class="lbl">Hosts</span><span class="val">25 / 25 up</span></div>
</div>

<h2>Do next</h2>
<div class="act you">
  <div class="n">1</div>
  <div class="body"><strong>The decision, stated as a claim</strong>
    <p>Why it matters, and what it unblocks. ⛔ Anything that would go wrong.</p></div>
  <div><span class="who you">you</span></div>
</div>

<h2>Closed recently</h2>
<ul><li><b>What shipped</b> — the evidence, in one clause</li></ul>
```

## Rules

- ⛔ **Never invent a figure.** Omit the tile.
- ⛔ **Never carry a number forward** from the previous edition.
- ⛔ **Never publish over a failed validation** — fix, then publish.
- ⚠️ Re-read the previous edition before refreshing: items it lists as pending may be done,
  and a stale "Do next" is the fastest way to lose the reader's trust.
- ⚠️ Keep the title stable across editions; it is how the artifact is found again.
