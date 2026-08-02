---
paths:
  - "**/*embed*"
  - "**/*retriev*"
  - "**/*ingest*"
  - "**/*vector*"
  - "**/*chroma*"
  - "**/*rag*"
---
# RAG / vector-ingest rules

Full reasoning: [`rag-library-baseline.md`](../../rag-library-baseline.md). Retrieval fails
*silently* — it returns fewer or wrong neighbours and the LLM answers plausibly on top. Make
ingest loud and idempotent.

- **One embedder, one vector space.** Every write to a collection AND every query against it uses
  the identical model, endpoint, dimension, and task prefix (e.g. nomic's `search_document:` /
  `search_query:`). Two embedders in one collection = incompatible vectors; a wrongly-embedded doc
  can poison the whole index so unrelated filtered queries return nothing. Embedder gets its **own**
  env var; never fall back to the vector DB's default built-in embedder.
- **One canonical write path per store.** A collection built by pipeline X is written only by
  pipeline X; every other surface (admin UI upload, generic HTTP ingest) is read-only or refuses
  the managed collections. An auth key is defense-in-depth, not the safeguard — the safeguard is a
  single writer. Don't route a trusted operator onto the wrong path just because they hold the key.
- **Upsert by stable source-derived id** (`<entity>-<chunk>`), never chunk-position or text-hash —
  those orphan old vectors on every re-run and drift the count up forever. Re-ingest must be
  idempotent. Provide a separate `--reset` (drop+rebuild) for purging removed entities / repairing
  the index.
- **Chunking is contract.** Size/overlap/boundaries are baked into the embeddings; a chunking
  change breaks id stability and retrieval quality — treat it as a schema change (full re-embed
  under `--reset`), and never run two different chunkers against one collection.
- **Structured vs. semantic are different stores.** Exact-match/filterable facts → a structured
  table (upsert by UNIQUE key, no embeddings); fuzzy recall → the vector store. Don't put
  exact-lookup facts behind approximate search.
- **Regenerate the published catalog** (record counts, store/task backlinks) after every ingest —
  never hand-edit it — and gate drift in pre-commit. Prefer **one self-service script** per corpus
  (sync → render → upsert → regenerate) with a `--dry-run`.
