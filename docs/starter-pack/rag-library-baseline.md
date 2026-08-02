# RAG / Vector-Library Baseline

> **Pack role:** the correctness floor for **building a retrieval library** — an embedding +
> vector store (ChromaDB/pgvector/etc.) that an LLM queries, plus any structured side-store it
> pairs with. [`data-ingestion-baseline.md`](data-ingestion-baseline.md) covers *tabular* import
> safety (CSV/API → rows → recompute); this doc covers *semantic* ingest safety — the layer where
> failures are even quieter, because a broken retrieval returns **fewer or subtly-wrong
> neighbours**, the LLM answers plausibly on top of them, and nothing anywhere throws. Every rule
> below was learned from a real incident.
>
> **Last reviewed:** 2026-07-11.

## Why

A RAG bug doesn't 500 — it *under-answers*. The store returns 3 chunks instead of 8, or the wrong
3, or none for one metadata filter; the model stitches a confident answer from whatever came back;
the UI is green. Worse, some failures are **collection-wide**: a single doc embedded the wrong way
can poison a vector index so that *other* queries return nothing. The rules below make each failure
loud at ingest time instead of silent at answer time. They are provider-agnostic — they hold for
ChromaDB, pgvector, Qdrant, or a hosted index.

## 1. One embedder, one vector space — pin the model *and* the convention

Every write into a collection and every query against it must use the **identical** embedding
model, endpoint, output dimensionality, and any task prefixes the model expects (e.g.
nomic-embed's `search_document:` / `search_query:`). Vectors from two different embedders (or the
same model with different prefixing) live in **incompatible spaces**; mixing them in one collection
makes similarity meaningless and can corrupt the index.

- Give the embedder its **own dedicated config** (a distinct env var, not reused from a chat/LLM
  URL) so it can move hosts without re-pointing anything else — and so nobody silently falls back
  to the vector DB's *default* built-in embedder (a different model entirely).
- The embedding model, dimension, and prefix convention are **contract**, recorded once next to
  the store. Changing any of them means re-embedding the whole collection, not a partial write.
- *Incident:* a curated collection was embedded by the gateway's own Ollama pipeline, but a second
  admin HTTP endpoint re-chunked and embedded through a different path; docs written that way
  landed in an incompatible space and **poisoned the collection's HNSW index** — retrieval then
  returned nothing for any query whose metadata filter touched a bad doc, not just the bad doc
  itself (ocr-llm, 2026-07-04).

## 2. One canonical write path per store — every other surface is read-only

A collection built by pipeline X must only ever be **written** by pipeline X. Do not expose a
second, "convenient" ingest surface (an admin-UI file upload, a generic HTTP `ingest_documents`)
onto a store that a stable pipeline owns.

- If a second surface must exist, it either **refuses the managed collections** by name, or routes
  through the *same* embed+chunk+upsert code — never a parallel implementation.
- An auth key on the admin surface is **defense-in-depth, not the safeguard**. The real safeguard
  is that a managed collection has exactly one writer. (Handing a trusted operator the ingest key
  doesn't make the *wrong path* safe — it just makes it authenticated. Route them to the canonical
  path instead.)
- Document the one true ingest command per corpus so "how do I add a doc?" has a single answer.

## 3. Upsert by a stable, source-derived id — never by chunk position or text hash

Every document gets a **deterministic id** from its source identity (`<entity-key>-<chunk-index>`),
so re-ingesting the same source **replaces** its vectors instead of appending new ones.

- Position-ordinal or hash-of-text ids create **orphans on every re-run**: the old vectors linger,
  retrieval returns stale + new, and `count()` drifts upward forever.
- Re-ingest must be **idempotent**: same source in ⇒ same collection out, byte-for-byte in effect.
- Provide an explicit `--reset` (drop + rebuild) as the *separate* recovery path — for purging
  entities removed from source or repairing a corrupted index — distinct from the default upsert.
  A reset has a brief empty-retrieval window; an upsert has none.

## 4. Chunking is part of the contract — pin it, and re-chunk means full reset

Chunk size, overlap, and boundary rules are baked into what actually got embedded. They are not a
tuning knob you change casually.

- Two ingest paths with **different chunkers** against one collection (1-doc-1-chunk vs. a
  paragraph splitter) is rule 1's incompatibility in another guise — same-source ids won't line up
  and orphans accumulate.
- Changing the chunker silently changes retrieval quality **and** breaks id stability. Treat a
  chunking change as a schema change: re-embed the whole collection under `--reset`.

## 5. Structured facts and semantic recall are different stores — don't cross them

Split by *how the data is queried*, not by where it came from.

- **Exact-match / filterable facts** (drug-interaction pairs, prices, codes, canonical lookups) →
  a **structured store** (SQLite/Postgres table), upsert by a UNIQUE key, **no embeddings**. Exact
  questions deserve exact answers.
- **Fuzzy / semantic recall** (prose, monographs, passages) → the **vector store**.
- Forcing exact-lookup facts into a vector store gives you *approximate* answers to questions that
  had a right answer — and no error when it's wrong.

## 6. The published catalog is derived — regenerate it, never hand-edit it

Whatever clients read to discover your stores (record counts, descriptions, which task uses which
collection) must be **regenerated from the source of truth after every ingest**, or clients pin to
stale numbers.

- Wire regeneration into the ingest runbook as a required final step (`reingest → regenerate
  catalog`), and enforce non-drift with a **pre-commit check** against the registry.
- A hand-edited count is a lie with a timestamp — it looks authoritative and is wrong the next
  ingest.

## 7. Make ingestion one reproducible, self-service command

Replace ad-hoc `docker exec … ingest.py` / hand-typed `curl` with **one script** per corpus that
does *sync-source → render → upsert → (remind to) regenerate-catalog*, plus a `--dry-run` that
parses, shows the plan, and writes nothing.

- The script **is** the spec for how that corpus is ingested — reproducible, reviewable, and safe
  to hand to the consuming app's operator.
- Same person owns client and host? Still script it. "No trust boundary" removes the *auth*
  concern (rule 2), never the *correctness* concern — the script is what keeps the right path the
  easy path.

## Adopting

1. Read this before standing up any embedding + vector store, or adding a corpus to one.
2. The always-on distillation is [`.claude/rules/rag-ingest.md`](.claude/rules/rag-ingest.md)
   (path-scoped to embedding/retrieval/vector/ingest files) — it fires when you touch RAG code.
3. New corpus → the CR's impact checklist should confirm: single embedder pinned, single write
   path, stable-id upsert + `--reset` path, chunking pinned, structured-vs-semantic split
   deliberate, catalog regenerated.
4. Provider-with-multiple-clients? Pair this with
   [`cross-repo-integration.md`](cross-repo-integration.md) — a store's shape is part of the
   contract clients pin to.
