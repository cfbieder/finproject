# Secrets Inventory — Fin

> Names and locations ONLY — NEVER values. Convention:
> [documentation standard](../documentation-standard.md); handling rules load from
> `.claude/rules/env-secrets.md`. Review whenever a CR adds an integration.

| Secret (env var) | Used by | Lives in | Escrowed? | Last rotated | Rotation trigger |
|---|---|---|---|---|---|
| POSTGRES_PASSWORD ⚠️ **EXPOSED 2026-09-08 — owner declined rotation, note below** | postgres + server (all three stacks) | `.env` at repo root on 192.168.1.87 (fail-loud since CR034) | ☐ | 2026-06 (CR034 hardening) | exposure / host migration |
| BANK_FEED_API_KEY | server ↔ bank-feed microservice (:3007) | `.env` at repo root; counterpart in `bank-feed/` repo config | ☐ | 2026-06 (CR034) | exposure / bank-feed redeploy |
| FINTABLE_API_TOKEN | bank-feed → fintable REST API V2 (CR059) | `bank-feed/.env` on 192.168.1.87 (placeholder in `.env.example`) | ☐ | 2026-07-28 (created) | **expires 1 year — 2027-07-28** / exposure / scope change (read → write for reconnect) |
| TRADIER_ACCESS_TOKEN ⚠️ **EXPOSED 2026-09-08 — owner declined rotation, note below** | **host-run scripts only** (CR093 — daily price history via `/v1/markets/history`, single-name sector via `/beta/markets/fundamentals/company`). ⚠️ **Not mapped into any container**, and must be if a server-side caller is ever added — a value in `.env` alone never reaches one, which is the omission that 401'd AI Review on the v4 stack | `.env` at repo root on 192.168.1.87 (placeholder in `.env.example`) | ☐ | 2026-09-05 (created, owner's existing brokerage account) | exposure / brokerage account change. Measured on creation: history 3,112 daily bars to 2014-04-17; single-name sector 12/12; **fund asset class and fund sector weights BOTH null** for QQQ and FLDR, which is why it is not the fund-data provider |
| ~~FMP_API_KEY~~ | **nothing** | **REMOVED from `.env` 2026-09-08** | n/a | never verified | closed |
| OCR_LLM_CLIENT_KEY (printed in cleartext 2026-09-06 — **owner decided not to rotate**, note below) | server → ocr-llm gateway `/task` — **three callers**: AI Review (`server/src/v2/services/aiReview.js`), the CR092 P1 net-worth narration (`server/src/services/netWorthNarration.js`) and, host-run, `Scripts/extract-statements-llm.js` (CR061 P2). Sent as the `X-Client-Id: finance` + `X-Client-Key` PAIR, or not at all | `.env` at repo root on 192.168.1.87 — **joined there 2026-09-08 by the non-secret `OCR_LLM_CLIENT_ID=finance`**, which no Fin code reads (all three callers hardcode the id) and which exists solely for ocr-llm's handoff-inbox CLI; **mapped explicitly in `docker-compose.yml` and `docker-compose.dev.yml`** — that service uses an `environment:` block, so a value sitting in `.env` alone never reaches the container. **mapped in `docker-compose.v4.yml` too since 2026-09-04** — it had been absent, which 401'd AI Review on the v4 stack (:3205); ocr-llm's 2026-08-31 audit could not have caught it, because it probed the eleven *running* containers and the v4 one was not up | ☐ | 2026-08-27 (created) | exposure / gateway re-keying. ✅ **The gateway now ENFORCES it** — `CLIENT_AUTH_MODE=enforce` live since 2026-08-31; re-measured 2026-09-04, `POST /task` returns **401 `client_unidentified`** with no headers **and** with a wrong key, reversing the 2026-08-27 note that stood here (422 regardless of key). It authenticates, and the id is discarded unless the key matches. `aiReview.js` **throws before the fetch** when the var is empty (2026-09-04) rather than sending an unkeyed request and reporting the 401 as a failed review. ⚠️ **`netWorthNarration.js` deliberately does NOT throw** — it warns and returns `reason: 'not-configured'`, because its narration is an enhancement over a deterministic summary that is already on screen. So on that surface a missing compose mapping presents as *no prose*, never as an error: check the server log for `[nw-narration]`, not the page |
| ~~anthropic_api_key~~ | nothing in Fin | REMOVED 2026-08-05 (v3.14.2) from `components/data/appdata.json` **and** the `app_data` table | n/a | **REVOKED 2026-08-05** (console key `chris-ocme-api-key`) | closed |

