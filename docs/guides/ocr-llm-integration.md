# ocr-llm integration (local LLM gateway)

> Moved out of `CLAUDE.md` 2026-07-11 (starter-pack adoption). The gateway is a separate
> repo/system — never modify it while working in Fin, except appending handoff entries as
> described below.
>
> **Protocols last reviewed 2026-09-04** against `Documentation/Guides/LLM_PROTOCOLS.md` in
> the ocr-llm repo (the rules-of-engagement doc, added there 2026-09-04). This page records
> only what binds **Fin**; it links onward rather than restating a doc that moves.

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
you asked for (send `"on_unsatisfiable": "error"` for a `409`). Frontier models (`deepseek`,
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
| `finance_statement_extract` | 420 000 | `task` | 480 000 ✅ |
| `finance_plan_review` | 600 000 | `global_default` | 300 000 🔴 **inverted** — [Known Issue #28](../current/project-roadmap.md#3-known-issues) |

⚠️ **The ordering is load-bearing in BOTH directions, and both failures are silent.** Each bound must
be looser than the one it wraps: `chain < their deadline_ms < our abort < the browser`. A deadline
*below* its own chain silently deletes the fallback step. One *above* our abort leaves an abandoned
request pinning a serialised tier, because **our abort never reaches their GPU** (uvicorn does not
cancel a handler on client disconnect — their measurement, 2026-09-04). **Run this check whenever you
add a caller or change a timeout**; it took one command to find the AI Review inversion that had been
live for months.

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

## Before non-trivial gateway API work

1. `(cd ~/Programs/fin/ocr-llm && git pull --ff-only)`
2. Read the tail of `HANDOFFS.md` for `[ocr-llm → Finance]` or `[ocr-llm → all]` entries.
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
