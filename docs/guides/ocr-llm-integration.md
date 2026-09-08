# ocr-llm integration (local LLM gateway)

> Moved out of `CLAUDE.md` 2026-07-11 (starter-pack adoption). The gateway is a separate
> repo/system — never modify it while working in Fin, except appending handoff entries as
> described below.
>
> **Protocols last reviewed 2026-09-06** against `Documentation/Guides/LLM_PROTOCOLS.md` in
> the ocr-llm repo (the rules-of-engagement doc, added there 2026-09-04). This page records
> only what binds **Fin**; it links onward rather than restating a doc that moves.
> **2026-09-06:** their broadcast ack is filed and closed (`llm-protocols-broadcast-finance`);
> the full migration checklist was run against all three callers — six of seven items held,
> the seventh is [rule 4](#the-rules-that-bind-fin) and it did not (see the box under it).

## Pointers (canonical, in `~/Programs/fin/ocr-llm/`)

| What | Where |
|---|---|
| **Protocols** — the rules of engagement, read first | `Documentation/Guides/LLM_PROTOCOLS.md` |
| Endpoint reference (fields, curl examples) | `Documentation/Guides/API_DOCUMENTATION.md` |
| Every registered task, auto-generated | `Documentation/Guides/TASK_CATALOG.md` |
| First-time wiring of an AI feature | `Documentation/Guides/AI_IMPLEMENTATION_GUIDE.md` |
| How ocr-llm talks to us | `HANDOFFS.md` (+ `handoffs/handoffs.json`, its structured twin) |

- **Base URL:** `http://100.66.213.40:8080` (Tailscale) · `http://192.168.1.61:8080` (LAN — the
  compose default for `LLM_GATEWAY_URL`, since both stacks run on 192.168.1.87).
- **Pinned contract version:** **v1** (`contracts/v1/`; additive changes logged in its
  `CHANGELOG.md`, breaking ones get a new `v{N+1}`). All six client repos pin v1.

## The rules that bind Fin

**1. Identity is mandatory — this is the one that breaks you.** Every call must carry
`X-Client-Id: finance` **and** `X-Client-Key: $OCR_LLM_CLIENT_KEY`. `CLIENT_AUTH_MODE=enforce`
has been live since **2026-08-31**; there is no grace path. Re-measured from this repo
**2026-09-04**: `POST /task` returns **401 `client_unidentified`** with no headers **and** 401
with a wrong key — so the "it only identifies, it does not authenticate" note that stood in the
[secrets inventory](../current/secrets-inventory.md) until today is dead. The id is discarded
unless the key matches, so it is the **pair or nothing**.

> ✅ **Two gaps in our own wiring, found by this review and fixed 2026-09-04.** (a) `aiReview.js`
> sent the headers only when `OCR_LLM_CLIENT_KEY` was non-empty — deliberate while the gateway
> merely observed identity, and a silent path to a 401 on every review once it enforced. It now
> **throws before the fetch**, naming the var and the compose mapping. (b) **`docker-compose.v4.yml`
> did not map the key at all** (both v3 compose files do), so AI Review on the v4 stack (:3205)
> 401'd; it is mapped now. ocr-llm's 2026-08-31 audit probed `fin-server` and `fin-server-dev` —
> **the v4 container was not among the eleven deployments they checked**, so no amount of care on
> their side could have caught it. A **container is the unit of keying, not a repo.**

**2. `POST /task`, never `POST /llm/generate`.** `/task` is where the fallback chain, the
context-window guard, the chain deadline, structured-output enforcement and cost attribution
live; `/llm/generate` has none of it. **Never hardcode a model name** — the routing table is
theirs and has changed several times; `GET /providers` lists what is callable (⚠️ it needs
both headers — measured 401 unauthenticated, 2026-09-04).

**3. Read the `routing` block on every response.**

| field | what to do with it |
|---|---|
| `degradations[]` | Empty is normal. `schema_violation` = nothing in the chain produced conforming output — **the one to alert on**; `schema_enforcement_dropped` = shape came from the prompt alone, validate defensively; `schema_relaxed` = informational (re-checked after the call). Also arrives as the `X-Gateway-Degraded` response header. |
| `schema_level` | The guarantee actually obtained: `CONSTRAINED_DECODE` › `SCHEMA_STRICT` › `SCHEMA_NATIVE` › `JSON_MODE` › `null` (task declares no schema). |
| `fallback_depth` | `0` = the first declared provider served it. |
| `usage.provider_latency_ms` | The **winning step alone**; the difference from the top-level timing is the fallback cost. |

A schema does not prevent **truncation** — repeated `schema_violation` on one task usually means
`max_tokens` is too small.

**4. `routing` reorders; it cannot add.** You may promote a step the task already declares.
An unsatisfiable preference is **not** an error by default — you get the normal chain plus
`routing.preference.applied: false`, so **check that field** rather than assuming you got what
you asked for (send `"on_unsatisfiable": "error"` for a `409`).

> 🔴 **This page carried that rule for a day while the only caller that sends a preference ignored
> it** (fixed 2026-09-06). `Scripts/extract-statements-llm.js` sent `routing` under `--pin-mid` and
> read nothing back; it now warns, naming `preference.reason`. **A doc you have acked is not a doc
> you have applied** — when a rule here says *check field X*, grep for X before believing it holds.
> The guard cannot fire today (`ollama_mid` is a declared step, so `applied` is always `true`); it is
> there for a route change we do not control. Shape verified live instead — `quick_narration` steered
> to `ollama_heavy`, which it does not declare, returns `200` on the default chain with
> `{"applied": false, "reason": "not_in_route"}`. Frontier models (`deepseek`,
`openai`, `kimi`) need four keys plus a per-client grant, **and zero grants are issued** —
irrelevant to Fin, because neither Fin task declares a frontier step at all.

**5. Branch on `detail.error`, never on message text.** What we can actually hit:
`401` unidentified · `409 routing_unsatisfiable` · `413 prompt_too_long` (body carries
`estimated_tokens` / `max_supported`) · `422` validation, incl. `missing_required_context`,
`invalid_context_type`, `empty_prompt` · `502` every provider failed · `503`
`no_providers_available` · `504 deadline_exceeded` (body separates steps **never started**
— unbilled — from those cancelled in flight).

## Fin's three tasks — all LOCAL-ONLY by construction

| task | caller | route | schema | `max_tokens` |
|---|---|---|---|---|
| `finance_plan_review` | `server/src/v2/services/aiReview.js` (AI Review + the CR040 compare narrative) | `ollama_heavy` (`qwen3.6:35b-a3b-q4_K_M`) → `ollama_mid` (`qwen3:32b`) | none — free text with embedded ` ```action ` blocks, so `schema_level` is `null` | 4096 |
| `finance_statement_extract` | `Scripts/extract-statements-llm.js` ([CR061](../cr/cr-061-holdings-and-prices.md) P2) | same | JSON `{positions:[…]}`, server-side system prefix | 8192 |
| `finance_networth_narration` | `server/src/services/netWorthNarration.js` (`POST /v2/reports/net-worth-bridge/narration`, [CR092](../cr/cr-092-net-worth-bridge.md) P1) | same | JSON `{headline, why[{driver,note}], watch_outs[]}` — obtained `CONSTRAINED_DECODE`; five guardrails server-side | 768 (temp 0.3) |

**Local-only means there is no cloud step to fall back to**, which is the point: a holdings table
is every position, quantity and cost basis in a real portfolio, a forecast context is the owner's
whole retirement plan, and a net-worth bridge is the balance sheet broken down by named account —
strictly more revealing than the holdings table. None can leave the Tailnet. ocr-llm **verified** this rather
than asserting it — naming `claude` or `openai` returns `409 routing_unsatisfiable`. The chain
hard-fails rather than degrading to the cloud.

⚠️ **Do not pin `ollama_mid`.** ocr-llm asked for the pin once, for a 56-document bulk run that no
longer exists, then measured it away (2026-09-04, identical input): heavy **17.0s / 37.9 tok/s**
vs mid **28.4s / 20.2 tok/s**, subtotals tie 3/3 on both — heavy is 1.7× faster and the path they
validated, and the gap widens with prompt length. `--pin-mid` survives in the script for a future
bulk run only.

⚠️ **The gateway takes no per-request schema.** Schemas are declared per task in its catalog, so a
new response shape needs a handoff, not a call we can make ourselves.

✅ **Check your abort against the task's `deadline_ms` — `GET /task/routes` reports it, since
2026-09-05.** Every task carries `deadline_ms` (the **effective** value, never null) and
`deadline_source` (`task` or `global_default`) — the second field is the one that matters, because
`600000` from a deliberate choice and `600000` inherited from the global default are different facts.
Ours today:

| task | `deadline_ms` | source | our abort |
|---|---|---|---|
| `finance_networth_narration` | 90 000 | `task` | 120 000 ✅ |
| `finance_statement_extract` | 600 000 | `task` | 720 000 ✅ |
| `finance_plan_review` | 600 000 | `global_default` | 660 000 ✅ |

**All three verified correctly ordered 2026-09-06** — ocr-llm's deadline fires first in every case. ⚠️ `finance_statement_extract`'s 600 000 is a **deliberate non-measurement**: *"no tighter than the default until someone has an uncensored measurement."* Fin owes them the real distribution after the next quarterly filing; do not cite 600 000 as an estimate of that task's tail.

⚠️ **The ordering is load-bearing in BOTH directions, and both failures are silent.** Each bound must
be looser than the one it wraps: `chain < their deadline_ms < our abort < the browser`. A deadline
*below* its own chain silently deletes the fallback step. One *above* our abort leaves an abandoned
request pinning a serialised tier, because **our abort never reaches their GPU** (uvicorn does not
cancel a handler on client disconnect — their measurement, 2026-09-04). **Run this check whenever you
add a caller or change a timeout** — one command found two inversions that had been live for months
([Known Issue #28](../current/project-roadmap.md#3-known-issues)), one of them latent and one that had
already cost us three silently-unextracted statements.

⚠️ **A gateway `200` does not mean the client received it.** Their abort does not propagate on client
disconnect, so a call we walk away from still runs to completion and is logged as a success.
**Reproduced accidentally 2026-09-06**: a smoke test of `extract-statements-llm.js` started a real
run, the client was killed at ~11:41Z, and their `/clients` counters recorded the call as **served
at 11:43:14Z** — two minutes after there was anyone to receive it, holding an `ollama_heavy` slot
throughout. Our side had no trace at all (no `--emit`); theirs had a success. Their
`api_log` held four `finance_statement_extract` successes above 420 s; **three were above our own
abort**, i.e. answers delivered to a closed socket. When reading their logs against ours, compare
every latency to *our* abort before concluding a call succeeded for us.

⚠️ **Beware a maximum that sits just under the cap that bounded it.** The 599.3 s worst case above is
99.9% of the 600 s global default in force at the time — a ceiling artefact, not the tail. Do not set
a deadline from a censored sample; say so and go get an uncensored one.

### Three things measured while adopting `finance_networth_narration` (2026-09-05)

⚠️ **Vocabulary put in the prompt comes back AS the answer.** Tagging each driver
`(with the change)` to fix a leading-driver ordering problem made the model return the *tags* as
the note text — six schema-valid lines carrying no figure. Convey intent by ORDERING what you send,
not by inventing labels the model can echo. Validate defensively for the class, not the instance:
`netWorthNarration.js` drops any note containing no digit.

⚠️ **A response field can arrive as a duplicate of another.** `watch_outs` came back byte-identical
to the `why` notes (2/2 on one run, 6/6 on another), so the page rendered everything twice.
✅ **ocr-llm fixed it at the task PREFIX the same day** (their rule 6: `why` explains a driver that
moved, `watch_outs` flags what a reader could misread, and an empty array beats a duplicate) —
re-verified against the raw gateway, 3 runs, 0 duplicates. Our parser still de-duplicates as defence
in depth: their fix is a prompt rule and so probabilistic, ours is a structural check that one
response field is not a copy of another, and the two fail independently.

⚠️ **An EMPTY required-context array reads as MISSING.** `{"drivers": []}` returns
`422 missing_required_context` — the check is truthiness, not presence — so short-circuit before the
call rather than spending a round trip. Equally: the routing field is `routing.provider`, **not
`routing.prefer`** — a mistyped key used to return 200 on the default chain and say nothing, which
cost us a measurement (we believed we had timed the fallback step and had timed the first step
twice). ✅ **Now a `422 extra_forbidden` naming the bad key**, shipped 2026-09-05 in v1 on the
grounds that no correct caller changes behaviour. A routing preference you did not verify is still a
routing preference you do not have.

⚠️ **Verify identity from INSIDE each deployment, against a gated route — not from a shell, and not
via `/clients`.** Two false passes in one day, both retracted the same day:
`GET /health` and `GET /task/routes` return `200` **unauthenticated** (measured 2026-09-06), so
their original §1 recipe answered the same for an identified and an unidentified caller; and
`GET /clients` — which *is* gated, and which this guide recommended for a few hours — answers
*"is this **client** identified"*, **not** *"is this **deployment** identified"*. An unidentified
call is logged under `_unidentified` and can never reach our own `rejected` counter, so our row
reads clean while a container 401s. 🔴 **That is not hypothetical for Fin: it is exactly what the v4
stack did for days** (fixed 2026-09-04) — one deployment unkeyed, the client row green throughout.
Their §1 and the migration checklist now carry the per-deployment form. Ours:

```bash
docker exec <container> sh -lc 'wget -qO-   --header="X-Client-Id: finance" --header="X-Client-Key: $OCR_LLM_CLIENT_KEY"   "$LLM_GATEWAY_URL/providers" >/dev/null && echo OK || echo FAIL'
```

**Run it three ways, not one** — with the headers, without them, and with a wrong key. A probe that
cannot fail has not run: if the no-header call also returns `OK`, you are testing an ungated route
and learning nothing. Measured 2026-09-06 on `fin-server` and `fin-server-dev`: `OK` / `FAIL` /
`FAIL` on both. The v4 stack was down; its compose maps the key non-empty
(`docker compose -f docker-compose.v4.yml config`), which is a static check, not a probe — **re-run
the real one whenever :3205 is next up.**

⚠️ **Do not build anything on `/clients` `source_ips`.** It is the **observed peer** address, not the
calling machine: anything arriving through Docker's published port records as the bridge
`172.18.0.1`, so distinct hosts collapse into one entry and a specific box may never appear — the
list is also capped at the 4 most frequent. **An absent address is not evidence that a host is not
calling.** We measured this the hard way on 2026-09-06 — a call from `100.94.46.62` moved `calls`
and `last_seen` in the same payload that left `source_ips` unchanged, and we inferred a stale field
before ocr-llm's answer landed; the bridge address was already in the list we had printed. The
caveat is now in the pinned spec (`CLIENTS_200`), not in the payload, so it is in
`contracts/v1/openapi-gateway.yaml` rather than anywhere a reader of `/clients` will see it.

## The handoff inbox — the server tells us what we owe (installed 2026-09-08)

A `git push` proves someone **sent**; nothing in git proves anyone **received**. `GET
/handoffs/inbox` (ocr-llm CR-024) answers *"what does Fin owe?"* over the same authenticated
channel as `/task` — **no new credential**. Their kit is installed here:

| Piece | Where |
|---|---|
| SessionStart hook (a 2-line shim) | `.claude/hooks/handoff-inbox.sh` → execs the kit inside the ocr-llm clone |
| Registration | third `SessionStart` entry in `.claude/settings.json` |
| The CLI itself | `~/Programs/fin/ocr-llm/tools/client-kit/handoff` — **not copied**, so their `git pull` updates it |
| Config | `OCR_LLM_CLIENT_ID=finance` + `OCR_LLM_CLIENT_KEY` in **`.env` at the repo root**, that file only |

Check any time: `~/Programs/fin/ocr-llm/tools/client-kit/handoff inbox`.

⚠️ **`OCR_LLM_CLIENT_ID` exists for the CLI and nothing else.** All three Fin callers hardcode
`X-Client-Id: 'finance'` as a source literal, so until 2026-09-08 the id had never been in `.env`
at all and the CLI exited 3. **A repo can send the pair to `/task` every day and still not hold
the pair as configuration.** The CLI reads the **repo-root `.env` only** — a pair in
`server/.env` is deliberately not searched.

**Reading what the hook printed:**

| It says | It means |
|---|---|
| *(nothing)* | The inbox was empty **and** their checkout was current. That combination only. |
| `YOU OWE THE NEXT MOVE` | `git pull --ff-only` the clone and read the thread at the `HANDOFFS.md:` anchor shown. |
| `waiting on ocr-llm` | We have replied; they owe the next move. Listed, not actionable. |
| `COULD NOT CHECK` (exit 2) | **Unknown, not clear.** Never read it as nothing outstanding. |
| `not configured` (exit 3) | The pair is missing from the environment and the root `.env`. |
| `STOP AND WAIT` | They hold unpushed commits — a thread we are asked to close may be unclosable until they push. |

The exit contract was **exercised, not assumed** (2026-09-08): normal `0`; no `.env` `3`; wrong key
`2`; wrong id `2`; unreachable gateway `2`; and the hook itself exits `0` under every one of those,
so it can never block a session. Nothing rendered as "clear" that was not.

**Closing a thread: `closed` means RESOLVED, not SENT.** Appending a reply leaves it `open` with
`waiting_on` pointing at whoever owes the next move. And if a closing entry hands back new work,
**that work gets its own thread** — a board reading `we owe 0` because the obligation was buried in
a closing note is worse than no board. The inbox is **read-only**; filing, replying and closing are
all still git (`HANDOFFS.md` + `handoffs/handoffs.json` in the **same commit** — a pre-commit hook
and CI both enforce the pair).

## Before non-trivial gateway API work

1. `(cd ~/Programs/fin/ocr-llm && git pull --ff-only)`
2. **Read what the SessionStart hook printed** (above) — it replaces the old "read the tail of
   `HANDOFFS.md` by hand" step rather than sitting beside it, so the manual habit cannot quietly
   stay the real one. Re-run the CLI if the session is long.
3. Fetch the live spec: `curl -s http://100.66.213.40:8080/contracts/v1/gateway`
   — ⚠️ `/contracts` is **no longer exempt from auth** (2026-08-29): send both headers.
   `GET /task/routes` is still public and reports each task's `route[]`, `context_types` and
   `opt_in_only` steps.

## When Fin needs the gateway to change

Do not hand-roll a prompt against `/llm/generate`. Append an entry to
`~/Programs/fin/ocr-llm/HANDOFFS.md`:

```
## YYYY-MM-DD [Finance → ocr-llm] subject
```

State: task name, intent, required/optional context keys, response shape, route preference
(local-first vs quality-first), token budget, temperature, and any guardrail you want enforced
**server-side** rather than carried in our prompt.

## Where it's used in Fin

AI Review ([CR006](../cr/cr-006-ai-review.md)) and the [CR040](../cr/cr-040-forecast-scenario-compare.md)
compare narrative call the gateway from `server/src/v2/services/aiReview.js` via
`LLM_GATEWAY_URL` (see `.env.example`); reviews are stored in `fc_ai_reviews` (migrations
014/035). CR061 P2's statement extraction runs offline from `Scripts/extract-statements-llm.js`.

[CR092](../cr/cr-092-net-worth-bridge.md) P1's net-worth narration
(`server/src/services/netWorthNarration.js`) is the **only caller that DEGRADES rather than
fails**: every failure path — no key, a 4xx/5xx, a timeout, a `schema_violation`, an unparseable
body, an empty `drivers[]`, or a bridge whose drivers do not reconcile — returns
`{data: null, meta:{available:false, reason}}` and the page keeps the deterministic summary it was
already showing. Nothing here is a dependency, which is why an unset `OCR_LLM_CLIENT_KEY` **warns**
here where `aiReview.js` deliberately **throws**: a review that silently produces nothing is a bug,
a narration that silently produces nothing is the designed fallback.