**`POSTGRES_PASSWORD` and `TRADIER_ACCESS_TOKEN` were printed in cleartext on 2026-09-08.
Logged, NOT rotated — owner decision, same day.** An agent session added `OCR_LLM_CLIENT_ID` to
`.env` and printed the surrounding lines back to confirm the insert, redacting with a pattern that
matched **only** `KEY=`. Two of the five lines shown were other secrets and neither matched, so both
resolved values went to the terminal and into that session's transcript. **Scope:** local terminal
output and the conversation transcript; neither value was sent to a third party, written to a file,
or committed. The owner declined rotation for both — the database is reachable only on the LAN /
Tailnet and rotating it means the role plus three compose stacks, and the Tradier token is read-only
against the owner's own brokerage account. Recorded here **so the next reader does not mistake an
unrotated key for an unnoticed one**; if either calculus changes, rotate then.

⚠️ **This is the SECOND redaction failure in three days, and the 2026-09-06 note below already
carried the rule that would have stopped it** — *check for presence rather than printing a line that
contains the value at all.* The mechanism differed (that one echoed the match through a
back-reference; this one used a filter narrower than what it printed), which is exactly how an acked
lesson gets re-learned: the fix was remembered as a `sed` idiom to avoid rather than as **do not
print `.env` lines**. There is no safe redaction of a multi-secret file. **Verify an `.env` edit with
`grep -c`, `cut -d= -f1`, or `git diff --stat` — never by printing the region you just changed.**

**`OCR_LLM_CLIENT_KEY` was printed in cleartext on 2026-09-06. Logged, NOT rotated — owner
decision, same day.** An agent session ran `docker compose -f docker-compose.v4.yml config` to confirm the
v4 stack maps the var, and the `sed` intended to redact the output used `&` in the replacement —
which re-inserts the whole match — so the resolved value was written to the terminal and into that
session's transcript. **Scope:** local terminal output and the conversation transcript; the value
was not sent to any third party, not written to a file, and not committed. The documented trigger for this var is
"exposure / gateway re-keying", and this qualifies on the letter of it; the owner judged it
immaterial and declined to rotate — the gateway is self-hosted on the owner's own Tailnet, the
`finance` client holds no frontier grant and spends $0.00, and the value never left the host except
into that transcript. Recorded here rather than acted on **because the next reader must not mistake
an unrotated key for an unnoticed one.** If the calculus changes (the gateway ever faces outward, or
a frontier grant is issued to `finance`), rotate then: it is two-sided — ocr-llm holds the
counterpart and all three Fin callers 401 the moment the sides disagree. **The durable lesson is about the redaction, not the key:**
a `sed 's/\(KEY: \).*/\1<redacted: &>/'` reveals exactly what it claims to hide, and it *looks*
redacted in the script. **Never construct a redaction with a back-reference that can echo the
match** — filter to the field name only (`grep -c`, or `cut -d: -f1`), or check for presence
(`[ -n "$V" ] && echo set`) rather than printing a line that contains the value at all.

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

**Removed 2026-09-08 — `FMP_API_KEY`, and it was never verified in the first place.**
Provisioned 2026-09-05 for CR093's fund sector weights — the one requirement Tradier could not
serve. It was **rejected by FMP three ways** (query param, Bearer header, v4 path) and its shape did
not match theirs (64 characters with an underscore against FMP's 32 hex), so it may have belonged to
a different service entirely. **FinImpulse took that job** (`Scripts/load-fund-reference.js`,
migration 077) and FMP was never wired to anything: grepped 2026-09-08 across `server/src`,
`Scripts`, `frontend/src` and every compose file — **no consumer**.

⚠️ **An unidentified credential is worth less than nothing.** It cannot be rotated (we do not know
whose it is), it cannot be revoked from here, and it sat in `.env` looking like a live dependency —
so the next person to read this file would have had to re-derive that it was dead. Removed rather
than left as documentation of a dead end; this note is the documentation.

⚠️ **Removal is not revocation.** If that value IS live somewhere, deleting our copy does nothing to
it. It was never used against any account we can see, but the owner should treat it as a string that
existed on this host and act accordingly if they recognise it.

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

**Gaps / TODO:** escrow status unknown for the live secrets (no off-box copy recorded) —
decide an escrow location and tick the column. v4 (CR027) auth will add a JWT/session
secret when `AUTH_ENABLED` becomes real — add its row in that CR.
