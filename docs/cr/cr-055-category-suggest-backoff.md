# CR055 — Category-Suggest Progressive Backoff — ✅ COMPLETED (v3.4.3, 2026-07-21)

Roadmap anchor: [project-roadmap.md#cr055](../current/project-roadmap.md#cr055). Improves the
[CR022](cr-022-bank-feed-parallel-import.md) "Suggest categories" feature; no schema change, no migration.

## Problem

The "Suggest categories" button on the feed-review page ([`RefreshFeeds.jsx`](../../frontend/src/pages/RefreshFeeds.jsx))
suggests, for each uncategorized transaction, the category most often assigned to that merchant across the
owner's accepted+categorized history — a deterministic majority vote keyed by a **merchant key** derived from
the description ([`categorySuggest.js`](../../server/src/v2/services/categorySuggest.js), CR022). The key was the
leading **3 tokens** after stripping digits, punctuation, PKO doubling and location/stop tokens.

That fixed 3-token key **fragments any merchant whose 3rd token is a per-transaction id.** US card descriptions
are the failure case: `AMAZON MKTPL*1Q8RX4GZ3`, `*258N416D3`, `*F40KK8XY3 [SALE]` … each order id survives
digit-stripping as leftover letters and becomes a **different** 3rd token (`amazon mktpl rx` / `nx` / `kk` / …),
so **177 categorized Amazon rows shatter into ~177 distinct keys, none reaching the 2-example floor** — Amazon
was never suggested despite abundant history. The bracketed disposition tag (`[SALE]`) also survived stripping
as a `sale` token, wasting a key slot.

## Fix (Approach A — progressive backoff + noise strip)

Key at **three granularities** and, per target, take the category from the **most specific level that clears the
confidence bar** (≥ `MIN_SAMPLES` = 2 examples AND a > 50 % majority). The narrow key wins where its 3rd token is
meaningful; we widen only on a miss, so Amazon collapses to `amazon mktpl` (177 rows) without over-broadening
merchants that genuinely need three tokens.

- `merchantKey(desc)` (fixed 3-token) refactored into `merchantTokens(desc)` (normalized, de-doubled token array)
  + `keyCandidates(desc)` → the 3→2→1 leading-token ladder, most-specific first, **deduped** (a 2-token merchant
  yields `["a b", "a"]`, never `"a b"` twice — which would double-count in the corpus).
- `buildLookup()` indexes every history row at **all three** granularities, so backoff consults the same corpus at
  whichever level the target resolves to. `suggestForIds()` walks the ladder and returns the first confident hit,
  reporting the level used in `merchant_key`. Majority-vote extracted into a pure `decide(map)` helper.
- `sale` / `return` / `refund` added to the stop list so US-card `[…]` disposition tags stop eating a key slot.
- `merchantKey` stays exported and byte-identical (leading 3 tokens) for any caller that relies on it.

The ≥2-sample / > 50 %-majority guards are **unchanged** — coverage was widened, precision was not loosened.

## Verification

Simulated read-only against the **live 37,124-row prod corpus**:

| Merchant | Before | After |
|---|---|---|
| `AMAZON MKTPL*…` | *nothing* (177 rows fragmented by order id) | **Chris Spending** — key `amazon mktpl`, 162 samples, 92 % |
| `MARSHALLS` | nothing | Purchases - Clothing, 68, 88 % |
| `PUBLIX` | nothing | FL - Groceries, 100, 76 % |
| `HL SUPERMARKET` | nothing | FL - Groceries, 3, 100 % |
| `TARGET` / `McDONALD'S` / `7-ELEVEN` / `RACETRAC` | nothing | **still nothing — correctly** |

The four that still abstain do so **because their history is genuinely split** (Target's top category is only 28 %
of 144 uses; McDonald's 47 %; RaceTrac a 3-way tie) — the majority guard rightly withholds rather than guessing.
Backoff unlocked Amazon without forcing bad guesses on ambiguous merchants.

New pure unit suite [`categorySuggest.test.js`](../../server/src/v2/services/__tests__/categorySuggest.test.js)
(7 tests): token normalization, the Amazon fragmentation ladder, level-dedup on short merchants, most-specific
ordering, and `merchantKey` backward-compatibility. All green.

## Not done / notes
- Live click-through of the actual button was **not** driven end-to-end; the algorithm was verified offline against
  real prod data and by unit tests. Exercise "Suggest categories" on the next real feed batch.
- Thresholds deliberately untouched. If genuinely-known merchants still get skipped after real use, revisit
  `MIN_SAMPLES` / `MIN_MAJORITY` then — not before.
