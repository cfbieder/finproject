# Secrets Inventory — Fin

> Names and locations ONLY — NEVER values. Convention:
> [documentation standard](../documentation-standard.md); handling rules load from
> `.claude/rules/env-secrets.md`. Review whenever a CR adds an integration.

| Secret (env var) | Used by | Lives in | Escrowed? | Last rotated | Rotation trigger |
|---|---|---|---|---|---|
| POSTGRES_PASSWORD | postgres + server (all three stacks) | `.env` at repo root on 192.168.1.87 (fail-loud since CR034) | ☐ | 2026-06 (CR034 hardening) | exposure / host migration |
| BANK_FEED_API_KEY | server ↔ bank-feed microservice (:3007) | `.env` at repo root; counterpart in `bank-feed/` repo config | ☐ | 2026-06 (CR034) | exposure / bank-feed redeploy |
| FINTABLE_API_TOKEN | bank-feed → fintable REST API V2 (CR059) | `bank-feed/.env` on 192.168.1.87 (placeholder in `.env.example`) | ☐ | 2026-07-28 (created) | **expires 1 year — 2027-07-28** / exposure / scope change (read → write for reconnect) |
| TRADIER_ACCESS_TOKEN | **host-run scripts only** (CR093 — daily price history via `/v1/markets/history`, single-name sector via `/beta/markets/fundamentals/company`). ⚠️ **Not mapped into any container**, and must be if a server-side caller is ever added — a value in `.env` alone never reaches one, which is the omission that 401'd AI Review on the v4 stack | `.env` at repo root on 192.168.1.87 (placeholder in `.env.example`) | ☐ | 2026-09-05 (created, owner's existing brokerage account) | exposure / brokerage account change. Measured on creation: history 3,112 daily bars to 2014-04-17; single-name sector 12/12; **fund asset class and fund sector weights BOTH null** for QQQ and FLDR, which is why it is not the fund-data provider |
| FMP_API_KEY | **host-run scripts only** (CR093 — ETF/fund sector weights, the one requirement Tradier cannot serve) | `.env` at repo root on 192.168.1.87 (placeholder in `.env.example`) | ☐ | 2026-09-05 (created) | exposure / plan change. ⚠️ **Unverified as of 2026-09-05** — the value present is rejected by FMP three ways (query param, Bearer header, v4 path) and its shape does not match FMP's (64 chars with an underscore against FMP's 32 hex), so it may be a key for a different service. Expected usage is ~28 calls per refresh against a 250/day free tier |
| OCR_LLM_CLIENT_KEY | server → ocr-llm gateway `/task` (AI Review, `aiReview.js`) — sent as the `X-Client-Id: finance` + `X-Client-Key` PAIR, or not at all | `.env` at repo root on 192.168.1.87; **mapped explicitly in `docker-compose.yml` and `docker-compose.dev.yml`** — that service uses an `environment:` block, so a value sitting in `.env` alone never reaches the container. **mapped in `docker-compose.v4.yml` too since 2026-09-04** — it had been absent, which 401'd AI Review on the v4 stack (:3205); ocr-llm's 2026-08-31 audit could not have caught it, because it probed the eleven *running* containers and the v4 one was not up | ☐ | 2026-08-27 (created) | exposure / gateway re-keying. ✅ **The gateway now ENFORCES it** — `CLIENT_AUTH_MODE=enforce` live since 2026-08-31; re-measured 2026-09-04, `POST /task` returns **401 `client_unidentified`** with no headers **and** with a wrong key, reversing the 2026-08-27 note that stood here (422 regardless of key). It authenticates, and the id is discarded unless the key matches. `aiReview.js` **throws before the fetch** when the var is empty (2026-09-04) rather than sending an unkeyed request and reporting the 401 as a failed review |
| ~~anthropic_api_key~~ | nothing in Fin | REMOVED 2026-08-05 (v3.14.2) from `components/data/appdata.json` **and** the `app_data` table | n/a | **REVOKED 2026-08-05** (console key `chris-ocme-api-key`) | closed |

**Not env vars, but they belong on this page: the CR082 identity data.** Locations only, per this
file's standing rule — and the reason they are listed is the lesson at the bottom of it, that a
secret can live in a *data document* and nothing here would have named it.

| Data | Lives in | Served how | Never in |
|---|---|---|---|
| Foreign bank account numbers (full) | `accounts.account_number` · `tax_foreign_accounts.own_account_number` — **Postgres only** | Masked in every list; full value only from `GET /util/coa/:id/account-number` and `GET /tax/designations/:id/number`, one account at a time | No file, no log line, no `audit_log` payload, no diagnostic dump. **`GET /util/coa-traits` served all 230 in full until CR082 P0a (2026-08-16)** |
| Filer TIN and date of birth (Form 114 Part I) | `app_data.tax_filer` — **Postgres only** | Masked by `GET /tax/filer` (TIN to last four, DOB to year); full values only from `GET /tax/filer/reveal` | Omitted from `GET /util/appdata`, which merges the whole `app_data` table into its response. **`POST /util/appdata` REFUSES this key** — that handler persists to a JSON file on disk |
| Joint-owner name / TIN / address | `tax_foreign_accounts.joint_owner_*` — Postgres only | Designation editor | As above |

⚠️ **These are not rotatable.** A leaked API key is revoked; a leaked TIN, date of birth or IBAN is
leaked permanently. That asymmetry is why the controls are placement (Postgres, never a document)
and blast radius (no bulk payload ever carries them) rather than rotation — and why every `pg_dump`
in `Backups/` taken after 2026-08-15 contains all of it in plaintext, the same way the pre-2026-08-05
dumps still carry the revoked Anthropic key.

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

**Gaps / TODO:** escrow status unknown for all three secrets (no off-box copy recorded) —
decide an escrow location and tick the column. v4 (CR027) auth will add a JWT/session
secret when `AUTH_ENABLED` becomes real — add its row in that CR.
