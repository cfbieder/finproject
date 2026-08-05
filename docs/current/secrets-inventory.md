# Secrets Inventory — Fin

> Names and locations ONLY — NEVER values. Convention:
> [documentation standard](../documentation-standard.md); handling rules load from
> `.claude/rules/env-secrets.md`. Review whenever a CR adds an integration.

| Secret (env var) | Used by | Lives in | Escrowed? | Last rotated | Rotation trigger |
|---|---|---|---|---|---|
| POSTGRES_PASSWORD | postgres + server (all three stacks) | `.env` at repo root on 192.168.1.87 (fail-loud since CR034) | ☐ | 2026-06 (CR034 hardening) | exposure / host migration |
| BANK_FEED_API_KEY | server ↔ bank-feed microservice (:3007) | `.env` at repo root; counterpart in `bank-feed/` repo config | ☐ | 2026-06 (CR034) | exposure / bank-feed redeploy |
| FINTABLE_API_TOKEN | bank-feed → fintable REST API V2 (CR059) | `bank-feed/.env` on 192.168.1.87 (placeholder in `.env.example`) | ☐ | 2026-07-28 (created) | **expires 1 year — 2027-07-28** / exposure / scope change (read → write for reconnect) |
| ~~anthropic_api_key~~ | nothing in Fin | REMOVED 2026-08-05 (v3.14.2) from `components/data/appdata.json` **and** the `app_data` table | n/a | **REVOKED 2026-08-05** (console key `chris-ocme-api-key`) | closed |

**Removed 2026-08-05 — `anthropic_api_key`.** `GET /api/v2/util/appdata` returned the whole
appdata document to any caller (v3 has no auth), including this key, reachable over the Tailscale
origin. **Nothing read it** — AI Review goes through the ocr-llm gateway (`LLM_GATEWAY_URL`), and
it appears nowhere in `server/` or `frontend/src`. Value deleted from both stores (each backed up
to the gitignored `Backups/` first) and the endpoint now omits any key whose NAME looks like a
credential — matched by pattern rather than a list, because the failure mode is a key nobody
thought to add to a list. **Never in git history:** the historically-tracked `appdata.json` blobs
carry no value.

**Revoked 2026-08-05** — console key `chris-ocme-api-key`. Two things the revocation surfaced that
are worth keeping:

- **It was still in use.** The console showed *last used 2026-07-23*, thirteen days before
  revocation — while Fin itself has had **no Anthropic consumer at all** since AI Review moved to
  the ocr-llm gateway (no `@anthropic-ai/sdk`, no `api.anthropic.com`, no `ANTHROPIC_API_KEY`
  anywhere in `server/src` or `frontend/src`). Whatever used it lives off this host and was never
  identified. The plausible-looking inference — that a `…-key2` alongside it meant a rotation had
  already happened — was **wrong**: key2 was the idle one. *Check last-used before revoking; do not
  reason from key names.*
- **Plaintext copies outlive the deletion.** The pre-deletion `Backups/appdata_before_key_removal_*`
  files were shredded 2026-08-05, and a host-wide sweep for `sk-ant-api03-` now returns nothing.
  But **every `pg_dump` taken before 2026-08-05 01:49 still contains the key inside the `app_data`
  table** — harmless now it is revoked, and the reason revocation, not deletion, is what ends an
  exposure.

*Lesson for this table: a secret can live in a **data document**, not only in `.env`, and nothing
here would have listed it.*

Non-secret endpoint config that travels with `.env` (no rotation): `BANK_FEED_URL`,
`LLM_GATEWAY_URL` (ocr-llm gateway, Tailscale), `CORS_ORIGINS`, `VITE_APP_VERSION`
(auto-managed by `Scripts/bump-version.sh`).

**Gaps / TODO:** escrow status unknown for both secrets (no off-box copy recorded) —
decide an escrow location and tick the column. v4 (CR027) auth will add a JWT/session
secret when `AUTH_ENABLED` becomes real — add its row in that CR.
