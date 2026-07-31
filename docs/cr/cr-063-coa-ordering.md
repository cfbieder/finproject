# CR063 — Chart of Accounts: user-controlled order, and honouring it everywhere — ✅ COMPLETED (all four phases, v3.10.0, migration 049 dev + prod)

Make the Chart of Accounts order **something the owner sets**, and then make every tree, report
and dropdown in the app read that order instead of the three different orders they read today.
Plus two small page fixes the same request carried: retire the **Analyze PS Data** button (PS is
no longer a data source) and give the tree the same expand/collapse controls the reports have.
[Roadmap](../current/project-roadmap.md#cr063)

**Opened:** 2026-07-31 · **Shipped:** 2026-07-31 (v3.10.0) · **Track:** v3 · **Migration:** 049 (dev + prod)
**Depends on:** CR010 (the COA Management page) · CR013 (`categories` collapsed into `accounts`,
so a category and an account are the same row and order the same way)

**Phases.**

| | scope | gate |
|---|---|---|
| **P0** | Remove Analyze PS Data; add Expand/Collapse all + one-layer — §2 | **Built.** Frontend only, no migration, no API change. Independent of everything below. |
| **P1** | `display_order` becomes authoritative — migration 049, `getTree`, create-appends, `POST /coa/reorder` — §3 | **Built.** The backfill lands *with* the sort flip; verified order-preserving (§9). |
| **P2** | ↑/↓ reorder buttons on the COA page — §4 | **Built** and clicked through a browser (§9). |
| **P3** | Every dropdown reads COA order — §5 | **Built.** Part of it was forced forward into P1 — see §5.3. |

---

## 1. The gap

Three different orders are in play today and none of them is the owner's.

### 1.1 `display_order` exists, and the tree ignores it

`accounts.display_order` has been in the schema since the seed. `findAll`, `getChildren` and
`getBalances` all order by it ([repositories/accounts.js:45, 139, 196](../../server/src/v2/repositories/accounts.js)).
`getTree()` — the one every tree, report and dropdown actually goes through — **selects it and
then sorts by something else**:

```sql
--- repositories/accounts.js:104-126
SELECT id, name, parent_id, …, display_order, 0 as depth, ARRAY[id] as path, …
…
SELECT * FROM account_tree
ORDER BY path            -- path is ARRAY[id] — this is creation order, not display order
```

So the visible order of the Chart of Accounts, the Balance Sheet, the Cash Flow report, the
budget worksheet and the forecast account list is **the order the rows were inserted**. It looks
deliberate only because the original seed inserted them in a sensible order.

The correct form is already written down elsewhere in this codebase —
[routes/ingestPs.js:43-49](../../server/src/v2/routes/ingestPs.js) builds the same recursive CTE
with `sort_path = ARRAY[display_order, id]`.

### 1.2 `display_order` is a *global* sequence, and new rows all get 0

On dev: 229 active accounts, values 0–207, **208 distinct** — it was seeded as one flat sequence
across the whole COA, not a rank within each parent. And `create()` hard-codes it:

```js
data.display_order || 0,          // repositories/accounts.js:268
```

so every account created since the seed carries **0** — 22 of them, including the `US - Investments`
category added on 2026-07-31 that started this. Ranked per parent, `Assets` alone has two.

### 1.3 The consequence: the sort cannot simply be flipped

Measured on dev — rows whose position changes if `getTree` starts honouring `display_order`
as it stands:

```
rows_that_would_move | total
                  68 |   229
```

Those 68 rows are not confined to the COA page. `getNestedTree` feeds
[services/reports.js:39,257](../../server/src/services/reports.js) (Balance Sheet, Cash Flow),
[services/budget.js:362,552](../../server/src/services/budget.js) and
[routes/forecast.js:638](../../server/src/v2/routes/forecast.js). A flip without a backfill silently
reshuffles three reports. **§3.2 is therefore not a nicety — it is the whole safety argument.**

### 1.4 And the dropdowns re-sort on top of it

Some consumers override whatever the tree gives them:

| where | order today |
|---|---|
| [`useCoa.bsLevel2Options`](../../frontend/src/hooks/useCoa.js) | `.sort(localeCompare)` — **added 2026-07-31**, because tree order buried a new category |
| [`useCoa.expenseCategoryOptions` / `incomeCategoryOptions`](../../frontend/src/hooks/useCoa.js) | `.sort()` |
| `accounts.findPLeaves` · `GET /accounts/categories` | `ORDER BY a.name` |
| `CategorySelector` | tree order (already correct) |

The alphabetical sort on `bsLevel2Options` was the right fix for the problem as it stood — with
no way to control the order, tree order was arbitrary and alphabetical at least made a new
account findable. Once the order is the owner's, that reasoning inverts, and **the owner has
explicitly released it** (2026-07-31: *"ok to remove that as this ordering is better than
alphabetical"*).

---

## 2. P0 — Analyze PS Data out, expand/collapse in (BUILT)

**Analyze PS Data.** PS is no longer a source of data. The button was the visible tip of a
chain: the 115-line `handleAnalyzeClick`, the results banner, the **quick-add missing
accounts/categories** buttons that consumed its output, and an add-modal branch that fired
`POST /ingest-ps/sync-to-transactions` and re-ran the analysis. All removed, along with their CSS
and the three now-unreachable `quickadd*` modes in `COAEditModal`.

**The backend endpoint stays.** `/api/v2/ingest-ps/analyze-ps` is also called by
[UploadPS.jsx:214](../../frontend/src/pages/UploadPS.jsx), and "Upload PS: keep" is a standing
CR042 decision. This is a frontend removal on one page, not a retirement of PS ingestion.

**Expand/collapse.** Four buttons — all / one-layer, both directions — matching
[`BudgetBalancePanel`](../../frontend/src/features/Budgets/BudgetBalancePanel.jsx) and the Cash
Flow pages, using the shared `btn btn--sm btn--outline btn--icon` primitive rather than a
page-local class (the button-CSS guard caught the first attempt at a bespoke one). One wrinkle
worth recording: this page stores **`collapsedPaths`**, the inverse of the reports'
`expandedPaths`, so "expand all" is the empty set and "collapse all" has to enumerate every
category path.

Verified in a browser against dev, since neither half is visible to a unit test: 231 rows →
Collapse all → **2** → Expand one level → **8** → **34** → Collapse one level → **8** → Expand
all → **231**, with each button disabling at its own extreme and no console errors.

---

## 3. P1 — make `display_order` authoritative (migration 049)

### 3.1 The model

`display_order` becomes a **rank within the parent**, not a global sequence. Nothing else needs
the global property: every read that uses it is already partitioned by parent (a tree level, a
child list) or is a flat list where only the tree rank matters (§5.2).

### 3.2 The backfill comes first, and its success criterion is "nothing moves"

Migration 049 rewrites `display_order` as a per-parent rank — ranked by the **currently visible**
order, which is `id`, *not* by the existing `display_order`:

```sql
UPDATE accounts a SET display_order = r.rank
FROM (SELECT id, row_number() OVER (PARTITION BY parent_id ORDER BY id) AS rank
      FROM accounts) r
WHERE r.id = a.id AND a.display_order IS DISTINCT FROM r.rank;
```

Ordering the backfill by `display_order, id` would *bake in* the 68-row reshuffle of §1.3 instead
of preventing it. The point of the backfill is that the day-one result is **byte-identical**: the
migration and the `getTree` change ship together, and the acceptance test is that Balance Sheet,
Cash Flow and the budget worksheet render exactly as before. Inactive rows are ranked too, so
reactivating an account later does not collide.

The `DO` block **raises** unless every `(parent_id, display_order)` pair is unique — a duplicate
rank is the one state that makes the order non-deterministic again.

### 3.3 The code changes

1. `getTree()` — `sort_path = ARRAY[display_order, id]`, `ORDER BY sort_path`. `id` stays as the
   tiebreak so a duplicate rank degrades to today's behaviour rather than to a random order.
2. `create()` — `display_order = COALESCE(MAX(display_order) FILTER (parent_id = …), 0) + 1`.
   A new account appends to the end of its group instead of jumping to the top. **This is the
   real fix for the complaint that opened this CR** — the alphabetical sort of §1.4 was
   compensating for the fact that a new account landed somewhere arbitrary.
3. `getNestedTree()` — emit `id` and `display_order` alongside `name`/`children`. Additive:
   `collectCoaRows` keys off `name`/`children` and ignores extra fields.

### 3.4 `POST /api/v2/util/coa/reorder`

Body: `{ parentId, orderedIds: [...] }` — **the whole sibling list**, not `{id, direction}`.

The whole-list form is idempotent, writes in one transaction, and cannot interleave with a
concurrent reorder into a half-applied state. It also lets the server reject a stale client: if
`orderedIds` is not exactly the set of that parent's active children, it 400s rather than
writing a partial order. The single-step form has none of those properties and would need a
read-modify-write on every click.

A root-level reorder passes `parentId: null`.

---

## 4. P2 — the reorder UI

↑/↓ buttons in the existing per-row action cluster
([COATreeRow.jsx](../../frontend/src/features/COAManagement/COATreeRow.jsx)), beside Add/Edit/Move/Delete.
Chosen over drag-and-drop by the owner: no new dependency (none is installed), keyboard
accessible, and it works on a flattened table where some ancestors are collapsed.

Rules:
- Disabled at the first/last position within the parent.
- **Disabled entirely while a search term or a type/currency filter is active** — in a filtered
  view the row above is not the sibling the row would swap with, so the button would lie.
- Categories and accounts reorder identically (CR013 made them the same row).
- The page reloads its own COA copy *and* invalidates the shared `["coa"]` query after a reorder,
  the same `reloadCoaAfterMutation` path the other four mutations use — otherwise the new order
  is invisible everywhere else for up to five minutes, which is exactly the defect fixed on
  2026-07-31.

---

## 5. P3 — every dropdown reads the order

### 5.1 Free

Everything that goes through `getNestedTree`/`getTree` inherits P1 with no further change:
Balance Sheet, Cash Flow, the budget worksheet, the forecast BS-account list, `CategorySelector`,
the transaction filters, the COA page itself.

### 5.2 Deliberate

- Delete the three `.sort()` calls in [`useCoa.js`](../../frontend/src/hooks/useCoa.js)
  (`bsLevel2Options`, `expenseCategoryOptions`, `incomeCategoryOptions`) — owner-released, §1.4.
  The comment on `bsLevel2Options` explaining *why* it sorts must go with it, or the next reader
  will restore the sort.
- `findPLeaves` and `GET /accounts/categories` return **flat** lists with no hierarchy, so
  "COA order" for them means the tree's depth-first rank. Both now join `SORT_PATH_CTE` and
  `ORDER BY sort_path`.
- `getTraitsMap` returns a **map** — its `ORDER BY name` is irrelevant; leave it.
- Currency and type filter dropdowns stay alphabetical. They are not COA order.

### 5.3 What the build changed about this plan

**Half of P3 turned out to be part of P1, not a follow-on.** `findAll` and `getBalances` were
already sorting `ORDER BY a.display_order, a.name` — on the *global* sequence. Making the column
a per-parent rank does not leave those endpoints unchanged, it **breaks** them: every parent's
rank-1 child sorts first, then every rank-2, which is not an order anyone asked for. The parity
run caught it immediately (`GET /accounts?leafOnly=true` came back scrambled while the trees were
still fine), so the shared `SORT_PATH_CTE` was written in P1 rather than P3 and `findAll`,
`getBalances`, `findPLeaves` and `/accounts/categories` all adopted it at once.

The lesson generalizes: **a rank scoped to a parent silently breaks every consumer that was
treating the column as global.** The four here were found by diffing responses, not by reading —
which is the only reason the sequencing error cost nothing.

---

## 6. What could go wrong

| risk | mitigation |
|---|---|
| The sort flip reshuffles three reports (§1.3) | The backfill ships in the same release and is ordered by `id`, so day-one output is unchanged. Verify by capturing Balance Sheet + Cash Flow + budget worksheet before and after and diffing. |
| Duplicate `(parent_id, display_order)` makes order non-deterministic | Migration `DO` block raises; `id` tiebreak in `sort_path` bounds the damage to "today's behaviour". |
| A reorder is invisible outside the COA page | `reloadCoaAfterMutation` (§4). |
| Something downstream depends on tree order for *meaning*, not display | Checked: the forecast cash sweep ranks on its own `cash_sweep_priority` column, not tree position. `getTree` consumers are display paths. To re-confirm during P1. |
| The name-keyed COA API and the new id-keyed one disagree | `accounts.name` is `UNIQUE`, so both address the same row. New endpoint is id-keyed; the existing four stay as they are. |

## 7. Test plan

- **Migration:** applies to a fresh migrations-only DB (CI's shape); re-runs as a no-op;
  post-condition `(parent_id, display_order)` unique; ranks are gap-free per parent.
- **Repo:** `getTree` returns siblings in `display_order`; a duplicate rank falls back to `id`;
  `create()` appends rather than prepending — **falsified against the current `|| 0`** first.
- **Route:** `reorder` rejects a wrong id set (400), rejects ids from another parent, is
  idempotent when replayed, and writes in one transaction (a mid-list failure leaves no partial
  order).
- **Report parity:** the before/after diff of §6, on dev restored from a prod copy.
- **UI:** reorder through the browser, then confirm the new order appears in the forecast
  New Module account list without a reload — the CR-opening defect, in reverse.

## 8. Out of scope

- Reparenting (`Move to…` already exists and is unchanged).
- Ordering the P&L vs Balance Sheet **sections** relative to each other.
- Drag-and-drop (§4 — revisitable once the endpoint exists; it needs no backend change).
- Retiring `/api/v2/ingest-ps/analyze-ps` (§2 — still used by Upload PS).

## 9. What was actually built, and how it was checked

**Migration 049 applied to dev** (via `migrate.js`, one pending file, no drift). After it: 229
accounts, `display_order` 1–13, **zero** duplicate `(parent_id, display_order)` pairs.

**Parity — the claim this CR rests on.** Every report was captured *before* the migration and
diffed *after*, with all CR063 code live:

| endpoint | result |
|---|---|
| `reports/balance` | **byte-identical** |
| `reports/cash-flow` | **byte-identical** |
| `budget/cash-flow` (worksheet) | **byte-identical** |
| `budget/category-groups` | **byte-identical** |
| `util/coa/BalanceSheet` · `util/coa/CashFlow` | **name sequence identical** — the only diff is the added `id` / `display_order` fields |
| `accounts/categories` · `accounts?leafOnly=true` | **changed on purpose** — alphabetical / global-rank → COA order (§5) |

**Tests.** 10 new backend (`cr063.coa-ordering.test.js`) — **704 backend total**; 9 new frontend
(`coaReorder.test.js`) plus two strengthened `useCoa` assertions — **27 files green**; six CI
guards green; build clean.

*Falsified, not asserted.* Reverting `ORDER BY sort_path` → `ORDER BY path` and `?? null` → `|| 0`
turns **3 of the 10** backend tests red; reverting `findPLeaves` to `ORDER BY a.name` turns a
**4th** red; restoring the two `.sort()` calls in `useCoa` turns the frontend assertion red with
`expected [ 'Dividends', 'Interest' ] to deeply equal [ 'Interest', 'Dividends' ]`. The `useCoa`
fixture had to be **changed to make that possible** — its tree was alphabetical, so it could not
tell COA order from a `.sort()` at all.

**Clicked, not just tested.** Through a browser against dev: an arrow moves a category among its
siblings and the tree re-renders in the new order; the first row's ↑ and the last row's ↓ are
disabled; typing in the search box disables **every** arrow; and — the point of the whole CR —
reordering on the COA page changes the **forecast New Module → Account** dropdown immediately,
with no reload:

```
BEFORE: … | PL Investments | PL - Properties | US - Investments | …
AFTER : … | PL Investments | US - Investments | PL - Properties | …
```

*Also worth recording:* one scripted browser run left dev's `Assets` group swapped because that
script had no restore step. Caught by re-reading the table rather than trusting the script, and
put back through the API. A UI-driving script that mutates shared state needs its undo written at
the same time as its action.

**Prod:** shipped as **v3.10.0**. Migration 049 applied by `deploy-to-production.sh` Step 2b, ahead of the rebuild — mandatory here, because the code reads a column whose *meaning* the migration changes. (P0 was already on prod ahead of the tag: it rode the v3.9.2 working-tree build.)

## 10. Post-release — "move up/down does not work" (v3.11.0)

It did work. Prod's stored order matched the reported screenshot, and clicking the arrow on the prod
bundle sent `{"parentId":1,…}`, returned 200, and moved the row. **What was missing was any way to
tell**, and behind that were two real defects:

1. **No feedback.** Every other mutation on this page toasts; reorder was silent. The arrows also
   belong to whichever row the pointer is *over*, so "which account did I just move?" is a genuine
   question — the toast now names it (*"US - Investments" moved up*).
2. **A stale-click window that silently undid the move.** The busy guard was released when the POST
   resolved (~40 ms) while `coaRows` does not refresh until the reload lands (~260 ms), so for
   ~200 ms a second click computed its plan from the **old** rows. That posts a sibling set which is
   still *valid*, so the server accepts it with a 200 and quietly reverts the first move. Measured:
   two clicks 60 ms apart sent 2 POSTs; the guard now spans the whole cycle and the same test sends 1.

*Worth recording, because it cost time:* the scroll pane appeared to jump 300 → 1988 on every
reorder, which would have explained the whole report. It was **Playwright auto-scrolling before its
own click** — with raw mouse events the scroll is preserved. A test artifact presented as a defect is
worse than no test, because the fix it implies is a real change to shipping code.

*Still inherent, not fixed:* the arrows act on the hovered row, and after a swap the rows move under
a stationary pointer — so a second click in the same spot acts on a **different** account
(reproduced: a 2-element payload for another parent's children, 200). That is the nature of a
move-in-place list; the toast is what makes it visible.
